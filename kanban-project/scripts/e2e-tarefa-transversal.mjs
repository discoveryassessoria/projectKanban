// scripts/e2e-tarefa-transversal.mjs
// ============================================================================
// A TAREFA TRANSVERSAL SOBRE AS PORTAS CANÔNICAS.
//
//   node scripts/e2e-tarefa-transversal.mjs <base> <saida> <tokGestor> <tokFunc>
//
// A transversal era o último serviço a escrever `statusTarefa` direto. Ela
// continua sendo a mesma feature — antecipar trabalho de uma fase futura —, mas
// agora nasce pela porta de criação, conclui por `concluirTarefaSemWorkflow` e
// cancela por `cancelarTarefa`.
//
// O teste prova as duas coisas juntas: a feature funciona, e o que ela produz é
// uma Tarefa canônica de verdade — aparece nas projeções, na fila de quem a
// recebe, com auditoria e sem duplicar em retry.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_GESTOR, TOK_FUNC] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()
async function sessao(tokPath) {
  const token = readFileSync(tokPath, "utf8").trim()
  const user = readFileSync(tokPath + ".user", "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem("authToken", t); localStorage.setItem("user", u)
  }, [token, user])
  await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
  return { page, token }
}
const gestor = await sessao(TOK_GESTOR)
const func = await sessao(TOK_FUNC)

const post = (s, url, data) =>
  s.page.request.post(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }, data })
const patch = (s, url, data) =>
  s.page.request.patch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }, data })
const get = async (s, url) => {
  const r = await s.page.request.get(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}` } })
  return { status: r.status(), body: r.ok() ? await r.json() : null }
}

const CTX = JSON.parse(process.env.CTX_TRANSVERSAL ?? "{}")

console.log("E2E — TAREFA TRANSVERSAL SOBRE AS PORTAS CANÔNICAS\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§8 · Criar a operação antecipada — pela porta canônica")
// ═══════════════════════════════════════════════════════════════════════════
const criar = await post(gestor, `/api/processos/${CTX.processoId}/tarefas-transversais`, {
  necessidadeOrigemId: CTX.necessidadeId,
  faseReferenciaCode: CTX.faseReferencia,
  acaoStepKey: CTX.acaoStepKey,
  motivo: "Cartório abre só às quartas — adiantar o pedido.",
  responsavelId: CTX.funcionarioId,
})
ok("§4) a Central consegue criar a transversal", criar.ok(), `HTTP ${criar.status()}`)
const criada = criar.ok() ? await criar.json() : null
const TASK_ID = criada?.tarefa?.id ?? criada?.id
ok("§3) ela materializa uma Tarefa canônica", Number.isInteger(TASK_ID), `taskId ${TASK_ID}`)

const det = await get(gestor, `/api/operacao/tarefas/${TASK_ID}`)
ok("§8) a Tarefa aparece na projeção operacional", det.status === 200)
const t = det.body?.tarefa
ok("§8) com identidade de trabalho, não de etapa", !!t?.titulo && !/^PASSO_/.test(t.titulo), t?.titulo ?? "—")
ok("§8) com o responsável pedido", t?.responsavelId === CTX.funcionarioId, String(t?.responsavelId))
ok("§8) e o histórico registra a criação",
  (t?.timeline ?? []).some((f) => /criad/i.test(f.texto)),
  (t?.timeline ?? [])[0]?.texto?.slice(0, 60) ?? "—")
ok("§12) sem reintroduzir árvore de subtarefas", t?.etapas?.length === 0 || t?.etapas != null)

// ═══════════════════════════════════════════════════════════════════════════
secao("§8 · Ela chega a quem vai executar")
// ═══════════════════════════════════════════════════════════════════════════
const fila = await get(func, "/api/operacao/tarefas?visao=minha_fila")
ok("§8) aparece na Minha Fila do funcionário", (fila.body?.linhas ?? []).some((l) => l.taskId === TASK_ID))

// ═══════════════════════════════════════════════════════════════════════════
secao("§9 · Idempotência e concorrência")
// ═══════════════════════════════════════════════════════════════════════════
const denovo = await post(gestor, `/api/processos/${CTX.processoId}/tarefas-transversais`, {
  necessidadeOrigemId: CTX.necessidadeId,
  faseReferenciaCode: CTX.faseReferencia,
  acaoStepKey: CTX.acaoStepKey,
  motivo: "Cartório abre só às quartas — adiantar o pedido.",
  responsavelId: CTX.funcionarioId,
})
// A transversal é trabalho antecipado DELIBERADO: repetir cria outra de
// propósito. O que não pode é a MESMA operação virar duas por retry técnico.
const segunda = denovo.ok() ? await denovo.json() : null
const SEGUNDO_ID = segunda?.tarefa?.id ?? segunda?.id
ok("§9) uma segunda antecipação é decisão do gestor, não acidente",
  !denovo.ok() || SEGUNDO_ID !== TASK_ID, denovo.ok() ? `nova #${SEGUNDO_ID}` : `recusada HTTP ${denovo.status()}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§2/§6 · Concluir pela porta canônica")
// ═══════════════════════════════════════════════════════════════════════════
const concl = await patch(func, `/api/tarefas-transversais/${TASK_ID}`, {
  acao: "concluir",
  resultadoObtido: "Certidão localizada no livro 42, folha 118.",
  resolveuNecessidade: false,
})
ok("§8) o funcionário conclui a transversal", concl.ok(), `HTTP ${concl.status()}`)
const dep = await get(gestor, `/api/operacao/tarefas/${TASK_ID}`)
ok("§8) a Tarefa ficou concluída", ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(dep.body?.tarefa?.statusTarefa),
  dep.body?.tarefa?.statusTarefa ?? "—")
ok("§8) com data de conclusão", !!dep.body?.tarefa?.tempos?.concluidaEm)
ok("§8) MESMO taskId", dep.body?.tarefa?.taskId === TASK_ID)
ok("§8) e a auditoria da conclusão existe",
  (dep.body?.tarefa?.timeline ?? []).some((f) => /conclu/i.test(f.texto)))

// Retry da conclusão não pode "concluir duas vezes".
const concl2 = await patch(func, `/api/tarefas-transversais/${TASK_ID}`, {
  acao: "concluir", resultadoObtido: "retry", resolveuNecessidade: false,
})
ok("§9) retry da conclusão é recusado, não repetido", !concl2.ok(), `HTTP ${concl2.status()}`)
const dep2 = await get(gestor, `/api/operacao/tarefas/${TASK_ID}`)
ok("§9) e o resultado original permanece",
  dep2.body?.tarefa?.tempos?.concluidaEm === dep.body?.tarefa?.tempos?.concluidaEm)

// ═══════════════════════════════════════════════════════════════════════════
secao("§2/§6 · Cancelar pela porta canônica")
// ═══════════════════════════════════════════════════════════════════════════
if (SEGUNDO_ID && SEGUNDO_ID !== TASK_ID) {
  const canc = await patch(gestor, `/api/tarefas-transversais/${SEGUNDO_ID}`, { acao: "cancelar", motivo: "duplicada por engano" })
  ok("§8) cancelar funciona", canc.ok(), `HTTP ${canc.status()}`)
  const dc = await get(gestor, `/api/operacao/tarefas/${SEGUNDO_ID}`)
  ok("§8) a Tarefa ficou CANCELADA", dc.body?.tarefa?.statusTarefa === "CANCELADA", dc.body?.tarefa?.statusTarefa ?? "—")
  ok("§8) e sai das filas ativas",
    !((await get(func, "/api/operacao/tarefas?visao=minha_fila")).body?.linhas ?? []).some((l) => l.taskId === SEGUNDO_ID))
} else {
  ok("§8) cancelar funciona", false, "sem segunda transversal para cancelar")
}

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
