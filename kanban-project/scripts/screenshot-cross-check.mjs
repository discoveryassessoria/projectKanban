// Comparação cruzada: Home + sino + Minha Operação + Tarefas e Projetos, mesma Daniela, mesmo momento.
import { chromium } from "playwright"
import { execSync } from "node:child_process"

const BASE = "http://localhost:3411"

async function main() {
  const tokenDaniela = execSync(`npx tsx scripts/_gerar-token-daniela.ts`, { cwd: process.cwd(), encoding: "utf8" }).trim()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } })
  await ctx.addCookies([{ name: "authToken", value: tokenDaniela, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" }])
  const page = await ctx.newPage()
  await page.addInitScript((token) => {
    window.localStorage.setItem("authToken", token)
    window.localStorage.setItem("user", JSON.stringify({ id: 12, nome: "Daniela Brait", email: "daniela@discoveryassessoria.com.br", tipo: "assistente" }))
  }, tokenDaniela)

  // 1) HOME
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 60000 })
  await page.waitForResponse((r) => r.url().includes("/api/home") && r.request().method() === "GET", { timeout: 40000 }).catch((e) => console.log("home resp timeout:", e.message))
  await page.waitForTimeout(2000)
  await page.screenshot({ path: "/tmp/cross-1-home.png", fullPage: false })
  console.log("1) home salvo")

  // 2) SINO aberto
  const sino = page.locator("button[aria-label*='otifica' i], button:has(svg.lucide-bell)").first()
  if (await sino.count() > 0) {
    await sino.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: "/tmp/cross-2-sino.png", fullPage: false })
    console.log("2) sino salvo")
    await page.keyboard.press("Escape")
  } else {
    console.log("2) sino NÃO encontrado por seletor — screenshot da home já mostra o ícone")
  }

  // 3) MINHA OPERAÇÃO
  await page.goto(`${BASE}/operacao`, { waitUntil: "load", timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: "/tmp/cross-3-minha-operacao.png", fullPage: false })
  console.log("3) minha operação salvo")

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
