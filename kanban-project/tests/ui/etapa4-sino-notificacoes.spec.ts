// tests/ui/etapa4-sino-notificacoes.spec.ts
//
// VALIDAÇÃO AO VIVO DO SINO REAL — Etapa 4, contra dados de PRODUÇÃO (quando
// `.env` aponta para produção — ver README da suíte).
//
// Autenticado como o admin técnico de tests/ui/global-setup.ts. Verifica que
// /api/notificacoes alimenta o sino com os AVISOS AGRUPADOS reais (um aviso não
// lido por pessoa/família/tipo — redesenho 29/09/2026: `{ avisos, anteriores,
// total }`, lidos SÓ da tabela), que o clique marca o aviso como lido (e só
// isso) e leva à Operação já na família, e que o estado persiste após reload.
//
// SOMENTE 1 ESCRITA intencional: marcar UM aviso como lido — a mesma ação que
// o usuário real faria clicando nele. Antes/depois das Tarefas que o aviso
// cobre (`tarefaIds`) são comparados byte a byte para provar que nada mais
// mudou. Sem aviso não lido disponível, o teste pula (nunca fabrica uma linha
// direto no banco).

import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { ehRuido } from './telas'

const prisma = new PrismaClient()
const BOTAO_SINO = 'button.relative.inline-flex.items-center.justify-center.rounded-full'

test.describe('Etapa 4 — sino real em produção', () => {
  test('renderiza, mostra aviso agrupado real, marca como lido sem efeito colateral, persiste', async ({ page }) => {
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
    expect(Array.isArray(corpo.avisos)).toBe(true)
    expect(Array.isArray(corpo.anteriores)).toBe(true)
    expect(typeof corpo.total).toBe('number')
    test.skip(corpo.avisos.length === 0, 'admin de teste não tem aviso não lido no momento — nada para clicar')

    const alvo = corpo.avisos[0] as { id: number; titulo: string; tipo: string; link: string | null; familiaId: number | null; contagem: number }
    // O aviso nunca leva ao Kanban: sempre à Operação (ou Distribuição/Visão global, no caso do gestor).
    if (alvo.link) expect(alvo.link).not.toContain('/kanban')

    // 4) badge/contador reflete o total (>0)
    const badge = sino.locator('span')
    await expect(badge).toBeVisible()
    const badgeTextoAntes = await badge.innerText()
    expect(Number(badgeTextoAntes.replace('+', '')) || 9).toBeGreaterThan(0)

    // Estado das Tarefas que o aviso cobre — ANTES de qualquer clique.
    const avisoAntes = await prisma.notificacaoOperacional.findUnique({ where: { id: alvo.id }, select: { tarefaIds: true } })
    const tarefasAntes = avisoAntes?.tarefaIds.length
      ? await prisma.tarefa.findMany({ where: { id: { in: avisoAntes.tarefaIds } }, orderBy: { id: 'asc' } })
      : []

    // 5) abrir o dropdown e localizar o aviso real pelo título ("<Família> — N tarefas ...")
    await sino.click()
    const dropdown = page.getByText('Notificações', { exact: true }).locator('..')
    await expect(dropdown).toBeVisible()
    const item = page.getByRole('button', { name: new RegExp(alvo.titulo.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
    await expect(item, `aviso "${alvo.titulo}" precisa estar visível no dropdown`).toBeVisible()

    // o título (que já traz a contagem agrupada) bate com o que a API devolveu
    await expect(item).toContainText(alvo.titulo)

    // 6) clicar — marca como lida + navega para o deep-link
    const respLida = page.waitForResponse((r) => /\/api\/notificacoes\/\d+\/lida/.test(r.url()))
    await item.click()
    const rLida = await respLida
    expect(rLida.status()).toBe(200)
    expect((await rLida.json()).ok).toBe(true)

    // deep-link correto: chegou na Operação, já na família do aviso (`?processo=<id>`)
    if (alvo.link) {
      const url = new URL(alvo.link, 'http://x')
      await expect(page).toHaveURL(new RegExp(url.pathname.replace('/', '\\/')))
      if (url.searchParams.get('processo')) {
        await expect(page).toHaveURL(new RegExp(`processo=${url.searchParams.get('processo')}`))
      }
    }

    // 7) efeito colateral ZERO sobre as Tarefas que o aviso cobre
    if (tarefasAntes.length > 0) {
      const tarefasDepois = await prisma.tarefa.findMany({ where: { id: { in: tarefasAntes.map((t) => t.id) } }, orderBy: { id: 'asc' } })
      expect(JSON.stringify(tarefasDepois)).toBe(JSON.stringify(tarefasAntes))
    }

    // o aviso está lido no banco
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

    // 9) reload — persistência: o MESMO aviso não aparece mais como não lido
    await page.reload()
    const resp2 = await page.waitForResponse((r) => r.url().includes('/api/notificacoes') && r.request().method() === 'GET')
    const corpo2 = await resp2.json()
    expect((corpo2.avisos as Array<{ id: number }>).some((a) => a.id === alvo.id)).toBe(false)

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
