// src/services/andamento-operacional.ts
// ============================================================================
// ANDAMENTO — a linha do tempo real de UMA Tarefa/operação, montada a partir
// das fontes canônicas JÁ EXISTENTES. Nenhuma tabela nova.
//
// Antes: a aba "Histórico" do drawer (DocumentoOperationalDrawer.tsx, função
// TabHistory) fabricava uma pseudo-linha-do-tempo a partir de TIMESTAMPS do
// Documento (createdAt/dataInicioOperacao/updatedAt) — zero consulta a
// qualquer log de evento. "Última atualização" não diz o que mudou nem quem
// mudou; é exatamente o anti-padrão de inferir no frontend que este módulo
// evita.
//
// FONTES REUTILIZADAS (nenhuma criada aqui):
//   • LogAuditoria        — eventos ricos de TAREFA (criação manual, reabertura,
//                            bloqueio, prazo, prioridade, cancelamento, causa
//                            removida) escritos por lib/operacional/tarefa-ciclo.ts
//                            e tarefa-comandos.ts. Tem autor (usuarioId nullable
//                            = Sistema) e `detalhes` já no formato antes/depois.
//                            Dois escritores gravam `entidade` com grafia
//                            diferente ("TAREFA" vs "Tarefa") — consultado aqui
//                            com as duas, nunca corrigido "no meio do caminho"
//                            (mudar dado histórico não é escopo desta unidade).
//   • WorkflowEvento       — eventos de PASSO/WORKFLOW/FASE, escritos
//                            exclusivamente por src/services/task-step-sync.ts.
//                            Tem `chaveIdempotencia` única (dedup por
//                            construção) mas NÃO tem autor — toda linha daqui
//                            é do MOTOR (Sistema), nunca de uma pessoa.
//   • NecessidadeDocumentalEvento — decisões sobre a necessidade (dispensa,
//                            atendida, não localizada, reaberta).
//   • DocumentoArquivo     — já carrega `criadoPorId`+`createdAt` própria:
//                            evento de anexo lido DIRETO da entidade, sem
//                            precisar de log paralelo.
//   • DocumentoObservacao  — idem, já carrega `criadoPorId`+`createdAt`.
//   • Tarefa.createdAt     — âncora "Tarefa materializada", só quando nenhuma
//                            LogAuditoria de criação mais rica já cobre isso.
//
// LACUNA DECLARADA (não inventada, não preenchida por este módulo): nenhuma
// das fontes acima registra CRIAÇÃO DE NECESSIDADE nem DISPENSA como evento
// com autor humano quando disparada por reconciliação automática — aparecem
// como "Sistema", o que é factualmente correto (foi o motor, não uma pessoa).
//
// ESCOPO — INDIVIDUAL POR TAREFA. Toda consulta abaixo filtra por IDs
// canônicos (tarefaId/documentoId/necessidadeId/stepInstanceId), nunca por
// nome/texto. Passos de OUTRAS tarefas/documentos nunca entram aqui.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { WorkflowEventoTipo } from "@prisma/client"

export interface AutorEvento {
  tipo: "humano" | "sistema"
  id: number | null
  nome: string
}

export interface EventoAndamento {
  /** Chave estável e única no conjunto — "fonte:id". */
  id: string
  tipo: string
  categoria:
    | "criacao" | "responsabilidade" | "execucao" | "estado" | "prazo"
    | "solicitacao" | "anexo" | "observacao" | "decisao" | "financeiro"
  data: string
  autor: AutorEvento
  titulo: string
  descricao: string | null
  de: string | null
  para: string | null
  etapa: string | null
  motivo: string | null
  referencias: {
    tarefaId?: number
    documentoId?: number
    stepInstanceId?: number
    necessidadeId?: number
    arquivoId?: number
    observacaoId?: number
  }
}

const SISTEMA: AutorEvento = { tipo: "sistema", id: null, nome: "Sistema" }
const autorDe = (usuarioId: number | null, nomes: Map<number, string>): AutorEvento =>
  usuarioId == null ? SISTEMA : { tipo: "humano", id: usuarioId, nome: nomes.get(usuarioId) ?? `Usuário #${usuarioId}` }

// ── Tradução de WorkflowEventoTipo → título legível ─────────────────────────
const TITULO_WORKFLOW_EVENTO: Partial<Record<WorkflowEventoTipo, string>> = {
  PASSO_INSTANCIADO: "Etapa criada", PASSO_DISPONIBILIZADO: "Etapa liberada",
  PASSO_INICIADO: "Etapa iniciada", PASSO_BLOQUEADO: "Etapa bloqueada",
  PASSO_DESBLOQUEADO: "Etapa desbloqueada", PASSO_EXECUTADO: "Etapa executada",
  PASSO_AGUARDANDO_APROVACAO: "Etapa aguardando aprovação", PASSO_APROVADO: "Etapa aprovada",
  PASSO_CONCLUIDO: "Etapa concluída", PASSO_FALHOU: "Etapa falhou",
  PASSO_REABERTO: "Etapa reaberta", PASSO_DISPENSADO: "Etapa dispensada",
  PASSO_CANCELADO: "Etapa cancelada", PASSO_SUPERSEDIDO: "Etapa superseded",
  TAREFA_GERADA: "Tarefa gerada", TAREFA_ATRIBUIDA: "Responsável atribuído",
  TAREFA_INICIADA: "Tarefa iniciada", TAREFA_CONCLUIDA: "Tarefa concluída",
  TAREFA_BLOQUEADA: "Tarefa bloqueada", TAREFA_DESBLOQUEADA: "Tarefa desbloqueada",
  TAREFA_CANCELADA: "Tarefa cancelada", TAREFA_SUPERSEDIDA: "Tarefa superseded",
  TAREFA_REABERTA: "Tarefa reaberta", TAREFA_SINCRONIZADA: "Tarefa sincronizada",
  FASE_AVANCADA: "Fase avançou", FASE_AVANCADA_FORCADO: "Fase avançou (forçado)",
  FASE_REABERTA: "Fase reaberta", FASE_RETORNADA: "Fase retornada", FASE_MOVIDA: "Fase movida",
}
const CATEGORIA_WORKFLOW_EVENTO = (t: WorkflowEventoTipo): EventoAndamento["categoria"] => {
  if (t.startsWith("PASSO_CANCELADO") || t.startsWith("TAREFA_CANCELADA") || t.includes("SUPERSEDID") || t.includes("DISPENSAD")) return "decisao"
  if (t.includes("REABERT")) return "decisao"
  if (t.startsWith("PASSO_") || t.startsWith("FASE_") || t.startsWith("WORKFLOW_")) return "execucao"
  if (t === "TAREFA_ATRIBUIDA") return "responsabilidade"
  return "estado"
}

// ── Tradução das ações de LogAuditoria (Tarefa) já escritas hoje ────────────
const TITULO_LOG_ACAO: Record<string, string> = {
  TAREFA_CRIADA_MANUAL: "Tarefa criada",
  TAREFA_REABERTA: "Tarefa reaberta",
  TAREFA_BLOQUEADA: "Tarefa bloqueada",
  TAREFA_DESBLOQUEADA: "Tarefa desbloqueada",
  TAREFA_DEVOLVIDA_A_FILA: "Devolvida à fila",
  TAREFA_PRAZO_ALTERADO: "Prazo alterado",
  TAREFA_PRIORIDADE_ALTERADA: "Prioridade alterada",
  TAREFA_AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  TAREFA_RETOMADA_DE_ESPERA: "Retomada da espera",
  TAREFA_CONCLUIDA: "Tarefa concluída",
  TAREFA_CANCELADA: "Operação cancelada",
  TAREFA_CAUSA_DECIDIDA: "Decisão sobre causa removida",
  TAREFA_DEPENDENCIA_REMOVIDA: "Dependência removida",
  TAREFA_ATRIBUIDA: "Responsável atribuído",
  TAREFA_TRANSFERIDA: "Responsável transferido",
  TAREFA_INICIADA: "Tarefa iniciada",
  TAREFA_REDISTRIBUIDAS: "Redistribuída",
  TAREFA_REPRIORIZADAS: "Reprioridade em lote",
}
const CATEGORIA_LOG_ACAO = (acao: string): EventoAndamento["categoria"] => {
  if (acao.includes("PRAZO")) return "prazo"
  if (acao.includes("ATRIBU") || acao.includes("TRANSFER") || acao.includes("REDISTRIB") || acao.includes("DEVOLVIDA")) return "responsabilidade"
  if (acao.includes("CANCEL") || acao.includes("CAUSA_DECIDIDA") || acao.includes("REABERT")) return "decisao"
  return "execucao"
}

interface EscopoTarefa {
  tarefaId: number | null
  documentoId: number | null
  necessidadeId: number | null
  workflowInstanceId: number | null
  createdAt: Date | null
  titulo: string | null
}

/** Resolve a Tarefa da OPERAÇÃO ATUAL de um documento (mesma visita do drawer). */
async function resolverEscopoDaTarefa(documentoId: number): Promise<EscopoTarefa | null> {
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: { id: true, necessidadeId: true },
  })
  if (!doc) return null
  const tarefa = await prisma.tarefa.findFirst({
    where: { documentoId },
    select: { id: true, documentoId: true, necessidadeId: true, workflowInstanceId: true, createdAt: true, titulo: true },
    orderBy: { id: "desc" },
  })
  if (tarefa) {
    return {
      tarefaId: tarefa.id, documentoId: tarefa.documentoId ?? documentoId,
      necessidadeId: tarefa.necessidadeId ?? doc.necessidadeId, workflowInstanceId: tarefa.workflowInstanceId,
      createdAt: tarefa.createdAt, titulo: tarefa.titulo,
    }
  }
  // Documento sem Tarefa própria (ex.: nunca teve operação materializada) — ainda
  // assim mostra o que existe no nível do Documento/Necessidade.
  return { tarefaId: null, documentoId, necessidadeId: doc.necessidadeId, workflowInstanceId: null, createdAt: null, titulo: null }
}

/**
 * MONTA O ANDAMENTO — a linha do tempo completa da operação de UM documento
 * (a Tarefa vigente dele + os passos/decisões/anexos/observações ligados à
 * MESMA obrigação). Só leitura; nenhum evento é inferido sem dado persistido.
 */
export async function montarAndamentoDaOperacao(documentoId: number): Promise<EventoAndamento[]> {
  const escopo = await resolverEscopoDaTarefa(documentoId)
  if (!escopo) return []

  const stepsDaObrigacao = await prisma.phaseWorkflowStepInstance.findMany({
    where: {
      documentoId: escopo.documentoId ?? undefined,
      ...(escopo.workflowInstanceId ? { workflowInstanceId: escopo.workflowInstanceId } : {}),
    },
    select: { id: true, stepKey: true, faseMacroKey: true },
  })
  const stepIds = stepsDaObrigacao.map((s) => s.id)
  const tituloDoStep = new Map(stepsDaObrigacao.map((s) => [s.id, s.stepKey]))

  const [logs, workflowEventosTarefa, workflowEventosStep, necEventos, anexos, observacoes] = await Promise.all([
    escopo.tarefaId != null
      ? prisma.logAuditoria.findMany({
          where: { entidade: { in: ["Tarefa", "TAREFA"] }, entidadeId: escopo.tarefaId },
          orderBy: { criadoEm: "desc" },
        })
      : Promise.resolve([]),
    escopo.tarefaId != null
      ? prisma.workflowEvento.findMany({ where: { tarefaId: escopo.tarefaId }, orderBy: { criadoEm: "desc" } })
      : Promise.resolve([]),
    stepIds.length
      ? prisma.workflowEvento.findMany({
          where: { entityType: "step_instance", stepInstanceId: { in: stepIds } },
          orderBy: { criadoEm: "desc" },
        })
      : Promise.resolve([]),
    escopo.necessidadeId != null
      ? prisma.necessidadeDocumentalEvento.findMany({ where: { necessidadeId: escopo.necessidadeId }, orderBy: { criadoEm: "desc" } })
      : Promise.resolve([]),
    escopo.documentoId != null
      ? prisma.documentoArquivo.findMany({
          where: { documentoId: escopo.documentoId },
          select: { id: true, nome: true, criadoPorId: true, createdAt: true, substituiId: true, motivoSubstituicao: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    escopo.documentoId != null
      ? prisma.documentoObservacao.findMany({
          where: { documentoId: escopo.documentoId },
          select: { id: true, texto: true, criadoPorId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ])

  // Todos os IDs de usuário referenciados — UMA consulta, nunca N+1 por evento.
  const idsUsuario = new Set<number>()
  for (const l of logs) {
    if (l.usuarioId != null) idsUsuario.add(l.usuarioId)
    // TAREFA_ATRIBUIDA/TAREFA_TRANSFERIDA guardam de/para como responsavelId
    // (número), não texto — precisam do mesmo lote de nomes pra virar
    // "João → Daniela" em vez de "12 → 7".
    const det = (l.detalhes ?? {}) as Record<string, unknown>
    if (typeof det.de === "number") idsUsuario.add(det.de)
    if (typeof det.para === "number") idsUsuario.add(det.para)
  }
  for (const a of anexos) if (a.criadoPorId != null) idsUsuario.add(a.criadoPorId)
  for (const o of observacoes) if (o.criadoPorId != null) idsUsuario.add(o.criadoPorId)
  const usuarios = idsUsuario.size
    ? await prisma.usuario.findMany({ where: { id: { in: [...idsUsuario] } }, select: { id: true, nome: true } })
    : []
  const nomesUsuario = new Map(usuarios.map((u) => [u.id, u.nome]))

  const eventos: EventoAndamento[] = []

  // Nomeia de/para: string fica como está; número (responsavelId em
  // TAREFA_ATRIBUIDA/TAREFA_TRANSFERIDA) vira o nome real — "João → Daniela",
  // nunca "12 → 7". `null` (fila, sem responsável) vira "Sem responsável".
  const rotuloDeValor = (v: unknown): string | null => {
    if (typeof v === "string") return v
    if (typeof v === "number") return nomesUsuario.get(v) ?? `Usuário #${v}`
    if (v === null) return "Sem responsável"
    return null
  }

  for (const l of logs) {
    const det = (l.detalhes ?? {}) as Record<string, unknown>
    const ehResponsabilidade = CATEGORIA_LOG_ACAO(l.acao) === "responsabilidade"
    eventos.push({
      id: `log:${l.id}`,
      tipo: l.acao,
      categoria: CATEGORIA_LOG_ACAO(l.acao),
      data: l.criadoEm.toISOString(),
      autor: autorDe(l.usuarioId, nomesUsuario),
      titulo: TITULO_LOG_ACAO[l.acao] ?? l.acao,
      descricao: l.descricao,
      de: ehResponsabilidade ? rotuloDeValor(det.de) : (typeof det.de === "string" ? det.de : null),
      para: ehResponsabilidade ? rotuloDeValor(det.para) : (typeof det.para === "string" ? det.para : null),
      etapa: typeof det.stepKey === "string" ? det.stepKey : null,
      motivo: typeof det.motivo === "string" ? det.motivo : null,
      referencias: { tarefaId: escopo.tarefaId ?? undefined, documentoId: escopo.documentoId ?? undefined },
    })
  }

  for (const e of [...workflowEventosTarefa, ...workflowEventosStep]) {
    const d = (e.dados ?? {}) as Record<string, unknown>
    eventos.push({
      id: `wfevt:${e.id}`,
      tipo: e.tipo,
      categoria: CATEGORIA_WORKFLOW_EVENTO(e.tipo),
      data: e.criadoEm.toISOString(),
      // WorkflowEvento não carrega autor — é sempre o motor (task-step-sync.ts).
      autor: SISTEMA,
      titulo: TITULO_WORKFLOW_EVENTO[e.tipo] ?? e.tipo,
      descricao: null,
      de: typeof d.de === "string" ? d.de : null,
      para: typeof d.para === "string" ? d.para : null,
      etapa: e.stepInstanceId != null ? tituloDoStep.get(e.stepInstanceId) ?? null : null,
      motivo: null,
      referencias: {
        tarefaId: escopo.tarefaId ?? undefined, documentoId: escopo.documentoId ?? undefined,
        stepInstanceId: e.stepInstanceId ?? undefined,
      },
    })
  }

  for (const n of necEventos) {
    const d = (n.dados ?? {}) as Record<string, unknown>
    eventos.push({
      id: `necevt:${n.id}`,
      tipo: `NECESSIDADE_${n.tipo}`,
      categoria: n.tipo === "DISPENSADA" || n.tipo === "REABERTA" ? "decisao" : "estado",
      data: n.criadoEm.toISOString(),
      autor: SISTEMA,
      titulo: n.descricao ?? `Necessidade: ${n.tipo}`,
      descricao: n.descricao,
      de: null, para: n.tipo,
      etapa: null,
      motivo: typeof d.motivo === "string" ? d.motivo : null,
      referencias: { tarefaId: escopo.tarefaId ?? undefined, documentoId: escopo.documentoId ?? undefined, necessidadeId: escopo.necessidadeId ?? undefined },
    })
  }

  for (const a of anexos) {
    eventos.push({
      id: `arq:${a.id}`,
      tipo: a.substituiId != null ? "ANEXO_SUBSTITUIDO" : "ANEXO_ADICIONADO",
      categoria: "anexo",
      data: a.createdAt.toISOString(),
      autor: autorDe(a.criadoPorId, nomesUsuario),
      titulo: a.substituiId != null ? "Arquivo substituído" : "Arquivo anexado",
      descricao: a.nome,
      de: null, para: null, etapa: null,
      motivo: a.motivoSubstituicao,
      referencias: { tarefaId: escopo.tarefaId ?? undefined, documentoId: escopo.documentoId ?? undefined, arquivoId: a.id },
    })
  }

  for (const o of observacoes) {
    eventos.push({
      id: `obs:${o.id}`,
      tipo: "OBSERVACAO_ADICIONADA",
      categoria: "observacao",
      data: o.createdAt.toISOString(),
      autor: autorDe(o.criadoPorId, nomesUsuario),
      titulo: "Observação adicionada",
      descricao: o.texto.length > 140 ? `${o.texto.slice(0, 140)}…` : o.texto,
      de: null, para: null, etapa: null, motivo: null,
      referencias: { tarefaId: escopo.tarefaId ?? undefined, documentoId: escopo.documentoId ?? undefined, observacaoId: o.id },
    })
  }

  // ÂNCORA "Tarefa materializada" — só quando NENHUM log de criação mais rico
  // já cobre o nascimento dela (evita duas linhas dizendo a mesma coisa).
  const jaTemCriacao = logs.some((l) => l.acao === "TAREFA_CRIADA_MANUAL") || workflowEventosTarefa.some((e) => e.tipo === "TAREFA_GERADA")
  if (escopo.tarefaId != null && escopo.createdAt && !jaTemCriacao) {
    eventos.push({
      id: `tarefa-criada:${escopo.tarefaId}`,
      tipo: "TAREFA_MATERIALIZADA",
      categoria: "criacao",
      data: escopo.createdAt.toISOString(),
      autor: SISTEMA,
      titulo: "Tarefa materializada",
      descricao: escopo.titulo,
      de: null, para: null, etapa: null, motivo: null,
      referencias: { tarefaId: escopo.tarefaId, documentoId: escopo.documentoId ?? undefined },
    })
  }

  eventos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
  return eventos
}
