// scripts/reancoragem-nao-rouba-trabalho-aberto.test.ts
//
// PROC-005/achado seguinte (28/09/2026, processo 651 real): mover o processo pra
// "apostilamento" via movePhaseManual(preservarHistorico) reancorou 7 tarefas ABERTAS
// (uma EM_ANDAMENTO há dias, outra AGUARDANDO_TERCEIRO com pedido já enviado ao
// cartório) de genealogia/emissão documental para um passo de emissão retificada —
// a tarefa perdeu status e prazo reais.
//
// Causa: a identidade da unidade (identidade-da-tarefa.ts) não carrega a fase, DE
// PROPÓSITO — pra tarefa "seguir o trabalho" numa transição NORMAL, onde a origem já
// foi fechada na MESMA transação antes da tarefa nova materializar. Mas
// materializarFasesPuladas (só ela usa preservarHistorico) materializa várias fases
// de uma vez SEM fechar nenhuma origem — a premissa quebra, e a chave "sem fase"
// rouba tarefa de trabalho que continua aberto em outro lugar.
//
// A trava: `garantirTarefaDePasso` só reancora quando a instância de onde a tarefa
// está vindo NÃO está mais aberta (ATIVO/BLOQUEADO/AGUARDANDO). Este arquivo prova as
// duas pontas: trabalho aberto não é roubado; trabalho fechado continua sendo
// corretamente reancorado (comportamento normal intocado).
//
// ESCREVE NO BANCO — só roda no banco de teste local.
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"

const MARCA = "REANC"

let ok = 0, falhou = 0
const falhas: string[] = []
const t = (cond: boolean, nome: string, detalhe = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}
const secao = (s: string) => console.log(`\n${s}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("prova que reancoragem nunca rouba tarefa de instância ainda aberta")
  await limpar()
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })

  console.log("REANCORAGEM NÃO ROUBA TRABALHO ABERTO — achado real, processo 651\n")

  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_item`, name: "Certidão de Nascimento", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: "Teste" }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` },
    select: { id: true },
  })
  const doc = await prisma.documento.create({ data: { pessoaId: pes.id }, select: { id: true } })

  const criarInstancia = (fase: string, status: "ATIVO" | "CONCLUIDO") =>
    prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: fase, ciclo: 1, status, chaveIdempotencia: `${MARCA}-inst-${fase}-${proc.id}` },
      select: { id: true },
    })
  const criarPasso = (instId: number, fase: string, key: string) =>
    prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: instId, processoId: proc.id, faseMacroKey: fase, stepKey: key,
        ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL", geraTarefa: true,
        necessidadeId: nec.id, documentoId: doc.id, pessoaId: pes.id, papel: "equipe_documental",
        chaveIdempotencia: `${MARCA}-step-${fase}-${key}-${proc.id}`,
      },
      select: { id: true },
    })

  // ═════════════════════════════════════════════════════════════════════════
  secao("A) Origem ainda ATIVO — reancoragem cruzada é RECUSADA, não rouba a tarefa")
  // ═════════════════════════════════════════════════════════════════════════
  const instA = await criarInstancia("fase_a", "ATIVO")
  const passoA = await criarPasso(instA.id, "fase_a", "obrigacao_a")
  const g1 = await garantirTarefaDePasso({ stepInstanceId: passoA.id })
  t(g1.success === true, "1ª materialização (fase_a) cria a tarefa", JSON.stringify(g1.success ? { id: g1.tarefa.id } : g1))
  const tarefaId = g1.success ? g1.tarefa.id : -1

  // Simula EM_ANDAMENTO/AGUARDANDO_TERCEIRO real — trabalho em curso, como as
  // tarefas reais do processo 651 estavam quando o bug aconteceu.
  await prisma.tarefa.update({ where: { id: tarefaId }, data: { statusTarefa: "AGUARDANDO_TERCEIRO", dataPrazo: new Date(Date.now() + 8 * 86400000) } })

  // fase_a CONTINUA ATIVO (preservarHistorico nunca fecha a origem) — e uma
  // fase_b nova materializa um passo pra MESMA necessidade+documento.
  const instB = await criarInstancia("fase_b", "ATIVO")
  const passoB = await criarPasso(instB.id, "fase_b", "obrigacao_b")
  const g2 = await garantirTarefaDePasso({ stepInstanceId: passoB.id })
  t(g2.success === false && !g2.success && g2.code === "OBRIGACAO_ABERTA_EM_OUTRA_INSTANCIA",
    "2ª materialização (fase_b, origem ainda ATIVO) é recusada com o código certo", JSON.stringify(g2))

  const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { workflowInstanceId: true, workflowStepInstanceId: true, statusTarefa: true, dataPrazo: true } })
  t(tarefaDepois.workflowInstanceId === instA.id && tarefaDepois.workflowStepInstanceId === passoA.id,
    "a tarefa continua ancorada na fase_a — não foi roubada", JSON.stringify(tarefaDepois))
  t(tarefaDepois.statusTarefa === "AGUARDANDO_TERCEIRO" && tarefaDepois.dataPrazo != null,
    "status e prazo reais preservados intactos (era exatamente o que a #3853 perdeu)", tarefaDepois.statusTarefa)

  // ═════════════════════════════════════════════════════════════════════════
  secao("B) Origem CONCLUÍDA — reancoragem cruzada volta a funcionar normalmente")
  // ═════════════════════════════════════════════════════════════════════════
  await prisma.phaseWorkflowInstance.update({ where: { id: instA.id }, data: { status: "CONCLUIDO" } })
  const g3 = await garantirTarefaDePasso({ stepInstanceId: passoB.id })
  t(g3.success === true && !g3.created, "com a origem fechada, a MESMA tarefa reancora pra fase_b (comportamento normal preservado)", JSON.stringify(g3.success ? { id: g3.tarefa.id, criada: g3.created } : g3))
  const tarefaFinal = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId }, select: { workflowInstanceId: true, workflowStepInstanceId: true } })
  t(tarefaFinal.workflowInstanceId === instB.id && tarefaFinal.workflowStepInstanceId === passoB.id,
    "agora sim ancorada em fase_b — nenhuma tarefa duplicada", JSON.stringify(tarefaFinal))
  // "Atribuir tarefas" (origem obrigacao-atribuicao) é um efeito colateral
  // administrativo SEPARADO (reconciliarObrigacaoDeAtribuicao) — não é a
  // obrigação sob teste aqui; o invariante é sobre a tarefa DO TRABALHO.
  const tarefasDoTrabalho = await prisma.tarefa.findMany({ where: { processoId: proc.id, origem: { not: "obrigacao-atribuicao" } }, select: { id: true, titulo: true } })
  t(tarefasDoTrabalho.length === 1, "continua existindo UMA tarefa do trabalho só, nunca duas", JSON.stringify(tarefasDoTrabalho))

  // ═════════════════════════════════════════════════════════════════════════
  secao("C) Progressão DENTRO da mesma instância nunca é bloqueada")
  // ═════════════════════════════════════════════════════════════════════════
  const passoB2 = await criarPasso(instB.id, "fase_b", "obrigacao_b_passo2")
  const g4 = await garantirTarefaDePasso({ stepInstanceId: passoB2.id })
  t(g4.success === true, "passo seguinte na MESMA instância (fase_b ainda ATIVO) reancora sem bloqueio", JSON.stringify(g4.success ? { id: g4.tarefa.id } : g4))

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${ok} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
