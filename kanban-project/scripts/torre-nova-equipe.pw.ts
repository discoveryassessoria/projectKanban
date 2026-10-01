// Playwright da aba Equipe (contra o palco em localhost; NÃO entra na suíte crítica — precisa de servidor).
//   npx tsx scripts/torre-nova-equipe.pw.ts
// Marca e cancela uma ausência (reversível), abre os modais e a simulação (só leitura), e Distribui + Desfaz as sem dono.
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: `http://localhost:${d.porta}` }])
  await ctx.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${d.porta}/torre?aba=equipe`, { waitUntil: "networkidle", timeout: 240000 })
  await page.getByText("Quem está carregando o quê").waitFor({ timeout: 120000 })
  for (const t of ["Pessoa", "Carga", "Ativas", "Atrasadas", "Aguard. terceiros", "Fila", "Ações", "Previsão de carga · próximas 4 semanas"]) assert.ok(await page.getByText(t, { exact: true }).first().isVisible(), t)
  const linha = (n: string) => page.locator(".eqp-row", { hasText: n }).first()
  const pessoa = "Lucas Ferraz"
  await linha(pessoa).getByRole("button", { name: "Marcar ausência" }).click()
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()          // cancelar fecha sem toast
  assert.equal(await page.locator(".tor-toast").count(), 0)
  await linha(pessoa).getByRole("button", { name: "Marcar ausência" }).click()
  await page.getByRole("button", { name: "Marcar", exact: true }).click()
  await page.locator(".tor-toast", { hasText: `Ausência marcada · ${pessoa}` }).waitFor()
  await linha(pessoa).getByRole("button", { name: "Cancelar ausência" }).click()
  await page.locator(".tor-toast", { hasText: `Ausência de ${pessoa} cancelada` }).waitFor()
  await linha("Daniela Brait").getByRole("button", { name: "Simular saída" }).click()
  await page.getByText("Nada foi gravado").waitFor()
  assert.match(await page.locator(".eqp-sim-txt").innerText(), /^Vencem \d+ prazos nesses 10 dias e \d+ certidões ficam sem toque\./)
  await page.getByRole("button", { name: "Fechar", exact: true }).click()
  await page.getByRole("button", { name: /Distribuir as \d+ por aptidão e carga/ }).click()
  await page.locator(".tor-toast", { hasText: "por aptidão e carga" }).waitFor({ timeout: 120000 })
  await page.locator(".tor-toast").getByRole("button", { name: "Desfazer" }).click()
  await page.locator(".tor-toast", { hasText: "Desfeito" }).waitFor()
  await browser.close()
  console.log("OK")
}
main().catch((e) => { console.error(e); process.exit(1) })
