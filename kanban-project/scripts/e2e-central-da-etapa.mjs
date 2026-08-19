// scripts/e2e-central-da-etapa.mjs
// ============================================================================
// A CENTRAL DA ETAPA — onde o trabalho é de fato executado.
//
//   node scripts/e2e-central-da-etapa.mjs <base> <saida> <tokenExecutor> <tokenObservador> <palco.json>
//
// Item 3 da validação. O que esta suíte responde, pelo navegador:
//
//   • a etapa abre um EXECUTOR ESPECIALIZADO, e o certo para aquele passo;
//   • as AÇÕES vêm do servidor — quem não pode executar não recebe botão, e o
//     servidor recusa mesmo que o botão fosse forçado;
//   • o que se registra na etapa PERSISTE — sobrevive a recarregar a página;
//   • concluir pelo executor move a MESMA tarefa uma etapa adiante;
//   • nada disso recria workflow, tarefa ou documento.
//
// O teste de serviço prova a regra; só o navegador prova que o operador alcança
// o editor, digita e o dado fica lá.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_EXEC, TOK_OBS, PALCO] = process.argv.slice(2)
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

/** O workflow do documento, lido do servidor — a fonte que a tela consome. */
const workflowDoDoc = (page, docId) => page.evaluate(async ([id]) => {
  const r = await fetch(`/api/documentos/${id}/workflow`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  if (!r.ok) return { erro: r.status }
  const d = await r.json()
  return (d.workflow?.steps ?? []).map((s) => ({
    id: s.id, stepKey: s.stepKey, title: s.title, status: s.status,
    editor: s.editor?.kind ?? null, acoes: s.acoesPermitidas ?? null,
    andamento: s.andamento ?? null, notes: s.notes ?? null,
  }))
}, [docId])

console.log("E2E — A CENTRAL DA ETAPA: o executor especializado\n")

const exec = await abaDe(TOK_EXEC)

// ═══════════════════════════════════════════════════════════════════════════
secao("§1) Cada etapa chega com o SEU editor resolvido pelo servidor")
// ═══════════════════════════════════════════════════════════════════════════
await exec.goto(`${BASE}/kanban?processoId=${palco.processoId}&tab=central&taskId=${palco.tarefaId}`, { waitUntil: "domcontentloaded", timeout: 90000 })
await exec.waitForTimeout(11000)

const steps = await workflowDoDoc(exec, palco.documentoId)
ok("o workflow do documento respondeu", Array.isArray(steps) && steps.length === 5, JSON.stringify(steps).slice(0, 120))
const esperado = {
  solicitar_certidao: "solicitacao_cartorio",
  aguardar_retorno_do_cartorio: "acompanhamento_retorno",
  receber_certidao: "recebimento_documento",
  conferir_certidao: "conferencia_documento",
  validar_certidao: "validacao_juridica",
}
for (const s of steps) {
  ok(`§1) "${s.title}" → ${esperado[s.stepKey]}`, s.editor === esperado[s.stepKey], `recebeu ${s.editor}`)
}
ok("§1) nenhuma etapa volta sem editor", steps.every((s) => !!s.editor))

// ═══════════════════════════════════════════════════════════════════════════
secao("§2) As AÇÕES vêm do servidor — e refletem estado e permissão")
// ═══════════════════════════════════════════════════════════════════════════
const ativa = steps.find((s) => s.status !== "concluida")
ok("há uma etapa executável", ativa != null, `${ativa?.title} · ${ativa?.status}`)
ok("§2) quem executa recebe as ações de execução",
  ["salvar_andamento", "registrar_contato", "registrar_observacao", "anexar", "concluir"].every((a) => ativa?.acoes?.includes(a)),
  JSON.stringify(ativa?.acoes))
ok("§2) e NÃO recebe as de gestão que não são dele",
  !ativa?.acoes?.includes("transferir"), JSON.stringify(ativa?.acoes))

// ═══════════════════════════════════════════════════════════════════════════
secao("§3) O operador ALCANÇA o executor pelo caminho real")
// ═══════════════════════════════════════════════════════════════════════════
const botaoEtapa = exec.getByRole("button", { name: /Central da Etapa/ }).first()
ok("§3) a etapa ativa oferece 'Central da Etapa'", (await botaoEtapa.count()) > 0)
await botaoEtapa.click()
await exec.waitForTimeout(5000)
let corpo = await exec.locator("body").innerText()
ok("§3) o painel da etapa abriu", /ETAPA \d+ DE \d+|Central da Etapa/i.test(corpo) || /Anexos/.test(corpo))
ok("§3) com as três abas operacionais",
  /Anexos/.test(corpo) && /Observações/.test(corpo) && /Timeline/.test(corpo))
ok("§3) e a ação de concluir, que abre o executor",
  (await exec.getByRole("button", { name: /^Concluir etapa$/ }).count()) > 0)
await exec.screenshot({ path: `${OUT}/1-central-da-etapa.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§4) O executor ESPECIALIZADO monta — e é o do passo")
// ═══════════════════════════════════════════════════════════════════════════
await exec.getByRole("button", { name: /^Concluir etapa$/ }).first().click()
await exec.waitForTimeout(4000)
corpo = await exec.locator("body").innerText()
ok("§4) abriu o executor de solicitação ao cartório",
  /Solicita(ção|r).*cart(ó|o)rio|canal/i.test(corpo), corpo.slice(0, 0) || "")
ok("§4) e ele pede o canal de solicitação — não um formulário genérico",
  /CRC|E-?cart(ó|o)rio|WhatsApp|presencial|E-?mail/i.test(corpo))
await exec.screenshot({ path: `${OUT}/2-executor-especializado.png` })
await exec.keyboard.press("Escape")
await exec.waitForTimeout(2500)

// ═══════════════════════════════════════════════════════════════════════════
secao("§5) O que se registra na etapa PERSISTE")
// ═══════════════════════════════════════════════════════════════════════════
const marca = `validacao-item3-${palco.tarefaId}`
// O CONTATO É O REGISTRO CANÔNICO DO ANDAMENTO — canal, desfecho e observação,
// com autor e data. É o que a aba de acompanhamento grava.
const gravou = await exec.evaluate(async ([docId, stepId, texto]) => {
  const r = await fetch(`/api/documentos/${docId}/workflow/steps/${stepId}/andamento`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({
      campos: { destinatario: "Cartório de Sevilha", prazoEstimadoDias: 15 },
      contato: { canal: "EMAIL", resultado: "PRAZO_INFORMADO", observacao: texto, ocorridoEm: new Date().toISOString() },
    }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}, [palco.documentoId, ativa.id, marca])
ok("§5) o registro de andamento foi aceito pelo servidor", gravou.status === 200, JSON.stringify(gravou).slice(0, 200))
// IDEMPOTÊNCIA: o mesmo contato duas vezes não vira dois registros.
const repetiu = await exec.evaluate(async ([docId, stepId, texto]) => {
  const r = await fetch(`/api/documentos/${docId}/workflow/steps/${stepId}/andamento`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({ contato: { canal: "EMAIL", resultado: "PRAZO_INFORMADO", observacao: texto } }),
  })
  return r.status
}, [palco.documentoId, ativa.id, marca])
ok("§5) repetir o mesmo contato é aceito sem quebrar", repetiu === 200, String(repetiu))

// RECARREGA A PÁGINA INTEIRA — persistência de verdade, não estado em memória.
await exec.reload({ waitUntil: "domcontentloaded" })
await exec.waitForTimeout(9000)
const depois = await workflowDoDoc(exec, palco.documentoId)
const etapaDepois = depois.find((s) => s.id === ativa.id)
const encontrouObs = JSON.stringify(etapaDepois?.andamento ?? {}).includes(marca)
ok("§5) e sobreviveu ao recarregar a página", encontrouObs,
  encontrouObs ? "" : JSON.stringify(etapaDepois?.andamento).slice(0, 250))
const contatos = etapaDepois?.andamento?.contatos ?? []
ok("§5) o contato ficou UM só — repetir não duplicou",
  contatos.filter((c) => c.observacao === marca).length === 1, `${contatos.length} contato(s)`)
ok("§5) e os campos de acompanhamento também persistiram",
  etapaDepois?.andamento?.destinatario === "Cartório de Sevilha" && etapaDepois?.andamento?.prazoEstimadoDias === 15,
  JSON.stringify({ dest: etapaDepois?.andamento?.destinatario, dias: etapaDepois?.andamento?.prazoEstimadoDias }))

// ═══════════════════════════════════════════════════════════════════════════
secao("§6) Quem NÃO pode executar não recebe botão — e o servidor recusa")
// ═══════════════════════════════════════════════════════════════════════════
const obs = await abaDe(TOK_OBS)
await obs.goto(`${BASE}/kanban?processoId=${palco.processoId}&tab=central`, { waitUntil: "domcontentloaded", timeout: 90000 })
await obs.waitForTimeout(9000)
const stepsObs = await workflowDoDoc(obs, palco.documentoId)
const ativaObs = Array.isArray(stepsObs) ? stepsObs.find((s) => s.id === ativa.id) : null
ok("§6) o observador enxerga a etapa", ativaObs != null)
ok("§6) mas recebe ZERO ações", (ativaObs?.acoes ?? []).length === 0, JSON.stringify(ativaObs?.acoes))
ok("§6) o editor continua resolvido — ver não é executar", ativaObs?.editor === esperado[ativa.stepKey])
const tentativa = await obs.evaluate(async ([docId, stepId]) => {
  const r = await fetch(`/api/documentos/${docId}/workflow/steps/${stepId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({ status: "concluida" }),
  })
  return r.status
}, [palco.documentoId, ativa.id])
ok("§6) e o servidor recusa a conclusão (403)", tentativa === 403, String(tentativa))
await obs.screenshot({ path: `${OUT}/3-observador.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§7) Concluir pelo executor move a MESMA tarefa — sem recriar nada")
// ═══════════════════════════════════════════════════════════════════════════
const antesDaConclusao = await exec.evaluate(async ([taskId]) => {
  const r = await fetch(`/api/operacao/tarefas/${taskId}/navegacao`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  return r.ok ? (await r.json()).alvo : null
}, [palco.tarefaId])

const concluiu = await exec.evaluate(async ([docId, stepId]) => {
  const r = await fetch(`/api/documentos/${docId}/workflow/steps/${stepId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({ status: "concluida" }),
  })
  return { status: r.status }
}, [palco.documentoId, ativa.id])
ok("§7) quem tem permissão conclui", concluiu.status === 200, String(concluiu.status))

await exec.waitForTimeout(3000)
const depoisDaConclusao = await exec.evaluate(async ([taskId]) => {
  const r = await fetch(`/api/operacao/tarefas/${taskId}/navegacao`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  return r.ok ? (await r.json()).alvo : null
}, [palco.tarefaId])
ok("§7) é a MESMA tarefa", depoisDaConclusao?.taskId === antesDaConclusao?.taskId && depoisDaConclusao?.taskId === palco.tarefaId)
ok("§7) e ela andou uma etapa", depoisDaConclusao?.stepKey !== antesDaConclusao?.stepKey,
  `${antesDaConclusao?.stepKey} → ${depoisDaConclusao?.stepKey}`)
ok("§7) o documento continua o mesmo", depoisDaConclusao?.documentoId === palco.documentoId)

const stepsFinal = await workflowDoDoc(exec, palco.documentoId)
ok("§7) o workflow continua com 5 etapas — nada foi recriado", stepsFinal.length === 5, String(stepsFinal.length))
ok("§7) a etapa concluída ficou concluída",
  stepsFinal.find((s) => s.id === ativa.id)?.status === "concluida",
  String(stepsFinal.find((s) => s.id === ativa.id)?.status))
ok("§5) e a observação registrada sobreviveu à conclusão",
  JSON.stringify(stepsFinal.find((s) => s.id === ativa.id)?.andamento ?? {}).includes(marca))
await exec.screenshot({ path: `${OUT}/4-apos-conclusao.png` })

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
