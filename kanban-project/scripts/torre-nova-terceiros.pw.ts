// scripts/torre-nova-terceiros.pw.ts — E2E da aba TERCEIROS da Torre nova (frente G) contra o PALCO (localhost, banco efêmero).
// NÃO entra na suíte crítica (precisa de servidor). Rodar:   npx tsx scripts/torre-nova-terceiros.pw.ts
// Pré-requisito: `node scripts/dev-torre-nova.mjs` vivo (lê /private/tmp/claude-501/torre-nova-dev.json). ESCREVE no banco do palco
// (cobranças) — nunca contra outra coisa que não seja o palco. Capturas em prototipo-torre/impl/terceiros-*.png.
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"
import { PrismaClient } from "@prisma/client"

const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
const base = `http://localhost:${d.porta}`
if (!/^http:\/\/localhost:\d+$/.test(base)) throw new Error("só contra o palco local")
mkdirSync("prototipo-torre/impl", { recursive: true })
let falhas = 0
const ok = (nome: string, cond: boolean, extra = "") => { console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` — ${extra}` : ""}`); if (!cond) falhas++ }

/** Deixa o palco com pedidos para cobrar (ontem, hoje e antigos) — repetível: as cobranças desta própria suíte empurram a data 7 dias. */
async function prepararPalco() {
  if (!/^postgresql:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(d.urlBanco)) throw new Error("só o banco efêmero do palco")
  const db = new PrismaClient({ datasources: { db: { url: d.urlBanco } } })
  try {
    const execs = await db.subtaskExecution.findMany({ where: { subtaskKey: "aguardar_retorno", supersededAt: null, status: "AGUARDANDO_EXTERNO" }, orderBy: { id: "asc" }, take: 6, select: { id: true } })
    const dias = [-1, -1, 0, -3, -2, 0]
    for (const [i, e] of execs.entries()) await db.subtaskExecution.update({ where: { id: e.id }, data: { proximoAcompanhamentoEm: new Date(Date.now() + dias[i] * 86_400_000) } })
    console.log(`palco preparado: ${execs.length} pedido(s) com a cobrança vencida/de hoje`)
  } finally { await db.$disconnect() }
}

async function main() {
  await prepararPalco()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: base }])
await ctx.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
const page = await ctx.newPage()
const erros: string[] = []
page.on("pageerror", (e) => erros.push("pageerror: " + e.message))
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) erros.push(`${r.status()} ${r.url()}`) })
const shot = (n: string) => page.screenshot({ path: `prototipo-torre/impl/terceiros-${n}.png`, fullPage: false })

await page.goto(`${base}/torre?aba=terceiros`, { waitUntil: "networkidle", timeout: 240000 })
await page.getByRole("heading", { name: "Terceiros · quem de fora está nos devendo resposta" }).waitFor({ timeout: 60000 })
await page.getByText("Pedidos esperando resposta").waitFor()
await page.waitForTimeout(1500)

// ── estrutura (T363–T370, T390, T391)
ok("T363 breadcrumb", (await page.locator(".ter-trilha").innerText()).replace(/\s+/g, " ") === "Torre de Controle › Terceiros")
const kpis = await page.locator(".ter-kpi .ter-kpi-l").allInnerTexts()
ok("T364–T366 seis cartões com os rótulos do protótipo", kpis.join("|") === "aguardando terceiros|com cartórios|com o cliente|tradutora · juízo · consulado|para cobrar hoje ou vencidas|escaladas (sem resposta após 2 cobranças)", kpis.join("|"))
const nums = await page.locator(".ter-kpi .ter-kpi-n").allInnerTexts()
const [agu, cart, cli] = nums.map((x) => Number(x.replace(/\./g, "")))
const [tr, ju, co] = nums[3].split("·").map((x) => Number(x.trim()))
ok("cartões 2–4 repartem o cartão 1", cart + cli + tr + ju + co === agu, nums.join(" / "))
ok("T367 título do cartão", await page.getByRole("heading", { name: "Pedidos esperando resposta" }).isVisible())
ok("T368 alternância 'Ver:' com os dois botões", await page.getByRole("button", { name: "por pedido", exact: true }).isVisible() && await page.getByRole("button", { name: "agrupado por cartório (para cobrar junto)" }).isVisible())
const colunas = (await page.locator(".tor-hd.ter-g span").allInnerTexts()).map((t) => t.toLowerCase())
ok("T370 colunas", colunas.join("|") === "certidão · pessoa · família|pedida a|pedida há|cobrar em|ações", colunas.join("|"))
const nota = await page.locator(".ter-nota").innerText()
ok("T390 rodapé do cartão", nota.includes("não há ranking nem média por cartório") && nota.includes("padrão: 7 dias depois do pedido ou da última cobrança"))
ok("T391 sem filtros, ordenação nem paginação", (await page.locator(".tor-card select, .tor-card input").count()) === 0)
const corpo = await page.locator("body").innerText()
ok("sem placar por cartório (sem resposta/não localizada)", !/Sem resposta \(dias\)|Não localizada/.test(corpo))
ok("Régua por órgão, Tempo médio real por fase e Backlog continuam na aba", /Régua de cobrança por órgão/.test(corpo) && /Tempo médio real por fase/.test(corpo) && /Backlog/.test(corpo))
const botaoTodos = await page.getByRole("button", { name: /^Cobrar todos os vencidos \(\d+\)$/ }).innerText()
const nVenc = Number(/\((\d+)\)/.exec(botaoTodos)![1])
ok("T369 'Cobrar todos os vencidos (N)' = cartão 'para cobrar'", nVenc === Number(nums[4]), botaoTodos)
const nLinhas = await page.locator(".tor-row.ter-g").count()
const nCobrar = await page.locator(".tor-row.ter-g >> text=Cobrar").locator("xpath=self::button").count()
ok("T378 só os pedidos com cobrança hoje/vencida têm 'Cobrar'; os demais 'Ver'", (await page.locator(".tor-row.ter-g button.pri").count()) === nVenc, `${nLinhas} pedidos, ${nCobrar}`)
await shot("por-pedido")

// ── Contatos (T381–T385)
await page.locator(".tor-row.ter-g").first().getByRole("button", { name: "Contatos" }).click()
await page.getByRole("dialog").waitFor()
const dlg = page.getByRole("dialog")
await dlg.locator(".ter-contatos li").first().waitFor({ timeout: 60000 })
ok("T381 modal Contatos: título e subtítulo", /^Contatos · Certidão/.test(await dlg.locator("h3").innerText()) && /^Pedido a .* · .* até agora$/.test(await dlg.locator(".ter-modal-texto").innerText()))
ok("T381 botão único 'Fechar'", (await dlg.getByRole("button").allInnerTexts()).join("|") === "Fechar")
ok("T382–T385 linhas com data/hora e frase", (await dlg.locator(".ter-contatos li").count()) >= 1 && /\d{2}\/\d{2}/.test(await dlg.locator(".ter-contatos li .quando").first().innerText()))
await shot("modal-contatos")
await dlg.getByRole("button", { name: "Fechar" }).click()

// ── Cobrar um pedido (T379, T380) — escreve no palco
const primeiro = page.locator(".tor-row.ter-g", { has: page.locator("button.pri") }).first()
const pedidoId = await primeiro.getAttribute("data-pedido")
const pessoa = (await primeiro.locator(".small").first().innerText()).split(" · ")[0]
const antes = await (await fetch(`${base}/api/torre/terceiros/pedidos/${pedidoId}/contatos`, { headers: { Authorization: `Bearer ${d.tokenAdmin}` } })).json()
await primeiro.getByRole("button", { name: "Cobrar" }).click()
const modal = page.getByRole("dialog")
ok("T379 modal 'Registrar cobrança · <órgão>' sem prometer envio", /^Registrar cobrança · /.test(await modal.locator("h3").innerText()) && /Registra a cobrança no histórico da certidão e marca a próxima\. O sistema não envia a mensagem: o canal abaixo é o que você usou\.$/.test(await modal.locator(".ter-modal-texto").innerText()))
ok("T379 campos Canal e Próxima cobrança em (dias) = 7; botões Cancelar / Registrar cobrança", await modal.locator("label.ter-campo", { hasText: "Canal usado" }).first().isVisible() && (await modal.locator("input[type=number]").inputValue()) === "7" && (await modal.getByRole("button").allInnerTexts()).join("|") === "Cancelar|Registrar cobrança")
await shot("modal-cobrar-pedido")
await modal.locator("input[type=number]").fill("0")
ok("próxima cobrança fora de 1–60 não envia", await modal.getByRole("button", { name: "Registrar cobrança" }).isDisabled())
await modal.locator("input[type=number]").fill("7")
await modal.getByRole("button", { name: "Registrar cobrança" }).click()
await page.getByRole("status").filter({ hasText: `Cobrança registrada · ${pessoa}` }).waitFor({ timeout: 20000 })
ok("T380 toast 'Cobrança registrada · <pessoa>'", true)
await shot("toast-cobranca")
const depois = await (await fetch(`${base}/api/torre/terceiros/pedidos/${pedidoId}/contatos`, { headers: { Authorization: `Bearer ${d.tokenAdmin}` } })).json()
ok("a cobrança REGISTROU no histórico do pedido (um contato novo)", depois.contatos.length === antes.contatos.length + 1, `${antes.contatos.length} → ${depois.contatos.length}`)
await page.locator(`.tor-row.ter-g[data-pedido="${pedidoId}"] button.pri`).waitFor({ state: "detached", timeout: 60000 })
ok("e AGENDOU a próxima: o pedido deixou de ser 'Cobrar' e mostra a data futura", true, await page.locator(`.tor-row.ter-g[data-pedido="${pedidoId}"] .ter-cobrar-em`).last().innerText())
await page.getByRole("button", { name: `Cobrar todos os vencidos (${nVenc - 1})` }).waitFor({ timeout: 60000 })
const nVencDepois = Number(/\((\d+)\)/.exec(await page.getByRole("button", { name: /^Cobrar todos os vencidos/ }).innerText())![1])
ok("o número de vencidos caiu em 1", nVencDepois === nVenc - 1, `${nVenc} → ${nVencDepois}`)

// ── Agrupado por cartório (T387–T389)
await page.getByRole("button", { name: "agrupado por cartório (para cobrar junto)" }).click()
await page.locator(".ter-grupo").first().waitFor()
const grupos = await page.locator(".ter-grupo").evaluateAll((els) => els.map((e) => ({ nome: e.querySelector(".ter-grupo-nome")!.textContent!, sub: e.querySelector(".ter-grupo-sub")!.textContent!, botao: e.querySelector("button")?.textContent ?? "" })))
ok("T387 cabeçalhos '<n> pedido(s) · cobrança registrada em cada certidão'", grupos.length > 0 && grupos.every((g) => /^\d+ pedido\(s\) · cobrança registrada em cada certidão$/.test(g.sub)))
ok("T389 ordenado por nome do órgão", grupos.map((g) => g.nome).join("|") === [...grupos.map((g) => g.nome)].sort((a, b) => a.localeCompare(b, "pt-BR")).join("|"))
ok("T388 botão 'Cobrar este cartório (n)' com o mesmo n do subtítulo", grupos.every((g) => g.botao === `Cobrar este cartório (${/^(\d+)/.exec(g.sub)![1]})`))
ok("sem número comparativo por cartório (nada além de nome + n pedidos)", grupos.every((g) => !/média|ranking|sem resposta|dias/i.test(g.sub)))
await shot("agrupado-por-cartorio")
const alvo = page.locator(".ter-grupo", { has: page.locator("button") }).last()
const nomeAlvo = await alvo.locator(".ter-grupo-nome").innerText()
const nAlvo = Number(/\((\d+)\)/.exec(await alvo.getByRole("button").innerText())![1])
await alvo.getByRole("button").click()
await page.getByRole("status").filter({ hasText: "registrada em cada uma" }).waitFor({ timeout: 30000 })
const msg = await page.getByRole("status").innerText()
ok("T388 toast 'Cobrança registrada para <órgão> com <n> certidão(ões) · registrada em cada uma'", msg.includes(`Cobrança registrada para ${nomeAlvo} com `) && msg.includes("registrada em cada uma"), msg)
await page.waitForTimeout(500)
await page.getByRole("button", { name: "por pedido", exact: true }).click()

// ── Cobrar todos os vencidos (T386)
const nAntesTodos = Number(/\((\d+)\)/.exec(await page.getByRole("button", { name: /^Cobrar todos os vencidos/ }).innerText())![1])
if (nAntesTodos > 0) {
  await page.getByRole("button", { name: /^Cobrar todos os vencidos/ }).click()
  const m2 = page.getByRole("dialog")
  const texto = await m2.locator(".ter-modal-texto").innerText()
  ok("T386 modal 'Cobrar todos os vencidos' com o texto do protótipo", (await m2.locator("h3").innerText()) === "Cobrar todos os vencidos" && new RegExp(`^${nAntesTodos} pedidos? com data de cobrança vencida ou de hoje, em \\d+ cartórios?\\. Registra uma cobrança em cada certidão, pelo canal cadastrado dela\\. O sistema não envia a mensagem\\.$`).test(texto), texto)
  ok("T386 botões Cancelar / 'Registrar N cobranças'", (await m2.getByRole("button").allInnerTexts()).join("|") === `Cancelar|Registrar ${nAntesTodos} ${nAntesTodos === 1 ? "cobrança" : "cobranças"}`)
  await shot("modal-cobrar-todos")
  await m2.getByRole("button", { name: /^Registrar \d+ cobran/ }).click()
  await page.getByRole("status").filter({ hasText: /cobran(ça|ças) registrad(a|as)/ }).waitFor({ timeout: 30000 })
  ok("T386 toast 'N cobranças registradas'", true, await page.getByRole("status").innerText())
  await page.waitForTimeout(6000)
  const nDepois = Number(/\((\d+)\)/.exec(await page.getByRole("button", { name: /^Cobrar todos os vencidos/ }).innerText())![1])
  ok("depois de cobrar todos, nenhum vencido (cada um tem a próxima data)", nDepois < nAntesTodos, `${nAntesTodos} → ${nDepois}`)
  await shot("apos-cobrar-todos")
}

// ── Ver leva ao Detalhe do Processo (T378)
const ver = page.locator(".tor-row.ter-g").getByRole("button", { name: "Ver", exact: true }).first()
if (await ver.count()) { await ver.click(); await page.waitForURL(/\/torre\/processo\/\d+/, { timeout: 60000 }); ok("T378 'Ver' leva ao Detalhe do Processo", true, page.url()) }

ok("sem erros de console/HTTP", erros.length === 0, erros.join(" | "))
await browser.close()
console.log(falhas === 0 ? "PASSOU" : `FALHOU: ${falhas}`)
process.exit(falhas === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
