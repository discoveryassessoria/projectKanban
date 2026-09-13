import { test, expect, type Page } from '@playwright/test'

test.use({ storageState: 'tests/ui/.auth/prod-readonly2.json' })

async function entrar(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('user')) {
      localStorage.setItem('user', JSON.stringify({ id: 3, nome: 'Marco Rovatti', email: 'marcoantonio@discoveryassessoria.com.br', tipo: 'admin' }))
    }
  })
}

test('Minha Operação (Central de Tarefas) — filtro Em risco mostra dado real com motivo', async ({ page }) => {
  await entrar(page)
  const erros: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
  const respostas: { status: number; url: string }[] = []
  page.on('response', (r) => respostas.push({ status: r.status(), url: r.url() }))

  await page.goto('/operacao', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/operacao/, { timeout: 30_000 })

  // "Sem responsável" é onde a Tarefa 3571 (EM_RISCO real, já provado na Etapa 6) mora.
  const abaSemResp = page.getByRole('button', { name: /sem responsável/i })
  if (await abaSemResp.count()) await abaSemResp.first().click()

  // Os filtros (Todas/A fazer/.../Em risco) só existem no modo LISTA — o modo
  // padrão é AGRUPADA (por família/processo).
  await page.getByRole('button', { name: /^lista$/i }).click()

  // O rótulo do filtro carrega a contagem ("Em risco 1") — o botão nunca é
  // "Em risco" sozinho quando há linha.
  const filtroRisco = page.getByRole('button', { name: /^em risco\b/i })
  await expect(filtroRisco, 'filtro "Em risco" existe na tela, com contagem real').toBeVisible({ timeout: 20_000 })
  await filtroRisco.click()

  await expect(page.getByText(/em risco:/i).first(), 'a linha real mostra o motivo do risco').toBeVisible({ timeout: 20_000 })
  const corpo = await page.locator('body').innerText()
  expect(corpo, 'o motivo real (não genérico) aparece no texto').toMatch(/SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL|SEM_RESPONSAVEL_PARA_PROXIMA_ACAO/)

  // "Acompanhar hoje"/"Retornos recebidos" ficam ocultos quando a contagem é
  // zero (mesma régua de "A fazer"/"Bloqueadas" etc.) — não é bug, é o
  // comportamento pretendido. A prova de que eles EXISTEM é estrutural (código
  // + typecheck + o teste de serviço), não desta tela com 1 única linha real.

  const cincoZero = respostas.filter((r) => r.status >= 500)
  expect(cincoZero, `sem 5xx — ${JSON.stringify(cincoZero)}`).toHaveLength(0)
  const errosLimpos = erros.filter((e) => !/favicon|ResizeObserver|hydrat|Failed to load resource/i.test(e))
  expect(errosLimpos, `console limpo — ${errosLimpos.join(' | ')}`).toHaveLength(0)
})
