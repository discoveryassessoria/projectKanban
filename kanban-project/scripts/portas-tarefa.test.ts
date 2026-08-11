// scripts/portas-tarefa.test.ts
// ============================================================================
// AS PORTAS CANÔNICAS DA TAREFA — testes A–T.
// Rodar: npm run test:portas-tarefa   (banco de TESTE)
//
// A pergunta: toda operação que a futura tela vai precisar tem uma porta — e
// nenhuma delas duplica tarefa, perde histórico ou aceita ser chamada duas
// vezes com efeito dobrado?
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa, iniciarTarefa, redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import {
  criarTarefaManual, reabrirTarefa, bloquearTarefa, desbloquearTarefa,
  aguardarTerceiro, retomarDeEspera, cancelarTarefa, devolverAFila,
  alterarPrazo, alterarPrioridade, declararDependencia, removerDependencia,
} from "@/lib/operacional/tarefa-ciclo"
import { dossieDaTarefa } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "PORTAS"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)
  await prisma.tarefaDependencia.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { dependeDeId: { in: tids } }] } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@portas.test" } } })
}

async function palco(sufixo: string, etapas = 2) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: `Trabalho ${sufixo}`, natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, pais: "espanha", arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: sufixo }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < etapas; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `${sufixo}_${i}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, pessoaId: pes.id, necessidadeId: nec.id, instanciaId: inst.id, stepIds, tarefaId: t.id }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@portas.test`, senha: "x", tipo: "assistente" }, select: { id: true } })

const ler = (id: number) =>
  prisma.tarefa.findUniqueOrThrow({
    where: { id },
    select: { id: true, statusTarefa: true, responsavelId: true, equipeKey: true, dataPrazo: true, prioridade: true, dataInicio: true, concluida: true, justificativa: true, motivoCodigo: true, slaPausadoEm: true, slaPausaAcumuladaMin: true },
  })

const logs = (id: number, acao?: string) =>
  prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: id, ...(acao ? { acao } : {}) }, select: { acao: true, descricao: true, detalhes: true, usuarioId: true } })

async function main() {
  exigirBancoDeTeste("prova as portas canônicas da tarefa")
  await limpar()
  const gestor = await usuario("Gestor")
  const dani = await usuario("Dani")
  const joao = await usuario("Joao")

  console.log("AS PORTAS CANÔNICAS DA TAREFA\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("A/B/C) Tarefa manual — cria, não duplica, avisa")
  // ═════════════════════════════════════════════════════════════════════════
  const p = await palco("A")
  const antes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  const m1 = await criarTarefaManual({
    processoId: p.processoId, titulo: "Investigar divergência", autorId: gestor.id,
    motivo: "grafia divergente", equipeKey: "equipe_documental", prioridade: "ALTA",
  })
  ok("A) a porta cria a tarefa manual", m1.ok === true, m1.ok ? "" : m1.mensagem)
  ok("A) e ela é UMA a mais", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === antes + 1)
  const idM = m1.ok ? m1.tarefaId : 0
  ok("A) marcada como MANUAL",
    (await prisma.tarefa.findUniqueOrThrow({ where: { id: idM }, select: { origem: true } })).origem === "MANUAL")

  // C) mesma OBRIGAÇÃO → avisa; e sem obrigação em comum → não avisa.
  const dupe = await criarTarefaManual({
    processoId: p.processoId, titulo: "Refazer", autorId: gestor.id,
    necessidadeId: p.necessidadeId, motivo: "retrabalho?",
  })
  ok("C) coincidir a obrigação dispara aviso estruturado", dupe.ok === false && dupe.codigo === "CONFLITO")
  const confirmada = await criarTarefaManual({
    processoId: p.processoId, titulo: "Refazer", autorId: gestor.id,
    necessidadeId: p.necessidadeId, motivo: "retrabalho?", confirmarDuplicidade: true,
  })
  ok("C) e passa com confirmação explícita", confirmada.ok === true)
  ok("B) sem motivo a porta recusa",
    (await criarTarefaManual({ processoId: p.processoId, titulo: "X", autorId: gestor.id, motivo: "" })).ok === false)
  ok("B) sem título a porta recusa",
    (await criarTarefaManual({ processoId: p.processoId, titulo: " ", autorId: gestor.id, motivo: "m" })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("D) Reabertura mantém o taskId")
  // ═════════════════════════════════════════════════════════════════════════
  const q = await palco("D")
  for (const id of q.stepIds) await prisma.phaseWorkflowStepInstance.update({ where: { id }, data: { status: "CONCLUIDO" } })
  await reconciliarTarefas({ processoId: q.processoId })
  const nQ = await prisma.tarefa.count({ where: { processoId: q.processoId } })
  const re = await reabrirTarefa({ tarefaId: q.tarefaId, autorId: gestor.id, motivo: "documento veio errado" })
  ok("D) reabriu", re.ok === true)
  ok("D) mesmo taskId", re.ok && re.tarefaId === q.tarefaId)
  ok("D) sem criar tarefa", (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === nQ)
  ok("D) histórico anterior preservado", (await logs(q.tarefaId, "TAREFA_CRIADA")).length === 1)
  ok("D) reabrir sem motivo é recusado",
    (await reabrirTarefa({ tarefaId: q.tarefaId, autorId: gestor.id, motivo: "" })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("E/F) Bloquear e desbloquear mantêm o taskId")
  // ═════════════════════════════════════════════════════════════════════════
  await atribuirTarefa({ tarefaId: q.tarefaId, responsavelId: dani.id, autorId: gestor.id })
  await iniciarTarefa({ tarefaId: q.tarefaId, autorId: dani.id })
  const b1 = await bloquearTarefa({ tarefaId: q.tarefaId, autorId: dani.id, motivo: "falta procuração" })
  ok("E) bloqueou o mesmo taskId", b1.ok && b1.tarefaId === q.tarefaId)
  ok("E) status BLOQUEADA", (await ler(q.tarefaId)).statusTarefa === "BLOQUEADA")
  ok("E) sem criar tarefa", (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === nQ)
  const d1 = await desbloquearTarefa({ tarefaId: q.tarefaId, autorId: dani.id })
  ok("F) desbloqueou o mesmo taskId", d1.ok && d1.tarefaId === q.tarefaId)
  ok("F) voltou ao estado anterior", (await ler(q.tarefaId)).statusTarefa === "EM_ANDAMENTO")
  ok("F) desbloquear o que não está bloqueado é recusado",
    (await desbloquearTarefa({ tarefaId: q.tarefaId, autorId: dani.id })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("G/H) Espera externa — mesma tarefa, SLA conforme a POLÍTICA")
  // ═════════════════════════════════════════════════════════════════════════
  const e1 = await aguardarTerceiro({ tarefaId: q.tarefaId, autorId: dani.id, motivo: "pedido enviado ao cartório" })
  ok("G) entrou em espera", e1.ok === true)
  const emEspera = await ler(q.tarefaId)
  ok("G) status AGUARDANDO_TERCEIRO", emEspera.statusTarefa === "AGUARDANDO_TERCEIRO")
  ok("G) continua com responsável e equipe", emEspera.responsavelId === dani.id && emEspera.equipeKey === "equipe_documental")
  // Sem workflow publicado, a política padrão é NÃO pausar — prazo que para
  // sozinho é prazo que ninguém cobra.
  ok("G) sem política publicada, o SLA NÃO é pausado", emEspera.slaPausadoEm === null)
  const rep = await aguardarTerceiro({ tarefaId: q.tarefaId, autorId: dani.id, motivo: "de novo" })
  ok("G) repetir a espera não gera segundo evento", rep.ok === true && (await logs(q.tarefaId, "TAREFA_AGUARDANDO_TERCEIRO")).length === 1)
  const h1 = await retomarDeEspera({ tarefaId: q.tarefaId, autorId: dani.id })
  ok("H) retomou o mesmo taskId", h1.ok && h1.tarefaId === q.tarefaId)
  ok("H) voltou a EM_ANDAMENTO", (await ler(q.tarefaId)).statusTarefa === "EM_ANDAMENTO")
  ok("H) sem criar tarefa", (await prisma.tarefa.count({ where: { processoId: q.processoId } })) === nQ)

  // A política LIGADA pausa e o prazo é empurrado pelo tempo REAL.
  // `upsert` porque o workflow do cenário sobrevive entre rodadas: `limpar()`
  // não o apaga, e recriá-lo estouraria a unicidade de `wfUid`.
  const wf = await prisma.phaseInternalWorkflow.upsert({
    where: { wfUid: `${MARCA}-wf` },
    update: { pausarSlaEmEsperaExterna: true } as never,
    create: { wfUid: `${MARCA}-wf`, name: `${MARCA} wf`, phaseKey: "genealogia", pausarSlaEmEsperaExterna: true } as never,
    select: { id: true },
  })
  await prisma.phaseWorkflowInstance.update({ where: { id: q.instanciaId }, data: { workflowDefinitionId: wf.id } })
  const prazoAntes = (await ler(q.tarefaId)).dataPrazo
  await aguardarTerceiro({ tarefaId: q.tarefaId, autorId: dani.id, motivo: "cartório de novo" })
  ok("G) com política ligada, o SLA é pausado", (await ler(q.tarefaId)).slaPausadoEm !== null)
  await retomarDeEspera({ tarefaId: q.tarefaId, autorId: dani.id })
  const depoisPausa = await ler(q.tarefaId)
  ok("H) a pausa é encerrada", depoisPausa.slaPausadoEm === null)
  ok("H) e o prazo não retrocedeu",
    prazoAntes == null || (depoisPausa.dataPrazo != null && depoisPausa.dataPrazo >= prazoAntes))

  // ═════════════════════════════════════════════════════════════════════════
  secao("I/J) Prazo e prioridade alteram só a INSTÂNCIA")
  // ═════════════════════════════════════════════════════════════════════════
  const novoPrazo = new Date(Date.now() + 30 * 86400000)
  ok("I) alterar prazo sem motivo é recusado",
    (await alterarPrazo({ tarefaId: q.tarefaId, autorId: gestor.id, novoPrazo, motivo: "" })).ok === false)
  await alterarPrazo({ tarefaId: q.tarefaId, autorId: gestor.id, novoPrazo, motivo: "cartório pediu mais tempo" })
  ok("I) o prazo da tarefa mudou", (await ler(q.tarefaId)).dataPrazo?.toDateString() === novoPrazo.toDateString())
  // O SLA do cadastro NÃO é tocado: mudar o prazo de uma tarefa não repactua o
  // serviço para todos os outros processos.
  ok("I) o SLA do cadastro (etapa) permanece",
    (await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { id: q.stepIds[0] }, select: { slaDays: true } })).slaDays === 5)
  const outra = await palco("I2")
  ok("I) e o prazo de outra tarefa não mudou",
    (await ler(outra.tarefaId)).dataPrazo?.toDateString() !== novoPrazo.toDateString())

  await alterarPrioridade({ tarefaId: q.tarefaId, autorId: gestor.id, prioridade: "URGENTE" })
  ok("J) a prioridade mudou", (await ler(q.tarefaId)).prioridade === "URGENTE")
  ok("J) e só nesta tarefa", (await ler(outra.tarefaId)).prioridade === "MEDIA")

  // ═════════════════════════════════════════════════════════════════════════
  secao("K/L) Dependências — não duplica, recusa ciclo")
  // ═════════════════════════════════════════════════════════════════════════
  await declararDependencia({ tarefaId: outra.tarefaId, dependeDeId: q.tarefaId, autorId: gestor.id })
  await declararDependencia({ tarefaId: outra.tarefaId, dependeDeId: q.tarefaId, autorId: gestor.id })
  ok("K) declarar 2x não duplica",
    (await prisma.tarefaDependencia.count({ where: { tarefaId: outra.tarefaId, dependeDeId: q.tarefaId } })) === 1)
  ok("L) ciclo A→B→A é recusado",
    (await declararDependencia({ tarefaId: q.tarefaId, dependeDeId: outra.tarefaId })).ok === false)
  ok("L) depender de si mesma é recusado",
    (await declararDependencia({ tarefaId: q.tarefaId, dependeDeId: q.tarefaId })).ok === false)
  await removerDependencia({ tarefaId: outra.tarefaId, dependeDeId: q.tarefaId, autorId: gestor.id })
  ok("K) remover funciona",
    (await prisma.tarefaDependencia.count({ where: { tarefaId: outra.tarefaId, dependeDeId: q.tarefaId } })) === 0)
  ok("K) remover de novo não é erro",
    (await removerDependencia({ tarefaId: outra.tarefaId, dependeDeId: q.tarefaId })).ok === true)

  // ═════════════════════════════════════════════════════════════════════════
  secao("M) Cancelar preserva o histórico e não apaga nada")
  // ═════════════════════════════════════════════════════════════════════════
  const r = await palco("M")
  const logsAntes = (await logs(r.tarefaId)).length
  ok("M) cancelar sem motivo é recusado",
    (await cancelarTarefa({ tarefaId: r.tarefaId, autorId: gestor.id, motivo: "" })).ok === false)
  const can = await cancelarTarefa({ tarefaId: r.tarefaId, autorId: gestor.id, motivo: "cliente desistiu" })
  ok("M) cancelou", can.ok === true)
  const rc = await ler(r.tarefaId)
  ok("M) status CANCELADA com motivo", rc.statusTarefa === "CANCELADA" && /desistiu/.test(rc.justificativa ?? ""))
  ok("M) a tarefa NÃO foi apagada", (await prisma.tarefa.count({ where: { id: r.tarefaId } })) === 1)
  ok("M) o histórico anterior continua lá", (await logs(r.tarefaId)).length > logsAntes)
  ok("M) cancelar tarefa já encerrada é recusado",
    (await cancelarTarefa({ tarefaId: r.tarefaId, autorId: gestor.id, motivo: "x" })).ok === false)
  // Concluída não se cancela: o trabalho ACONTECEU.
  const s = await palco("M2")
  for (const id of s.stepIds) await prisma.phaseWorkflowStepInstance.update({ where: { id }, data: { status: "CONCLUIDO" } })
  await reconciliarTarefas({ processoId: s.processoId })
  ok("M) cancelar tarefa CONCLUÍDA é recusado",
    (await cancelarTarefa({ tarefaId: s.tarefaId, autorId: gestor.id, motivo: "x" })).ok === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("N) Devolver à fila")
  // ═════════════════════════════════════════════════════════════════════════
  const u = await palco("N")
  await atribuirTarefa({ tarefaId: u.tarefaId, responsavelId: dani.id, autorId: gestor.id })
  const un = await devolverAFila({ tarefaId: u.tarefaId, autorId: gestor.id, motivo: "férias" })
  ok("N) devolveu", un.ok === true)
  const ud = await ler(u.tarefaId)
  ok("N) sem responsável", ud.responsavelId === null)
  ok("N) com a equipe preservada", ud.equipeKey === "equipe_documental")
  ok("N) mesmo taskId", un.ok && un.tarefaId === u.tarefaId)

  // ═════════════════════════════════════════════════════════════════════════
  secao("O) Redistribuição em lote — relata item a item")
  // ═════════════════════════════════════════════════════════════════════════
  const l1 = await palco("L1"), l2 = await palco("L2"), l3 = await palco("L3")
  await atribuirTarefa({ tarefaId: l1.tarefaId, responsavelId: dani.id, autorId: gestor.id })
  await atribuirTarefa({ tarefaId: l2.tarefaId, responsavelId: dani.id, autorId: gestor.id })
  await cancelarTarefa({ tarefaId: l3.tarefaId, autorId: gestor.id, motivo: "não se aplica" })

  const lote = await redistribuirTarefas({
    tarefaIds: [l1.tarefaId, l2.tarefaId, l3.tarefaId], novoResponsavelId: joao.id, autorId: gestor.id, motivo: "afastamento",
  })
  ok("O) o lote relata total, sucesso e falha", lote.total === 3 && lote.sucesso === 2 && lote.falha === 1, JSON.stringify({ t: lote.total, s: lote.sucesso, f: lote.falha }))
  // A tarefa encerrada NÃO derruba as outras duas: tudo-ou-nada aqui deixaria
  // quem sai de férias com o lote inteiro.
  ok("O) as legítimas passaram apesar da inválida",
    (await ler(l1.tarefaId)).responsavelId === joao.id && (await ler(l2.tarefaId)).responsavelId === joao.id)
  ok("O) e a inválida veio com o motivo", lote.itens.find((i) => i.tarefaId === l3.tarefaId)?.codigo === "TERMINAL")
  ok("O) nenhuma tarefa foi duplicada",
    (await prisma.tarefa.count({ where: { processoId: { in: [l1.processoId, l2.processoId, l3.processoId] } } })) === 3)
  const devolve = await redistribuirTarefas({ tarefaIds: [l1.tarefaId], novoResponsavelId: null, autorId: gestor.id })
  ok("O) responsável null devolve à fila", devolve.sucesso === 1 && (await ler(l1.tarefaId)).responsavelId === null)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Q) Concorrência — um vence, o outro recebe conflito")
  // ═════════════════════════════════════════════════════════════════════════
  const v = await palco("Q")
  const ver = (await prisma.tarefa.findUniqueOrThrow({ where: { id: v.tarefaId }, select: { lockVersion: true } })).lockVersion
  const [a, b] = await Promise.all([
    atribuirTarefa({ tarefaId: v.tarefaId, responsavelId: dani.id, autorId: gestor.id, lockVersion: ver }),
    atribuirTarefa({ tarefaId: v.tarefaId, responsavelId: joao.id, autorId: gestor.id, lockVersion: ver }),
  ])
  ok("Q) só um vence", [a.ok, b.ok].filter(Boolean).length === 1)
  const perdedor = a.ok ? b : a
  ok("Q) o perdedor recebe CONFLITO", !perdedor.ok && perdedor.codigo === "CONFLITO")
  const final = await ler(v.tarefaId)
  ok("Q) o responsável final é UM só", final.responsavelId === dani.id || final.responsavelId === joao.id)

  // ═════════════════════════════════════════════════════════════════════════
  secao("R) Auditoria — antes, depois e motivo, num mecanismo só")
  // ═════════════════════════════════════════════════════════════════════════
  const todos = await logs(q.tarefaId)
  const acoes = new Set(todos.map((l) => l.acao))
  for (const esperada of ["TAREFA_CRIADA", "TAREFA_REABERTA", "TAREFA_BLOQUEADA", "TAREFA_DESBLOQUEADA", "TAREFA_AGUARDANDO_TERCEIRO", "TAREFA_RETOMADA_DE_ESPERA", "TAREFA_PRAZO_ALTERADO", "TAREFA_PRIORIDADE_ALTERADA"]) {
    ok(`R) auditou ${esperada}`, acoes.has(esperada))
  }
  const prazoLog = todos.find((l) => l.acao === "TAREFA_PRAZO_ALTERADO")
  ok("R) o log de prazo tem de-para e motivo",
    !!prazoLog && /de/.test(JSON.stringify(prazoLog.detalhes)) && /mais tempo/.test(JSON.stringify(prazoLog.detalhes)))
  ok("R) toda auditoria tem autor", todos.filter((l) => l.acao !== "TAREFA_CRIADA").every((l) => l.usuarioId != null))

  // ═════════════════════════════════════════════════════════════════════════
  secao("S) Notificação não duplica")
  // ═════════════════════════════════════════════════════════════════════════
  const w = await palco("S")
  await atribuirTarefa({ tarefaId: w.tarefaId, responsavelId: dani.id, autorId: gestor.id })
  const n1 = await prisma.notificacaoOperacional.count({ where: { tarefaId: w.tarefaId } })
  await atribuirTarefa({ tarefaId: w.tarefaId, responsavelId: dani.id, autorId: gestor.id })
  ok("S) reatribuir para a mesma pessoa não gera segunda notificação",
    (await prisma.notificacaoOperacional.count({ where: { tarefaId: w.tarefaId } })) === n1, `${n1}`)
  // Bloqueio e espera NÃO notificam por si: são detalhes que o responsável já
  // conhece — ele mesmo os registrou.
  await bloquearTarefa({ tarefaId: w.tarefaId, autorId: dani.id, motivo: "x" })
  await desbloquearTarefa({ tarefaId: w.tarefaId, autorId: dani.id })
  ok("S) bloquear/desbloquear não vira spam",
    (await prisma.notificacaoOperacional.count({ where: { tarefaId: w.tarefaId } })) === n1)

  // ═════════════════════════════════════════════════════════════════════════
  secao("18) Dossiê continua respondendo depois de tudo")
  // ═════════════════════════════════════════════════════════════════════════
  const d = await dossieDaTarefa(q.tarefaId)
  ok("o dossiê existe", !!d)
  ok("tem identidade e origem", d?.taskId === q.tarefaId && !!d?.porQueExisto.chaveIdempotencia)
  ok("tem processo, fase e workflow", !!d?.processoId && !!d?.faseMacroKey && !!d?.porQueExisto.workflowInstanceId)
  ok("tem responsável, equipe, prioridade e prazo",
    d?.responsavelId != null && !!d?.equipeKey && !!d?.prioridade && !!d?.dataPrazo)
  ok("tem etapa atual e etapas internas", !!d?.etapaAtual && (d?.etapas.length ?? 0) > 0)
  ok("tem tempos (criada/atribuída/iniciada)", !!d?.tempos.criadaEm && !!d?.tempos.atribuidaEm)
  ok("e o histórico auditado", (d?.historico.length ?? 0) >= 5, `${d?.historico.length}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("T) O reconciliador continua idempotente depois de tudo")
  // ═════════════════════════════════════════════════════════════════════════
  const totalAntes = await prisma.tarefa.count()
  const notifAntes = await prisma.notificacaoOperacional.count()
  let criadas = 0
  for (let i = 0; i < 5; i++) criadas += (await reconciliarTarefas()).tarefasCriadas
  ok("T) zero tarefas novas em 5 rodadas", criadas === 0, `${criadas}`)
  ok("T) a contagem total não mudou", (await prisma.tarefa.count()) === totalAntes)
  ok("T) zero notificações novas", (await prisma.notificacaoOperacional.count()) === notifAntes)
  // A tarefa cancelada e a manual continuam como estavam.
  ok("T) a cancelada segue cancelada", (await ler(r.tarefaId)).statusTarefa === "CANCELADA")
  ok("T) a manual segue viva", (await ler(idM)).statusTarefa === "NAO_INICIADA")

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("Toda operação da futura tela tem uma porta — e nenhuma duplica nada.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
