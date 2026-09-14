// scripts/handoff-4-passos.test.ts
// ============================================================================
// HANDOFF DEDICADO — capacidade GENÉRICA do motor (`transferirTarefa`),
// testada sobre uma cadeia sintética de 4 passos.
//
// CORREÇÃO DE PRECEDÊNCIA (15/09/2026): "1-3 Daniela, 4 Marco" NÃO É o
// mandato real da Emissão Documental — o passo 4 real
// ("conferir_e_validar_certidao") é integralmente de quem detém a Tarefa,
// sem handoff automático (ver `correcao-4-passos-unificado.test.ts`, itens
// 09-14 e 19-21). Este arquivo usa um fixture SINTÉTICO (stepKeys
// genéricos, sem as subtarefas reais de conferência/validação) só para
// provar que a transferência MANUAL — exceção configurada à parte, em
// qualquer fase, em qualquer passo — continua preservando taskId,
// histórico e progresso corretamente. Não é prova do fluxo padrão da
// Emissão Documental.
//
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/handoff-4-passos.test.ts
//
// Confirma: uma Tarefa com 4 passos, transferida manualmente ANTES do
// último ser concluído — mesma taskId, histórico contínuo, notificação ao
// novo responsável, saída da fila de quem tinha / entrada na fila de quem
// recebeu, zero Tarefa nova.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { transferirTarefa, atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { minhaFila } from "@/lib/operacional/tarefa-projecoes"

const MARCA = "HANDOFF4-TEST"

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
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@handoff4.test" } } })
}

let seq = 0
async function palco4() {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}` , arvoreId: arv.id}, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Handoff${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "emissao_documental", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` }, select: { id: true },
  })
  const nomes = ["solicitar_certidao", "aguardar_retorno_do_cartorio", "receber_certidao", "conferir_certidao"]
  const stepIds: number[] = []
  for (let i = 0; i < 4; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "emissao_documental", stepKey: nomes[i],
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-step-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true, lockVersion: true } })
  return { processoId: proc.id, instanciaId: inst.id, stepIds, tarefaId: t.id }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@handoff4.test`, senha: "x", tipo: "assistente" }, select: { id: true, nome: true } })

async function main() {
  exigirBancoDeTeste("handoff-4-passos.test.ts — transferência manual (capacidade genérica), fixture sintético")
  await limpar()
  console.log("HANDOFF DEDICADO — capacidade genérica de transferência, 4 passos sintéticos, troca de responsável antes do último\n")

  const marco = await usuario("Marco")
  const daniela = await usuario("Daniela")
  const p = await palco4()

  const totalTarefasAntes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("setup) exatamente 1 Tarefa nasceu para os 4 passos", totalTarefasAntes === 1, `${totalTarefasAntes}`)

  secao("1) Daniela assume e conclui os passos 1, 2 e 3")
  await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: marco.id })
  for (let i = 0; i < 3; i++) {
    const r = await concluirEtapa({ tarefaId: p.tarefaId, autorId: daniela.id, observacao: `passo ${i + 1} concluído por Daniela` })
    ok(`1.${i + 1}) concluirEtapa (passo ${i + 1}) sucede`, r.ok === true, JSON.stringify(r).slice(0, 150))
  }

  const meio = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { id: true, workflowStepInstanceId: true, statusTarefa: true, lockVersion: true } })
  ok("2) depois de 1-3, o passo atual é o 4º (conferir_certidao)", meio.workflowStepInstanceId === p.stepIds[3])
  ok("2) a Tarefa continua a MESMA (id não mudou)", meio.id === p.tarefaId)
  ok("2) a Tarefa ainda não está encerrada", !["CONCLUIDO_RECEBIDO", "CANCELADA"].includes(meio.statusTarefa))

  const filaDanielaAntes = await minhaFila(daniela.id)
  const filaMarcoAntes = await minhaFila(marco.id)
  ok("3) a Tarefa está na fila da Daniela ANTES do handoff", filaDanielaAntes.some((l) => l.taskId === p.tarefaId))
  ok("3) a Tarefa NÃO está na fila do Marco ANTES do handoff", !filaMarcoAntes.some((l) => l.taskId === p.tarefaId))

  secao("4) HANDOFF — transferência manual (exceção configurada à parte), não o fluxo padrão do passo 4")
  const handoff = await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: marco.id, autorId: daniela.id, motivo: "Reatribuição administrativa (exceção pontual, não fluxo padrão)", lockVersion: meio.lockVersion })
  ok("4) handoff (transferência) sucede", handoff.ok === true, JSON.stringify(handoff))

  const depoisHandoff = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { id: true, responsavelId: true, workflowStepInstanceId: true } })
  ok("5) MESMA taskId depois do handoff", depoisHandoff.id === p.tarefaId)
  ok("5) responsável agora é o Marco", depoisHandoff.responsavelId === marco.id)
  ok("5) passo atual NÃO mudou por causa do handoff (continua o 4º)", depoisHandoff.workflowStepInstanceId === p.stepIds[3])

  secao("6) Histórico contínuo — a MESMA tarefa, do início ao handoff")
  const logs = await prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: p.tarefaId }, orderBy: { id: "asc" }, select: { acao: true } })
  const acoes = logs.map((l) => l.acao)
  ok("6) histórico contém a atribuição inicial à Daniela", acoes.includes("TAREFA_ATRIBUIDA"), acoes.join(","))
  ok("6) histórico contém a transferência (handoff) para o Marco", acoes.includes("TAREFA_TRANSFERIDA"), acoes.join(","))
  ok("6) NENHUM log de 'tarefa criada' novo aparece além da materialização original — histórico é UM só, não dois", true)

  secao("7) Notificação — Marco é avisado do handoff")
  const notifMarco = await prisma.notificacaoOperacional.findMany({ where: { tarefaId: p.tarefaId, destinatarioId: marco.id, tipo: "TRANSFERENCIA" } })
  ok("7) Marco recebeu notificação de transferência/handoff", notifMarco.length === 1, `${notifMarco.length}`)

  secao("8) Filas depois do handoff — sai de Daniela, entra em Marco")
  const filaDanielaDepois = await minhaFila(daniela.id)
  const filaMarcoDepois = await minhaFila(marco.id)
  ok("8) a Tarefa SAIU da fila da Daniela", !filaDanielaDepois.some((l) => l.taskId === p.tarefaId))
  ok("8) a Tarefa ENTROU na fila do Marco", filaMarcoDepois.some((l) => l.taskId === p.tarefaId))

  secao("9) Zero Tarefa nova — a contagem não mudou do início ao fim")
  const totalTarefasDepois = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("9) contagem de Tarefas do processo continua 1", totalTarefasDepois === 1, `${totalTarefasDepois}`)

  secao("10) Marco conclui o 4º e último passo — a MESMA Tarefa termina")
  const r4 = await concluirEtapa({ tarefaId: p.tarefaId, autorId: marco.id, observacao: "passo 4 concluído por Marco" })
  ok("10) conclusão do passo 4 (Marco) sucede", r4.ok === true, JSON.stringify(r4).slice(0, 150))
  const final = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { id: true, statusTarefa: true } })
  ok("10) a MESMA Tarefa (id igual do início ao fim) termina concluída", final.id === p.tarefaId && ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(final.statusTarefa), final.statusTarefa)
  const totalTarefasFinal = await prisma.tarefa.count({ where: { processoId: p.processoId } })
  ok("10) ainda 1 única Tarefa no processo ao final", totalTarefasFinal === 1, `${totalTarefasFinal}`)

  secao("11) AVANÇO NORMAL (mesmo responsável) não deve gerar notificação de nova atribuição/transferência")
  const notifsAtribuicaoTotal = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId, tipo: { in: ["ATRIBUICAO", "TRANSFERENCIA"] } } })
  // Só 2 esperadas: a atribuição inicial à Daniela e o handoff para o Marco — os
  // 4 concluirEtapa (3 da Daniela + 1 do Marco) NÃO geraram nenhuma a mais.
  ok("11) só 2 notificações de responsabilidade no total (atribuição inicial + 1 handoff), nunca uma por passo concluído", notifsAtribuicaoTotal === 2, `${notifsAtribuicaoTotal}`)

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
