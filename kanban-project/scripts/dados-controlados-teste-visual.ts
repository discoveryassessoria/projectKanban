// scripts/dados-controlados-teste-visual.ts
//
// DADOS CONTROLADOS PARA VALIDAÇÃO VISUAL MANUAL — mandato "correção
// definitiva do modelo temporal" (19-20/09/2026), seção 18. NÃO roda sem
// `--aplicar`. NÃO cria nada em processo/cliente real: monta uma família,
// um processo e uma pessoa PRÓPRIOS, claramente marcados
// ("[TESTE VISUAL] — não é cliente real", prefixo TESTEVIS), para o
// administrador abrir na Central Operacional / Minha Operação / Home e
// CONFERIR com os próprios olhos que cada dimensão temporal aparece como
// deveria. Nada aqui é criado até `--aplicar` ser passado explicitamente,
// e mesmo assim só depois da autorização do usuário.
//
// CENÁRIOS CRIADOS (um processo por letra, 6 processos):
//
//   TESTE A — Tarefa com prazo oficial VENCIDO (ontem).
//             Esperado: ATRASADA.
//
//   TESTE B — Prazo oficial futuro (30 dias) + acompanhamento HOJE.
//             Esperado: ACOMPANHAR HOJE, tarefa NÃO atrasada.
//
//   TESTE C — Prazo oficial futuro (30 dias) + regra temporal do terceiro
//             VENCIDA (ontem).
//             Esperado: TERCEIRO ATRASADO, tarefa NÃO atrasada.
//
//   TESTE D — Aguardando terceiro + acompanhamento FUTURO (daqui a 5 dias).
//             Esperado: AGUARDANDO TERCEIRO (sem acompanhar/atrasar ainda).
//
//   TESTE E — Ação interna disponível, sem nenhuma espera.
//             Esperado: PARA AGIR AGORA.
//
//   TESTE F — COLISÃO: prazo oficial vencido (ontem) + acompanhamento
//             vencido (ontem) + regra temporal do terceiro vencida
//             (anteontem), tudo na MESMA Tarefa.
//             Esperado: UMA Tarefa, UMA linha na projeção operacional,
//             motivos múltiplos visíveis (não 3 tarefas).
//
// Cada processo tem 1 pessoa, 1 workflow de 2 passos (o 1º ação interna, o
// 2º espera de terceiro com acompanhamento/regra temporal configuráveis) —
// réplica minimalista do padrão de Emissão Documental, não o cadastro real.
//
//   npx tsx scripts/dados-controlados-teste-visual.ts            (dry-run — só descreve)
//   npx tsx scripts/dados-controlados-teste-visual.ts --aplicar   (cria de verdade)
//   npx tsx scripts/dados-controlados-teste-visual.ts --limpar    (remove tudo que este script criou)

import { prisma } from "@/lib/prisma"
import { diaOperacional } from "@/lib/operacional/tempo-operacional"

const MARCA = "TESTEVIS"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `[TESTE VISUAL]` } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  const arvIds = [...new Set(procs.map((p) => p.arvoreId).filter((x): x is number => x != null))]
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${MARCA}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.stepSubtaskDefinition.deleteMany({ where: { step: { workflowId: wf.id } } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${MARCA}_fase` } })
  console.log(`Limpo: ${ids.length} processo(s) de teste visual removido(s).`)
}

async function main() {
  const aplicar = process.argv.includes("--aplicar")
  const soLimpar = process.argv.includes("--limpar")

  if (soLimpar) {
    await limpar()
    await prisma.$disconnect()
    return
  }

  const daniela = await prisma.usuario.findUnique({ where: { id: 12 }, select: { id: true, nome: true } })
  if (!daniela || daniela.nome !== "Daniela Brait") {
    console.error("ABORTADO: usuário #12 não é a Daniela esperada — verifique antes de prosseguir.")
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`Responsável dos 6 testes: ${daniela.nome} (#${daniela.id})\n`)

  const hoje = new Date()
  const dias = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d }
  // Hoje, MAIS TARDE (não "ontem"): é exatamente o caso que o mandato
  // 19-20/09/2026 corrigiu — mesma data-calendário, horário ainda não
  // chegado, e ainda assim deve entrar em "Acompanhar hoje" (classificação
  // por DIA no fuso operacional, não por instante). Usar "ontem" aqui não
  // provaria nada que o comportamento antigo (quebrado) também não passasse.
  // Construído a partir do DIA operacional (não `agora + Nh`): um offset fixo
  // de horas cruzaria pra amanhã dependendo de que horas são agora em SP —
  // exatamente o bug de fronteira que este cenário existe para não repetir.
  const hojeOperacionalYmd = diaOperacional(hoje)
  const candidato23h = new Date(`${hojeOperacionalYmd}T23:00:00.000-03:00`)
  const maisTardeHoje = candidato23h > hoje ? candidato23h : new Date(hoje.getTime() + 5 * 60_000)

  const cenarios = [
    { letra: "A", nome: "Prazo oficial vencido", nomeCurto: "Prazo vencido", prazoOficial: dias(-1), acompanhamento: null as Date | null, regraTemporal: null as Date | null, esperando: false, esperado: "ATRASADA" },
    { letra: "B", nome: "Acompanhar hoje (mesma data-calendário, horário ainda não chegado, prazo futuro)", nomeCurto: "Acompanhar hoje", prazoOficial: dias(30), acompanhamento: maisTardeHoje, regraTemporal: null, esperando: true, esperado: "ACOMPANHAR HOJE, tarefa NÃO atrasada — mesmo com horário à frente do agora" },
    { letra: "C", nome: "Terceiro atrasado (prazo futuro)", nomeCurto: "Terceiro atrasado", prazoOficial: dias(30), acompanhamento: null, regraTemporal: dias(-1), esperando: true, esperado: "TERCEIRO ATRASADO, tarefa NÃO atrasada" },
    { letra: "D", nome: "Aguardando terceiro, acompanhamento futuro", nomeCurto: "Aguardando terceiro", prazoOficial: dias(30), acompanhamento: dias(5), regraTemporal: dias(10), esperando: true, esperado: "AGUARDANDO TERCEIRO" },
    { letra: "E", nome: "Ação interna disponível", nomeCurto: "Ação disponível", prazoOficial: dias(30), acompanhamento: null, regraTemporal: null, esperando: false, esperado: "PARA AGIR AGORA" },
    { letra: "F", nome: "Colisão — prazo + acompanhamento + terceiro, tudo vencido", nomeCurto: "Colisão de motivos", prazoOficial: dias(-1), acompanhamento: dias(-1), regraTemporal: dias(-2), esperando: true, esperado: "UMA Tarefa, motivos múltiplos, nunca 3 tarefas" },
  ]

  console.log("O QUE SERÁ CRIADO (6 processos, 1 por letra):")
  for (const c of cenarios) {
    console.log(`  TESTE ${c.letra} — ${c.nome}`)
    console.log(`    prazo oficial: ${c.prazoOficial.toLocaleDateString("pt-BR")} · acompanhamento: ${c.acompanhamento?.toLocaleDateString("pt-BR") ?? "—"} · regra temporal: ${c.regraTemporal?.toLocaleDateString("pt-BR") ?? "—"} · 2ª subtarefa ${c.esperando ? "AGUARDANDO_EXTERNO" : "não materializada (1ª ação interna fica DISPONÍVEL)"}`)
    console.log(`    esperado na tela: ${c.esperado}`)
  }
  console.log(`\nCada processo: nome "[TESTE VISUAL] Cenário <LETRA> — <nome>", pessoa "Fulano de Teste Visual <LETRA>".`)
  console.log(`Fáceis de achar (prefixo "[TESTE VISUAL]") e de remover depois: npx tsx scripts/dados-controlados-teste-visual.ts --limpar\n`)

  if (!aplicar) {
    console.log("(seco — rode com --aplicar para criar de verdade, só depois de autorizado)")
    await prisma.$disconnect()
    return
  }

  await limpar()

  const fase = await prisma.catalogoFase.upsert({
    where: { phaseKey: `${MARCA}_fase` },
    update: {},
    create: { phaseKey: `${MARCA}_fase`, label: "Fase de Teste Visual", escopo: "PROCESSO", ordemPadrao: 98, efeitosPermitidos: ["REGISTER_ONLY"] },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}::wf`, phaseKey: fase.phaseKey, name: "Workflow de teste visual", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${MARCA}_passo`, label: "Passo de teste", ordem: 1, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never, slaDays: 5,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true, key: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: "acao_interna", label: "Ação interna", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: "espera_terceiro", label: "Espera de terceiro", ordem: 2, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["acao_interna"] as never, esperaExternaAoLiberar: true },
  })

  for (const c of cenarios) {
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${c.letra}` }, select: { id: true } })
    const pessoa = await prisma.pessoa.create({ data: { nome: "Fulano de Teste Visual", sobrenome: c.letra, arvoreId: arv.id }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `[TESTE VISUAL] [TESTE ${c.letra}] — ${c.nomeCurto}`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: fase.phaseKey },
      select: { id: true },
    })
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1, status: "ATIVO", workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${MARCA}-${c.letra}-i1` },
      select: { id: true },
    })
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fase.phaseKey, ciclo: 1,
        stepKey: passo.key, ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: "EM_ANDAMENTO", dependeDeStepKeys: [] as never, pessoaId: pessoa.id,
        stepDefinitionId: passo.id, stepDefinitionVersion: 1, chaveIdempotencia: `${MARCA}-${c.letra}-p1`,
      },
      select: { id: true },
    })
    const tarefa = await prisma.tarefa.create({
      data: {
        titulo: `[TESTE ${c.letra}] ${c.nome}`, processoId: proc.id, workflowStepInstanceId: si.id, workflowInstanceId: inst.id,
        chaveIdempotencia: `${MARCA}-${c.letra}-t1`, statusTarefa: c.esperando ? "AGUARDANDO_TERCEIRO" : "NAO_INICIADA",
        responsavelId: daniela.id, dataPrazo: c.prazoOficial, pessoaId: pessoa.id,
      },
      select: { id: true },
    })
    if (c.esperando) {
      // Subtarefa 1 (ação interna) CONCLUÍDA, pra deixar a 2ª (espera de
      // terceiro) corrente — é ela que carrega acompanhamento/regra temporal.
      await prisma.subtaskExecution.create({
        data: {
          stepInstanceId: si.id, subtaskKey: "acao_interna", sequencia: 1, status: "CONCLUIDO", motivo: "ABERTURA",
          completedAt: new Date(), executadoPorId: daniela.id, chaveIdempotencia: `${MARCA}-${c.letra}-sub1`,
        },
      })
      await prisma.subtaskExecution.create({
        data: {
          stepInstanceId: si.id, subtaskKey: "espera_terceiro", sequencia: 1, status: "AGUARDANDO_EXTERNO", motivo: "ABERTURA",
          proximoAcompanhamentoEm: c.acompanhamento, previstoPara: c.regraTemporal, chaveIdempotencia: `${MARCA}-${c.letra}-sub2`,
        },
      })
    }
    // TESTE E (e qualquer cenário com `esperando: false`): NENHUMA execução
    // é criada — a subtarefa 1 (ação interna) fica DISPONÍVEL por projeção
    // pura, sem precisar materializar nada. É exatamente "PARA AGIR AGORA".
    console.log(`  criado: processo #${proc.id}, tarefa #${tarefa.id} — TESTE ${c.letra}`)
  }

  console.log("\n✅ Criado. Abra a Central Operacional / Minha Operação / Home e procure por \"[TESTE VISUAL]\".")
  console.log("Quando terminar de validar: npx tsx scripts/dados-controlados-teste-visual.ts --limpar")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
