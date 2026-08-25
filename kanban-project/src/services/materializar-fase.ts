// src/services/materializar-fase.ts
//
// MATERIALIZAÇÃO DA EXECUÇÃO DE UMA FASE — o serviço OFICIAL ÚNICO.
//
// Toda instância/ciclo de fase, venha de onde vier, passa por aqui:
//   • nascimento do processo;
//   • avanço automático e avanço forçado;
//   • movimentação manual (para frente, para trás ou para fase intermediária);
//   • reabertura e retorno controlado;
//   • cadastro de processo já em andamento e regularização histórica;
//   • reconciliação, reparo e backfill autorizado.
//
// NÃO é um segundo materializador: ele ORQUESTRA os dois serviços canônicos que já
// existem — `instanciarWorkflowDaFase` (workflow publicado → alvos → passos) e
// `garantirTarefaDePasso` (passo → tarefa). O que ele acrescenta é o que faltava:
//
//   1) UM ponto de entrada, para que nenhuma origem materialize "quase igual";
//   2) CONVERGÊNCIA: reexecutar completa o que falta e não duplica o que existe;
//   3) RELATÓRIO EXPLÍCITO: quando nada é materializado, o motivo é NOMEADO. "Zero
//      documentos" deixa de ser um estado silencioso e passa a ser um diagnóstico —
//      falta workflow publicado? falta pessoa na árvore? falta o registro no
//      Documento Mestre? A tela mostra o motivo real em vez de inventar
//      "nenhum documento configurado".
//
// O que ele NÃO faz: não muda a fase do processo, não conclui nada, não cancela
// nada, não toca em ciclo anterior, não altera obrigação de outra fase.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { materializarGenealogia } from "@/src/services/genealogia/materializar-genealogia"
import { garantirTarefaDePasso, carregarPreCondicoes } from "@/src/services/passo-tarefa"
import type { WorkflowValidationIssue } from "@/src/services/phase-workflow-helpers"
import { phaseKeyToFaseCode, FASES } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

/** De onde veio o pedido de materialização — vai para a auditoria, sem exceção. */
export type FonteMaterializacao =
  | "PROCESSO_CRIADO"
  | "AVANCO_AUTOMATICO"
  | "AVANCO_FORCADO"
  | "REABERTURA"
  | "RETORNO_CONTROLADO"
  | "MOVIMENTACAO_MANUAL"
  | "CADASTRO_EM_ANDAMENTO"
  | "REGULARIZACAO_HISTORICA"
  | "RECONCILIACAO"
  | "REPARO_ADMINISTRATIVO"
  | "BACKFILL"

/**
 * Resultado ESTRUTURAL da materialização. Note que "sem alvo" e "sem workflow" são
 * estados OFICIAIS e diferentes: o primeiro é configuração completa sem entidade a
 * operar; o segundo é configuração ausente. Confundir os dois foi exatamente o que
 * fazia a Central dizer "nenhum documento obrigatório configurado" quando o
 * workflow existia e estava publicado.
 */
export type EstadoMaterializacao =
  | "MATERIALIZADO"
  | "SEM_ALVO_APLICAVEL"
  | "SEM_WORKFLOW_PUBLICADO"
  | "CONFIGURACAO_INVALIDA"
  | "PROCESSO_SEM_FASE"
  | "ERRO"

export interface RelatorioMaterializacao {
  ok: boolean
  estado: EstadoMaterializacao
  processoId: number
  faseMacroKey: string | null
  faseLabel: string | null
  workflowInstanceId: number | null
  ciclo: number | null
  workflowDefinitionId: number | null
  workflowVersion: number | null
  /** Escopo operacional canônico da fase (por qual entidade ela opera). */
  escopo: string | null
  passosTotais: number
  passosCriados: number
  passosPreexistentes: number
  tarefasCriadas: number
  tarefasPreexistentes: number
  /** Motivos NOMEADOS — nunca vazio quando `estado != "MATERIALIZADO"`. */
  motivos: WorkflowValidationIssue[]
  /** Texto pronto para a tela administrativa. `null` quando materializou. */
  mensagemAdministrativa: string | null
  fonte: FonteMaterializacao
  correlationId: string
  duracaoMs: number
}

export interface MaterializarInput {
  processoId: number
  /** Fase alvo. Omitida ⇒ a fase operacional de referência do processo. */
  faseMacroKey?: string | null
  /** Instância alvo. Omitida ⇒ a instância ATIVA da fase (ou a que for criada). */
  phaseInstanceId?: number | null
  /** Ciclo alvo. Omitido ⇒ o ciclo da instância ativa, ou 1. */
  ciclo?: number | null
  fonte: FonteMaterializacao
  solicitadoPorId?: number
  correlationId?: string
  causationId?: string
  /** Registrar LogAuditoria da materialização (default: true). */
  auditar?: boolean
}

/**
 * `Tarefa.origem` é VarChar(20) — o rótulo precisa caber. O relato completo da
 * operação (fonte, contagens, motivos, duração) vive na auditoria; aqui só entra a
 * etiqueta curta que a tarefa carrega para sempre.
 */
const ORIGEM_TAREFA_POR_FONTE: Record<FonteMaterializacao, string> = {
  PROCESSO_CRIADO: "process_created",
  AVANCO_AUTOMATICO: "workflow",
  AVANCO_FORCADO: "workflow_forcado",
  REABERTURA: "reabertura",
  RETORNO_CONTROLADO: "retorno",
  MOVIMENTACAO_MANUAL: "mover_manual",
  CADASTRO_EM_ANDAMENTO: "cadastro_andamento",
  REGULARIZACAO_HISTORICA: "regularizacao",
  RECONCILIACAO: "reconciliacao",
  REPARO_ADMINISTRATIVO: "reparo",
  BACKFILL: "backfill",
}

/** A instância veio de qual operação — vocabulário do serviço de instanciação. */
const ORIGEM_POR_FONTE: Record<FonteMaterializacao, "MOTOR" | "MANUAL" | "MIGRACAO" | "REABERTURA"> = {
  PROCESSO_CRIADO: "MOTOR",
  AVANCO_AUTOMATICO: "MOTOR",
  AVANCO_FORCADO: "MOTOR",
  REABERTURA: "REABERTURA",
  RETORNO_CONTROLADO: "REABERTURA",
  MOVIMENTACAO_MANUAL: "MANUAL",
  CADASTRO_EM_ANDAMENTO: "MANUAL",
  REGULARIZACAO_HISTORICA: "MIGRACAO",
  RECONCILIACAO: "MOTOR",
  REPARO_ADMINISTRATIVO: "MANUAL",
  BACKFILL: "MIGRACAO",
}

/**
 * NOTAS DE BASTIDOR — verdadeiras, úteis no log, sem serventia para quem opera.
 *
 * "Tipo inferido de createsTask=true => HUMANO" descreve uma decisão interna do
 * motor. Ela ia para a mesma frase que o operador lê, colada no meio, sem pontuação:
 *
 *   "…nenhuma entidade do processo se aplica aos passos dele. Tipo inferido de
 *    createsTask=true => HUMANO O processo ainda não tem árvore genealógica…"
 *
 * Quem abriu o processo Gerbi em 12/08 leu isso e não fez nada — e a parte que dizia
 * o que fazer ("crie a árvore e cadastre as pessoas") estava ali, enterrada.
 *
 * Elas continuam no relatório: `motivos` não perde nada. O que muda é que param de
 * entrar na frase que a tela mostra.
 */
const NOTAS_DE_BASTIDOR = new Set(["PASSO_TIPO_INFERIDO"])

/** Os motivos que o operador consegue AGIR. */
export function motivosAcionaveis(motivos: WorkflowValidationIssue[]): WorkflowValidationIssue[] {
  return motivos.filter((m) => !NOTAS_DE_BASTIDOR.has(m.code) && !!m.message)
}

/**
 * Traduz os motivos técnicos numa frase que o operador consegue AGIR. Sem isso, o
 * relatório vira log e a tela continua mentindo.
 */
function mensagemDe(estado: EstadoMaterializacao, faseLabel: string, motivos: WorkflowValidationIssue[]): string | null {
  if (estado === "MATERIALIZADO") return null
  // PONTUADO, e sem as notas de bastidor: duas frases coladas por um espaço viram uma
  // frase que não termina, e ninguém lê até o fim.
  const detalhe = motivosAcionaveis(motivos)
    .map((m) => (/[.!?]$/.test(m.message.trim()) ? m.message.trim() : `${m.message.trim()}.`))
    .join(" ")
  switch (estado) {
    case "SEM_WORKFLOW_PUBLICADO":
      return `A fase ${faseLabel} não tem Workflow Interno publicado aplicável a este processo. ${detalhe} Publique o workflow em Gerenciamento › Workflows das Fases.`
    case "SEM_ALVO_APLICAVEL":
      return `O Workflow Interno da fase ${faseLabel} está publicado, mas nenhuma entidade do processo se aplica aos passos dele. ${detalhe}`
    case "CONFIGURACAO_INVALIDA":
      return `A configuração da fase ${faseLabel} está inválida e a materialização foi recusada. ${detalhe}`
    case "PROCESSO_SEM_FASE":
      return "O processo não tem fase operacional de referência definida."
    default:
      return `Falha ao materializar a fase ${faseLabel}. ${detalhe}`
  }
}

/**
 * MATERIALIZA (ou converge) a execução de uma fase. Idempotente: rodar N vezes sobre
 * o mesmo phaseInstanceId produz exatamente o mesmo estado.
 */
export async function materializarExecucaoDaFase(input: MaterializarInput): Promise<RelatorioMaterializacao> {
  const inicio = Date.now()
  const correlationId = input.correlationId ?? randomUUID()

  const base = (extra: Partial<RelatorioMaterializacao>): RelatorioMaterializacao => ({
    ok: false, estado: "ERRO", processoId: input.processoId, faseMacroKey: null, faseLabel: null,
    workflowInstanceId: null, ciclo: null, workflowDefinitionId: null, workflowVersion: null,
    escopo: null, passosTotais: 0, passosCriados: 0, passosPreexistentes: 0,
    tarefasCriadas: 0, tarefasPreexistentes: 0, motivos: [], mensagemAdministrativa: null,
    fonte: input.fonte, correlationId, duracaoMs: Date.now() - inicio, ...extra,
  })

  // ── 1) fase alvo ─────────────────────────────────────────────────────────
  let faseMacroKey = input.faseMacroKey ?? null
  let phaseInstanceId = input.phaseInstanceId ?? null
  let ciclo = input.ciclo ?? null

  if (phaseInstanceId != null) {
    const inst = await prisma.phaseWorkflowInstance.findUnique({
      where: { id: phaseInstanceId },
      select: { id: true, processoId: true, faseMacroKey: true, ciclo: true },
    })
    if (!inst || inst.processoId !== input.processoId) {
      const motivos = [{ code: "INSTANCIA_INVALIDA", message: `Instância de fase ${phaseInstanceId} inexistente ou de outro processo.` }]
      return base({ estado: "ERRO", motivos, mensagemAdministrativa: mensagemDe("ERRO", "informada", motivos) })
    }
    faseMacroKey = inst.faseMacroKey
    ciclo = inst.ciclo
  }

  if (!faseMacroKey) {
    const processo = await prisma.processo.findUnique({
      where: { id: input.processoId }, select: { faseAtualKey: true },
    })
    faseMacroKey = processo?.faseAtualKey ?? null
  }
  if (!faseMacroKey) {
    const motivos = [{ code: "PROCESSO_SEM_FASE", message: "Processo sem fase operacional de referência." }]
    return base({ estado: "PROCESSO_SEM_FASE", motivos, mensagemAdministrativa: mensagemDe("PROCESSO_SEM_FASE", "atual", motivos) })
  }

  const faseCode = phaseKeyToFaseCode(faseMacroKey)
  const faseLabel = faseCode ? FASES[faseCode as FaseCode].label : faseMacroKey
  const escopo = faseCode ? String(FASES[faseCode as FaseCode].scope) : "PROCESSO"

  // Ciclo alvo: o da instância ATIVA da fase. Materializar NUNCA cria ciclo novo —
  // criar ciclo é decisão do PhaseAdvanceService (avanço, retorno, movimentação).
  if (ciclo == null) {
    const ativa = await prisma.phaseWorkflowInstance.findFirst({
      where: { processoId: input.processoId, faseMacroKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
      orderBy: { ciclo: "desc" }, select: { id: true, ciclo: true },
    })
    if (ativa) { phaseInstanceId = ativa.id; ciclo = ativa.ciclo }
    else ciclo = 1
  }

  const passosAntes = phaseInstanceId != null
    ? await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: phaseInstanceId } })
    : 0

  // ── 1.5) OBRIGAÇÕES DOCUMENTAIS — motor ÚNICO, antes dos passos ──────────
  //
  // As necessidades da fase nascem AQUI, das Regras Documentais PUBLICADAS, e de
  // lugar nenhum mais. Antes existiam DOIS motores: este e a geração por árvore
  // (DOCUMENT_RULES) embutida em `carregarContextoEscopo`. Como cada um gravava
  // um `varianteKey` diferente para a mesma obrigação, a chave de idempotência
  // não os reconhecia como iguais e a mesma pessoa recebia a certidão duas vezes
  // — uma por motor.
  //
  // A ordem importa: as necessidades precisam existir ANTES de
  // `instanciarWorkflowDaFase`, que é quem transforma alvo em passo.
  if (faseMacroKey === "genealogia") {
    try {
      await materializarGenealogia(input.processoId)
    } catch (e) {
      // Falha aqui não derruba a materialização da fase: os passos que não
      // dependem de necessidade continuam válidos, e o relatório dirá que a
      // fase ficou sem alvo documental.
      console.error(`[materializar-fase] materializarGenealogia falhou (proc ${input.processoId}):`, e)
    }
  }

  // ── 2) workflow publicado → alvos → passos (serviço canônico) ────────────
  const inst = await instanciarWorkflowDaFase({
    processoId: input.processoId,
    faseMacroKey,
    ciclo,
    origem: ORIGEM_POR_FONTE[input.fonte],
    correlationId,
    causationId: input.causationId,
    solicitadoPorId: input.solicitadoPorId,
  })

  if (!inst.success) {
    const estado: EstadoMaterializacao =
      inst.code === "WORKFLOW_NAO_ENCONTRADO" || inst.code === "SEM_VERSAO_ATIVA" || inst.code === "WORKFLOW_SEM_PASSOS"
        ? "SEM_WORKFLOW_PUBLICADO"
        : "CONFIGURACAO_INVALIDA"
    const motivos = inst.errors.length
      ? inst.errors
      : [{ code: inst.code, message: `Materialização recusada pelo serviço de instanciação (${inst.code}).` }]
    const rel = base({
      estado, faseMacroKey, faseLabel, escopo, ciclo, motivos,
      mensagemAdministrativa: mensagemDe(estado, faseLabel, motivos),
    })
    await auditar(input, rel)
    return rel
  }

  const passos = inst.stepInstances
  const passosCriados = Math.max(0, passos.length - passosAntes)

  // ── 3) tarefas dos passos (serviço canônico, idempotente) ────────────────
  let tarefasCriadas = 0
  let tarefasPreexistentes = 0
  const motivos: WorkflowValidationIssue[] = [...inst.warnings]

  if (passos.length > 0) {
    const preCondicoes = await carregarPreCondicoes(input.processoId)
    for (const passo of passos) {
      const g = await garantirTarefaDePasso({
        stepInstanceId: passo.id,
        correlationId,
        causationId: passo.chaveIdempotencia,
        origem: ORIGEM_TAREFA_POR_FONTE[input.fonte],
        solicitadoPorId: input.solicitadoPorId,
        preCondicoes,
      })
      if (g.success) { if (g.created) tarefasCriadas++; else tarefasPreexistentes++ }
    }
  }

  // ── 4) estado final — zero só existe com motivo NOMEADO ──────────────────
  const estado: EstadoMaterializacao = passos.length > 0
    ? "MATERIALIZADO"
    : "SEM_ALVO_APLICAVEL"

  if (estado === "SEM_ALVO_APLICAVEL" && motivos.length === 0) {
    // Zero passos e nenhum aviso é uma contradição: o workflow foi resolvido e
    // validado (senão teríamos caído no ramo de erro acima). Registrar como motivo
    // próprio é o que impede o estado mudo que gerou este trabalho.
    motivos.push({
      code: "MATERIALIZACAO_VAZIA_SEM_MOTIVO",
      message: `O Workflow Interno da fase ${faseLabel} foi resolvido, mas nenhum passo foi instanciado e nenhum motivo foi reportado. Isto é uma inconsistência de configuração — verifique os passos publicados e o escopo (${escopo}) deles.`,
    })
  }

  const relatorio = base({
    ok: estado === "MATERIALIZADO",
    estado,
    faseMacroKey,
    faseLabel,
    escopo,
    workflowInstanceId: inst.workflowInstance.id,
    ciclo: inst.workflowInstance.ciclo,
    workflowDefinitionId: inst.workflowInstance.workflowDefinitionId ?? null,
    workflowVersion: inst.workflowInstance.workflowVersion ?? null,
    passosTotais: passos.length,
    passosCriados,
    passosPreexistentes: passos.length - passosCriados,
    tarefasCriadas,
    tarefasPreexistentes,
    motivos,
    mensagemAdministrativa: mensagemDe(estado, faseLabel, motivos),
    duracaoMs: Date.now() - inicio,
  })

  await auditar(input, relatorio)
  return relatorio
}

/**
 * Auditoria da materialização. Usa LogAuditoria porque os eventos ESTRUTURAIS já
 * existem e são emitidos pelos serviços canônicos (WORKFLOW_INSTANCIADO,
 * PASSO_INSTANCIADO, TAREFA_GERADA). O que falta é o RELATÓRIO da operação — fonte,
 * contagens, motivos, duração — e é isso que fica aqui. FASE_MOVIDA e os demais
 * eventos de fase permanecem intocados.
 *
 * Falhar a auditoria não pode desfazer uma materialização já convergida.
 */
async function auditar(input: MaterializarInput, r: RelatorioMaterializacao): Promise<void> {
  if (input.auditar === false) return
  // Materialização convergente que não mudou nada é ruído: só audita quando houve
  // efeito real ou quando o estado NÃO é o esperado (que é a informação valiosa).
  const houveEfeito = r.passosCriados > 0 || r.tarefasCriadas > 0
  if (!houveEfeito && r.estado === "MATERIALIZADO") return
  try {
    await prisma.logAuditoria.create({
      data: {
        acao: "FASE_MATERIALIZADA",
        entidade: "PROCESSO",
        entidadeId: r.processoId,
        descricao: `Materialização da fase ${r.faseLabel ?? r.faseMacroKey} (ciclo ${r.ciclo ?? "?"}) — ${r.estado}`,
        usuarioId: input.solicitadoPorId ?? null,
        detalhes: {
          fonte: r.fonte,
          estado: r.estado,
          faseMacroKey: r.faseMacroKey,
          workflowInstanceId: r.workflowInstanceId,
          ciclo: r.ciclo,
          workflowDefinitionId: r.workflowDefinitionId,
          workflowVersion: r.workflowVersion,
          escopo: r.escopo,
          passosTotais: r.passosTotais,
          passosCriados: r.passosCriados,
          passosPreexistentes: r.passosPreexistentes,
          tarefasCriadas: r.tarefasCriadas,
          tarefasPreexistentes: r.tarefasPreexistentes,
          motivos: r.motivos.map((m) => ({ code: m.code, message: m.message })),
          duracaoMs: r.duracaoMs,
          correlationId: r.correlationId,
        } as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    console.error(`[materializar-fase] auditoria falhou (proc ${r.processoId}, ${r.correlationId}):`, e)
  }
}

// --------------------------------------------------------------------------
// VALIDAÇÃO PÓS-MATERIALIZAÇÃO
// --------------------------------------------------------------------------

export interface ValidacaoMaterializacao {
  ok: boolean
  workflowInstanceId: number | null
  ciclo: number | null
  pessoasOficiais: number
  alvosResolvidos: number
  passos: number
  tarefas: number
  /** Passos que apontam para instância/ciclo diferente do consultado. */
  vazamentoDeCiclo: number
  problemas: string[]
}

/**
 * Confere o que a materialização deixou no banco. É a segunda barreira: o relatório
 * diz o que o serviço ACHA que fez; isto diz o que o banco realmente tem.
 */
export async function validarMaterializacaoDaFase(
  phaseInstanceId: number,
): Promise<ValidacaoMaterializacao> {
  const problemas: string[] = []
  const inst = await prisma.phaseWorkflowInstance.findUnique({
    where: { id: phaseInstanceId },
    select: {
      id: true, processoId: true, faseMacroKey: true, ciclo: true, status: true,
      workflowDefinitionId: true, workflowVersion: true,
    },
  })
  if (!inst) {
    return { ok: false, workflowInstanceId: null, ciclo: null, pessoasOficiais: 0, alvosResolvidos: 0, passos: 0, tarefas: 0, vazamentoDeCiclo: 0, problemas: ["Instância de fase inexistente."] }
  }
  if (inst.workflowDefinitionId == null) problemas.push("Instância sem workflow publicado vinculado.")

  const processo = await prisma.processo.findUnique({ where: { id: inst.processoId }, select: { arvoreId: true } })
  const pessoasOficiais = processo?.arvoreId
    ? await prisma.pessoa.count({ where: { arvoreId: processo.arvoreId } })
    : 0

  const passosDaInstancia = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: inst.id },
    select: { id: true, ciclo: true, pessoaId: true, necessidadeId: true, documentoId: true },
  })
  const vazamentoDeCiclo = passosDaInstancia.filter((p) => p.ciclo !== inst.ciclo).length
  if (vazamentoDeCiclo > 0) problemas.push(`${vazamentoDeCiclo} passo(s) da instância estão com ciclo diferente do ciclo da fase.`)

  const alvosResolvidos = new Set(
    passosDaInstancia.map((p) =>
      p.necessidadeId != null ? `n${p.necessidadeId}`
      : p.documentoId != null ? `d${p.documentoId}`
      : p.pessoaId != null ? `p${p.pessoaId}`
      : "processo",
    ),
  ).size

  const tarefas = await prisma.tarefa.count({
    where: { workflowStepInstanceId: { in: passosDaInstancia.map((p) => p.id) } },
  })

  return {
    ok: problemas.length === 0,
    workflowInstanceId: inst.id,
    ciclo: inst.ciclo,
    pessoasOficiais,
    alvosResolvidos,
    passos: passosDaInstancia.length,
    tarefas,
    vazamentoDeCiclo,
    problemas,
  }
}
