// scripts/torre-nova-processo.pw.ts — Playwright do DETALHE DO PROCESSO contra o palco (NÃO entra na suíte crítica: precisa de servidor).
//   npx tsx scripts/torre-nova-processo.pw.ts [processoId]      (padrão: 10; escreve no banco EFÊMERO do palco — comenta, pausa/desfaz, distribui)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
const id = process.argv[2] ?? "10"
let falhou = 0
const ok = (n: string, c: boolean) => { console.log(`${c ? "  ✅" : "  ❌"} ${n}`); if (!c) falhou++ }
async function main() {
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 } })
await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: `http://localhost:${d.porta}` }])
await ctx.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
const page = await ctx.newPage()
await page.goto(`http://localhost:${d.porta}/torre/processo/${id}`, { waitUntil: "networkidle", timeout: 240000 })
await page.waitForSelector("text=Caminho do processo", { timeout: 60000 })
for (const t of ["Próxima ação · obrigatória", "Previsão · validade", "Últimos fatos", "Comentários da família", "Relatório de controle", "Histórico completo", "Árvore e cadastro", "Pausar processo"]) ok(`texto "${t}"`, (await page.getByText(t).count()) > 0)
ok("tabela Certidões/Tarefas da fase atual", (await page.getByText(/da fase atual · \d+/).count()) > 0)
// comentário com @menção
const nComent = await page.locator("[data-comentario]").count()
await page.getByLabel("Novo comentário").fill("@Daniela pode distribuir hoje? teste pw")
await page.getByRole("button", { name: "Comentar", exact: true }).click()
await page.waitForFunction((n) => document.querySelectorAll("[data-comentario]").length > n, nComent, { timeout: 60000 }).catch(() => {})
ok("comentário novo apareceu", (await page.locator("[data-comentario]").count()) === nComent + 1)
ok("menção destacada", (await page.locator(".tpr-mencao").filter({ hasText: "@Daniela" }).count()) > 0)
// relatório
await page.getByRole("button", { name: "Relatório de controle" }).click()
ok("modal do relatório", (await page.getByText(/Filtro: família/).count()) > 0)
await page.getByRole("button", { name: "Fechar" }).first().click()
// histórico
await page.getByRole("button", { name: "Histórico completo", exact: true }).click()
ok("modal do histórico", (await page.getByRole("dialog", { name: "Histórico completo", exact: true }).count()) > 0)
await page.getByRole("button", { name: "Fechar" }).first().click()
// pausar + desfazer
await page.getByRole("button", { name: "Pausar processo" }).click()
const confirmar = page.getByRole("button", { name: "Pausar processo" }).last()
ok("pausar exige motivo (botão desabilitado)", await confirmar.isDisabled())
await page.locator("textarea").fill("cliente sumiu (teste pw)")
await confirmar.click()
await page.waitForSelector("text=Processo pausado com motivo", { timeout: 60000 })
await page.waitForSelector("text=Reativar processo", { timeout: 60000 })
ok("selo Pausado e botão Reativar", (await page.getByText("Pausado", { exact: true }).count()) > 0)
await page.getByRole("button", { name: "Desfazer" }).click()
await page.waitForSelector("text=Pausar processo", { timeout: 60000 })
ok("desfazer reativou", (await page.getByRole("button", { name: "Pausar processo" }).count()) > 0)
// distribuir
const dist = page.getByRole("button", { name: /^Distribuir/ })
if (await dist.isEnabled()) { await dist.click(); await page.waitForSelector(".tpr-toast", { timeout: 30000 }); console.log("  toast:", await page.locator(".tpr-toast span").first().innerText()) }
await page.screenshot({ path: "prototipo-torre/impl/detalhe-processo-pw.png" })
await browser.close()
console.log(falhou ? `FALHOU ${falhou}` : "OK")
process.exit(falhou ? 1 : 0)
}
void main()
