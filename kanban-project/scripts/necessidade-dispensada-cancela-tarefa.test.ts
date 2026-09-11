// scripts/necessidade-dispensada-cancela-tarefa.test.ts
// ============================================================================
// UNIDADE 1 do plano de consolidação (10/09/2026) — achado real do processo 589
// (Santin): `dispensarNecessidade` cancela corretamente a NecessidadeDocumental
// e o PhaseWorkflowStepInstance ligado, mas a Tarefa correspondente ficava
// órfã (NAO_INICIADA) para sempre quando o `PhaseWorkflowInstance` da fase já
// estava CONCLUIDO (fase terminou normalmente) — porque `reconciliarTarefas`
// só considerava "tarefa sem causa" quando o CONTAINER inteiro (o workflow da
// fase) tinha sido CANCELADO/SUPERSEDIDO, nunca quando é a OBRIGAÇÃO
// individual (a necessidade) que deixou de valer dentro de um container ainda
// válido/concluído normalmente.
//
// Prova, com dados REAIS (não mock), os 4 cenários do fix em
// `lib/operacional/reconciliar-tarefas.ts`:
//   1. Necessidade dispensada, tarefa NUNCA iniciada, workflow CONCLUIDO
//      (exatamente o caso Santin) → Tarefa é CANCELADA.
//   2. Necessidade dispensada, tarefa JÁ iniciada → Tarefa NÃO é cancelada
//      (trabalho feito é preservado); só marca `causaRemovidaEm`.
//   3. Tarefa de Emissão (liga por `documentoId`, nunca `necessidadeId`) cujo
//      Documento foi cancelado → também é cancelada.
//   4. Rodar a reconciliação de novo é idempotente — não duplica, não
//      re-audita o que já foi decidido.
//
//   npx tsx scripts/necessidade-dispensada-cancela-tarefa.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { dispensarNecessidade } from "@/src/services/necessidade-documental"

const MARCA = "DISPTASK"

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
  if (ids.length) {
    await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id) } } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.necessidadeDocumentalEvento.deleteMany({ where: { necessidade: { processoId: { in: ids } } } })
    await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  }
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  if (arvIds.length) {
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  }
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/** Monta processo + pessoa + necessidade + workflow + step + tarefa via reconciliarTarefas real. */
async function palco(sufixo: string, statusWorkflow: "ATIVO" | "CONCLUIDO" | "CANCELADO" | "SUPERSEDIDO" = "ATIVO") {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: `Certidão ${sufixo}`, natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Pessoa", sobrenome: sufixo }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}` },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: statusWorkflow, chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` },
    select: { id: true },
  })
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: "localizar_registro",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL",
      necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
      chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-0`,
    },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, pessoaId: pes.id, necessidadeId: nec.id, tarefaId: t.id, workflowInstanceId: inst.id }
}

async function main() {
  exigirBancoDeTeste("prova que necessidade dispensada cancela a Tarefa correspondente")
  await limpar()

  console.log("NECESSIDADE DISPENSADA CANCELA A TAREFA CORRESPONDENTE\n")

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) Caso Santin: workflow CONCLUIDO (fase terminou normalmente), tarefa nunca iniciada → CANCELADA")
  // ══════════════════════════════════════════════════════════════════════════
  const c1 = await palco("C1", "ATIVO")
  // Fase termina normalmente DEPOIS de a tarefa já existir — como no Santin.
  await prisma.phaseWorkflowInstance.update({ where: { id: c1.workflowInstanceId }, data: { status: "CONCLUIDO" } })
  await dispensarNecessidade(c1.necessidadeId, "teste: pessoa não precisa mais de documentação")
  const necDepois1 = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: c1.necessidadeId }, select: { status: true } })
  ok("1a) necessidade foi dispensada", necDepois1.status === "DISPENSADA")
  const stepDepois1 = await prisma.phaseWorkflowStepInstance.findFirstOrThrow({ where: { necessidadeId: c1.necessidadeId }, select: { status: true } })
  ok("1b) step foi cancelado (comportamento já existente, preservado)", stepDepois1.status === "CANCELADO")

  const r1 = await reconciliarTarefas({ processoId: c1.processoId })
  ok("1c) reconciliarTarefas encerrou a tarefa sem causa", r1.tarefasEncerradasSemCausa === 1, String(r1.tarefasEncerradasSemCausa))
  const tarefaDepois1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: c1.tarefaId }, select: { statusTarefa: true, motivoCodigo: true } })
  ok("1d) A TAREFA FOI CANCELADA — este era o bug real do processo 589 (Santin)", tarefaDepois1.statusTarefa === "CANCELADA", tarefaDepois1.statusTarefa)
  ok("1e) motivo registrado como CAUSA_REMOVIDA", tarefaDepois1.motivoCodigo === "CAUSA_REMOVIDA")

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) Tarefa JÁ INICIADA quando a necessidade é dispensada → NÃO cancela, preserva trabalho")
  // ══════════════════════════════════════════════════════════════════════════
  const c2 = await palco("C2", "ATIVO")
  await prisma.phaseWorkflowInstance.update({ where: { id: c2.workflowInstanceId }, data: { status: "CONCLUIDO" } })
  await prisma.tarefa.update({ where: { id: c2.tarefaId }, data: { dataInicio: new Date(), statusTarefa: "EM_ANDAMENTO" } })
  await dispensarNecessidade(c2.necessidadeId, "teste: dispensa depois de iniciada")
  const r2 = await reconciliarTarefas({ processoId: c2.processoId })
  ok("2a) reconciliarTarefas NÃO cancelou (contabiliza como 'aguardando decisão')", r2.tarefasAguardandoDecisao === 1 && r2.tarefasEncerradasSemCausa === 0)
  const tarefaDepois2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: c2.tarefaId }, select: { statusTarefa: true, causaRemovidaEm: true } })
  ok("2b) tarefa continua EM_ANDAMENTO — trabalho já feito não é destruído", tarefaDepois2.statusTarefa === "EM_ANDAMENTO")
  ok("2c) mas fica marcada com causaRemovidaEm, aguardando decisão humana", tarefaDepois2.causaRemovidaEm != null)

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) Tarefa de EMISSÃO (liga por documentoId, nunca necessidadeId) cujo Documento foi cancelado → CANCELADA")
  // ══════════════════════════════════════════════════════════════════════════
  const arv3 = await prisma.arvore.create({ data: { nome: `${MARCA} C3` }, select: { id: true } })
  const proc3 = await prisma.processo.create({ data: { nome: `${MARCA} C3`, arvoreId: arv3.id }, select: { id: true } })
  const pes3 = await prisma.pessoa.create({ data: { arvoreId: arv3.id, nome: "Pessoa", sobrenome: "C3" }, select: { id: true } })
  const doc3 = await prisma.documento.create({ data: { pessoaId: pes3.id, status: "CANCELADO" }, select: { id: true } })
  const inst3 = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc3.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-C3-${proc3.id}` },
    select: { id: true },
  })
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst3.id, processoId: proc3.id, faseMacroKey: "emissao_documental", stepKey: "solicitar_certidao",
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL",
      documentoId: doc3.id, pessoaId: pes3.id, papel: "equipe_documental", slaDays: 5,
      chaveIdempotencia: `${MARCA}-s-C3-${proc3.id}-0`,
    },
  })
  // Documento JÁ NASCE cancelado neste cenário — a mesma passagem que cria a
  // tarefa (porque o passo está DISPONIVEL) já a encontra sem causa e a encerra.
  // Não são duas rodadas: é uma só, criação e encerramento na mesma passagem —
  // ainda mais forte que "encerra depois": prova que nem chega a ficar aberta.
  const r3criacao = await reconciliarTarefas({ processoId: proc3.id })
  const tarefa3 = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc3.id }, select: { id: true, necessidadeId: true, documentoId: true, statusTarefa: true } })
  ok("3a) tarefa de emissão liga por documentoId, não necessidadeId", tarefa3.necessidadeId === null && tarefa3.documentoId === doc3.id)
  ok("3b) já na criação, a tarefa nasce e é encerrada por documento cancelado na mesma passagem", r3criacao.tarefasEncerradasSemCausa === 1, String(r3criacao.tarefasEncerradasSemCausa))
  ok("3c) TAREFA DE EMISSÃO TAMBÉM FOI CANCELADA", tarefa3.statusTarefa === "CANCELADA")

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) Reconciliação repetida é idempotente")
  // ══════════════════════════════════════════════════════════════════════════
  const r1b = await reconciliarTarefas({ processoId: c1.processoId })
  ok("4a) rodar de novo não re-encerra a mesma tarefa (já está CANCELADA, fora do filtro de status)", r1b.tarefasEncerradasSemCausa === 0)
  const auditorias = await prisma.logAuditoria.count({ where: { entidade: "Tarefa", entidadeId: c1.tarefaId, acao: "TAREFA_CANCELADA" } })
  ok("4b) exatamente 1 evento de auditoria de cancelamento (não duplicou)", auditorias === 1, String(auditorias))

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) Regressão: fase RETROCEDIDA (workflow SUPERSEDIDO) continua preservando tarefa pendente NÃO dispensada")
  // ══════════════════════════════════════════════════════════════════════════
  const c5 = await palco("C5", "ATIVO")
  await prisma.phaseWorkflowInstance.update({ where: { id: c5.workflowInstanceId }, data: { status: "SUPERSEDIDO" } })
  // necessidade continua PENDENTE (nunca foi dispensada) — só o container mudou de status.
  const r5 = await reconciliarTarefas({ processoId: c5.processoId })
  const tarefa5 = await prisma.tarefa.findUniqueOrThrow({ where: { id: c5.tarefaId }, select: { statusTarefa: true } })
  ok("5a) necessidade PENDENTE (não dispensada) sob workflow SUPERSEDIDO NÃO cancela a tarefa — regra preservada", tarefa5.statusTarefa !== "CANCELADA", tarefa5.statusTarefa)
  void r5

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) console.log("Falhas:", falhas.join(", "))
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
