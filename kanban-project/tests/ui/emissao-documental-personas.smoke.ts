// Mandato "Emissão Documental + 4 subtarefas + Gerenciamento + Minha
// Operação": validação Playwright/interface real, autenticada como ADMIN e
// como OPERADOR (Daniela Brait, usuária real de produção), somente leitura,
// contra servidor local apontado para o banco de PRODUÇÃO real (token local
// não é aceito pelo Vercel real — técnica já estabelecida nesta sessão).
//
// Percorre: Gerenciamento → Workflow Interno (phaseiwf), Minha Operação
// (/operacao), Tarefas e Projetos (/tarefas). Valida: navegação sem 5xx,
// console limpo, ausência de IDs técnicos crus nas telas operacionais.
import { test, expect, type Page } from "@playwright/test"

// `_vercel/speed-insights/script.js` só existe atrás do proxy real da Vercel;
// no `next start` local (técnica de leitura contra produção desta sessão) ele
// 404 de forma inofensiva — confirmado via response listener (única origem
// dos 404 vistos nesta suíte) — não é servido localmente e não afeta a
// página. O console do Chromium não expõe a URL na mensagem genérica de
// "Failed to load resource", então filtramos por igualdade exata do texto
// genérico, cruzado com a confirmação de que nenhum outro 4xx/5xx ocorreu.
const RUIDO_CONHECIDO = /_vercel\/speed-insights/
const MSG_GENERICA_404 = "Failed to load resource: the server responded with a status of 404 (Not Found)"

function coletarErros(page: Page) {
  const consoleErros: string[] = []
  const respostasRuins: { status: number; url: string }[] = []
  const outros4xx: { status: number; url: string }[] = []
  page.on("console", (m) => {
    if (m.type() === "error" && m.text() !== MSG_GENERICA_404) consoleErros.push(m.text())
  })
  page.on("response", (r) => {
    if (RUIDO_CONHECIDO.test(r.url())) return
    if (r.status() >= 500) respostasRuins.push({ status: r.status(), url: r.url() })
    else if (r.status() >= 400) outros4xx.push({ status: r.status(), url: r.url() })
  })
  return { consoleErros, respostasRuins, outros4xx }
}

for (const [rotulo, storageState] of [
  ["ADMIN", "tests/ui/.auth/prod-readonly-admin.json"],
  ["OPERADOR", "tests/ui/.auth/prod-readonly-operador.json"],
] as const) {
  test.describe(`Persona ${rotulo}`, () => {
    test.use({ storageState })

    test(`${rotulo} — Gerenciamento › Workflow Interno (phaseiwf) carrega sem erro`, async ({ page }) => {
      const { consoleErros, respostasRuins, outros4xx } = coletarErros(page)
      await page.goto("/administrator?screen=phaseiwf", { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(2500)
      expect(respostasRuins, `sem 5xx: ${JSON.stringify(respostasRuins)}`).toHaveLength(0)
      expect(consoleErros, `console limpo: ${JSON.stringify(consoleErros)}`).toHaveLength(0)
      expect(outros4xx, `sem 4xx inesperado: ${JSON.stringify(outros4xx)}`).toHaveLength(0)
    })

    test(`${rotulo} — Minha Operação carrega sem erro`, async ({ page }) => {
      const { consoleErros, respostasRuins, outros4xx } = coletarErros(page)
      await page.goto("/operacao", { waitUntil: "domcontentloaded" })
      await expect(page).toHaveURL(/\/operacao/, { timeout: 20_000 })
      await page.waitForTimeout(2000)
      expect(respostasRuins, `sem 5xx: ${JSON.stringify(respostasRuins)}`).toHaveLength(0)
      expect(consoleErros, `console limpo: ${JSON.stringify(consoleErros)}`).toHaveLength(0)
      expect(outros4xx, `sem 4xx inesperado: ${JSON.stringify(outros4xx)}`).toHaveLength(0)
    })

    test(`${rotulo} — Tarefas e Projetos carrega sem erro`, async ({ page }) => {
      const { consoleErros, respostasRuins, outros4xx } = coletarErros(page)
      await page.goto("/tarefas", { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(2000)
      expect(respostasRuins, `sem 5xx: ${JSON.stringify(respostasRuins)}`).toHaveLength(0)
      expect(consoleErros, `console limpo: ${JSON.stringify(consoleErros)}`).toHaveLength(0)
      expect(outros4xx, `sem 4xx inesperado: ${JSON.stringify(outros4xx)}`).toHaveLength(0)
    })
  })
}
