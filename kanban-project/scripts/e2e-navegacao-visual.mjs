// scripts/e2e-navegacao-visual.mjs
// ============================================================================
// O CLIQUE REAL — "Continuar" leva ao processo, não a um drawer local.
//
//   node scripts/e2e-navegacao-visual.mjs <base> <saida> <tokFunc>
//
// O critério do §22 é visual: build verde e teste unitário não bastam. Aqui o
// teste faz o que a Daniela faz — vê a fila, clica em Continuar — e falha se
// aparecer o painel da tarefa por cima da tela Operação.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
let passou = 0, falhou = 0
const falhas = []
const ok = (n, c, e = "") => { if (c) { passou++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) } }
const secao = (t) => console.log(`\n${t}`)

const token = readFileSync(TOK, "utf8").trim()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 1050 } })
await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", u) },
  [token, readFileSync(TOK + ".user", "utf8").trim()])

console.log("E2E — CONTINUAR LEVA AO PROCESSO\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§20 · A fila, e o clique")
// ═══════════════════════════════════════════════════════════════════════════
await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForTimeout(4000)
const aba = page.getByRole("button", { name: /^Minha fila$/ })
if (await aba.count()) { await aba.click(); await page.waitForTimeout(3000) }
const fila = await page.locator("main").innerText()
ok("§3) a fila lista o trabalho", /Certidão|Inteiro Teor/i.test(fila))
await page.screenshot({ path: `${OUT}/1-fila.png` })

const urlAntes = page.url()
const botao = page.getByRole("button", { name: /^(Continuar|Iniciar tarefa)$/ }).first()
ok("§10) existe a ação principal", await botao.count() > 0)
await botao.click()
await page.waitForTimeout(6000)

// ═══════════════════════════════════════════════════════════════════════════
secao("§22 · FALHA se o drawer local aparecer")
// ═══════════════════════════════════════════════════════════════════════════
const urlDepois = page.url()
ok("§1) a URL mudou — houve navegação", urlDepois !== urlAntes, urlDepois.replace(BASE, ""))
ok("§5) e ela é o deep-link canônico",
  /processoId=\d+/.test(urlDepois) && /tab=central/.test(urlDepois) && /taskId=\d+/.test(urlDepois),
  urlDepois.replace(BASE, ""))
ok("§22) NÃO ficou na tela Operação", !/\/operacao/.test(new URL(urlDepois).pathname))

const corpo = await page.locator("body").innerText()
ok("§6) abriu o PROCESSO", /Central Operacional|CENTRAL OPERACIONAL/i.test(corpo) || /Processo/i.test(corpo))
await page.screenshot({ path: `${OUT}/2-central.png`, fullPage: true })

// ═══════════════════════════════════════════════════════════════════════════
secao("§6 · Documento certo, Workflow selecionado, Step atual")
// ═══════════════════════════════════════════════════════════════════════════
ok("§6) o painel do documento abriu", /Workflow|WORKFLOW/i.test(corpo))
const passos = ["Solicitar certidão", "Aguardar retorno do cartório", "Receber certidão", "Conferir certidão", "Validar certidão"]
const visiveis = passos.filter((p) => corpo.includes(p))
ok("§6) o workflow do documento está à vista", visiveis.length >= 3, `${visiveis.length}/5 passos`)
ok("§9) e nenhum passo aparece em chave técnica",
  !/solicitar_certidao|receber_certidao|aguardar_retorno/i.test(corpo))

// ═══════════════════════════════════════════════════════════════════════════
secao("§15 · Refresh preserva o contexto")
// ═══════════════════════════════════════════════════════════════════════════
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForTimeout(6000)
ok("§15) a URL sobrevive ao refresh", page.url() === urlDepois, page.url().replace(BASE, ""))
const depoisRefresh = await page.locator("body").innerText()
ok("§15) e o contexto volta", /Workflow|WORKFLOW/i.test(depoisRefresh))
await page.screenshot({ path: `${OUT}/3-refresh.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§16 · Back volta para a fila")
// ═══════════════════════════════════════════════════════════════════════════
await page.goBack({ waitUntil: "domcontentloaded" })
await page.waitForTimeout(3500)
ok("§16) voltar leva à Operação", /\/operacao/.test(new URL(page.url()).pathname), page.url().replace(BASE, ""))

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
