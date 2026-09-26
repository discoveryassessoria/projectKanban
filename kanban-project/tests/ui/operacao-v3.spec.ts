// tests/ui/operacao-v3.spec.ts
//
// ETAPA 3 — TELA OPERAÇÃO (idêntica ao protótipo).
//
// Suíte SOMENTE LEITURA (mesma regra do resto de tests/ui): navega, lê,
// confere — nunca clica em Iniciar/Cobrar/Adiar/Concluir de verdade (o
// servidor de dev aponta pro banco de produção). A identidade da suíte é
// sempre admin (global-setup.ts); "Marco Rovatti" normalmente não tem tarefa
// pessoal atribuída, então esta suíte prova ESTRUTURA (abas, KPIs, sem
// crash, sem 5xx) — não conteúdo rico. As capturas com dado real (usuária
// operadora de verdade, "Daniela Brait") ficam em
// tests/ui/.artifacts/operacao-v3/*.png, tiradas manualmente nesta rodada
// (ver docs/design/operacao-v3-prototipo.html para o "antes" de comparação).
import { test, expect } from '@playwright/test'

test('Operação v3 — 6 abas, KPIs e sino carregam sem erro', async ({ page }) => {
  const erros: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
  const respostas: { status: number; url: string }[] = []
  page.on('response', (r) => respostas.push({ status: r.status(), url: r.url() }))

  await page.goto('/operacao', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/operacao/, { timeout: 30_000 })

  // As 6 abas, na ordem — mesma ordem do protótipo.
  const ABAS = ['Fila', 'Aguardando', 'Acompanhamento', 'Famílias', 'Radar', 'Feito']
  for (const rotulo of ABAS) {
    await expect(page.getByRole('button', { name: new RegExp(`^${rotulo}\\b`) }).first(), `aba "${rotulo}" existe`).toBeVisible({ timeout: 20_000 })
  }

  // Os 5 KPIs do cabeçalho.
  for (const rotulo of ['Fila', 'Aguardando', 'Acomp. vencidos', 'Atrasadas', 'Abertas']) {
    await expect(page.getByText(rotulo, { exact: true }).first(), `KPI "${rotulo}" existe`).toBeVisible({ timeout: 20_000 })
  }

  // O sino de notificações abre e fecha.
  await page.getByRole('button', { name: /Notificações operacionais/i }).click()
  await expect(page.getByText('Notificações operacionais', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '✕' }).first().click()

  // Navega pelas 6 abas — cada uma renderiza sem quebrar (estado vazio é ok, crash não).
  for (const rotulo of ABAS.slice(1)) {
    await page.getByRole('button', { name: new RegExp(`^${rotulo}\\b`) }).first().click()
    await page.waitForTimeout(400)
  }

  const cincoZero = respostas.filter((r) => r.status >= 500)
  expect(cincoZero, `sem 5xx — ${JSON.stringify(cincoZero)}`).toHaveLength(0)
  const errosLimpos = erros.filter((e) => !/favicon|ResizeObserver|hydrat|Failed to load resource/i.test(e))
  expect(errosLimpos, `console limpo — ${errosLimpos.join(' | ')}`).toHaveLength(0)
})
