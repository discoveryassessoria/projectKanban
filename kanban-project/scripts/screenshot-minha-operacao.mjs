// Screenshot autenticado local (build de produção + banco real) de Minha Operação.
import { chromium } from "playwright"
import { execSync } from "node:child_process"

const BASE = "http://localhost:3411"

async function main() {
  const tokenDaniela = execSync(`npx tsx scripts/_gerar-token-daniela.ts`, { cwd: process.cwd(), encoding: "utf8" }).trim()

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await ctx.addCookies([{ name: "authToken", value: tokenDaniela, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
  const page = await ctx.newPage()
  const erros = []
  page.on("console", (msg) => { if (msg.type() === "error") erros.push(msg.text()) })
  page.on("pageerror", (err) => erros.push(String(err)))
  page.on("response", (r) => { if (r.url().includes("/api/operacao/tarefas")) console.log("RESP", r.status(), r.url()) })
  page.on("requestfailed", (r) => console.log("FAILED", r.url(), r.failure()?.errorText))
  await page.addInitScript((token) => {
    window.localStorage.setItem("authToken", token)
    window.localStorage.setItem("user", JSON.stringify({ id: 12, nome: "Daniela Brait", email: "daniela@discoveryassessoria.com.br", tipo: "assistente" }))
  }, tokenDaniela)

  await page.goto(`${BASE}/operacao`, { waitUntil: "load", timeout: 60000 })
  await page.waitForTimeout(15000)
  await page.screenshot({ path: "/tmp/minha-operacao-daniela.png", fullPage: false })
  console.log("screenshot salvo: /tmp/minha-operacao-daniela.png")

  // Clica na primeira linha pra abrir o detalhe
  const primeiraLinha = page.locator("table tbody tr").first()
  if (await primeiraLinha.count() > 0) {
    const respPromise = page.waitForResponse((r) => r.url().includes("/api/operacao/tarefas/") && r.request().method() === "GET").catch(() => null)
    await primeiraLinha.click()
    const resp = await respPromise
    if (resp) console.log("dossiê respondeu:", resp.status())
    await page.waitForTimeout(2000)
    await page.screenshot({ path: "/tmp/minha-operacao-daniela-detalhe.png", fullPage: false })
    console.log("screenshot com detalhe salvo: /tmp/minha-operacao-daniela-detalhe.png")

    const abaPassos = page.getByRole("tab", { name: "Passos" })
    if (await abaPassos.count() > 0) {
      await abaPassos.click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: "/tmp/minha-operacao-daniela-passos.png", fullPage: false })
      console.log("screenshot aba Passos salvo: /tmp/minha-operacao-daniela-passos.png")
    }
    const abaPrazos = page.getByRole("tab", { name: "Prazos e acompanhamentos" })
    if (await abaPrazos.count() > 0) {
      await abaPrazos.click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: "/tmp/minha-operacao-daniela-prazos.png", fullPage: false })
      console.log("screenshot aba Prazos salvo: /tmp/minha-operacao-daniela-prazos.png")
    }
  }

  const tokenAdmin = execSync(`npx tsx scripts/_gerar-token-admin.ts`, { cwd: process.cwd(), encoding: "utf8" }).trim()
  const ctxAdmin = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await ctxAdmin.addCookies([{ name: "authToken", value: tokenAdmin, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
  const pageAdmin = await ctxAdmin.newPage()
  await pageAdmin.addInitScript((token) => {
    window.localStorage.setItem("authToken", token)
    window.localStorage.setItem("user", JSON.stringify({ id: 3, nome: "Marco Rovatti", email: "marcoantonio@discoveryassessoria.com.br", tipo: "admin" }))
  }, tokenAdmin)
  await pageAdmin.goto(`${BASE}/tarefas`, { waitUntil: "load", timeout: 60000 })
  await pageAdmin.waitForTimeout(6000)
  await pageAdmin.screenshot({ path: "/tmp/tarefas-e-projetos-comparacao.png", fullPage: false })
  console.log("screenshot Tarefas e Projetos salvo: /tmp/tarefas-e-projetos-comparacao.png")

  await pageAdmin.goto(`${BASE}/operacao`, { waitUntil: "load", timeout: 60000 })
  await pageAdmin.waitForTimeout(6000)
  await pageAdmin.screenshot({ path: "/tmp/minha-operacao-marco.png", fullPage: false })
  console.log("screenshot Minha Operação (Marco/admin) salvo: /tmp/minha-operacao-marco.png")

  console.log(`\nErros de console/página: ${erros.length}`)
  for (const e of erros.slice(0, 20)) console.log("  -", e)
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
