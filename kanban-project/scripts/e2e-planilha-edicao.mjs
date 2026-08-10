// scripts/e2e-planilha-edicao.mjs
// ============================================================================
// E2E DA EDIÇÃO INLINE — no NAVEGADOR, com clique de verdade.
//
// Teste de API não serve aqui. Já estava provado que o backend gravava o
// override; o que ninguém tinha provado é que dava para CHEGAR nele pela tela.
// Este teste clica na célula, digita, aperta Enter, recarrega a página e
// restaura o padrão — exatamente o que uma pessoa faria.
//
// ─── ESCREVE ────────────────────────────────────────────────────────────────
// O ciclo grava e depois REMOVE o override, deixando o processo como estava.
// Ainda assim, rode contra um processo que possa receber escrita.
//
//   node scripts/e2e-planilha-edicao.mjs <base> <processoId> <arquivo-token>
// ============================================================================
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const [BASE, PROCESSO, TOKEN_PATH] = process.argv.slice(2)
const token = readFileSync(TOKEN_PATH, "utf8").trim()
const user = readFileSync(TOKEN_PATH + ".user", "utf8").trim()

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

// O pt-BR separa "R$" do número com espaço NÃO-QUEBRÁVEL. Comparar com um
// espaço comum falha silenciosamente e faz o seletor "não achar" a célula que
// está bem ali na tela.
const dinheiro = (t) => (t ?? "").replace(/ /g, " ").trim()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e)))
page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()) })
// Falha de REDE da própria planilha, separada do ruído do resto da casca
// (favicon, cotação de câmbio, sessão) — que existe com ou sem esta tela e não
// pode mascarar nem ser mascarado por ela.
const falhasDaPlanilha = []
page.on("requestfailed", (r) => {
  if (/planilha-override|\/custos/.test(r.url())) falhasDaPlanilha.push(`${r.url()} ${r.failure()?.errorText ?? ""}`)
})
page.on("response", (r) => {
  if (r.status() >= 400 && /planilha-override|\/custos/.test(r.url())) falhasDaPlanilha.push(`${r.status()} ${r.url()}`)
})
await page.addInitScript(([t, u]) => {
  localStorage.setItem("authToken", t); localStorage.setItem("user", u)
}, [token, user])

/** Abre a Planilha Documental do processo. */
async function abrir() {
  await page.goto(`${BASE}/financeiro/v3/processo-preview?processoId=${PROCESSO}`, {
    waitUntil: "domcontentloaded", timeout: 90000,
  })
  await page.waitForTimeout(3500)
  await page.getByRole("button", { name: /^Custos$/ }).first().click()
  await page.waitForTimeout(2500)
  await page.getByRole("button", { name: /Planilha documental/ }).first().click()
  await page.waitForSelector("table", { timeout: 30000 })
  await page.waitForTimeout(1500)
}

const totalDoRodape = async () =>
  dinheiro(await page.locator("text=/^Total/").last().locator("..").innerText()).replace(/\s+/g, " ")

const celulaValor = async (loc) => dinheiro(await loc.innerText())

console.log(`E2E — edição inline da Planilha Documental · ${BASE} · processo ${PROCESSO}\n`)
await abrir()

// ═══════════════════════════════════════════════════════════════════════════
secao("Estado inicial")
// ═══════════════════════════════════════════════════════════════════════════
const monetarias = page.locator("td.cursor-text")
const nMonetarias = await monetarias.count()
ok("as células monetárias são editáveis", nMonetarias > 0, `${nMonetarias} célula(s)`)

const alvo = monetarias.first()
const valorInicial = await celulaValor(alvo)
ok("a célula mostra o preço base", /146,24/.test(valorInicial), valorInicial)
ok("o tooltip convida ao clique",
  /Clique para editar/.test((await alvo.getAttribute("title")) ?? ""),
  ((await alvo.getAttribute("title")) ?? "").split("\n")[0])

const totalInicial = await totalDoRodape()
ok("o rodapé mostra o total", /2\.193,60/.test(totalInicial), totalInicial)

// Nada por cima da célula: se houvesse overlay, o clique nunca chegaria.
const caixa = await alvo.boundingBox()
const noTopo = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y)
  return el ? el.tagName : "?"
}, [caixa.x + caixa.width / 2, caixa.y + caixa.height / 2])
ok("nada intercepta o clique na célula", noTopo === "TD" || noTopo === "SPAN", noTopo)

// ═══════════════════════════════════════════════════════════════════════════
secao("Clique → a própria célula vira campo")
// ═══════════════════════════════════════════════════════════════════════════
const alturaAntes = (await alvo.boundingBox()).height
await alvo.click()
await page.waitForTimeout(400)
const campo = page.locator("td input").first()
ok("o input aparece dentro da célula", (await campo.count()) === 1)
ok("nenhum modal foi aberto", (await page.locator('[role="dialog"]').count()) === 0)
ok("o valor vem selecionado para substituição",
  await page.evaluate(() => {
    const i = document.querySelector("td input")
    return !!i && i.selectionStart === 0 && i.selectionEnd === i.value.length
  }))
const alturaDurante = (await page.locator("td input").first().locator("..").boundingBox()).height
ok("a linha não muda de altura (sem layout shift)", Math.abs(alturaDurante - alturaAntes) <= 2,
  `${alturaAntes} → ${alturaDurante}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("Digitar 175 + Enter")
// ═══════════════════════════════════════════════════════════════════════════
await campo.fill("175")
await campo.press("Enter")
await page.waitForTimeout(2500)
ok("o input sai e a célula volta ao normal", (await page.locator("td input").count()) === 0)
const depois = await celulaValor(monetarias.first())
ok("a célula mostra R$ 175,00", /175,00/.test(depois), depois)
const totalDepois = await totalDoRodape()
ok("o total vai a R$ 2.222,36 sem recarregar", /2\.222,36/.test(totalDepois), totalDepois)
ok("a célula ganha o marcador de valor personalizado",
  (await monetarias.first().locator("span[aria-label]").count()) === 1)
ok("o tooltip passa a dizer que o valor é personalizado",
  /personalizado/.test((await monetarias.first().getAttribute("title")) ?? ""))

// ═══════════════════════════════════════════════════════════════════════════
secao("Reload → o combinado permanece")
// ═══════════════════════════════════════════════════════════════════════════
await abrir()
const aposReload = await celulaValor(page.locator("td.cursor-text").first())
ok("a célula continua R$ 175,00", /175,00/.test(aposReload), aposReload)
ok("o total continua R$ 2.222,36", /2\.222,36/.test(await totalDoRodape()))

// ═══════════════════════════════════════════════════════════════════════════
secao("Restaurar valor padrão")
// ═══════════════════════════════════════════════════════════════════════════
await page.locator("td.cursor-text").first().click()
await page.waitForTimeout(400)
const botao = page.getByRole("button", { name: /Restaurar valor padrão/ })
ok("a ação de restaurar aparece na edição", (await botao.count()) === 1)
await botao.first().click()
await page.waitForTimeout(2500)
const restaurado = await celulaValor(page.locator("td.cursor-text").first())
ok("a célula volta a R$ 146,24", /146,24/.test(restaurado), restaurado)
ok("o total volta a R$ 2.193,60", /2\.193,60/.test(await totalDoRodape()))
ok("o marcador de personalizado some",
  (await page.locator("td.cursor-text").first().locator("span[aria-label]").count()) === 0)

await abrir()
ok("depois de recarregar continua R$ 146,24",
  /146,24/.test(await celulaValor(page.locator("td.cursor-text").first())))
ok("e o total continua R$ 2.193,60", /2\.193,60/.test(await totalDoRodape()))

// ═══════════════════════════════════════════════════════════════════════════
secao("Escape cancela sem gravar")
// ═══════════════════════════════════════════════════════════════════════════
await page.locator("td.cursor-text").first().click()
await page.waitForTimeout(300)
await page.locator("td input").first().fill("999")
await page.locator("td input").first().press("Escape")
await page.waitForTimeout(1200)
ok("a célula segue R$ 146,24 após Esc",
  /146,24/.test(await celulaValor(page.locator("td.cursor-text").first())))
await abrir()
ok("e nada foi gravado (confirma após reload)",
  /146,24/.test(await celulaValor(page.locator("td.cursor-text").first())))

ok("nenhuma chamada da planilha falhou", falhasDaPlanilha.length === 0, falhasDaPlanilha.slice(0, 3).join(" | "))
ok("nenhuma exceção de JavaScript na tela",
  erros.filter((e) => !/Failed to load resource/.test(e)).length === 0,
  erros.filter((e) => !/Failed to load resource/.test(e)).slice(0, 2).join(" | "))
// O resto do ruído fica registrado, não escondido: ele é da casca, não da
// planilha, e some da conta sem sumir do relatório.
const ruido = erros.filter((e) => /Failed to load resource/.test(e))
if (ruido.length) console.log(`  ℹ ${ruido.length} recurso(s) da casca com falha (favicon/câmbio/sessão), alheios à planilha`)

await page.screenshot({ path: "/tmp/e2e-planilha-final.png", fullPage: true })
await browser.close()

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log("Cliquei na célula, editei, recarreguei e restaurei — pelo navegador.\n")
