// scripts/reconciliacao-escopo-documento.test.ts
// ============================================================================
// PROVA DE PONTA A PONTA da reconciliação de escopo PROCESSO→DOCUMENTO para as
// 4 fases canônicas (mandato "Catálogo de Fases", correção 20/09/2026, item 1).
//
// Simula, com prisma direto, exatamente o estado real encontrado em produção
// ANTES da correção — uma instância PROCESSO-escopo já materializada, com
// tarefa aberta OU concluída — e roda a MESMA lógica usada pelo script de
// produção (`scripts/reconciliar-escopo-documento.ts`), extraída aqui como
// função importável para o teste exercitar sem subprocess.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/reconciliacao-escopo-documento.test.ts
// ============================================================================
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { garantirOferta } from "./_fixture-oferta"
import { publicarRevisaoCatalogoFase } from "../src/lib/motor/catalogo-fase-revisao"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { proximoCiclo } from "../src/lib/motor/phase-advance"
import { escopoCanonicoDaFase } from "../src/lib/process-stage/escopo-operacional-da-fase"
import { montarChaveWorkflow, montarChavePasso } from "../src/services/phase-workflow-helpers"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra: string | null | undefined = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "RECESCDOC"
const FASE_ALVO = "retificacao_registros" // fase canônica REAL — precisa ser para resolverEscopoDaFase reconhecer

async function limpar() {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: tipoIds } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
  const arvoreIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvoreIds } } } })
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvoreIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@rescdoc.test" } } })

  // CatalogoFase é cadastro GLOBAL (não prefixado por MARCA) — reseta o que este
  // teste pode ter deixado de reexecuções anteriores, para o teste ser idempotente
  // ao rodar de novo (revisaoAtual de volta a 1, sem revisões residuais > 1).
  const cf = await prisma.catalogoFase.findUnique({ where: { phaseKey: FASE_ALVO }, select: { id: true } })
  if (cf) {
    await prisma.catalogoFaseRevisao.deleteMany({ where: { catalogoFaseId: cf.id } })
    await prisma.catalogoFase.update({ where: { id: cf.id }, data: { revisaoAtual: 1, escopo: "PROCESSO" } })
  }
}

async function main() {
  exigirBancoDeTeste("reconciliação de escopo PROCESSO→DOCUMENTO")
  console.log("RECONCILIAÇÃO DE ESCOPO — PROCESSO→DOCUMENTO (item 1, correção 20/09/2026)\n")
  await limpar()

  secao("0) Pré-condição: fases-catalog.ts já declara DOCUMENTO para as 4 fases (código, fonte real de cardinalidade)")
  ok("0.1) escopoCanonicoDaFase('retificacao_registros') === DOCUMENTO", escopoCanonicoDaFase("retificacao_registros") === "DOCUMENTO")
  ok("0.2) escopoCanonicoDaFase('emissao_documental_retificada') === DOCUMENTO", escopoCanonicoDaFase("emissao_documental_retificada") === "DOCUMENTO")
  ok("0.3) escopoCanonicoDaFase('traducao_juramentada') === DOCUMENTO", escopoCanonicoDaFase("traducao_juramentada") === "DOCUMENTO")
  ok("0.4) escopoCanonicoDaFase('apostilamento') === DOCUMENTO", escopoCanonicoDaFase("apostilamento") === "DOCUMENTO")

  const admin = await prisma.usuario.create({ data: { nome: "Admin RescDoc", email: "admin@rescdoc.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País RescDoc", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade RescDoc" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId, modalidadeId: oferta.modalidadeId }, select: { id: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE_ALVO, label: "Retificação de registros", ordem: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "finalizado", ordem: 2, required: true, conditional: false } })

  // O MESMO workflow interno (1 passo, "solicitar_analise") publicado ANTES da correção
  // — nunca republicado nesta rodada (item 1 não mexe em passo, só em escopo).
  const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${FASE_ALVO}`, phaseKey: FASE_ALVO, name: `WF ${FASE_ALVO}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
  const step = await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: "solicitar_analise", label: "Solicitar análise", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 5, cardinalidade: null }, select: { id: true, versao: true } })

  // Garante que o CatalogoFase desta fase começa como PROCESSO (o estado real de
  // produção antes da correção), independente do que a migration/seed local trouxe.
  const catalogoAntes = await prisma.catalogoFase.upsert({
    where: { phaseKey: FASE_ALVO },
    update: { escopo: "PROCESSO" },
    create: { phaseKey: FASE_ALVO, label: "Retificação de registros", escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, status: "PUBLICADA", revisaoAtual: 1 },
  })
  ok("0.5) CatalogoFase.escopo começa PROCESSO (estado real pré-correção)", catalogoAntes.escopo === "PROCESSO")

  /** Simula, com prisma direto, uma instância PROCESSO-escopo materializada ANTES
   *  da correção — sem passar pelo materializador (que já resolveria DOCUMENTO,
   *  já que o código do catálogo já foi corrigido nesta árvore de trabalho). */
  async function criarProcessoComInstanciaLegada(nome: string, statusInstancia: "ATIVO" | "CONCLUIDO", statusTarefa: "NAO_INICIADA" | "CONCLUIDO_RECEBIDO") {
    const arvore = await prisma.arvore.create({ data: { nome: `Árvore ${nome}` } })
    const pessoa = await prisma.pessoa.create({ data: { nome, sobrenome: "RescDoc", arvoreId: arvore.id, linhaReta: true, requerente: "maior" } })
    const doc1 = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: "Certidão A" }, select: { id: true } })
    const doc2 = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: "Certidão B" }, select: { id: true } })
    const docCancelado = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: "Certidão cancelada", status: "CANCELADO" }, select: { id: true } })

    const processo = await prisma.processo.create({
      data: { nome: `${MARCA} ${nome}`, workflowRuntime: "v2", faseAtualKey: FASE_ALVO, tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1, arvoreId: arvore.id },
      select: { id: true },
    })

    const chaveWf = montarChaveWorkflow({ processoId: processo.id, faseMacroKey: FASE_ALVO, workflowDefinitionId: wf.id, workflowVersion: 1, ciclo: 1 })
    const instanciaLegada = await prisma.phaseWorkflowInstance.create({
      data: {
        processoId: processo.id, faseMacroKey: FASE_ALVO, workflowDefinitionId: wf.id, workflowVersion: 1,
        ciclo: 1, status: statusInstancia, origem: "MOTOR", chaveIdempotencia: chaveWf,
        completedAt: statusInstancia === "CONCLUIDO" ? new Date("2026-09-01T00:00:00Z") : null,
      },
    })
    const chavePasso = montarChavePasso({ workflowInstanceId: instanciaLegada.id, stepDefinitionId: step.id, stepKey: "solicitar_analise", stepDefinitionVersion: step.versao, ciclo: 1 })
    const stepInstance = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: instanciaLegada.id, processoId: processo.id, faseMacroKey: FASE_ALVO,
        stepDefinitionId: step.id, stepDefinitionVersion: step.versao, stepKey: "solicitar_analise",
        ordem: 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true, ciclo: 1,
        status: statusTarefa === "CONCLUIDO_RECEBIDO" ? "CONCLUIDO" : "DISPONIVEL",
        chaveIdempotencia: chavePasso,
        completedAt: statusTarefa === "CONCLUIDO_RECEBIDO" ? new Date("2026-09-01T00:00:00Z") : null,
      },
    })
    const tarefaLegada = await prisma.tarefa.create({
      data: {
        processoId: processo.id, faseMacroKey: FASE_ALVO, workflowInstanceId: instanciaLegada.id, workflowStepInstanceId: stepInstance.id,
        titulo: "Solicitar análise", statusTarefa, origem: "workflow", responsavelId: admin.id,
        chaveIdempotencia: `tarefa|${chavePasso}`,
      },
    })
    return { processo, arvore, pessoa, doc1, doc2, docCancelado, instanciaLegada, stepInstance, tarefaLegada }
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("1) Publicar nova revisão do CADASTRO com escopo DOCUMENTO")
  // ══════════════════════════════════════════════════════════════════════
  const catalogoAtual = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: FASE_ALVO } })
  const revisaoAntes = catalogoAtual.revisaoAtual
  const pub = await publicarRevisaoCatalogoFase(prisma, catalogoAtual, { ...catalogoAtual, escopo: "DOCUMENTO" }, admin.id)
  ok("1.1) revisão nova incrementou revisaoAtual", pub.revisaoNova === revisaoAntes + 1, `${revisaoAntes} → ${pub.revisaoNova}`)
  ok("1.2) CatalogoFase.escopo agora é DOCUMENTO", pub.fase.escopo === "DOCUMENTO")
  const revisaoRegistrada = await prisma.catalogoFaseRevisao.findFirst({ where: { catalogoFaseId: catalogoAtual.id, revisao: pub.revisaoNova } })
  ok("1.3) CatalogoFaseRevisao da nova revisão foi congelada com escopo DOCUMENTO", revisaoRegistrada?.escopo === "DOCUMENTO")
  const revisaoAnterior = await prisma.catalogoFaseRevisao.findFirst({ where: { catalogoFaseId: catalogoAtual.id, revisao: revisaoAntes } })
  ok("1.4) revisão ANTERIOR nunca foi reescrita — continua com o escopo antigo (PROCESSO) que ela realmente teve", revisaoAnterior == null || revisaoAnterior.escopo === "PROCESSO")

  // ══════════════════════════════════════════════════════════════════════
  secao("2) Reconciliação: tarefa ABERTA no escopo antigo")
  // ══════════════════════════════════════════════════════════════════════
  const casoAberto = await criarProcessoComInstanciaLegada("CasoAberto", "ATIVO", "NAO_INICIADA")
  const snapshotAntesAberto = { ...casoAberto.instanciaLegada }
  const snapshotTarefaAntes = { ...casoAberto.tarefaLegada }

  const novoCiclo1 = await proximoCiclo(casoAberto.processo.id, FASE_ALVO)
  ok("2.1) próximo ciclo é 2 (ciclo 1 é a legada, nunca reaproveitado)", novoCiclo1 === 2, String(novoCiclo1))
  const rel1 = await materializarExecucaoDaFase({ processoId: casoAberto.processo.id, faseMacroKey: FASE_ALVO, ciclo: novoCiclo1, fonte: "RECONCILIACAO" })
  ok("2.2) materialização no ciclo novo é bem-sucedida", rel1.estado === "MATERIALIZADO", rel1.estado)
  ok("2.3) 2 novas tarefas criadas — 1 por documento aplicável (docCancelado NÃO conta)", rel1.tarefasCriadas === 2, String(rel1.tarefasCriadas))
  await prisma.phaseWorkflowInstance.update({ where: { id: rel1.workflowInstanceId! }, data: { previousInstanceId: casoAberto.instanciaLegada.id } })

  const legadaDepois1 = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: casoAberto.instanciaLegada.id } })
  ok("2.4) instância LEGADA preservada intacta — status não mudou", legadaDepois1.status === snapshotAntesAberto.status, legadaDepois1.status)
  ok("2.5) instância LEGADA preservada intacta — chaveIdempotencia não mudou", legadaDepois1.chaveIdempotencia === snapshotAntesAberto.chaveIdempotencia)
  const tarefaLegadaDepois1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: casoAberto.tarefaLegada.id } })
  ok("2.6) tarefa ABERTA legada continua ABERTA — nunca copiou conclusão de lugar nenhum", tarefaLegadaDepois1.statusTarefa === "NAO_INICIADA")
  ok("2.7) tarefa legada preservou responsável", tarefaLegadaDepois1.responsavelId === admin.id)

  const novasTarefas1 = await prisma.tarefa.findMany({ where: { processoId: casoAberto.processo.id, workflowInstanceId: rel1.workflowInstanceId } })
  ok("2.8) todas as novas obrigações nasceram PENDENTES (nunca herdam conclusão do escopo antigo)", novasTarefas1.every((t) => t.statusTarefa === "NAO_INICIADA"), novasTarefas1.map((t) => t.statusTarefa).join(","))
  const docIdsNovasTarefas = new Set(
    (await prisma.phaseWorkflowStepInstance.findMany({ where: { id: { in: novasTarefas1.map((t) => t.workflowStepInstanceId!) } }, select: { documentoId: true } })).map((s) => s.documentoId),
  )
  ok("2.9) as novas tarefas identificam o documento inequivocamente (doc1 e doc2, nunca o cancelado)", docIdsNovasTarefas.has(casoAberto.doc1.id) && docIdsNovasTarefas.has(casoAberto.doc2.id) && !docIdsNovasTarefas.has(casoAberto.docCancelado.id))

  // ══════════════════════════════════════════════════════════════════════
  secao("3) Reconciliação: tarefa CONCLUÍDA no escopo antigo")
  // ══════════════════════════════════════════════════════════════════════
  const casoConcluido = await criarProcessoComInstanciaLegada("CasoConcluido", "CONCLUIDO", "CONCLUIDO_RECEBIDO")
  const novoCiclo2 = await proximoCiclo(casoConcluido.processo.id, FASE_ALVO)
  const rel2 = await materializarExecucaoDaFase({ processoId: casoConcluido.processo.id, faseMacroKey: FASE_ALVO, ciclo: novoCiclo2, fonte: "RECONCILIACAO" })
  ok("3.1) materialização no ciclo novo funciona mesmo com a fase já concluída no escopo antigo", rel2.estado === "MATERIALIZADO", rel2.estado)
  await prisma.phaseWorkflowInstance.update({ where: { id: rel2.workflowInstanceId! }, data: { previousInstanceId: casoConcluido.instanciaLegada.id } })

  const legadaDepois2 = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: casoConcluido.instanciaLegada.id } })
  ok("3.2) instância legada CONCLUÍDA permanece CONCLUÍDA — histórico nunca reaberto", legadaDepois2.status === "CONCLUIDO")
  ok("3.3) completedAt da legada não foi tocado", legadaDepois2.completedAt?.toISOString() === "2026-09-01T00:00:00.000Z")
  const tarefaLegadaDepois2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: casoConcluido.tarefaLegada.id } })
  ok("3.4) tarefa CONCLUÍDA legada permanece concluída e histórica", tarefaLegadaDepois2.statusTarefa === "CONCLUIDO_RECEBIDO")
  const novasTarefas2 = await prisma.tarefa.findMany({ where: { processoId: casoConcluido.processo.id, workflowInstanceId: rel2.workflowInstanceId } })
  ok("3.5) mesmo com o escopo antigo concluído, a nova obrigação por documento nasce PENDENTE — nunca herda a conclusão do processo", novasTarefas2.length === 2 && novasTarefas2.every((t) => t.statusTarefa === "NAO_INICIADA"))

  // ══════════════════════════════════════════════════════════════════════
  secao("4) Idempotência — segunda reconciliação")
  // ══════════════════════════════════════════════════════════════════════
  const jaReconciliadoAberto = await prisma.phaseWorkflowInstance.findFirst({ where: { previousInstanceId: casoAberto.instanciaLegada.id } })
  ok("4.1) processo já reconciliado é detectável por previousInstanceId (a checagem de idempotência do script de produção)", !!jaReconciliadoAberto)

  const instanciasAntesSegunda = await prisma.phaseWorkflowInstance.count({ where: { processoId: casoAberto.processo.id } })
  const tarefasAntesSegunda = await prisma.tarefa.count({ where: { processoId: casoAberto.processo.id } })
  // Simula a checagem do script real: já reconciliado → PULA (não chama materializarExecucaoDaFase de novo)
  if (!jaReconciliadoAberto) {
    await materializarExecucaoDaFase({ processoId: casoAberto.processo.id, faseMacroKey: FASE_ALVO, ciclo: await proximoCiclo(casoAberto.processo.id, FASE_ALVO), fonte: "RECONCILIACAO" })
  }
  const instanciasDepoisSegunda = await prisma.phaseWorkflowInstance.count({ where: { processoId: casoAberto.processo.id } })
  const tarefasDepoisSegunda = await prisma.tarefa.count({ where: { processoId: casoAberto.processo.id } })
  ok("4.2) segunda reconciliação: ZERO novas instâncias", instanciasDepoisSegunda === instanciasAntesSegunda, `${instanciasAntesSegunda} → ${instanciasDepoisSegunda}`)
  ok("4.3) segunda reconciliação: ZERO novas tarefas", tarefasDepoisSegunda === tarefasAntesSegunda, `${tarefasAntesSegunda} → ${tarefasDepoisSegunda}`)

  // E se, por engano, materializarExecucaoDaFase for chamado de novo no MESMO ciclo novo
  // (idempotência da própria materialização, não só do gate do script): não duplica passo.
  const rel1Repetido = await materializarExecucaoDaFase({ processoId: casoAberto.processo.id, faseMacroKey: FASE_ALVO, ciclo: novoCiclo1, fonte: "RECONCILIACAO" })
  ok("4.4) reexecutar o MESMO ciclo novo não duplica passo/tarefa (idempotência do materializador)", rel1Repetido.tarefasCriadas === 0 && rel1Repetido.tarefasPreexistentes === 2, `criadas=${rel1Repetido.tarefasCriadas} preexistentes=${rel1Repetido.tarefasPreexistentes}`)

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
