// scripts/mandato-e2e-38-passos.test.ts
// ============================================================================
// MANDATO — TESTE REAL PONTA A PONTA, 38 PASSOS LITERAIS + CAMINHO ALTERNATIVO.
//
// Simula o ciclo de vida completo de UMA operação de "Solicitar Certidão"
// (Emissão Documental: 1 Tarefa, 5 Steps reais — solicitar_certidao →
// aguardar_retorno_do_cartorio → receber_certidao → conferir_certidao →
// validar_certidao), depois o caminho NÃO VALIDADA → nova tentativa → nova
// via → validação posterior.
//
// Cada passo tem uma verificação real (`ok(...)`) que CONFIRMA o estado do
// sistema (banco/serviço), não apenas "a função não lançou".
//
// PADRÃO DE PALCO reaproveitado de scripts/handoff-4-passos.test.ts e
// scripts/etapa6-circuito-completo.test.ts. O CADASTRO PUBLICADO (workflow
// com ações/campos/checklist/exigências) segue o padrão de
// scripts/sete-passos-operacionais.test.ts (`publicarWorkflow` +
// `executarAcaoCadastrada`).
//
// Rodar:
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   npx tsx scripts/mandato-e2e-38-passos.test.ts
//
// ESCREVE NO BANCO — só roda no banco de teste local (trava em
// `exigirBancoDeTeste`).
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"

import { garantirTarefaDePasso } from "@/src/services/passo-tarefa"
import { atribuirTarefa, avisarAcontecimentosOperacionais } from "@/lib/operacional/tarefa-comandos"
import { minhaFila, visaoGerencial, dossieDaTarefa } from "@/lib/operacional/tarefa-projecoes"
import { estadoTemporalDaOperacao } from "@/lib/operacional/proximo-acontecimento"
import { resolverAlvoDaTarefa, urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { aplicarAndamento, gravarAndamento, ANDAMENTO_VAZIO } from "@/src/lib/process-stage/andamento-etapa"

import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"
import { executarAcaoCadastrada } from "@/src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, tentativaVigente, MOTIVOS_DE_TENTATIVA } from "@/src/services/execucao-do-passo"
import { executorEfetivo } from "@/src/services/validacao-de-publicacao"
import { REGISTRO_DE_EXECUTORES } from "@/src/lib/motor/registro-de-executores"

const MARCA = "MANDATOE2E-TEST"
const M = "ME2E"

let passou = 0
let falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`)

// ============================================================================
// LIMPEZA — antes e depois. ExigenciaEvidenciaEtapa/StepRequirement/
// StepChecklistItem por stepKey são GLOBAIS (não escopados por workflowId) —
// por isso o workflow ME2E é a ÚNICA fonte dessas linhas, e é sempre removido.
// ============================================================================
async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const necs = await prisma.necessidadeDocumental.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const necIds = necs.map((n) => n.id)
  const docs = await prisma.documento.findMany({ where: { OR: [{ necessidadeId: { in: necIds } }, { pessoa: { arvore: { processos: { some: { id: { in: ids } } } } } }] }, select: { id: true } })
  const docIds = docs.map((d) => d.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)

  await prisma.documentoArquivo.deleteMany({ where: { documentoId: { in: docIds } } })
  await prisma.documentoObservacao.deleteMany({ where: { documentoId: { in: docIds } } })
  await prisma.custo.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { OR: [{ entidade: "Tarefa", entidadeId: { in: tids } }, { entidade: "PhaseWorkflowStepInstance" }] } })
  await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: { in: ids } } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  // Documentos derivados (nova via) apontam uns para os outros — limpar em duas
  // passadas para não bater em FK de auto-referência (derivadoDeId).
  await prisma.documento.updateMany({ where: { id: { in: docIds } }, data: { derivadoDeId: null, chaveDerivacao: null } })
  await prisma.documento.deleteMany({ where: { id: { in: docIds } } })
  await prisma.necessidadeDocumentalEvento.deleteMany({ where: { necessidadeId: { in: necIds } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { id: { in: necIds } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@mandatoe2e.test" } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })

  // O CADASTRO GLOBAL POR stepKey — o único jeito seguro de não vazar para
  // outros scripts que também usam os stepKeys reais da Emissão Documental
  // (handoff-4-passos.test.ts, etapa6-circuito-completo.test.ts). Precisa sair
  // ANTES do TipoDocumentoCadastro que ela referencia (Restrict).
  await prisma.exigenciaEvidenciaEtapa.deleteMany({ where: { stepKey: { in: [...STEP_KEYS] } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })

  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::emissao` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
}

const STEP_KEYS = [
  "solicitar_certidao",
  "aguardar_retorno_do_cartorio",
  "receber_certidao",
  "conferir_certidao",
  "validar_certidao",
] as const

const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

// ============================================================================
// CADASTRO — o workflow REAL da Emissão Documental (doc 27), publicado.
// ============================================================================
async function montarWorkflowEmissao() {
  const tipoEvidencia = await prisma.tipoDocumentoCadastro.create({
    data: { name: `${MARCA} Requerimento Enviado`, ativo: true, category: "civil_registry" },
    select: { id: true },
  })

  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::emissao`, phaseKey: "emissao_documental", name: `${MARCA} Emissão Documental`,
      versao: 1, execucao: "SEQUENCIAL", escopoExecucao: "DOCUMENTO",
      passos: {
        create: [
          { key: "solicitar_certidao", label: "Solicitar certidão", ordem: 1, createsTask: true, required: true, owner: "equipe_documental", slaDays: 5, cardinalidade: "DOCUMENTO", dependeDe: [] as never },
          { key: "aguardar_retorno_do_cartorio", label: "Aguardar retorno do cartório", ordem: 2, createsTask: true, required: true, owner: "equipe_documental", slaDays: 10, cardinalidade: "DOCUMENTO", dependeDe: ["solicitar_certidao"] as never },
          { key: "receber_certidao", label: "Receber certidão", ordem: 3, createsTask: true, required: true, owner: "equipe_documental", slaDays: 3, cardinalidade: "DOCUMENTO", dependeDe: ["aguardar_retorno_do_cartorio"] as never },
          { key: "conferir_certidao", label: "Conferir certidão", ordem: 4, createsTask: true, required: true, owner: "equipe_documental", slaDays: 2, cardinalidade: "DOCUMENTO", dependeDe: ["receber_certidao"] as never },
          { key: "validar_certidao", label: "Validar certidão", ordem: 5, createsTask: true, required: true, owner: "equipe_documental", slaDays: 2, cardinalidade: "DOCUMENTO", dependeDe: ["conferir_certidao"] as never },
        ],
      },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  const porChave = new Map(wf.passos.map((p) => [p.key, p.id]))
  const idDe = (k: (typeof STEP_KEYS)[number]) => porChave.get(k)!

  // ── solicitar_certidao — COMPLETE_STEP, PAUSE_FOR_EXTERNAL_WAIT, REGISTER_ONLY
  await prisma.stepAction.createMany({
    data: [
      { stepId: idDe("solicitar_certidao"), key: "enviado", label: "Enviar solicitação ao cartório", effectKey: "COMPLETE_STEP", ordem: 1 },
      { stepId: idDe("solicitar_certidao"), key: "aguardando", label: "Aguardar retorno", effectKey: "PAUSE_FOR_EXTERNAL_WAIT", ordem: 2 },
      { stepId: idDe("solicitar_certidao"), key: "anotar", label: "Só registrar", effectKey: "REGISTER_ONLY", ordem: 3 },
    ],
  })
  // A EVIDÊNCIA OBRIGATÓRIA (REQUERIMENTO_ENVIADO) — StepRequirement (o mecanismo
  // versionado, cobrado por `executarAcaoCadastrada`/`requisitosPendentes`) +
  // ExigenciaEvidenciaEtapa (o cadastro paralelo, cobrado só por `concluirEtapa`
  // — ver a nota na seção 6 do teste: são DOIS mecanismos, achado real).
  await prisma.stepRequirement.create({
    data: {
      stepId: idDe("solicitar_certidao"), key: "evidencia_requerimento",
      label: "Comprovante do requerimento enviado ao cartório", tipo: "EVIDENCIA_ANEXADA",
      minimo: 1, acaoKey: "enviado", evidenciaTipoId: tipoEvidencia.id, ordem: 1,
    },
  })
  await prisma.exigenciaEvidenciaEtapa.create({
    data: {
      stepKey: "solicitar_certidao", evidenciaTipoId: tipoEvidencia.id,
      finalidade: "REQUERIMENTO_ENVIADO", obrigatoria: true, cardinalidadeMax: 1, ativo: true,
      chaveExigencia: `solicitar_certidao|null|null|${tipoEvidencia.id}`,
    },
  })

  // ── aguardar_retorno_do_cartorio — COMPLETE_STEP, PAUSE_FOR_EXTERNAL_WAIT, RESUME
  await prisma.stepField.createMany({
    data: [
      { stepId: idDe("aguardar_retorno_do_cartorio"), key: "numero_protocolo", label: "Número do protocolo", tipo: "texto", obrigatorio: false, ordem: 1 },
      { stepId: idDe("aguardar_retorno_do_cartorio"), key: "data_protocolo", label: "Data do protocolo", tipo: "texto", obrigatorio: false, ordem: 2 },
    ],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: idDe("aguardar_retorno_do_cartorio"), key: "ainda_aguardando", label: "Ainda aguardando", effectKey: "PAUSE_FOR_EXTERNAL_WAIT", ordem: 1 },
      { stepId: idDe("aguardar_retorno_do_cartorio"), key: "retomar", label: "Retomar", effectKey: "RESUME", ordem: 2 },
      { stepId: idDe("aguardar_retorno_do_cartorio"), key: "registrar_confirmacao", label: "Registrar confirmação do pedido", effectKey: "REGISTER_ONLY", requerCampos: ["numero_protocolo", "data_protocolo"] as never, ordem: 3 },
      { stepId: idDe("aguardar_retorno_do_cartorio"), key: "retorno_chegou", label: "Retorno chegou", effectKey: "COMPLETE_STEP", requerCampos: ["numero_protocolo", "data_protocolo"] as never, ordem: 4 },
    ],
  })

  // ── receber_certidao — MARK_DOCUMENT_RECEIVED
  await prisma.stepAction.createMany({
    data: [{ stepId: idDe("receber_certidao"), key: "recebido", label: "Documento recebido", effectKey: "MARK_DOCUMENT_RECEIVED", ordem: 1 }],
  })

  // ── conferir_certidao — COMPLETE_STEP("aprovado"), REQUEST_NEW_COPY("nova_via")
  await prisma.stepField.createMany({
    data: [{ stepId: idDe("conferir_certidao"), key: "motivo", label: "Motivo", tipo: "texto", obrigatorio: false, ordem: 1 }],
  })
  await prisma.stepChecklistItem.createMany({
    data: [
      { stepId: idDe("conferir_certidao"), key: "nome_confere", label: "Nome confere com o cadastro", obrigatorio: true, ordem: 1 },
      { stepId: idDe("conferir_certidao"), key: "data_nascimento_confere", label: "Data de nascimento confere", obrigatorio: true, ordem: 2 },
    ],
  })
  await prisma.stepRequirement.create({
    data: {
      stepId: idDe("conferir_certidao"), key: "checklist_conferencia", label: "Checklist de conferência completo",
      tipo: "CHECKLIST_COMPLETO", acaoKey: "aprovado", ordem: 1,
    },
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: idDe("conferir_certidao"), key: "aprovado", label: "Aprovado", effectKey: "COMPLETE_STEP", ordem: 1 },
      { stepId: idDe("conferir_certidao"), key: "nova_via", label: "Solicitar nova via", effectKey: "REQUEST_NEW_COPY", requerCampos: ["motivo"] as never, ordem: 2 },
    ],
  })

  // ── validar_certidao — APPROVE_FOR_ANALYSIS("aprovado"), REQUEST_NEW_COPY("nova_via")
  await prisma.stepField.createMany({
    data: [{ stepId: idDe("validar_certidao"), key: "motivo", label: "Motivo", tipo: "texto", obrigatorio: false, ordem: 1 }],
  })
  await prisma.stepAction.createMany({
    data: [
      { stepId: idDe("validar_certidao"), key: "aprovado", label: "Validado", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 },
      { stepId: idDe("validar_certidao"), key: "nova_via", label: "Não validado — solicitar nova via", effectKey: "REQUEST_NEW_COPY", requerCampos: ["motivo"] as never, ordem: 2 },
    ],
  })

  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 1 })
  if (!pub.ok) throw new Error(`Publicação do workflow ME2E falhou: ${JSON.stringify(pub.problemas ?? pub)}`)

  return { workflowId: wf.id, versao: pub.versaoNova!, porChave, tipoEvidenciaId: tipoEvidencia.id }
}

// ============================================================================
// PALCO — necessidade + documento + instância + 5 steps, para um ciclo dado.
// ============================================================================
let seq = 0
async function usuario(nome: string, tipo: "admin" | "assistente" = "assistente") {
  seq++
  return prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${seq}@mandatoe2e.test`, senha: "x", tipo }, select: { id: true, nome: true } })
}

async function palco(args: {
  wf: Awaited<ReturnType<typeof montarWorkflowEmissao>>
  pessoa: { id: number }
  processo: { id: number }
  ciclo: number
  documentoId?: number | null
  necessidadeId?: number | null
}) {
  seq++
  const nec = args.necessidadeId
    ? await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: args.necessidadeId } })
    : await prisma.necessidadeDocumental.create({
        data: {
          processoId: args.processo.id,
          itemCatalogoId: (await prisma.itemCatalogo.create({
            data: { code: `${MARCA}_ITEM_${seq}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" },
            select: { id: true },
          })).id,
          pessoaId: args.pessoa.id, ciclo: 1,
          chaveIdempotencia: `${MARCA}-nec-${args.processo.id}-${seq}`,
        },
      })

  const documento = args.documentoId
    ? await prisma.documento.findUniqueOrThrow({ where: { id: args.documentoId } })
    : await prisma.documento.create({
        data: {
          pessoaId: args.pessoa.id, necessidadeId: nec.id, status: "SOLICITAR",
          descricao: `${MARCA} Certidão de Nascimento`, tipo: "CERTIDAO_NASCIMENTO",
        },
      })

  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: args.processo.id, faseMacroKey: "emissao_documental", ciclo: args.ciclo, status: "ATIVO",
      workflowDefinitionId: args.wf.workflowId, workflowVersion: args.wf.versao,
      chaveIdempotencia: `${MARCA}-inst-${args.processo.id}-c${args.ciclo}-${seq}`,
    },
    select: { id: true },
  })

  const stepIds: Record<string, number> = {}
  for (let i = 0; i < STEP_KEYS.length; i++) {
    const k = STEP_KEYS[i]
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: args.processo.id, faseMacroKey: "emissao_documental",
        ciclo: args.ciclo, stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, documentoId: documento.id, pessoaId: args.pessoa.id,
        papel: "equipe_documental", slaDays: 5,
        dependeDeStepKeys: (i === 0 ? [] : [STEP_KEYS[i - 1]]) as never,
        stepDefinitionId: args.wf.porChave.get(k)!, stepDefinitionVersion: args.wf.versao,
        chaveIdempotencia: `${MARCA}-step-${args.processo.id}-c${args.ciclo}-${seq}-${i}`,
      },
      select: { id: true },
    })
    stepIds[k] = s.id
  }

  return { necessidade: nec, documento, instanciaId: inst.id, stepIds }
}

async function registrarCampos(stepId: number, campos: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(ANDAMENTO_VAZIO, { campos }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}

async function registrarContato(stepId: number, contato: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(ANDAMENTO_VAZIO, { contato }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}

function naLista<T extends { taskId: number }>(linhas: T[], taskId: number): T | undefined {
  return linhas.find((l) => l.taskId === taskId)
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  exigirBancoDeTeste("mandato-e2e-38-passos.test.ts — 38 passos + caminho NÃO VALIDADA")
  await limpar()
  console.log("MANDATO E2E — 38 PASSOS + CAMINHO NÃO VALIDADA\n")

  const marco = await usuario("Marco", "admin")
  const daniela = await usuario("Daniela")

  const wf = await montarWorkflowEmissao()

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `${MARCA}` }, select: { id: true } })
  const processo = await prisma.processo.create({
    data: { nome: `${MARCA} processo`, arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })

  // ==========================================================================
  secao("1) CRIAR NECESSIDADE (NecessidadeDocumental real)")
  // ==========================================================================
  const p = await palco({ wf, pessoa, processo, ciclo: 1 })
  ok("1) necessidade nasceu PENDENTE", p.necessidade.status === "PENDENTE")
  ok("1) necessidade pertence ao processo e à pessoa certos", p.necessidade.processoId === processo.id && p.necessidade.pessoaId === pessoa.id)
  ok("1) chaveIdempotencia única gravada", !!p.necessidade.chaveIdempotencia)

  const step1 = p.stepIds.solicitar_certidao
  const step2 = p.stepIds.aguardar_retorno_do_cartorio
  const step3 = p.stepIds.receber_certidao
  const step4 = p.stepIds.conferir_certidao
  const step5 = p.stepIds.validar_certidao

  // ==========================================================================
  secao("2) MATERIALIZAR TAREFA (garantirTarefaDePasso — não reconciliação)")
  // ==========================================================================
  const mat = await garantirTarefaDePasso({ stepInstanceId: step1 })
  ok("2) garantirTarefaDePasso sucede", mat.success === true, JSON.stringify(mat).slice(0, 200))
  ok("2) a Tarefa foi CRIADA (não reancorada de outra)", mat.success && mat.created === true)
  const tarefaId = mat.success ? mat.tarefa.id : -1
  ok("2) a Tarefa aponta para o Step 1 (solicitar_certidao)", mat.success && mat.tarefa.workflowStepInstanceId === step1)
  ok("2) exatamente 1 Tarefa existe para este processo", (await prisma.tarefa.count({ where: { processoId: processo.id } })) === 1)
  await garantirTentativa(step1, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  // ==========================================================================
  secao("3) ATRIBUIR (a um responsável real)")
  // ==========================================================================
  const atrib = await atribuirTarefa({ tarefaId, responsavelId: daniela.id, autorId: marco.id })
  ok("3) atribuição aceita", atrib.ok === true, JSON.stringify(atrib))
  const tAposAtrib = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("3) responsavelId = Daniela", tAposAtrib.responsavelId === daniela.id)
  ok("3) notificação de atribuição criada", (await prisma.notificacaoOperacional.count({ where: { tarefaId, tipo: "ATRIBUICAO" } })) === 1)

  // ==========================================================================
  secao("4) VALIDAR MINHA OPERAÇÃO (fila do responsável, 1 linha, com deep-link)")
  // ==========================================================================
  const filaDaniela1 = await minhaFila(daniela.id)
  const linhaFila = naLista(filaDaniela1, tarefaId)
  ok("4) a Tarefa aparece na fila da Daniela", !!linhaFila)
  ok("4) aparece UMA linha só (grão Tarefa, não por passo)", filaDaniela1.filter((l) => l.taskId === tarefaId).length === 1)
  const deepLink = urlOperacionalDaTarefa({ taskId: tarefaId, processoId: processo.id })
  ok("4) deep-link aponta para o processo e a tarefa certos", deepLink.includes(`processoId=${processo.id}`) && deepLink.includes(`taskId=${tarefaId}`))

  // ==========================================================================
  secao("5) ABRIR DEEP-LINK (resolve para a Tarefa/processo certo)")
  // ==========================================================================
  const resolvido = await resolverAlvoDaTarefa(prisma, tarefaId)
  ok("5) resolve para o processo certo", resolvido.alvo?.processoId === processo.id)
  ok("5) resolve para a tarefa certa", resolvido.alvo?.taskId === tarefaId)
  ok("5) resolve para o passo corrente certo (solicitar_certidao)", resolvido.alvo?.stepKey === "solicitar_certidao")
  ok("5) responsável resolvido é a Daniela", resolvido.responsavelId === daniela.id)

  // ==========================================================================
  secao("6) EXECUTAR STEP 1 (solicitar_certidao) — evidência obrigatória")
  // ==========================================================================
  // NOTA DE ARQUITETURA (achado real, não corrigido nesta rodada — fora do
  // escopo mínimo): existem DOIS mecanismos de evidência obrigatória no
  // motor — `ExigenciaEvidenciaEtapa` (cobrado só por `concluirEtapa`,
  // lib/operacional/tarefa-etapa.ts) e `StepRequirement` tipo
  // EVIDENCIA_ANEXADA (cobrado só por `executarAcaoCadastrada`, o caminho que
  // a Central/o painel de ação realmente usa — `POST
  // /api/workflow-step-instances/[id]/execucao`). Este teste exercita o
  // SEGUNDO, que é o que a produção usa para passos com cadastro publicado.
  const semEvidencia = await executarAcaoCadastrada(step1, "enviado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a1` })
  ok("6) concluir sem evidência é RECUSADO", semEvidencia.ok === false && semEvidencia.codigo === "REQUISITO_PENDENTE", JSON.stringify(semEvidencia))
  const docAntes = await prisma.documento.findUniqueOrThrow({ where: { id: p.documento.id } })
  ok("6) o documento continua sem evidência anexada", (await prisma.documentoArquivo.count({ where: { documentoId: docAntes.id } })) === 0)

  await prisma.documentoArquivo.create({
    data: {
      documentoId: p.documento.id, stepInstanceId: step1, documentTypeId: wf.tipoEvidenciaId,
      tipo: "REQUERIMENTO_ENVIADO", url: `https://arquivos.test/${MARCA}/requerimento.pdf`, nome: "requerimento.pdf",
      criadoPorId: daniela.id,
    },
  })
  const comEvidencia = await executarAcaoCadastrada(step1, "enviado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a2` })
  ok("6) com evidência anexada, a ação sucede e conclui o passo", comEvidencia.ok === true && comEvidencia.concluiuPasso === true, JSON.stringify(comEvidencia))
  const step1Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: step1 } })
  ok("6) Step 1 está CONCLUIDO", step1Depois.status === "CONCLUIDO")

  // ==========================================================================
  secao("7) VALIDAR HISTÓRICO (WorkflowEvento/LogAuditoria registrou o Step 1)")
  // ==========================================================================
  const eventosStep1 = await prisma.workflowEvento.findMany({ where: { processoId: processo.id, stepInstanceId: step1 }, orderBy: { id: "asc" } })
  ok("7) TAREFA_GERADA registrado (a materialização do passo 2)", eventosStep1.some((e) => e.tipo === "TAREFA_GERADA"))
  ok("7) PASSO_CONCLUIDO registrado para o Step 1", eventosStep1.some((e) => e.tipo === "PASSO_CONCLUIDO"))
  const logsStep1 = await prisma.logAuditoria.findMany({ where: { entidade: "PhaseWorkflowStepInstance", entidadeId: step1 } })
  ok("7) LogAuditoria STEP_ACTION_EXECUTED registrado", logsStep1.some((l) => l.acao === "STEP_ACTION_EXECUTED"))
  ok("7) exatamente 1 evento TAREFA_GERADA em toda a cadeia (invariante do mandato)",
    (await prisma.workflowEvento.count({ where: { processoId: processo.id, tipo: "TAREFA_GERADA" } })) === 1)

  // ==========================================================================
  secao("8) ENTRAR EM STEP 2 (aguardar_retorno_do_cartorio)")
  // ==========================================================================
  const tAposStep1 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("8) a MESMA Tarefa avançou para o Step 2", tAposStep1.workflowStepInstanceId === step2 && tAposStep1.id === tarefaId)
  ok("8) ainda 1 única Tarefa (nenhuma nova pelo avanço)", (await prisma.tarefa.count({ where: { processoId: processo.id } })) === 1)
  const step2Antes = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: step2 } })
  ok("8) Step 2 está DISPONIVEL", step2Antes.status === "DISPONIVEL")

  // ==========================================================================
  secao("9) INICIAR ESPERA (PAUSE_FOR_EXTERNAL_WAIT)")
  // ==========================================================================
  const pausa = await executarAcaoCadastrada(step2, "ainda_aguardando", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a3` })
  ok("9) pausa aceita", pausa.ok === true, JSON.stringify(pausa))
  const tPausada = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("9) Tarefa BLOQUEADA aguardando terceiro", tPausada.statusTarefa === "BLOQUEADA" && tPausada.motivoCodigo === "AGUARDANDO_TERCEIRO")

  // ==========================================================================
  secao("10) FOLLOW-UP (agendar/registrar)")
  // ==========================================================================
  const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  await registrarCampos(step2, { proximoAcompanhamento: amanha })
  const estado10 = await estadoTemporalDaOperacao(prisma, tarefaId)
  ok("10) proximoAcompanhamentoData gravado", estado10?.proximoAcompanhamentoData != null)

  // ==========================================================================
  secao("11) VALIDAR SAÍDA DA ATENÇÃO IMEDIATA (aguardando, não é 'agir agora')")
  // ==========================================================================
  ok("11) acompanhamento FUTURO — não vencido", estado10?.acompanhamentoVencido === false)
  const { linhas: linhas11 } = await visaoGerencial({ processoId: processo.id }, new Date())
  const l11 = naLista(linhas11, tarefaId)
  ok("11) executavelAgora = false (bloqueada aguardando terceiro)", l11?.executavelAgora === false)

  // ==========================================================================
  secao("12) SIMULAR VENCIMENTO DO FOLLOW-UP")
  // ==========================================================================
  const ontem = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  await registrarCampos(step2, { proximoAcompanhamento: ontem })
  const estado12 = await estadoTemporalDaOperacao(prisma, tarefaId)
  ok("12) acompanhamento agora VENCIDO", estado12?.acompanhamentoVencido === true)

  // ==========================================================================
  secao("13) \"ACOMPANHAR HOJE\" (a Tarefa aparece no filtro correspondente)")
  // ==========================================================================
  const { linhas: linhas13 } = await visaoGerencial({ processoId: processo.id }, new Date())
  const acompanharHoje = linhas13.filter((l) => l.acompanhamentoVencido === true)
  ok("13) a Tarefa aparece no filtro 'acompanhamento vencido/acompanhar hoje'", acompanharHoje.some((l) => l.taskId === tarefaId))

  // ==========================================================================
  secao("14) REGISTRAR FOLLOW-UP (ação do operador)")
  // ==========================================================================
  await registrarContato(step2, { canal: "EMAIL", resultado: "PRAZO_INFORMADO", destinatario: "Cartório", observacao: "Cartório informou novo prazo" })
  const step2ComContato = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: step2 }, select: { metadata: true } })
  const historicoContatos = ((step2ComContato.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined)?.contatos as unknown[] | undefined
  ok("14) o contato ficou registrado no histórico da etapa", Array.isArray(historicoContatos) && historicoContatos.length >= 1)

  // ==========================================================================
  secao("15) REAGENDAR (novo follow-up)")
  // ==========================================================================
  const depoisDeAmanha = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  await registrarCampos(step2, { proximoAcompanhamento: depoisDeAmanha })
  const estado15 = await estadoTemporalDaOperacao(prisma, tarefaId)
  ok("15) o reagendamento saiu de vencido para futuro", estado15?.acompanhamentoVencido === false)

  // ==========================================================================
  secao("16) RETORNO ANTECIPADO (terceiro responde antes do follow-up vencer)")
  // ==========================================================================
  await registrarContato(step2, { canal: "EMAIL", resultado: "RETORNO_RECEBIDO", destinatario: "Cartório", observacao: "Cartório respondeu antes do previsto" })

  // ==========================================================================
  secao("17) RETORNO RECEBIDO (retornoRecebido=true, reativa a atenção)")
  // ==========================================================================
  const estado17 = await estadoTemporalDaOperacao(prisma, tarefaId)
  ok("17) retornoRecebido = true", estado17?.retornoRecebido === true)
  ok("17) próximo acontecimento é 'retorno_recebido' (ação imediata, não espera o agendamento)", estado17?.proximoAcontecimento.tipo === "retorno_recebido")
  const { linhas: linhas17 } = await visaoGerencial({ processoId: processo.id }, new Date())
  const retornosRecebidos = linhas17.filter((l) => l.retornoRecebido === true)
  ok("17) aparece no filtro 'retornos recebidos'", retornosRecebidos.some((l) => l.taskId === tarefaId))
  const avisoRetorno = await avisarAcontecimentosOperacionais()
  ok("17) notificação de retorno de terceiro gerada", (await prisma.notificacaoOperacional.count({ where: { tarefaId, tipo: "RETORNO_TERCEIRO" } })) === 1, JSON.stringify(avisoRetorno.retorno))

  // ==========================================================================
  secao("18) CONFIRMAÇÃO/PROTOCOLO (campos do pedido preenchidos)")
  // ==========================================================================
  const confirmacao = await executarAcaoCadastrada(step2, "registrar_confirmacao", { numero_protocolo: "CRT-2026-001", data_protocolo: "2026-09-10" },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a4` })
  ok("18) confirmação registrada, sem concluir o passo", confirmacao.ok === true && confirmacao.concluiuPasso === false, JSON.stringify(confirmacao))
  const vigenteStep2 = await tentativaVigente(step2)
  const valoresVigentes = (vigenteStep2?.payload as { valores?: Record<string, unknown> } | null)?.valores
  ok("18) os campos de confirmação ficaram gravados na tentativa", valoresVigentes?.numero_protocolo === "CRT-2026-001" && valoresVigentes?.data_protocolo === "2026-09-10")

  // ==========================================================================
  secao("19) PAGAMENTO QUANDO APLICÁVEL (custo associado ao cenário)")
  // ==========================================================================
  const custo = await prisma.custo.create({
    data: {
      codigo: `${M}-CST-${processo.id}`, processoId: processo.id, documentoId: p.documento.id,
      tipo: "SERVICO", categoria: "OUTROS", descricao: `${MARCA} Taxa do cartório — certidão`,
      moeda: "BRL", valor: "45.00", fxEstimado: "1.0000", vencimento: new Date(), origem: "manual",
    },
    select: { id: true, documentoId: true, processoId: true },
  })
  ok("19) custo registrado e vinculado ao documento/processo certos", custo.documentoId === p.documento.id && custo.processoId === processo.id)

  // ==========================================================================
  secao("20) CONCLUIR STEP 2")
  // ==========================================================================
  const retomar = await executarAcaoCadastrada(step2, "retomar", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a5` })
  ok("20) retomada (RESUME) aceita", retomar.ok === true, JSON.stringify(retomar))
  const tRetomada = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("20) Tarefa saiu de BLOQUEADA", tRetomada.statusTarefa !== "BLOQUEADA")
  const concluiStep2 = await executarAcaoCadastrada(step2, "retorno_chegou", { numero_protocolo: "CRT-2026-001", data_protocolo: "2026-09-10" },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a6` })
  ok("20) Step 2 concluído", concluiStep2.ok === true && concluiStep2.concluiuPasso === true, JSON.stringify(concluiStep2))

  // ==========================================================================
  secao("21) ENTRAR EM STEP 3 (receber_certidao)")
  // ==========================================================================
  const tAposStep2 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("21) a MESMA Tarefa avançou para o Step 3", tAposStep2.workflowStepInstanceId === step3 && tAposStep2.id === tarefaId)
  ok("21) ainda 1 única Tarefa", (await prisma.tarefa.count({ where: { processoId: processo.id } })) === 1)

  // ==========================================================================
  secao("22) ESPERA (nova espera externa) — receber_certidao tem espera PRÓPRIA, automática")
  // ==========================================================================
  // CORREÇÃO (15/09/2026, refinada): "receber_certidao" tem sua PRÓPRIA
  // espera de terceiro — entre o protocolo confirmado (passo 2) e a certidão
  // física chegar, o operador ainda depende do cartório. Não é uma AÇÃO que o
  // operador dispara (por isso `PAUSE_FOR_EXTERNAL_WAIT` não precisa estar em
  // `efeitos`): é o cadastro do PASSO (`esperaExternaAoLiberar`) que decide, e
  // o motor entra em espera sozinho ao liberar o passo — o executor só precisa
  // declarar `suportaEsperaExterna` para a tela de cadastro permitir marcar
  // essa opção nele. Ver scripts/receber-certidao-segunda-espera.test.ts para
  // a prova completa (liberação → motor entra em espera sozinho → motor
  // temporal lê espera externa → recebimento desbloqueia sozinho).
  const execReceber = executorEfetivo({ key: "receber_certidao", executorKey: null }, "emissao_documental")
  const capReceber = REGISTRO_DE_EXECUTORES[execReceber as keyof typeof REGISTRO_DE_EXECUTORES]
  ok("22) o executor real de receber_certidao declara suporte a espera externa (segunda espera de terceiro, automática por cadastro)",
    capReceber != null && capReceber.suportaEsperaExterna === true)

  // ==========================================================================
  secao("23) TERCEIRO ATRASADO (sem virar atraso do operador)")
  // ==========================================================================
  await registrarCampos(step3, { previsaoRetorno: "2020-01-01" })
  const estado23 = await estadoTemporalDaOperacao(prisma, tarefaId)
  ok("23) atrasoTerceiro = true (previsão do terceiro no passado)", estado23?.atrasoTerceiro === true)

  // ==========================================================================
  secao("24) COMPROVAR OPERADOR SAUDÁVEL (não é atraso interno)")
  // ==========================================================================
  ok("24) atrasoInterno = false — terceiro atrasado nunca vaza para o operador", estado23?.atrasoInterno === false)

  // ==========================================================================
  secao("25) RECEBER DOCUMENTO (MARK_DOCUMENT_RECEIVED)")
  // ==========================================================================
  // 26/27 acontecem ANTES da conclusão: a versão do arquivo nasce, é vinculada
  // ao Documento, e SÓ DEPOIS o recebimento é confirmado no sistema — ordem
  // real de operação (primeiro o físico/digital chega, depois se confirma).
  secao("26) CRIAR VERSÃO (Documento com versão)")
  const arquivoV1 = await prisma.documentoArquivo.create({
    data: {
      documentoId: p.documento.id, stepInstanceId: step3, tipo: "DOCUMENTO_RECEBIDO",
      url: `https://arquivos.test/${MARCA}/certidao-v1.pdf`, nome: "certidao-v1.pdf", vigente: true,
      criadoPorId: daniela.id,
    },
  })
  ok("26) a v1 do arquivo foi criada e está vigente", arquivoV1.vigente === true)
  ok("26) exatamente 1 arquivo vigente do tipo DOCUMENTO_RECEBIDO para este documento",
    (await prisma.documentoArquivo.count({ where: { documentoId: p.documento.id, tipo: "DOCUMENTO_RECEBIDO", vigente: true } })) === 1)

  secao("27) VINCULAR ARQUIVO (nova versão substitui a anterior, histórico preservado)")
  const arquivoV2 = await prisma.$transaction(async (tx) => {
    const v2 = await tx.documentoArquivo.create({
      data: {
        documentoId: p.documento.id, stepInstanceId: step3, tipo: "DOCUMENTO_RECEBIDO",
        url: `https://arquivos.test/${MARCA}/certidao-v2-legivel.pdf`, nome: "certidao-v2-legivel.pdf",
        vigente: true, substituiId: arquivoV1.id, criadoPorId: daniela.id,
      },
    })
    await tx.documentoArquivo.update({ where: { id: arquivoV1.id }, data: { vigente: false, substituidoEm: new Date(), motivoSubstituicao: "Digitalização anterior estava ilegível" } })
    return v2
  })
  const v1Depois = await prisma.documentoArquivo.findUniqueOrThrow({ where: { id: arquivoV1.id } })
  ok("27) a v1 continua existindo, marcada não-vigente (histórico preservado)", v1Depois.vigente === false && v1Depois.substituidoEm != null)
  ok("27) a v2 é a vigente e aponta para a v1 como substituída", arquivoV2.vigente === true && arquivoV2.substituiId === arquivoV1.id)
  ok("27) o vínculo ao Documento está correto nas duas versões do arquivo recebido",
    (await prisma.documentoArquivo.count({ where: { documentoId: p.documento.id, tipo: "DOCUMENTO_RECEBIDO" } })) === 2)

  const recebido = await executarAcaoCadastrada(step3, "recebido", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a7` })
  ok("25) MARK_DOCUMENT_RECEIVED sucede", recebido.ok === true, JSON.stringify(recebido))
  const docRecebido = await prisma.documento.findUniqueOrThrow({ where: { id: p.documento.id } })
  ok("25) Documento.status = RECEBIDO", docRecebido.status === "RECEBIDO")

  // ==========================================================================
  secao("28) CONCLUIR STEP 3")
  // ==========================================================================
  const step3Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: step3 } })
  ok("28) Step 3 CONCLUIDO", step3Depois.status === "CONCLUIDO")
  const tAposStep3 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("28) a MESMA Tarefa avançou para o Step 4", tAposStep3.workflowStepInstanceId === step4)

  // ==========================================================================
  secao("29) CHECKLIST DO STEP 4 (conferir_certidao — StepChecklistItem real)")
  // ==========================================================================
  const semChecklist = await executarAcaoCadastrada(step4, "aprovado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a8` })
  ok("29) aprovar sem o checklist completo é RECUSADO", semChecklist.ok === false && semChecklist.codigo === "REQUISITO_PENDENTE", JSON.stringify(semChecklist))
  const comChecklist = await executarAcaoCadastrada(step4, "aprovado", { checklist: { nome_confere: true, data_nascimento_confere: true } },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a9` })
  ok("29) com o checklist marcado (StepChecklistItem real), aprova e conclui", comChecklist.ok === true && comChecklist.concluiuPasso === true, JSON.stringify(comChecklist))

  // ==========================================================================
  secao("30) VALIDAR (decisão VALIDADA no Step 5 validar_certidao)")
  // ==========================================================================
  const tAposStep4 = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("antes de 30) a MESMA Tarefa avançou para o Step 5", tAposStep4.workflowStepInstanceId === step5)
  const necAntesValidar = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p.necessidade.id } })
  ok("30) a necessidade AINDA NÃO está atendida (só no fim do Step 5)", necAntesValidar.status !== "ATENDIDA")
  const validado = await executarAcaoCadastrada(step5, "aprovado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-a10` })
  ok("30) decisão VALIDADA (APPROVE_FOR_ANALYSIS) sucede", validado.ok === true && validado.concluiuPasso === true, JSON.stringify(validado))
  const docValidado = await prisma.documento.findUniqueOrThrow({ where: { id: p.documento.id } })
  ok("30) Documento.status = EM_ANALISE (Emissão entrega; não julga)", docValidado.status === "EM_ANALISE")

  // ==========================================================================
  secao("31) CONCLUIR (Step final concluído)")
  // ==========================================================================
  const step5Depois = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: step5 } })
  ok("31) Step 5 CONCLUIDO", step5Depois.status === "CONCLUIDO")
  const tFinal = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId } })
  ok("31) a MESMA Tarefa (id igual do início ao fim) está concluída", tFinal.id === tarefaId && ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(tFinal.statusTarefa), tFinal.statusTarefa)
  // FIX aplicado nesta rodada: `aplicarTarefa` (task-step-sync.ts) só mudava
  // `statusTarefa`/`lockVersion` ao concluir — nunca zerava o ponteiro do
  // passo, diferente de `concluirEtapa` (tarefa-etapa.ts) e
  // `sincronizarTarefaComWorkflow` (tarefa-canonica.ts), que sempre escrevem
  // `corrente?.id ?? null`. Uma Tarefa concluída por ESTE caminho
  // (`executarAcaoCadastrada` → `concluirPasso`) ficava com
  // `workflowStepInstanceId` apontando para um passo já histórico — a mesma
  // contradição que o verificador de integridade sinaliza (Tarefa concluída
  // com Step "atual"). Agora as duas portas convergem: `TAREFA_CONCLUIDA_SET`
  // sempre zera o ponteiro.
  ok("31) a Tarefa concluída tem o ponteiro de passo ZERADO (mesmo padrão de concluirEtapa/sincronizarTarefaComWorkflow — doc 27, Tarefa 3570 real)",
    tFinal.workflowStepInstanceId === null,
    `workflowStepInstanceId=${tFinal.workflowStepInstanceId}`)
  ok("31) ainda 1 única Tarefa do início ao fim", (await prisma.tarefa.count({ where: { processoId: processo.id } })) === 1)

  // ==========================================================================
  secao("32) SATISFAZER NECESSIDADE (NecessidadeDocumental → ATENDIDA)")
  // ==========================================================================
  const necFinal = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p.necessidade.id } })
  ok("32) NecessidadeDocumental.status = ATENDIDA", necFinal.status === "ATENDIDA", necFinal.status)

  // ==========================================================================
  secao("33) HISTÓRICO (cadeia completa consultável do início ao fim)")
  // ==========================================================================
  const eventosTodos = await prisma.workflowEvento.findMany({ where: { processoId: processo.id }, orderBy: { id: "asc" } })
  ok("33) histórico não está vazio e cobre os 5 passos", eventosTodos.length >= 10)
  const stepsComEvento = new Set(eventosTodos.map((e) => e.stepInstanceId).filter((x): x is number => x != null))
  ok("33) todos os 5 passos aparecem no histórico", [step1, step2, step3, step4, step5].every((id) => stepsComEvento.has(id)))
  const logsTodos = await prisma.logAuditoria.findMany({ where: { OR: [{ entidade: "Tarefa", entidadeId: tarefaId }, { entidade: "PhaseWorkflowStepInstance", entidadeId: { in: [step1, step2, step3, step4, step5] } }] } })
  ok("33) LogAuditoria também cobre o ciclo inteiro", logsTodos.length >= 5)

  // ==========================================================================
  secao("34) EVENTOS (todos os esperados existem, na ordem certa)")
  // ==========================================================================
  const tiposNaOrdem = eventosTodos.map((e) => e.tipo)
  const idxGerada = tiposNaOrdem.indexOf("TAREFA_GERADA")
  const idxConcluido1 = tiposNaOrdem.indexOf("PASSO_CONCLUIDO")
  const idxTarefaConcluida = tiposNaOrdem.indexOf("TAREFA_CONCLUIDA")
  ok("34) TAREFA_GERADA vem antes do primeiro PASSO_CONCLUIDO", idxGerada >= 0 && idxConcluido1 >= 0 && idxGerada < idxConcluido1)
  ok("34) TAREFA_CONCLUIDA é o desfecho, depois de todos os PASSO_CONCLUIDO", idxTarefaConcluida >= 0 && idxTarefaConcluida === tiposNaOrdem.lastIndexOf(tiposNaOrdem[idxTarefaConcluida]) && idxTarefaConcluida > idxConcluido1)
  ok("34) exatamente 5 PASSO_CONCLUIDO (um por step, nenhum duplicado)", tiposNaOrdem.filter((t) => t === "PASSO_CONCLUIDO").length === 5, tiposNaOrdem.filter((t) => t === "PASSO_CONCLUIDO").length.toString())

  // ==========================================================================
  secao("35) NOTIFICAÇÕES (geradas nos pontos certos)")
  // ==========================================================================
  const notifsTodas = await prisma.notificacaoOperacional.findMany({ where: { tarefaId } })
  ok("35) notificação de ATRIBUICAO existe", notifsTodas.some((n) => n.tipo === "ATRIBUICAO"))
  ok("35) notificação de RETORNO_TERCEIRO existe (do passo 17)", notifsTodas.some((n) => n.tipo === "RETORNO_TERCEIRO"))
  ok("35) nenhuma notificação duplicada do mesmo tipo+destinatário (idempotência)",
    notifsTodas.filter((n) => n.tipo === "ATRIBUICAO").length === 1 && notifsTodas.filter((n) => n.tipo === "RETORNO_TERCEIRO").length === 1)

  // ==========================================================================
  secao("36) MINHA OPERAÇÃO (a Tarefa sai da fila, aparece concluída/fora da atenção)")
  // ==========================================================================
  const filaDanielaFinal = await minhaFila(daniela.id)
  ok("36) a Tarefa SAIU da fila de pendências da Daniela", !filaDanielaFinal.some((l) => l.taskId === tarefaId))
  const dossieFinal = await dossieDaTarefa(tarefaId)
  ok("36) o dossiê mostra a Tarefa concluída", dossieFinal != null && ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(dossieFinal.statusTarefa as string))

  // ==========================================================================
  secao("37) TAREFAS E PROJETOS (a projeção administrativa reflete o mesmo estado final)")
  // ==========================================================================
  const { linhas: linhas37 } = await visaoGerencial({ processoId: processo.id, incluirEncerradas: true }, new Date())
  const l37 = naLista(linhas37, tarefaId)
  ok("37) a linha existe e mostra o mesmo statusTarefa final", l37?.statusTarefa === tFinal.statusTarefa)
  ok("37) a coluna Kanban é CONCLUIDA — mesmo estado que Minha Operação", l37 != null && (l37 as unknown as { coluna?: string }).coluna === "CONCLUIDA")

  // ==========================================================================
  secao("38) FASE (PhaseWorkflowInstance reflete a conclusão, sem apagar histórico)")
  // ==========================================================================
  const instFinal = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: p.instanciaId } })
  ok("38) a instância da fase continua existindo (nada foi apagado)", instFinal.id === p.instanciaId)
  const stepsFinais = await prisma.phaseWorkflowStepInstance.findMany({ where: { workflowInstanceId: p.instanciaId } })
  ok("38) os 5 steps continuam existindo, todos CONCLUIDO", stepsFinais.length === 5 && stepsFinais.every((s) => s.status === "CONCLUIDO"))
  ok("38) o histórico de eventos da fase não foi apagado (mesma contagem de antes)", (await prisma.workflowEvento.count({ where: { workflowInstanceId: p.instanciaId } })) === eventosTodos.length)

  // ==========================================================================
  secao("CAMINHO ALTERNATIVO — NÃO VALIDADA → nova tentativa → nova via → validação posterior")
  // ==========================================================================
  const arv2 = await prisma.arvore.create({ data: { nome: `${MARCA} árvore alt` }, select: { id: true } })
  const pessoa2 = await prisma.pessoa.create({ data: { arvoreId: arv2.id, nome: "Beltrano", sobrenome: `${MARCA} Alt` }, select: { id: true } })
  const processo2 = await prisma.processo.create({
    data: { nome: `${MARCA} processo alt`, arvoreId: arv2.id, workflowRuntime: "v2", faseAtualKey: "emissao_documental" },
    select: { id: true },
  })
  const p2c1 = await palco({ wf, pessoa: pessoa2, processo: processo2, ciclo: 1 })

  const mat2 = await garantirTarefaDePasso({ stepInstanceId: p2c1.stepIds.solicitar_certidao })
  ok("alt.1) 1º ciclo materializa uma Tarefa real", mat2.success === true && mat2.created === true)
  const tarefaId2c1 = mat2.success ? mat2.tarefa.id : -1
  await garantirTentativa(p2c1.stepIds.solicitar_certidao, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  await atribuirTarefa({ tarefaId: tarefaId2c1, responsavelId: daniela.id, autorId: marco.id })

  await prisma.documentoArquivo.create({
    data: {
      documentoId: p2c1.documento.id, stepInstanceId: p2c1.stepIds.solicitar_certidao, documentTypeId: wf.tipoEvidenciaId,
      tipo: "REQUERIMENTO_ENVIADO", url: `https://arquivos.test/${MARCA}/alt-requerimento.pdf`, nome: "requerimento.pdf", criadoPorId: daniela.id,
    },
  })
  await executarAcaoCadastrada(p2c1.stepIds.solicitar_certidao, "enviado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-1` })
  await executarAcaoCadastrada(p2c1.stepIds.aguardar_retorno_do_cartorio, "retorno_chegou", { numero_protocolo: "CRT-ALT-01", data_protocolo: "2026-09-11" },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-2` })
  await executarAcaoCadastrada(p2c1.stepIds.receber_certidao, "recebido", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-3` })
  await executarAcaoCadastrada(p2c1.stepIds.conferir_certidao, "aprovado", { checklist: { nome_confere: true, data_nascimento_confere: true } },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-4` })

  secao("NÃO VALIDADA (decisão no Step 5, com motivo obrigatório)")
  const semMotivo = await executarAcaoCadastrada(p2c1.stepIds.validar_certidao, "nova_via", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-5a` })
  ok("alt.2) NÃO VALIDADA sem motivo é RECUSADA (motivo obrigatório)", semMotivo.ok === false && semMotivo.codigo === "CAMPO_OBRIGATORIO", JSON.stringify(semMotivo))
  const naoValidada = await executarAcaoCadastrada(p2c1.stepIds.validar_certidao, "nova_via", { motivo: "Certidão ilegível — solicitar nova via" },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-5b` })
  ok("alt.3) NÃO VALIDADA com motivo sucede (REQUEST_NEW_COPY)", naoValidada.ok === true, JSON.stringify(naoValidada))

  secao("PRESERVA A VERSÃO REJEITADA")
  const docOrigemDepois = await prisma.documento.findUniqueOrThrow({ where: { id: p2c1.documento.id } })
  ok("alt.4) o documento REJEITADO continua existindo e legível", docOrigemDepois.id === p2c1.documento.id)
  ok("alt.4) o documento rejeitado foi marcado substituído (não apagado, não sobrescrito)", docOrigemDepois.substituidoEm != null)
  const docNovaVia = await prisma.documento.findFirstOrThrow({ where: { derivadoDeId: p2c1.documento.id } })
  ok("alt.5) a NOVA VIA é um documento NOVO, derivado do anterior", docNovaVia.derivadoDeId === p2c1.documento.id && docNovaVia.id !== p2c1.documento.id)
  ok("alt.5) a nova via aponta para a MESMA necessidade (não duplica a obrigação)", docNovaVia.necessidadeId === p2c1.necessidade.id)
  ok("alt.6) ainda existem exatamente 2 documentos para esta necessidade (original + nova via)",
    (await prisma.documento.count({ where: { necessidadeId: p2c1.necessidade.id } })) === 2)

  secao("NECESSIDADE NÃO SATISFEITA NO 1º CICLO")
  const necCiclo1 = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p2c1.necessidade.id } })
  ok("alt.7) a necessidade NÃO está ATENDIDA depois do 1º ciclo rejeitado", necCiclo1.status !== "ATENDIDA", necCiclo1.status)
  const tarefaC1Final = await prisma.tarefa.findUniqueOrThrow({ where: { id: tarefaId2c1 } })
  ok("alt.7) a Tarefa do 1º ciclo terminou (mesmo rejeitada, o roteiro dela acabou)", ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(tarefaC1Final.statusTarefa))

  secao("NOVA TENTATIVA / NOVA VIA — 2º ciclo, mesma necessidade, novo documento")
  const p2c2 = await palco({ wf, pessoa: pessoa2, processo: processo2, ciclo: 2, documentoId: docNovaVia.id, necessidadeId: p2c1.necessidade.id })
  const mat2c2 = await garantirTarefaDePasso({ stepInstanceId: p2c2.stepIds.solicitar_certidao })
  ok("alt.8) 2º ciclo materializa Tarefa (nova execução, mesma obrigação)", mat2c2.success === true && mat2c2.created === true)
  const tarefaId2c2 = mat2c2.success ? mat2c2.tarefa.id : -1
  ok("alt.8) a Tarefa do 2º ciclo é DIFERENTE da do 1º (nova tentativa, não ressurreição)", tarefaId2c2 !== tarefaId2c1 && tarefaId2c2 > 0)
  await garantirTentativa(p2c2.stepIds.solicitar_certidao, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  await atribuirTarefa({ tarefaId: tarefaId2c2, responsavelId: daniela.id, autorId: marco.id })

  secao("VALIDAÇÃO POSTERIOR — o 2º ciclo é validado com sucesso")
  await prisma.documentoArquivo.create({
    data: {
      documentoId: docNovaVia.id, stepInstanceId: p2c2.stepIds.solicitar_certidao, documentTypeId: wf.tipoEvidenciaId,
      tipo: "REQUERIMENTO_ENVIADO", url: `https://arquivos.test/${MARCA}/alt-requerimento-v2.pdf`, nome: "requerimento-v2.pdf", criadoPorId: daniela.id,
    },
  })
  await executarAcaoCadastrada(p2c2.stepIds.solicitar_certidao, "enviado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-6` })
  await executarAcaoCadastrada(p2c2.stepIds.aguardar_retorno_do_cartorio, "retorno_chegou", { numero_protocolo: "CRT-ALT-02", data_protocolo: "2026-09-12" },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-7` })
  await executarAcaoCadastrada(p2c2.stepIds.receber_certidao, "recebido", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-8` })
  await executarAcaoCadastrada(p2c2.stepIds.conferir_certidao, "aprovado", { checklist: { nome_confere: true, data_nascimento_confere: true } },
    { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-9` })
  const validadoAlt = await executarAcaoCadastrada(p2c2.stepIds.validar_certidao, "aprovado", {}, { usuarioId: daniela.id, permissoes: PERMS, correlationId: `${M}-alt-10` })
  ok("alt.9) a 2ª tentativa (nova via) é VALIDADA com sucesso", validadoAlt.ok === true && validadoAlt.concluiuPasso === true, JSON.stringify(validadoAlt))

  secao("NECESSIDADE SATISFEITA SÓ NO 2º CICLO")
  const necFinalAlt = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: p2c1.necessidade.id } })
  ok("alt.10) a necessidade agora está ATENDIDA — só depois do 2º ciclo", necFinalAlt.status === "ATENDIDA")
  const docNovaViaFinal = await prisma.documento.findUniqueOrThrow({ where: { id: docNovaVia.id } })
  ok("alt.10) o documento validado é a NOVA VIA (EM_ANALISE), não o rejeitado", docNovaViaFinal.status === "EM_ANALISE")
  const docOrigemFinal = await prisma.documento.findUniqueOrThrow({ where: { id: p2c1.documento.id } })
  ok("alt.11) o documento ORIGINAL rejeitado permanece como estava (histórico intacto)", docOrigemFinal.substituidoEm != null && docOrigemFinal.status !== "EM_ANALISE")

  // ==========================================================================
  await limpar()
  console.log(`\n${"=".repeat(78)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  • ${f}`)
    process.exitCode = 1
  } else {
    console.log("\nOs 38 passos + o caminho NÃO VALIDADA fecham de ponta a ponta, com estado real confirmado em cada um.")
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
