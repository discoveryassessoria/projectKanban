// tests/ui/delete-processo-lifecycle.smoke.ts
//
// SMOKE AUTENTICADO DO DELETE DE PROCESSO — pela interface real, contra o
// BANCO DE TESTE LOCAL (nunca produção — este arquivo ESCREVE/EXCLUI).
//
// Pré-requisito (fora deste arquivo):
//   1) servidor local apontado para o banco de teste, na porta usada abaixo;
//   2) `npx tsx scripts/ui-fixtures-delete-processo.ts` — monta usuários e
//      processos marcados UIDELPROC e assina os 2 storageState usados aqui;
//   3) depois de rodar: `npx tsx scripts/ui-fixtures-delete-processo.ts --limpar`.
//
// Roda com:
//   UI_TEST_BASE_URL=http://localhost:3480 \
//     npx playwright test tests/ui/delete-processo-lifecycle.smoke.ts --config=playwright.config.ts
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const MARCA = 'UIDELPROC'
const PAIS = 'Alemanha'

const fixture = JSON.parse(readFileSync('tests/ui/.auth/delete-processo-fixture.json', 'utf8')) as {
  usuarios: { autorizado: { id: number }; naoAutorizado: { id: number } }
  processos: {
    limpo: number; bloqueado: number
    arvoreCompartilhada: { arvoreId: number; pessoaId: number; procA: number; procB: number }
  }
}

/** Autenticação em memória (localStorage.user), igual ao smoke de Pessoa. */
async function entrar(page: Page, nome: string, tipo: string, id: number) {
  await page.addInitScript(([n, t, i]) => {
    localStorage.setItem('user', JSON.stringify({ id: i, nome: n, email: `${n}@teste.local`, tipo: t }))
  }, [nome, tipo, id] as const)
}

async function chamar(page: Page, url: string, init?: { method?: string }) {
  return page.evaluate(
    async ([u, i]) => {
      const token = localStorage.getItem('authToken')
      const r = await fetch(u as string, {
        method: (i as { method?: string })?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      return { status: r.status, corpo: await r.text() }
    },
    [url, init ?? {}] as const,
  )
}

/** Vai para Processos → país → Lista, e filtra pela marca do fixture. */
async function abrirLista(page: Page) {
  await page.goto('/kanban', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/kanban/, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Processos' }).first().click()
  await page.getByRole('button', { name: PAIS }).first().click()
  await page.getByRole('button', { name: 'Lista' }).click()
  const busca = page.getByPlaceholder('Buscar processo...')
  await busca.waitFor({ state: 'visible', timeout: 20_000 })
  await busca.fill(MARCA)
}

function linha(page: Page, nome: string) {
  return page.locator('tr', { hasText: nome })
}

async function abrirMenuDaLinha(page: Page, nome: string) {
  const tr = linha(page, nome)
  await expect(tr, `linha "${nome}" visível`).toBeVisible({ timeout: 20_000 })
  await tr.getByRole('button').last().click()
}

test.describe('DELETE de Processo — usuário AUTORIZADO (processos.excluirDefinitivo)', () => {
  test.use({ storageState: 'tests/ui/.auth/delete-processo-autorizado.json' })

  test('preview, bloqueio financeiro, exclusão real, árvore/família preservadas, idempotência', async ({ page }) => {
    await entrar(page, `${MARCA} Autorizado`, 'admin', fixture.usuarios.autorizado.id)

    const errosDeConsole: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errosDeConsole.push(m.text()) })
    const respostas: { status: number; url: string }[] = []
    page.on('response', (r) => respostas.push({ status: r.status(), url: r.url() }))

    await abrirLista(page)

    // ── 1) Os 4 processos do fixture estão visíveis ──────────────────────────
    for (const nome of [
      `${MARCA} Processo Limpo`, `${MARCA} Processo Bloqueado`,
      `${MARCA} Processo A (arvore)`, `${MARCA} Processo B (arvore)`,
    ]) {
      await expect(linha(page, nome), `linha "${nome}" aparece na lista`).toBeVisible({ timeout: 20_000 })
    }

    // ── 2) RBAC frontend positivo: usuário autorizado VÊ "Excluir" ───────────
    await abrirMenuDaLinha(page, `${MARCA} Processo Limpo`)
    const excluirLimpo = page.getByRole('menuitem', { name: /excluir/i })
    await expect(excluirLimpo, 'opção Excluir visível para quem tem a permissão').toBeVisible({ timeout: 10_000 })

    // ── 3) PREVIEW real + exclusão de um processo LIMPO ──────────────────────
    let dialogMsg = ''
    page.once('dialog', async (d) => { dialogMsg = d.message(); await d.accept() })
    await excluirLimpo.click()
    await expect.poll(() => dialogMsg, { timeout: 15_000, message: 'diálogo de confirmação apareceu' }).not.toBe('')
    expect(dialogMsg, 'o preview cita que nada financeiro será atingido').toMatch(/nenhum fato financeiro materializado/i)
    expect(dialogMsg, 'o preview cita a contagem de tarefas/necessidades/etc').toMatch(/serão removidos/i)

    await expect(linha(page, `${MARCA} Processo Limpo`), 'a linha some sem recarregar')
      .toBeHidden({ timeout: 20_000 })

    // ── 4) Coerência preview × DELETE: chamar de novo é NÃO ENCONTRADO, não 500 ──
    const repetir = await chamar(page, `/api/processos/${fixture.processos.limpo}`, { method: 'DELETE' })
    expect(repetir.status, `segunda exclusão do mesmo processo — ${repetir.corpo}`).toBe(404)

    // ── 5) BLOQUEIO por fato financeiro: visual (alert) + server-side (409) ──
    let alertMsg = ''
    page.once('dialog', async (d) => { alertMsg = d.message(); await d.dismiss() })
    await abrirMenuDaLinha(page, `${MARCA} Processo Bloqueado`)
    await page.getByRole('menuitem', { name: /excluir/i }).click()
    await expect.poll(() => alertMsg, { timeout: 15_000, message: 'alerta de bloqueio apareceu' }).not.toBe('')
    expect(alertMsg, 'o alerta explica o bloqueio por fato financeiro').toMatch(/não é possível excluir/i)
    expect(alertMsg, 'o alerta cita o movimento financeiro real').toMatch(/movimento\(s\) financeiro\(s\)/i)
    // Bloqueado NA TELA (alert) ⇒ nenhuma chamada DELETE deve ter saído.
    const deletesDisparados = respostas.filter((r) => r.url.includes(`/api/processos/${fixture.processos.bloqueado}`) && r.status !== 200)
    expect(deletesDisparados, 'nenhum DELETE chegou a sair para o processo bloqueado (recusado antes, no preview)').toHaveLength(0)
    await expect(linha(page, `${MARCA} Processo Bloqueado`), 'a linha continua lá — nada foi apagado')
      .toBeVisible({ timeout: 10_000 })

    // Mesmo se a interface tivesse deixado passar, o servidor recusa (409) —
    // prova server-side independente do client.
    const tentativaServidor = await chamar(page, `/api/processos/${fixture.processos.bloqueado}`, { method: 'DELETE' })
    expect(tentativaServidor.status, `bloqueio também é aplicado no servidor — ${tentativaServidor.corpo}`).toBe(409)
    expect(tentativaServidor.corpo, 'o servidor também cita o fato financeiro').toMatch(/financeir/i)

    // ── 6) Árvore compartilhada: excluir A não afeta B, Árvore nem Família ───
    let dialogArvore = ''
    page.once('dialog', async (d) => { dialogArvore = d.message(); await d.accept() })
    await abrirMenuDaLinha(page, `${MARCA} Processo A (arvore)`)
    await page.getByRole('menuitem', { name: /excluir/i }).click()
    await expect.poll(() => dialogArvore, { timeout: 15_000 }).not.toBe('')
    await expect(linha(page, `${MARCA} Processo A (arvore)`), 'processo A some').toBeHidden({ timeout: 20_000 })
    await expect(linha(page, `${MARCA} Processo B (arvore)`), 'processo B da MESMA árvore continua intacto')
      .toBeVisible({ timeout: 10_000 })

    // ── 7) Reload: o estado persiste, nada volta e nada some indevidamente ───
    await page.reload({ waitUntil: 'domcontentloaded' })
    await abrirLista(page)
    await expect(linha(page, `${MARCA} Processo Limpo`), 'processo limpo continua excluído após reload').toBeHidden({ timeout: 20_000 })
    await expect(linha(page, `${MARCA} Processo A (arvore)`), 'processo A continua excluído após reload').toBeHidden({ timeout: 20_000 })
    await expect(linha(page, `${MARCA} Processo Bloqueado`), 'processo bloqueado continua existindo após reload').toBeVisible({ timeout: 20_000 })
    await expect(linha(page, `${MARCA} Processo B (arvore)`), 'processo B continua existindo após reload').toBeVisible({ timeout: 20_000 })

    // ── 8) Rede: nenhum 5xx; todo 4xx é um dos que ESTE teste provocou de propósito ──
    const cincoZero = respostas.filter((r) => r.status >= 500)
    expect(cincoZero, `nenhuma resposta 5xx — ${JSON.stringify(cincoZero)}`).toHaveLength(0)

    const quatroXX = respostas.filter((r) => r.status >= 400 && r.status < 500 && r.url.includes('/api/'))
    const quatroXXInesperado = quatroXX.filter((r) => !(
      (r.status === 404 && r.url.includes(`/processos/${fixture.processos.limpo}`)) ||       // 2ª exclusão (idempotência)
      (r.status === 409 && r.url.includes(`/processos/${fixture.processos.bloqueado}`))       // bloqueio financeiro
    ))
    expect(quatroXXInesperado, `todo 4xx de API é um dos provocados de propósito — ${JSON.stringify(quatroXXInesperado)}`).toHaveLength(0)

    // "Failed to load resource" não diz QUAL recurso — o navegador loga isso
    // para qualquer resposta >=400, inclusive as que este teste PROVOCA de
    // propósito (404 da 2ª exclusão, 409 do bloqueio financeiro). A prova real
    // de "sem 4xx/5xx inesperado" já foi feita acima contra `respostas`
    // (com URL e status) — mesmo padrão de `exclusao-pessoa.smoke.ts`.
    const erros = errosDeConsole.filter((e) => !/favicon|ResizeObserver|hydrat|Failed to load resource/i.test(e))
    if (erros.length) console.log('\n[console]\n' + erros.map((e) => '  · ' + e).join('\n'))
    expect(erros, `console limpo — ${erros.join(' | ')}`).toHaveLength(0)
  })
})

test.describe('DELETE de Processo — usuário NÃO AUTORIZADO (tipo=admin, sem a permissão EXCLUSIVA)', () => {
  test.use({ storageState: 'tests/ui/.auth/delete-processo-nao-autorizado.json' })

  test('a ação some da interface e o servidor recusa mesmo sendo admin', async ({ page }) => {
    await entrar(page, `${MARCA} NaoAutorizado`, 'admin', fixture.usuarios.naoAutorizado.id)

    await abrirLista(page)
    // O processo Bloqueado e o B (arvore) ainda existem (o teste anterior só
    // excluiu Limpo e A).
    await expect(linha(page, `${MARCA} Processo Bloqueado`)).toBeVisible({ timeout: 20_000 })

    // ── RBAC frontend negativo: nem admin vê "Excluir" ───────────────────────
    await abrirMenuDaLinha(page, `${MARCA} Processo Bloqueado`)
    await expect(page.getByRole('menuitem', { name: /editar/i }), 'o menu abriu (Editar está lá)').toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('menuitem', { name: /excluir/i }), 'Excluir NÃO aparece para quem não tem a permissão')
      .toHaveCount(0)
    await page.keyboard.press('Escape')

    // ── RBAC backend: 403 mesmo chamando a API direto, mesmo sendo admin ─────
    const previewNegado = await chamar(page, `/api/processos/${fixture.processos.bloqueado}/impacto-exclusao`)
    expect(previewNegado.status, `preview recusado — ${previewNegado.corpo}`).toBe(403)
    expect(previewNegado.corpo).toMatch(/processos\.excluirDefinitivo/)

    const deleteNegado = await chamar(page, `/api/processos/${fixture.processos.bloqueado}`, { method: 'DELETE' })
    expect(deleteNegado.status, `DELETE recusado — ${deleteNegado.corpo}`).toBe(403)
    expect(deleteNegado.corpo).toMatch(/processos\.excluirDefinitivo/)

    // O processo continua intacto — a tentativa negada não teve efeito algum.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await abrirLista(page)
    await expect(linha(page, `${MARCA} Processo Bloqueado`), 'continua existindo — 403 não teve efeito colateral')
      .toBeVisible({ timeout: 20_000 })
  })
})
