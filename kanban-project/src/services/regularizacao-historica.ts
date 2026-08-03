// src/services/regularizacao-historica.ts
//
// REGULARIZAÇÃO HISTÓRICA — cadastro de processo já em fase avançada e conclusão
// posterior das fases anteriores.
//
// O problema real: um processo que chega ao escritório já em Retificação não pode ser
// obrigado a percorrer artificialmente Genealogia, Emissão e Análise antes de poder
// trabalhar. E também não pode ter essas fases marcadas como concluídas sem que o
// trabalho tenha sido registrado — isso não é histórico, é ficção.
//
// A solução: as fases anteriores EXISTEM, com workflow materializado e tarefas reais,
// no estado PENDENTE_DE_REGULARIZACAO. Elas não bloqueiam a fase operacional atual e
// continuam obrigatórias para a integridade histórica do processo.
//
// TODA a regra vive aqui. Rotas, actions e UI apenas chamam — e a autorização é
// verificada NESTE serviço, não só na borda.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma, WorkflowInstanceStatus, RegularizacaoHistorica } from "@prisma/client"
import { calcularPermissoes, temPermissao, type MapaPermissoes } from "@/src/lib/permissoes"
import { FASES, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"
import { instanciarWorkflowDaFase } from "@/src/services/phase-workflow"
import { garantirTarefaDePasso, carregarPreCondicoes } from "@/src/services/passo-tarefa"

/** Permissão oficial, nominal e auditável desta funcionalidade. */
export const PERMISSAO_REGULARIZACAO = "processos.regularizarHistorico" as const

export class RegularizacaoErro extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

// ============================================================
// AUTORIZAÇÃO
// ============================================================

/**
 * Ator autorizado a operar a regularização histórica.
 *
 * Só é resolvido a partir do usuário AUTENTICADO no servidor — nunca de um id vindo
 * do cliente. A permissão é EXCLUSIVA: nem `tipo = 'admin'` a recebe por ser admin;
 * ela precisa estar concedida nominalmente no perfil ou nas permissões custom.
 */
export interface AtorAutorizado {
  usuarioId: number
  nome: string
  email: string
}

export async function assertPermissaoRegularizacao(
  usuarioId: number | null | undefined,
  contexto: { acao: string; processoId?: number | null; origem?: string; ip?: string | null },
): Promise<AtorAutorizado> {
  if (!usuarioId) {
    await auditarTentativaNegada(null, contexto, "SEM_AUTENTICACAO")
    throw new RegularizacaoErro("Não autenticado.", 401, "SEM_AUTENTICACAO")
  }

  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: {
      id: true, nome: true, email: true, tipo: true,
      permissoesCustom: true, perfil: { select: { permissoes: true } },
    },
  })
  if (!u) {
    await auditarTentativaNegada(usuarioId, contexto, "USUARIO_INVALIDO")
    throw new RegularizacaoErro("Usuário inválido ou inativo.", 403, "USUARIO_INVALIDO")
  }

  const permissoes: MapaPermissoes = calcularPermissoes(
    u.tipo,
    u.perfil?.permissoes as MapaPermissoes | null,
    u.permissoesCustom as MapaPermissoes | null,
  )
  if (!temPermissao(permissoes, PERMISSAO_REGULARIZACAO)) {
    await auditarTentativaNegada(usuarioId, contexto, "SEM_PERMISSAO")
    throw new RegularizacaoErro(
      "Esta operação exige a permissão de regularização histórica, concedida nominalmente.",
      403,
      "SEM_PERMISSAO",
    )
  }
  return { usuarioId: u.id, nome: u.nome, email: u.email }
}

/** Toda tentativa negada vira registro — inclusive a chamada direta ao endpoint. */
async function auditarTentativaNegada(
  usuarioId: number | null,
  contexto: { acao: string; processoId?: number | null; origem?: string; ip?: string | null },
  motivo: string,
): Promise<void> {
  try {
    await prisma.logAuditoria.create({
      data: {
        acao: "REGULARIZACAO_ACESSO_NEGADO",
        entidade: "PROCESSO",
        entidadeId: contexto.processoId ?? 0,
        usuarioId: usuarioId ?? undefined,
        descricao: `Acesso negado a "${contexto.acao}" (${motivo})`,
        detalhes: { motivo, acao: contexto.acao, origem: contexto.origem ?? null, ip: contexto.ip ?? null },
      },
    })
  } catch {
    // Auditoria nunca derruba a negativa — a negativa em si já aconteceu.
  }
}

// ============================================================
// ESTADOS
// ============================================================

/** Estado inicial que o administrador pode atribuir a uma fase anterior. */
export type EstadoFaseAnterior = "PENDENTE_DE_REGULARIZACAO" | "CONCLUIDA" | "NAO_APLICAVEL"

/** Fase anterior não bloqueia a operação; só a integridade histórica. */
export const ESTADOS_HISTORICOS: WorkflowInstanceStatus[] = ["PENDENTE_DE_REGULARIZACAO", "NAO_APLICAVEL"]

/** A instância representa trabalho histórico pendente de registro? */
export function ehPendenteDeRegularizacao(status: WorkflowInstanceStatus): boolean {
  return status === "PENDENTE_DE_REGULARIZACAO"
}

// ============================================================
// CADASTRO DE PROCESSO JÁ EM ANDAMENTO
// ============================================================

export interface FaseAnteriorInput {
  faseKey: string
  estado: EstadoFaseAnterior
  /** Obrigatório quando estado = NAO_APLICAVEL. */
  justificativa?: string | null
  inicioReal?: Date | null
  conclusaoReal?: Date | null
  fonteDataHistorica?: string | null
}

export interface CriarProcessoEmAndamentoInput {
  processoId: number
  faseOperacional: string
  motivo: string
  inicioRealFaseAtual?: Date | null
  fasesAnteriores: FaseAnteriorInput[]
  /** Idempotência do comando: reexecutar com a mesma chave não duplica nada. */
  chaveComando?: string
  correlationId?: string
}

export interface ResultadoMaterializacao {
  processoId: number
  faseOperacional: string
  instanciaOperacionalId: number | null
  fasesCriadas: Array<{ faseKey: string; status: WorkflowInstanceStatus; instanciaId: number; passos: number; tarefas: number }>
  regularizacao: RegularizacaoHistorica
  correlationId: string
}

/** Sequência oficial de fases do fluxo, até a fase operacional (exclusive). */
export function fasesAnterioresA(faseOperacional: string): FaseCode[] {
  const alvo = phaseKeyToFaseCode(faseOperacional)
  if (!alvo) throw new RegularizacaoErro(`Fase "${faseOperacional}" não pertence ao fluxo oficial.`, 400, "FASE_INVALIDA")
  const ordemAlvo = FASES[alvo].ordem
  return (Object.keys(FASES) as FaseCode[])
    .filter((k) => FASES[k].ordem < ordemAlvo)
    .sort((a, b) => FASES[a].ordem - FASES[b].ordem)
}

/**
 * Materializa as fases ANTERIORES do processo com estado histórico próprio, e deixa
 * a fase operacional viva e trabalhável.
 *
 * Transacional no que é crítico (estado das instâncias e do processo); a
 * materialização de cada workflow usa o serviço canônico, que já é idempotente por
 * chave lógica — reexecutar converge, nunca duplica.
 */
export async function materializarFasesHistoricas(
  input: CriarProcessoEmAndamentoInput,
  ator: AtorAutorizado,
): Promise<ResultadoMaterializacao> {
  const correlationId = input.correlationId ?? randomUUID()
  const processo = await prisma.processo.findUnique({
    where: { id: input.processoId },
    select: { id: true, codigo: true, faseAtualKey: true, tipoProcessoMotorId: true },
  })
  if (!processo) throw new RegularizacaoErro("Processo não encontrado.", 404, "PROCESSO_NAO_ENCONTRADO")

  const anterioresOficiais = fasesAnterioresA(input.faseOperacional)
  const declaradas = new Map(input.fasesAnteriores.map((f) => [f.faseKey, f]))

  // Nenhuma fase oficial pode ser omitida em silêncio.
  const faltando = anterioresOficiais.filter((k) => !declaradas.has(FASES[k].phaseKey))
  if (faltando.length > 0) {
    throw new RegularizacaoErro(
      `Fases anteriores não declaradas: ${faltando.map((k) => FASES[k].label).join(", ")}. Toda fase oficial anterior precisa de um estado explícito.`,
      400,
      "FASE_ANTERIOR_OMITIDA",
    )
  }
  for (const f of input.fasesAnteriores) {
    if (f.estado === "NAO_APLICAVEL" && !(f.justificativa ?? "").trim()) {
      throw new RegularizacaoErro(
        `A fase "${f.faseKey}" foi marcada como não aplicável sem justificativa.`,
        400,
        "JUSTIFICATIVA_OBRIGATORIA",
      )
    }
  }
  if (!(input.motivo ?? "").trim()) {
    throw new RegularizacaoErro("Motivo administrativo é obrigatório.", 400, "MOTIVO_OBRIGATORIO")
  }

  const fasesCriadas: ResultadoMaterializacao["fasesCriadas"] = []

  // ---- fases ANTERIORES: instância + workflow + tarefas, em estado histórico ----
  for (const key of anterioresOficiais) {
    const phaseKey = FASES[key].phaseKey
    const decl = declaradas.get(phaseKey)!
    const statusFinal: WorkflowInstanceStatus =
      decl.estado === "NAO_APLICAVEL" ? "NAO_APLICAVEL"
      : decl.estado === "CONCLUIDA" ? "CONCLUIDO"
      : "PENDENTE_DE_REGULARIZACAO"

    // Fase não aplicável não materializa workflow: não há trabalho a registrar.
    // As demais materializam — é o que permite regularizar depois.
    const inst = await instanciarWorkflowDaFase({
      processoId: processo.id, faseMacroKey: phaseKey, ciclo: 1,
      correlationId, origem: "MIGRACAO", solicitadoPorId: ator.usuarioId,
    })
    if (!inst.success) {
      // Fase sem workflow publicado não impede o cadastro — fica registrada como
      // pendência com o motivo, em vez de sumir do histórico.
      await registrarAuditoria({
        acao: "REGULARIZACAO_FASE_SEM_WORKFLOW", processoId: processo.id, usuarioId: ator.usuarioId,
        descricao: `Fase "${phaseKey}" não pôde ser materializada: ${inst.errors[0]?.message ?? inst.code}`,
        detalhes: { faseKey: phaseKey, code: inst.code }, correlationId,
      })
      continue
    }

    const atualizada = await prisma.phaseWorkflowInstance.update({
      where: { id: inst.workflowInstance.id },
      data: {
        status: statusFinal,
        requerRegularizacao: statusFinal === "PENDENTE_DE_REGULARIZACAO",
        inicioReal: decl.inicioReal ?? null,
        conclusaoReal: decl.conclusaoReal ?? null,
        fonteDataHistorica: decl.fonteDataHistorica ?? null,
        motivoAdministrativo: input.motivo,
        motivoNaoAplicavel: decl.estado === "NAO_APLICAVEL" ? decl.justificativa : null,
        criadoPorId: ator.usuarioId,
        ...(statusFinal === "CONCLUIDO"
          ? { completedAt: new Date(), regularizadoEm: new Date(), regularizadoPorId: ator.usuarioId }
          : {}),
      },
      select: { id: true, status: true },
    })

    // Tarefas das fases históricas EXISTEM — é o que permite regularizar depois.
    // Elas ficam marcadas como históricas e fora das filas operacionais comuns.
    let tarefas = 0
    if (statusFinal !== "NAO_APLICAVEL") {
      const pre = await carregarPreCondicoes(processo.id)
      for (const step of inst.stepInstances) {
        const g = await garantirTarefaDePasso({
          stepInstanceId: step.id, correlationId, causationId: step.chaveIdempotencia, origem: "regularizacao",
          preCondicoes: pre,
        })
        if (g.success && g.created) tarefas++
      }
    }

    fasesCriadas.push({
      faseKey: phaseKey, status: atualizada.status, instanciaId: atualizada.id,
      passos: inst.stepInstances.length, tarefas,
    })

    await registrarAuditoria({
      acao: "REGULARIZACAO_FASE_MATERIALIZADA", processoId: processo.id, usuarioId: ator.usuarioId,
      faseInstanciaId: atualizada.id,
      descricao: `Fase "${phaseKey}" criada como ${statusFinal}`,
      detalhes: {
        faseKey: phaseKey, statusInicial: statusFinal, passos: inst.stepInstances.length, tarefas,
        workflowDefinitionId: inst.workflowInstance.workflowDefinitionId,
        workflowVersion: inst.workflowInstance.workflowVersion,
        inicioReal: decl.inicioReal ?? null, conclusaoReal: decl.conclusaoReal ?? null,
        justificativa: decl.justificativa ?? null,
      },
      correlationId,
    })
  }

  // ---- fase OPERACIONAL: viva, normal, não bloqueada pelo histórico ----
  const instOper = await instanciarWorkflowDaFase({
    processoId: processo.id, faseMacroKey: input.faseOperacional, ciclo: 1,
    correlationId, origem: "MANUAL", solicitadoPorId: ator.usuarioId,
  })
  let instanciaOperacionalId: number | null = null
  if (instOper.success) {
    instanciaOperacionalId = instOper.workflowInstance.id
    await prisma.phaseWorkflowInstance.update({
      where: { id: instOper.workflowInstance.id },
      data: {
        status: "ATIVO", requerRegularizacao: false,
        inicioReal: input.inicioRealFaseAtual ?? null,
        criadoPorId: ator.usuarioId,
      },
    })
    const pre = await carregarPreCondicoes(processo.id)
    for (const step of instOper.stepInstances) {
      await garantirTarefaDePasso({
        stepInstanceId: step.id, correlationId, causationId: step.chaveIdempotencia, origem: "workflow",
        preCondicoes: pre,
      })
    }
  }

  const regularizacao = await recalcularRegularizacao(processo.id, ator)

  await registrarAuditoria({
    acao: "REGULARIZACAO_PROCESSO_EM_ANDAMENTO", processoId: processo.id, usuarioId: ator.usuarioId,
    descricao: `Processo cadastrado já em "${input.faseOperacional}" com ${fasesCriadas.length} fase(s) anterior(es)`,
    detalhes: {
      faseOperacional: input.faseOperacional, motivo: input.motivo,
      fases: fasesCriadas, regularizacao,
    },
    correlationId,
  })

  return {
    processoId: processo.id, faseOperacional: input.faseOperacional, instanciaOperacionalId,
    fasesCriadas, regularizacao, correlationId,
  }
}

// ============================================================
// REGULARIZAÇÃO DAS FASES ANTERIORES
// ============================================================

/**
 * Conclui uma fase histórica. Só passa quando o trabalho está de fato registrado:
 * todos os passos obrigatórios concluídos (ou dispensados). Não existe atalho.
 */
export async function concluirFaseHistorica(
  instanciaId: number,
  dados: { conclusaoReal?: Date | null; fonteDataHistorica?: string | null; observacao?: string | null },
  ator: AtorAutorizado,
): Promise<{ instanciaId: number; status: WorkflowInstanceStatus; regularizacao: RegularizacaoHistorica }> {
  const inst = await prisma.phaseWorkflowInstance.findUnique({
    where: { id: instanciaId },
    select: {
      id: true, processoId: true, faseMacroKey: true, status: true, ciclo: true,
      steps: { select: { id: true, stepKey: true, status: true, obrigatorio: true } },
    },
  })
  if (!inst) throw new RegularizacaoErro("Fase não encontrada.", 404, "FASE_NAO_ENCONTRADA")
  if (inst.status !== "PENDENTE_DE_REGULARIZACAO") {
    throw new RegularizacaoErro(
      `Esta fase está em "${inst.status}" — só uma fase pendente de regularização pode ser concluída por aqui.`,
      409, "TRANSICAO_INVALIDA",
    )
  }

  const FEITO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"])
  const abertos = inst.steps.filter((s) => s.obrigatorio && !FEITO.has(s.status))
  if (abertos.length > 0) {
    throw new RegularizacaoErro(
      `Ainda há ${abertos.length} passo(s) obrigatório(s) sem registro: ${abertos.map((s) => s.stepKey).join(", ")}. Registre o trabalho antes de concluir a fase.`,
      409, "PASSOS_OBRIGATORIOS_ABERTOS",
    )
  }

  const agora = new Date()
  const atualizada = await prisma.phaseWorkflowInstance.update({
    where: { id: instanciaId },
    data: {
      status: "CONCLUIDO",
      requerRegularizacao: false,
      completedAt: agora,
      conclusaoReal: dados.conclusaoReal ?? null,
      fonteDataHistorica: dados.fonteDataHistorica ?? null,
      regularizadoEm: agora,
      regularizadoPorId: ator.usuarioId,
    },
    select: { id: true, status: true, processoId: true },
  })

  await registrarAuditoria({
    acao: "REGULARIZACAO_FASE_CONCLUIDA", processoId: atualizada.processoId, usuarioId: ator.usuarioId,
    faseInstanciaId: instanciaId,
    descricao: `Fase "${inst.faseMacroKey}" regularizada e concluída`,
    detalhes: {
      valorAnterior: inst.status, valorPosterior: "CONCLUIDO",
      conclusaoReal: dados.conclusaoReal ?? null, fonte: dados.fonteDataHistorica ?? null,
      observacao: dados.observacao ?? null, passos: inst.steps.length,
    },
  })

  const regularizacao = await recalcularRegularizacao(atualizada.processoId, ator)
  return { instanciaId, status: atualizada.status, regularizacao }
}

/** Marca uma fase histórica como não aplicável. Exige justificativa e auditoria. */
export async function marcarFaseNaoAplicavel(
  instanciaId: number,
  justificativa: string,
  ator: AtorAutorizado,
): Promise<{ instanciaId: number; status: WorkflowInstanceStatus; regularizacao: RegularizacaoHistorica }> {
  if (!(justificativa ?? "").trim()) {
    throw new RegularizacaoErro("Justificativa é obrigatória para marcar a fase como não aplicável.", 400, "JUSTIFICATIVA_OBRIGATORIA")
  }
  const inst = await prisma.phaseWorkflowInstance.findUnique({
    where: { id: instanciaId },
    select: { id: true, processoId: true, faseMacroKey: true, status: true },
  })
  if (!inst) throw new RegularizacaoErro("Fase não encontrada.", 404, "FASE_NAO_ENCONTRADA")
  if (inst.status !== "PENDENTE_DE_REGULARIZACAO") {
    throw new RegularizacaoErro(
      `Esta fase está em "${inst.status}" — só uma fase pendente de regularização pode ser marcada como não aplicável.`,
      409, "TRANSICAO_INVALIDA",
    )
  }

  const atualizada = await prisma.phaseWorkflowInstance.update({
    where: { id: instanciaId },
    data: {
      status: "NAO_APLICAVEL", requerRegularizacao: false,
      motivoNaoAplicavel: justificativa,
      regularizadoEm: new Date(), regularizadoPorId: ator.usuarioId,
    },
    select: { id: true, status: true, processoId: true },
  })

  await registrarAuditoria({
    acao: "REGULARIZACAO_FASE_NAO_APLICAVEL", processoId: atualizada.processoId, usuarioId: ator.usuarioId,
    faseInstanciaId: instanciaId,
    descricao: `Fase "${inst.faseMacroKey}" marcada como não aplicável`,
    detalhes: { valorAnterior: inst.status, valorPosterior: "NAO_APLICAVEL", justificativa },
  })

  const regularizacao = await recalcularRegularizacao(atualizada.processoId, ator)
  return { instanciaId, status: atualizada.status, regularizacao }
}

/**
 * Recalcula o indicador de integridade histórica do processo. NÃO encerra nem
 * bloqueia a operação — só diz se o histórico está completo.
 */
export async function recalcularRegularizacao(
  processoId: number,
  ator?: AtorAutorizado,
): Promise<RegularizacaoHistorica> {
  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { processoId },
    select: { id: true, status: true, requerRegularizacao: true },
  })
  const historicas = instancias.filter((i) => i.requerRegularizacao || i.status === "NAO_APLICAVEL")
  const pendentes = instancias.filter((i) => i.status === "PENDENTE_DE_REGULARIZACAO")

  let novo: RegularizacaoHistorica
  if (historicas.length === 0) novo = "NAO_NECESSARIA"
  else if (pendentes.length === historicas.length) novo = "PENDENTE"
  else if (pendentes.length > 0) novo = "PARCIAL"
  else novo = "REGULARIZADA"

  const proc = await prisma.processo.findUnique({
    where: { id: processoId }, select: { regularizacaoHistorica: true },
  })
  if (proc && proc.regularizacaoHistorica !== novo) {
    await prisma.processo.update({
      where: { id: processoId },
      data: {
        regularizacaoHistorica: novo,
        ...(novo === "REGULARIZADA"
          ? { regularizacaoConcluidaEm: new Date(), regularizacaoConcluidaPorId: ator?.usuarioId ?? null }
          : { regularizacaoConcluidaEm: null, regularizacaoConcluidaPorId: null }),
      },
    })
    await registrarAuditoria({
      acao: "REGULARIZACAO_STATUS_ALTERADO", processoId, usuarioId: ator?.usuarioId,
      descricao: `Regularização histórica: ${proc.regularizacaoHistorica} → ${novo}`,
      detalhes: { valorAnterior: proc.regularizacaoHistorica, valorPosterior: novo, pendentes: pendentes.length, historicas: historicas.length },
    })
  }
  return novo
}

// ============================================================
// LEITURA — painel de regularização
// ============================================================

export async function lerRegularizacao(processoId: number) {
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: {
      id: true, codigo: true, nome: true, faseAtualKey: true,
      regularizacaoHistorica: true, regularizacaoConcluidaEm: true, motivoCadastroEmAndamento: true,
    },
  })
  if (!processo) throw new RegularizacaoErro("Processo não encontrado.", 404, "PROCESSO_NAO_ENCONTRADO")

  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { processoId },
    orderBy: [{ id: "asc" }],
    select: {
      id: true, faseMacroKey: true, status: true, ciclo: true,
      workflowDefinitionId: true, workflowVersion: true,
      inicioReal: true, conclusaoReal: true, fonteDataHistorica: true,
      requerRegularizacao: true, regularizadoEm: true, motivoNaoAplicavel: true, motivoAdministrativo: true,
      createdAt: true, completedAt: true,
      regularizadoPor: { select: { id: true, nome: true } },
      steps: { select: { id: true, status: true, obrigatorio: true } },
    },
  })

  const FEITO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"])
  const fases = instancias
    .map((i) => {
      const code = phaseKeyToFaseCode(i.faseMacroKey)
      const total = i.steps.length
      const concluidos = i.steps.filter((s) => FEITO.has(s.status)).length
      const obrigAbertos = i.steps.filter((s) => s.obrigatorio && !FEITO.has(s.status)).length
      return {
        instanciaId: i.id,
        faseKey: i.faseMacroKey,
        label: code ? FASES[code].label : i.faseMacroKey,
        ordem: code ? FASES[code].ordem : 999,
        status: i.status,
        ciclo: i.ciclo,
        workflowDefinitionId: i.workflowDefinitionId,
        workflowVersion: i.workflowVersion,
        passos: total,
        passosConcluidos: concluidos,
        passosObrigatoriosAbertos: obrigAbertos,
        podeConcluir: i.status === "PENDENTE_DE_REGULARIZACAO" && obrigAbertos === 0,
        requerRegularizacao: i.requerRegularizacao,
        // DATA REAL informada x data de REGISTRO no sistema — nunca se confundem.
        inicioReal: i.inicioReal, conclusaoReal: i.conclusaoReal, fonteDataHistorica: i.fonteDataHistorica,
        registradoEm: i.createdAt, concluidoNoSistemaEm: i.completedAt,
        regularizadoEm: i.regularizadoEm, regularizadoPor: i.regularizadoPor,
        motivoNaoAplicavel: i.motivoNaoAplicavel, motivoAdministrativo: i.motivoAdministrativo,
      }
    })
    .sort((a, b) => a.ordem - b.ordem)

  const historicas = fases.filter((f) => f.requerRegularizacao || f.status === "NAO_APLICAVEL")
  const resolvidas = historicas.filter((f) => f.status !== "PENDENTE_DE_REGULARIZACAO").length
  return {
    processo,
    fases,
    resumo: {
      status: processo.regularizacaoHistorica,
      totalHistoricas: historicas.length,
      resolvidas,
      pendentes: historicas.length - resolvidas,
      percentual: historicas.length > 0 ? Math.round((resolvidas / historicas.length) * 100) : 100,
    },
  }
}

// ============================================================
// AUDITORIA
// ============================================================

export async function registrarAuditoria(e: {
  acao: string
  processoId: number
  usuarioId?: number | null
  faseInstanciaId?: number | null
  tarefaId?: number | null
  descricao: string
  detalhes?: Prisma.InputJsonValue
  correlationId?: string
  origem?: string
  ip?: string | null
}): Promise<void> {
  try {
    await prisma.logAuditoria.create({
      data: {
        acao: e.acao,
        entidade: "PROCESSO",
        entidadeId: e.processoId,
        usuarioId: e.usuarioId ?? undefined,
        descricao: e.descricao,
        detalhes: {
          ...(typeof e.detalhes === "object" && e.detalhes !== null ? e.detalhes : { valor: e.detalhes ?? null }),
          processoId: e.processoId,
          faseInstanciaId: e.faseInstanciaId ?? null,
          tarefaId: e.tarefaId ?? null,
          correlationId: e.correlationId ?? null,
          origem: e.origem ?? null,
          ip: e.ip ?? null,
        } as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    console.error("[regularizacao] auditoria não registrada:", err)
  }
}
