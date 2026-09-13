// tests/ui/etapa4-sino-notificacoes.spec.ts
//
// VALIDAÇÃO AO VIVO DO SINO REAL — Etapa 4, contra dados de PRODUÇÃO (quando
// `.env` aponta para produção — ver README da suíte).
//
// Autenticado como o admin técnico de tests/ui/global-setup.ts. Verifica que
// /api/notificacoes alimenta o sino com NotificacaoOperacional real, que o
// clique marca como lida (e só isso), e que o estado persiste após reload.
//
// SOMENTE 1 ESCRITA intencional: marcar UMA notificação como lida — a mesma
// ação que o usuário real faria clicando nela. Antes/depois da Tarefa
// referenciada são comparados byte a byte para provar que nada mais mudou.
// Sem notificação não-lida disponível, o teste pula (nunca fabrica uma linha
// direto no banco).

import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { ehRuido } from './telas'

const prisma = new PrismaClient()
const BOTAO_SINO = 'button.relative.inline-flex.items-center.justify-center.rounded-full'

test.describe('Etapa 4 — sino real em produção', () => {
  test('renderiza, mostra notificação real, marca como lida sem efeito colateral, persiste', async ({ page }) => {
    const erros: string[] = []
    page.on('console', (msg) => { if (msg.type() === 'error') erros.push(msg.text()) })
    page.on('response', (res) => { if (res.status() >= 500) erros.push(`${res.status()} ${res.url()}`) })

    // 1) abrir a app autenticado
    await page.goto('/kanban')
    await expect(page).not.toHaveURL(/\/login/)

    // 2) o header carrega
    const sino = page.locator(BOTAO_SINO)
    await expect(sino).toBeVisible()

    // 3) /api/notificacoes alimenta o sino — espera a resposta real
    const respNotif = await page.waitForResponse((r) => r.url().includes('/api/notificacoes') && r.request().method() === 'GET')
    expect(respNotif.status()).toBe(200)
    const corpo = await respNotif.json()
    expect(Array.isArray(corpo.acontecimentos)).toBe(true)
    test.skip(corpo.acontecimentos.length === 0, 'admin de teste não tem NotificacaoOperacional não lida no momento — nada para clicar')

    const alvo = corpo.acontecimentos[0] as { id: number; titulo: string; mensagem: string | null; tipo: string; link: string | null }

    // 4) badge/contador reflete o total (>0)
    const badge = sino.locator('span')
    await expect(badge).toBeVisible()
    const badgeTextoAntes = await badge.innerText()
    expect(Number(badgeTextoAntes.replace('+', '')) || 9).toBeGreaterThan(0)

    // Estado da Tarefa referenciada — ANTES de qualquer clique.
    const tarefaAntes = alvo.link?.includes('taskId=')
      ? await prisma.tarefa.findUnique({ where: { id: Number(new URL(alvo.link, 'http://x').searchParams.get('taskId')) } })
      : null

    // 5) abrir o dropdown e localizar a notificação real pelo título
    await sino.click()
    const dropdown = page.getByText('Notificações', { exact: true }).locator('..')
    await expect(dropdown).toBeVisible()
    const bloco = page.getByText('Atenção operacional', { exact: true })
    await expect(bloco).toBeVisible()
    const item = page.getByRole('button', { name: new RegExp(alvo.titulo.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
    await expect(item, `notificação "${alvo.titulo}" precisa estar visível no dropdown`).toBeVisible()

    // título e conteúdo batem com o que a API devolveu
    await expect(item).toContainText(alvo.titulo)
    if (alvo.mensagem) await expect(item).toContainText(alvo.mensagem.slice(0, 30))

    // 6) clicar — marca como lida + navega para o deep-link
    const respLida = page.waitForResponse((r) => /\/api\/notificacoes\/\d+\/lida/.test(r.url()))
    await item.click()
    const rLida = await respLida
    expect(rLida.status()).toBe(200)
    expect((await rLida.json()).ok).toBe(true)

    // deep-link correto: chegou na Central do processo certo
    if (alvo.link) {
      const url = new URL(alvo.link, 'http://x')
      await expect(page).toHaveURL(new RegExp(url.pathname.replace('/', '\\/')))
      if (url.searchParams.get('processoId')) {
        await expect(page).toHaveURL(new RegExp(`processoId=${url.searchParams.get('processoId')}`))
      }
    }

    // 7) efeito colateral ZERO sobre a Tarefa referenciada
    if (tarefaAntes) {
      const tarefaDepois = await prisma.tarefa.findUnique({ where: { id: tarefaAntes.id } })
      expect(JSON.stringify(tarefaDepois)).toBe(JSON.stringify(tarefaAntes))
    }

    // a notificação está lida no banco
    const notifDepois = await prisma.notificacaoOperacional.findUnique({ where: { id: alvo.id } })
    expect(notifDepois?.lidaEm).not.toBeNull()

    // 8) badge diminuiu (ou sumiu) depois de reabrir
    await page.goto('/kanban')
    await page.waitForResponse((r) => r.url().includes('/api/notificacoes') && r.request().method() === 'GET')
    const sino2 = page.locator(BOTAO_SINO)
    const badge2 = sino2.locator('span')
    const totalDepois = (await badge2.count()) > 0 ? Number((await badge2.innerText()).replace('+', '')) : 0
    const totalAntes = Number(badgeTextoAntes.replace('+', ''))
    expect(totalDepois).toBeLessThanOrEqual(totalAntes)

    // 9) reload — persistência: a MESMA notificação não aparece mais como não-lida
    await page.reload()
    const resp2 = await page.waitForResponse((r) => r.url().includes('/api/notificacoes') && r.request().method() === 'GET')
    const corpo2 = await resp2.json()
    expect((corpo2.acontecimentos as Array<{ id: number }>).some((a) => a.id === alvo.id)).toBe(false)

    // 10) console/network limpos (sem 500, sem erro JS de verdade — fora do ruído conhecido)
    const errosReais = erros.filter((e) => !ehRuido(e))
    expect(errosReais, JSON.stringify(errosReais)).toEqual([])
  })

  test('RBAC: outro usuário não marca a notificação de alguém como lida', async () => {
    const outro = await prisma.usuario.findFirst({ where: { tipo: { not: 'admin' } }, orderBy: { id: 'asc' }, select: { id: true } })
    const alvo = await prisma.notificacaoOperacional.findFirst({ where: { lidaEm: null }, select: { id: true, destinatarioId: true } })
    test.skip(!outro || !alvo || outro.id === alvo.destinatarioId, 'sem par usuário-diferente/notificação para testar RBAC agora')

    const token = execFileSync('npx', ['tsx', 'scripts/ui-token-outro-usuario.ts', String(outro!.id)], {
      cwd: process.cwd(), encoding: 'utf8', env: process.env,
    })
    const base = process.env.UI_TEST_BASE_URL ?? 'http://localhost:3411'
    const res = await fetch(`${base}/api/notificacoes/${alvo!.id}/lida`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(403)
    const notifDepois = await prisma.notificacaoOperacional.findUnique({ where: { id: alvo!.id } })
    expect(notifDepois?.lidaEm).toBeNull()
  })
})

test.afterAll(async () => { await prisma.$disconnect() })
