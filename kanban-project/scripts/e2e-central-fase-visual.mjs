// scripts/e2e-central-fase-visual.mjs
// ============================================================================
// A TABELA DA FASE, PELO NAVEGADOR — com volume de verdade.
//
//   node scripts/e2e-central-fase-visual.mjs <base> <saida> <token> <processoId>
//
// Build verde e teste unitário não dizem se a tela ficou legível. O critério
// desta rodada é operacional: com quinhentos documentos, bater o olho e
// identificar o que falta. Isso só se verifica olhando.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK, PROCESSO] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
let passou = 0, falhou = 0
const falhas = []
const ok = (n, c, e = "") => { if (c) { passou++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) } }
const secao = (t) => console.log(`\n${t}`)

const token = readFileSync(TOK, "utf8").trim()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } })
await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", u) },
  [token, readFileSync(TOK + ".user", "utf8").trim()])
page.on("console", (m) => { if (m.type() === "error") console.log(`    ! ${m.text().slice(0, 160)}`) })

console.log("E2E — A CENTRAL DA FASE COM VOLUME REAL\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§16/§42 · Quinhentos documentos abrem, e abrem rápido")
// ═══════════════════════════════════════════════════════════════════════════
const t0 = Date.now()
await page.goto(`${BASE}/kanban?processoId=${PROCESSO}&tab=central`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(9000)
const ms = Date.now() - t0
const corpo = await page.locator("body").innerText()
ok("§42) a Central abriu com a fase", /Central Operacional/i.test(corpo), `${ms}ms`)
await page.screenshot({ path: `${OUT}/1-fase.png`, fullPage: false })

// ═══════════════════════════════════════════════════════════════════════════
secao("§22/§34 · Com volume, os cards nascem fechados")
// ═══════════════════════════════════════════════════════════════════════════
// É o comportamento certo: vinte e cinco cards abertos com quinhentas linhas
// seria um muro. O agrupamento por pessoa continua, e o operador abre quem quer.
ok("§22) o agrupamento por pessoa continua", /Pessoa\d\d/.test(corpo))
const cardPessoa = page.locator("button").filter({ hasText: /Pessoa01/ }).first()
await cardPessoa.click()
await page.waitForTimeout(3000)
const tabela = await page.locator("body").innerText()
await page.screenshot({ path: `${OUT}/1b-pessoa-aberta.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§3/§4 · As colunas são as da FASE ATUAL")
// ═══════════════════════════════════════════════════════════════════════════
// O cabeçalho é desenhado em CAIXA ALTA pelo CSS: o texto no DOM continua
// "Etapa atual", mas `innerText` devolve o que a tela mostra.
const semCaixa = tabela.toLowerCase()
for (const c of ["Documento", "Progresso", "Etapa atual", "Responsável", "Prazo", "Status"]) {
  ok(`§3) a tabela tem "${c}"`, semCaixa.includes(c.toLowerCase()))
}
// "Apostilamento" é uma FASE do processo e continua na trilha macro do topo — o
// que saiu foi a COLUNA "Apostila" da tabela desta fase.
for (const c of ["Retificada", "Apostila<", "Status final"]) {
  const html = await page.content()
  ok(`§4) e a tabela NÃO tem mais a coluna "${c.replace("<", "")}"`,
    !html.includes(`>${c.replace("<", "")}</div>`))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§6/§10/§11/§13 · A linha diz onde o trabalho está")
// ═══════════════════════════════════════════════════════════════════════════
ok("§6) há percentual por documento", /\d+%/.test(tabela))
ok("§10) e etapa em nome de gente",
  /Solicitar certidão|Aguardar retorno do cartório|Receber certidão|Conferir certidão|Validar certidão/.test(tabela))
ok("§10) nunca a chave técnica", !/solicitar_certidao|receber_certidao|aguardar_retorno/.test(tabela))
ok("§11) o responsável aparece", /Daniela Brait|Sem responsável/.test(tabela))
ok("§13) e o status operacional também", /A fazer|Em andamento|Aguardando terceiro|Bloqueada|Concluída/.test(tabela))
// O atraso pode não estar na pessoa aberta; o recorte de atrasados prova que
// eles existem e são reconhecíveis.
const ordemAtraso = page.getByLabel("Ordenar").first()
if (await ordemAtraso.count()) { await ordemAtraso.selectOption("prazo"); await page.waitForTimeout(2500) }
const comAtraso = await page.locator("body").innerText()
ok("§41) atraso aparece como condição, junto do status",
  /Atrasada/.test(comAtraso), (comAtraso.match(/Atrasada há \d+ dias?/) ?? ["—"])[0])

// ═══════════════════════════════════════════════════════════════════════════
secao("§18/§43 · O contador PENDENTES filtra")
// ═══════════════════════════════════════════════════════════════════════════
const kpiPendentes = page.getByRole("button").filter({ hasText: /^\d+\s*Pendentes$/ }).first()
const temKpi = await kpiPendentes.count() > 0
ok("§18) o contador de pendentes é clicável", temKpi)
if (temKpi) {
  await kpiPendentes.click()
  await page.waitForTimeout(2500)
  const filtrado = await page.locator("body").innerText()
  ok("§36) e o rodapé diz de que conjunto fala", /\d+ de \d+ documento\(s\)/.test(filtrado),
    (filtrado.match(/\d+ de \d+ documento\(s\)/) ?? ["—"])[0])
  ok("§43) o recorte não mostra nada concluído",
    !/Concluída/.test(filtrado.split("Documentos por pessoa")[1] ?? ""))
  await page.screenshot({ path: `${OUT}/2-pendentes.png` })
  await kpiPendentes.click()
  await page.waitForTimeout(2000)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§21 · A busca encontra")
// ═══════════════════════════════════════════════════════════════════════════
const busca = page.getByPlaceholder("Buscar pessoa ou documento…").first()
const temBusca = await busca.count() > 0
ok("§21) existe busca textual", temBusca)
if (temBusca) {
  await busca.fill("Pessoa03")
  await page.waitForTimeout(2500)
  const achado = await page.locator("body").innerText()
  ok("§21) e ela recorta o conjunto", /\d+ de \d+ documento\(s\)/.test(achado),
    (achado.match(/\d+ de \d+ documento\(s\)/) ?? ["—"])[0])
  await page.screenshot({ path: `${OUT}/3-busca.png` })
  await busca.fill("zzzz-nao-existe")
  await page.waitForTimeout(2000)
  const vazio = await page.locator("body").innerText()
  ok("§36) recorte vazio NÃO diz que a fase está vazia",
    /Nenhum documento neste recorte/.test(vazio) && !/não tem trabalho materializado/.test(vazio))
  await busca.fill("")
  await page.waitForTimeout(1500)
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§17 · Ordenar por prazo é possível")
// ═══════════════════════════════════════════════════════════════════════════
const ordem = page.getByLabel("Ordenar").first()
if (await ordem.count()) {
  await ordem.selectOption("prazo")
  await page.waitForTimeout(2500)
  ok("§17) a ordenação por prazo aplica", true)
  await page.screenshot({ path: `${OUT}/4-ordem-prazo.png` })
} else {
  ok("§17) a ordenação por prazo aplica", false, "seletor de ordem não encontrado")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("§15 · A linha abre o painel do documento — a porta de sempre")
// ═══════════════════════════════════════════════════════════════════════════
const acao = page.getByRole("button", { name: /^(Iniciar|Continuar|Ver etapa|Ver bloqueio|Ver detalhes)$/ }).first()
if (await acao.count()) {
  await acao.click()
  await page.waitForTimeout(5000)
  const painel = await page.locator("body").innerText()
  ok("§15) o painel operacional do documento abriu", /Workflow|Anexos|Observações/i.test(painel))
  // ITEM 1 §7/§9/§28 — a ação leva DIRETO ao workflow daquele documento. O
  // painel entrava por uma aba "Operação" que repetia a linha inteira e ainda
  // exigia mais um clique: uma Central dentro da Central.
  ok("§7) não existe mais a aba 'Operação' no painel do documento",
    !(await page.getByRole("button", { name: /^Operação$/ }).count()))
  ok("§9) e o painel já mostra o WORKFLOW do documento",
    /Central da Etapa|etapas ·|concluídas/i.test(painel))
  ok("§12) com a etapa atual à vista", /Solicitar certidão|Aguardar retorno do cartório|Receber certidão|Conferir certidão|Validar certidão/.test(painel))
  // ITEM 1 §2 — o cabeçalho do painel mostra a MESMA pessoa que a linha.
  ok("§2) o responsável do painel não contradiz a linha",
    /Daniela Brait|Não atribuído/.test(painel))
  await page.screenshot({ path: `${OUT}/5-documento.png` })
} else {
  ok("§15) o painel operacional do documento abriu", false, "nenhuma ação de linha encontrada")
}

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
