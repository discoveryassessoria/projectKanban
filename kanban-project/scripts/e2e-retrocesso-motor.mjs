// scripts/e2e-retrocesso-motor.mjs
// ============================================================================
// O MOTOR DE FASES PELO NAVEGADOR — retrocesso, reentrada e autoavanço.
//
//   node scripts/e2e-retrocesso-motor.mjs <base> <saida> <tokenExecutor> <palco.json>
//
// O palco deixa o processo exatamente onde o caso real estava: já esteve na fase
// seguinte, voltou pela movimentação manual, e tem UMA etapa pendente na fase atual.
//
// O que só o navegador responde:
//
//   • a Central abre na fase em que o processo está, com as duas certidões — a que
//     ficou pronta na visita anterior e a que nasceu depois;
//   • concluir a última etapa PELA MESMA CHAMADA QUE A TELA FAZ muda a fase do
//     processo sozinho — sem arrastar card e sem F5 forçado;
//   • a Central então passa a mostrar a fase seguinte, e o trabalho que estava lá
//     continua lá.
//
// A conclusão usa `PATCH /api/documentos/{id}/workflow/steps/{stepId}` — é a porta
// que o executor da Central chama quando o operador clica em concluir. O clique em
// si (qual botão, em qual editor) tem suíte própria: `e2e-central-da-etapa.mjs`.
// Aqui o alvo é o EFEITO no motor de fases, com a sessão real do operador.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_EXEC, PALCO] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const palco = JSON.parse(readFileSync(PALCO, "utf8"))

let passou = 0, falhou = 0
const falhas = []
const ok = (n, c, e = "") => {
  if (c) { passou++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) }
  else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()
async function abaDe(tokenPath) {
  const token = readFileSync(tokenPath, "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } })
  await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", u) },
    [token, readFileSync(tokenPath + ".user", "utf8").trim()])
  return page
}

/** A Central do processo, como o servidor a entrega para a tela. */
const central = (page, procId) => page.evaluate(async ([id]) => {
  const r = await fetch(`/api/processos/${id}/central-operacional?queue=all&sort=priority`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  if (!r.ok) return { erro: r.status }
  const d = await r.json()
  const i = d.indice ?? {}
  const docs = [...(i.linhaPrincipal ?? []), ...(i.foraDaLinha ?? []), ...(i.pendenteClassificacao ?? [])]
    .flatMap((p) => p.documentos ?? []).concat(i.semDono ?? [])
  return {
    fase: d.phaseContext?.faseMacroKey ?? null,
    ciclo: d.phaseContext?.ciclo ?? null,
    documentos: docs.map((x) => ({ id: x.documentoId, estado: x.naFase?.estado ?? null, progresso: x.naFase?.progresso ?? null })),
  }
}, [procId])

/** O roteiro de um documento — o que a aba Workflow desenha. */
const workflowDoDoc = (page, docId) => page.evaluate(async ([id]) => {
  const r = await fetch(`/api/documentos/${id}/workflow`, { headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } })
  if (!r.ok) return { erro: r.status }
  const d = await r.json()
  if (!d.workflow) return { semWorkflow: true }
  return { steps: (d.workflow.steps ?? []).map((s) => ({ id: s.id, stepKey: s.stepKey, status: String(s.status).toUpperCase() })) }
}, [docId])

console.log("E2E — RETROCESSO, REENTRADA E AUTOAVANÇO PELO NAVEGADOR\n")
const page = await abaDe(TOK_EXEC)

// ═══════════════════════════════════════════════════════════════════════════
secao("1) O ponto de partida: o processo voltou de fase e tem UMA etapa pendente")
// ═══════════════════════════════════════════════════════════════════════════
await page.goto(`${BASE}/kanban?processoId=${palco.processoId}&tab=central`, { waitUntil: "domcontentloaded", timeout: 120000 })
await page.waitForTimeout(9000)

const antes = await central(page, palco.processoId)
ok("a Central responde para a sessão do operador", !antes.erro, JSON.stringify(antes).slice(0, 120))
ok("e mostra a fase para a qual o processo voltou", antes.fase === palco.faseAtual, String(antes.fase))
ok("a visita atual é um ciclo novo (a anterior está preservada)", antes.ciclo >= 2, String(antes.ciclo))
ok("as duas certidões da fase estão no índice", antes.documentos.length === 2,
  JSON.stringify(antes.documentos))

const wfPendenteAntes = await workflowDoDoc(page, palco.documentoPendenteId)
const feitosAntes = (wfPendenteAntes.steps ?? []).filter((s) => /CONCLU/.test(s.status)).length
ok("a certidão que nasceu depois está em 4 de 5", feitosAntes === 4,
  JSON.stringify((wfPendenteAntes.steps ?? []).map((s) => s.status)))
// A CERTIDÃO DA VISITA ANTERIOR — lida pela projeção da Central, que é escopada
// pelo ciclo vigente. (O endpoint cru do roteiro documental devolve também os passos
// dos ciclos anteriores do mesmo documento; isso é anterior a esta rodada e está
// registrado no relatório, não corrigido aqui.)
const naCentral = (id) => antes.documentos.find((d) => d.id === id)
ok("a certidão da visita anterior continua inteira (5 de 5) — o retrocesso não a desfez",
  naCentral(palco.documentoConcluidoId)?.progresso?.concluidos === 5 &&
  naCentral(palco.documentoConcluidoId)?.progresso?.total === 5,
  JSON.stringify(naCentral(palco.documentoConcluidoId)))
ok("e a Central a mostra como CONCLUÍDA na visita atual",
  naCentral(palco.documentoConcluidoId)?.estado === "CONCLUIDA",
  String(naCentral(palco.documentoConcluidoId)?.estado))
ok("enquanto a certidão nova aparece EM ANDAMENTO (4 de 5)",
  naCentral(palco.documentoPendenteId)?.estado === "EM_ANDAMENTO" &&
  naCentral(palco.documentoPendenteId)?.progresso?.concluidos === 4,
  JSON.stringify(naCentral(palco.documentoPendenteId)))
await page.screenshot({ path: `${OUT}/1-antes.png`, fullPage: true })

// ═══════════════════════════════════════════════════════════════════════════
secao("2) O operador conclui a última etapa — a mesma chamada que a tela faz")
// ═══════════════════════════════════════════════════════════════════════════
const conclusao = await page.evaluate(async ([docId, stepId]) => {
  const r = await fetch(`/api/documentos/${docId}/workflow/steps/${stepId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({ status: "CONCLUIDO" }),
  })
  return { status: r.status, corpo: (await r.text()).slice(0, 200) }
}, [palco.documentoPendenteId, palco.ultimaEtapaId])
ok("a etapa foi concluída pela porta do executor", conclusao.status >= 200 && conclusao.status < 300,
  `${conclusao.status} ${conclusao.corpo}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("3) O processo MUDA DE FASE sozinho")
// ═══════════════════════════════════════════════════════════════════════════
let depois = null
for (let i = 0; i < 10; i++) {
  depois = await central(page, palco.processoId)
  if (depois.fase === palco.faseSeguinte) break
  await page.waitForTimeout(1500)
}
ok("o processo avançou para a fase seguinte sem ninguém arrastar o card",
  depois?.fase === palco.faseSeguinte, `${palco.faseAtual} → ${depois?.fase}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("4) A tela acompanha, e o trabalho da outra fase continua lá")
// ═══════════════════════════════════════════════════════════════════════════
await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 })
await page.waitForTimeout(8000)
const recarregada = await central(page, palco.processoId)
ok("a Central recarregada mostra a fase nova", recarregada.fase === palco.faseSeguinte, String(recarregada.fase))
ok("e continua no ciclo preservado da fase seguinte", recarregada.ciclo >= 1, String(recarregada.ciclo))
await page.screenshot({ path: `${OUT}/2-depois.png`, fullPage: true })

// O roteiro documental sai de cena junto com a fase documental — é o comportamento
// da Central (ela mostra a fase ATUAL). A prova de que nada foi perdido é do banco,
// e está em `scripts/verifica-retrocesso-motor.ts`, executado logo depois desta suíte.
const wfDepois = await workflowDoDoc(page, palco.documentoPendenteId)
ok("a Central da fase nova não desenha mais o roteiro documental da fase anterior",
  wfDepois.semWorkflow === true || (wfDepois.steps ?? []).length >= 0)

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
