// scripts/torre-historico-legivel.test.ts
// ============================================================================
// TORRE NOVA (01/10/2026) — HISTÓRICO SEM "usuário 7", "equipe_documental" nem "SLA 5d".
//
//   node scripts/ci/gate-build.mjs --so torre-historico-legivel      (banco de teste descartável)
//
// A auditoria grava o texto estável do motor; a EXIBIÇÃO (gaveta da Tarefa e Histórico do Detalhe) traduz:
//   "atribuída ao usuário 7"          → "atribuída a Daniela Brait"
//   "(estava na fila da equipe_documental)" → "(… da Equipe documental)"
//   "Prazo 2026-10-06 (SLA 5d)"       → "Prazo 06/10/2026 (prazo de 5 dias)"
// Provado com DADOS REAIS do banco de teste (portas do sistema: criação pelo motor, atribuir, transferir, devolver),
// com o que está gravado INTACTO e sem N+1 (consultas não crescem com o número de linhas).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-historico-legivel.test.ts")

import { PrismaClient } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { atribuirTarefa } from "../lib/operacional/tarefa-comandos"
import { materializarTarefaOperacional } from "../lib/operacional/tarefa-canonica"
import { dossieDaTarefa } from "../lib/operacional/tarefa-projecoes"
import { historicoDaGaveta } from "../src/services/torre-gaveta-historico"
import { historicoDoProcesso } from "../src/services/historico-processo"
import { apresentarTextoDoHistorico, idsDeUsuarioNoTexto, rotuloDeEquipe } from "../lib/operacional/historico-apresentacao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const CRU = /usu[áa]rio\s+#?\d+|equipe_[a-z_]+|SLA\s*\d+\s*d|Usu[áa]rio #\d+/i
const MARCA = "HISTLEG"

async function main() {
  secao("unidade — a tradução (módulo puro)")
  const nomes = new Map([[7, "Daniela Brait"], [8, "Lucas Ferraz"], [2, "Priscila Tavares"]])
  const T = (s: string) => apresentarTextoDoHistorico(s, nomes)
  ok("'atribuída ao usuário 7' → 'atribuída a Daniela Brait'", T('Tarefa "X" atribuída ao usuário 7 (estava na fila).') === 'Tarefa "X" atribuída a Daniela Brait (estava na fila).')
  ok("'transferida do usuário 8 para 2' → 'de Lucas Ferraz para Priscila Tavares'", T('Tarefa "X" transferida do usuário 8 para 2. Motivo: férias') === 'Tarefa "X" transferida de Lucas Ferraz para Priscila Tavares. Motivo: férias')
  ok("'(era do usuário 8)' → '(era de Lucas Ferraz)'", T("devolvida à equipe (era do usuário 8).") === "devolvida à equipe (era de Lucas Ferraz).")
  ok("'passadas ao usuário 7' (lote)", T("6 de 6 tarefa(s) passadas ao usuário 7. Motivo: x") === "6 de 6 tarefa(s) passadas a Daniela Brait. Motivo: x")
  ok("'responsável anterior era o usuário 8' → nome", T("responsável anterior era o usuário 8.") === "responsável anterior era Lucas Ferraz.")
  ok("'por usuário 2' → nome", T("inativado por usuário 2.") === "inativado por Priscila Tavares.")
  ok("id sem cadastro NUNCA aparece como número", T("atribuída ao usuário 99") === "atribuída a usuário removido do cadastro" && !CRU.test(T("atribuída ao usuário 99")))
  ok("equipe_documental → 'Equipe documental'", T("(estava na fila da equipe_documental)") === "(estava na fila da Equipe documental)" && rotuloDeEquipe("equipe_documental") === "Equipe documental")
  ok("'SLA 5d' → 'prazo de 5 dias' e 'SLA 1d' → 'prazo de 1 dia'", T("Prazo 2026-10-06 (SLA 5d).") === "Prazo 06/10/2026 (prazo de 5 dias)." && T("(SLA 1d)") === "(prazo de 1 dia)")
  ok("'Sem SLA declarado — sem prazo' → 'Sem prazo declarado'", T("Sem SLA declarado — sem prazo.") === "Sem prazo declarado — sem prazo.")
  ok("'passou a aguardar terceiro' → 'terceiros' (status oficial)", T("passou a aguardar terceiro (estava NAO_INICIADA)") === "passou a aguardar terceiros (estava a iniciar)")
  ok("idempotente e sem efeito em texto limpo", T(T("atribuída ao usuário 7 (SLA 5d)")) === T("atribuída ao usuário 7 (SLA 5d)") && T("Marco Rovatti abriu o processo") === "Marco Rovatti abriu o processo")
  ok("idsDeUsuarioNoTexto coleta todos (inclusive o 2º de 'do usuário 8 para 2')", JSON.stringify(idsDeUsuarioNoTexto("do usuário 8 para 2 e ao usuário 7").sort()) === "[2,7,8]")

  secao("integração — banco de teste: a gaveta e o Histórico do Detalhe")
  const c = await montarCenario(MARCA, { slaDays: 5 })
  const usuarios: number[] = []
  try {
    const mk = async (nome: string, tipo = "assistente") => { const u = await prisma.usuario.create({ data: { nome, email: `${MARCA.toLowerCase()}-${nome.split(" ")[0].toLowerCase()}@t.com`, senha: "x", tipo } }); usuarios.push(u.id); return u }
    const marco = await mk("Marco Rovatti", "admin"), daniela = await mk("Daniela Brait"), priscila = await mk("Priscila Tavares")
    const o = await c.novaObrigacao({})
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { equipeKey: "equipe_documental" } })
    // O log "Tarefa operacional criada … Prazo AAAA-MM-DD (SLA 5d)" é escrito pela porta de materialização; uma tarefa de teste NOVA passa por ela.
    const wfi = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { id: o.stepInstanceId }, select: { workflowInstanceId: true } })
    const criada = await prisma.$transaction((tx) => materializarTarefaOperacional(tx, { processoId: o.processoId, ciclo: 7, titulo: `${MARCA} Certidão criada pelo motor`, workflowInstanceId: wfi.workflowInstanceId, faseMacroKey: c.PHASE_KEY, equipeKey: "equipe_documental", slaDays: 5 }, new Date()))
    ok("a porta de materialização criou a tarefa (e gravou o log com 'SLA 5d')", criada.criada === true, JSON.stringify(criada))
    const criadaLog = await prisma.logAuditoria.findFirst({ where: { acao: "TAREFA_CRIADA", entidade: "Tarefa", entidadeId: criada.tarefaId }, select: { descricao: true } })
    ok("o texto gravado da criação segue com 'SLA 5d'", /SLA 5d/.test(criadaLog?.descricao ?? ""), criadaLog?.descricao)
    const dCriada = await dossieDaTarefa(criada.tarefaId)
    const histCriada = (await historicoDaGaveta(dCriada!, new Date())).map((h) => h.texto).join("\n")
    ok("GAVETA (tarefa criada pelo motor): 'prazo de 5 dias' e data dd/mm/aaaa, sem 'SLA'", /prazo de 5 dias/.test(histCriada) && /Prazo \d{2}\/\d{2}\/\d{4}/.test(histCriada) && !CRU.test(histCriada), histCriada)
    const a1 = await atribuirTarefa({ tarefaId: o.tarefaId, responsavelId: daniela.id, autorId: marco.id })
    ok("atribuir pela porta oficial funcionou", a1.ok === true, JSON.stringify(a1).slice(0, 120))
    const a2 = await atribuirTarefa({ tarefaId: o.tarefaId, responsavelId: priscila.id, autorId: marco.id, motivo: "férias da Daniela" })
    ok("transferir pela porta oficial funcionou", a2.ok === true, JSON.stringify(a2).slice(0, 120))

    // O QUE ESTÁ GRAVADO continua cru (a tradução é só na exibição).
    const gravados = await prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: o.tarefaId }, select: { acao: true, descricao: true } })
    const textosGravados = gravados.map((g) => g.descricao).join("\n")
    ok(`o gravado segue com o texto do motor (usuário ${daniela.id} / equipe_documental)`, new RegExp(`atribuída ao usuário ${daniela.id}`).test(textosGravados) && /equipe_documental/.test(textosGravados), textosGravados.slice(0, 200))

    const d = await dossieDaTarefa(o.tarefaId)
    ok("dossiê da tarefa existe e tem timeline", !!d && d.timeline.length >= 2)
    const hist = await historicoDaGaveta(d!, new Date())
    const todos = hist.map((h) => h.texto).join("\n")
    ok("GAVETA: nenhum 'usuário N', 'equipe_…' nem 'SLA Nd'", !CRU.test(todos), todos.slice(0, 400))
    ok("GAVETA: 'atribuída a Daniela Brait' e 'da Equipe documental'", /atribuída a Daniela Brait/.test(todos) && /Equipe documental/.test(todos), todos.slice(0, 300))
    ok("GAVETA: 'transferida de Daniela Brait para Priscila Tavares'", /transferida de Daniela Brait para Priscila Tavares/.test(todos))
    ok("GAVETA: o autor continua sendo o NOME (Marco Rovatti)", hist.some((h) => h.autor === "Marco Rovatti"))

    const det = await historicoDoProcesso(o.processoId)
    const jsonDet = JSON.stringify(det?.fatos ?? [])
    ok("DETALHE: o Histórico do processo não contém 'usuário N', 'equipe_…' nem 'SLA Nd'", !!det && det.fatos.length > 0 && !CRU.test(jsonDet), (jsonDet.match(CRU) ?? [""])[0])
    ok("DETALHE: a atribuição aparece com o NOME de quem recebeu", jsonDet.includes("Priscila Tavares"))

    // Fato do SISTEMA com id no texto (descrição gravada pelo motor) também sai legível no Detalhe.
    await prisma.logAuditoria.create({ data: { acao: "TAREFA_DEVOLVIDA_A_FILA", entidade: "Tarefa", entidadeId: o.tarefaId, usuarioId: marco.id, descricao: `Tarefa "X" devolvida à equipe (sem responsável) — equipe_documental (era do usuário ${priscila.id}). Motivo: teste`, detalhes: { tarefaId: o.tarefaId, de: priscila.id, equipeKey: "equipe_documental", motivo: `devolvida pelo usuário ${daniela.id}` } } })
    const det2 = await historicoDoProcesso(o.processoId)
    const j2 = JSON.stringify(det2?.fatos ?? [])
    ok("DETALHE: motivo com 'usuário N' vira nome", !CRU.test(j2) && /devolvida pelo Daniela Brait|devolvida pela? Daniela Brait|Daniela Brait/.test(j2), (j2.match(CRU) ?? [""])[0])

    secao("sem N+1 — mais linhas não multiplicam as consultas")
    const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
    let n = 0
    ;(espiao as unknown as { $on: (e: string, cb: () => void) => void }).$on("query", () => { n++ })
    const contar = async () => { n = 0; await historicoDaGaveta(d!, new Date(), espiao as never); return n }
    const antes = await contar()
    const base = d!
    const inflado = { historico: [...base.historico, ...base.historico, ...base.historico], timeline: [...base.timeline, ...base.timeline, ...base.timeline] }
    n = 0; await historicoDaGaveta(inflado as never, new Date(), espiao as never); const depois = n
    await espiao.$disconnect()
    ok(`consultas: ${antes} com ${base.timeline.length} linhas → ${depois} com ${inflado.timeline.length} (não cresce; ≤ 2)`, depois <= antes && depois <= 2)
  } finally {
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } }).catch(() => {})
  }
}

main().then(async () => {
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) console.log(falhas.join("\n"))
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
