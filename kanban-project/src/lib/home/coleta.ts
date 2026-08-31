// ============================================================================
// COLETOR DO CENTRO OPERACIONAL — fonte ÚNICA das filas da Home
// ----------------------------------------------------------------------------
// Um único módulo lê o estado persistido e monta: filas executáveis, alertas,
// resumo do dia e agenda. A rota agregadora (/api/home) e o drill-down de uma
// fila (/api/home/fila/[key]) consomem DAQUI — a contagem do card e a lista da
// fila nunca podem divergir, porque nascem da MESMA coleta.
//
// Nada de regra de negócio nova: tudo é leitura do que o motor já gravou
// (PhaseWorkflowStepInstance, PhaseWorkflowInstance, Tarefa, Documento,
// PendenciaFinanceira, Evento, DomainOutbox, CotacaoCambio).
// ============================================================================

import { prisma } from "@/lib/prisma"
import { resolveSlaProjectionBatch, resumirSla } from "@/src/lib/process-stage/sla-projection"
import {
  FILAS_PASSO,
  FILAS_ESTADO,
  FILAS_SLA,
  faixaDaFilaSla,
  STATUS_PASSO_ACIONAVEL,
  STATUS_PASSO_VIVO,
  STATUS_TAREFA_TERMINAL,
  acharFila,
  ehPassoDeEspera,
  estaAtrasado,
  filaDoStepKey,
  fimDoDia,
  grupoDaData,
  inicioDoDia,
  nivelDaFila,
  ordenarFilas,
  rotuloDoDia,
  somarDias,
  venceHoje,
} from "@/src/lib/home/home-logic"
import type {
  Agenda,
  AgendaItem,
  AlertaOperacional,
  FilaDetalhe,
  FilaItem,
  FilaOperacional,
  HomePermissions,
  PainelSla,
  ResumoDia,
} from "@/src/types/home"
import type { SlaProcesso } from "@/src/types/sla"

/** Dias sem movimentação a partir dos quais o processo entra na fila "parados". */
export const DIAS_PROCESSO_PARADO = 15
/** Horizonte da agenda ("próximos dias"). */
export const DIAS_AGENDA = 7

const FASE_FINAL = "finalizado"

export interface ContextoHome {
  userId: number
  isAdmin: boolean
  permissoes: HomePermissions
  agora: Date
}

// ---------------------------------------------------------------------------
// BASE — leitura única, reaproveitada por todas as filas
// ---------------------------------------------------------------------------
interface ProcessoBase {
  id: number
  codigo: string | null
  nome: string
  pais: string
  faseAtualKey: string | null
  updatedAt: Date
}
interface PassoBase {
  id: number
  stepKey: string
  status: string
  processoId: number
  faseMacroKey: string
  responsavelId: number | null
  prazo: Date | null
  documentoId: number | null
  necessidadeId: number | null
}
interface TarefaBase {
  id: number
  titulo: string
  statusTarefa: string | null
  dataPrazo: Date | null
  processoId: number | null
  responsavelId: number | null
}
interface PendenciaBase {
  id: number
  processoId: number
  motivo: string
  detalhe: string
  phaseKey: string
  criadoEm: Date
}

export interface BaseOperacional {
  processos: Map<number, ProcessoBase>
  /** passos vivos JÁ filtrados para a fase atual do processo */
  passos: PassoBase[]
  tarefas: TarefaBase[]
  pendencias: PendenciaBase[]
  /** processos cuja fase atual está concluída no motor (prontos para avançar) */
  prontosParaAvancar: number[]
  parados: ProcessoBase[]
  /**
   * SLA por processo, vindo da ENGINE ÚNICA (resolveSlaProjectionBatch). A Home
   * não calcula prazo: consome a mesma projeção da listagem e do detalhe.
   */
  sla: Map<number, SlaProcesso>
}

export async function carregarBase(ctx: ContextoHome): Promise<BaseOperacional> {
  const { permissoes: p, isAdmin, userId, agora } = ctx
  const limiteParado = somarDias(inicioDoDia(agora), -DIAS_PROCESSO_PARADO)

  // Escopo do usuário comum: o que é dele ou está sem dono (espelha /api/tarefas).
  const escopoResponsavel = isAdmin ? {} : { OR: [{ responsavelId: userId }, { responsavelId: null }] }

  const [processosRaw, passosRaw, tarefasRaw, pendenciasRaw, instanciasRaw] = await Promise.all([
    p.verProcessos
      ? prisma.processo.findMany({
          select: { id: true, codigo: true, nome: true, pais: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, faseAtualKey: true, updatedAt: true },
        })
      : Promise.resolve([] as ProcessoBase[]),
    p.verProcessos
      ? prisma.phaseWorkflowStepInstance.findMany({
          where: { status: { in: STATUS_PASSO_VIVO as unknown as any[] }, ...(escopoResponsavel as any) },
          select: {
            id: true,
            stepKey: true,
            status: true,
            processoId: true,
            faseMacroKey: true,
            responsavelId: true,
            prazo: true,
            documentoId: true,
            necessidadeId: true,
          },
        })
      : Promise.resolve([] as any[]),
    p.verTarefas
      ? prisma.tarefa.findMany({
          where: {
            concluida: false,
            statusTarefa: { notIn: [...STATUS_TAREFA_TERMINAL] as any },
            ...(escopoResponsavel as any),
          },
          select: {
            id: true,
            titulo: true,
            statusTarefa: true,
            dataPrazo: true,
            processoId: true,
            responsavelId: true,
          },
        })
      : Promise.resolve([] as any[]),
    p.verFinanceiro
      ? prisma.pendenciaFinanceira.findMany({
          where: { resolvida: false },
          select: { id: true, processoId: true, motivo: true, detalhe: true, phaseKey: true, criadoEm: true },
          orderBy: { criadoEm: "desc" },
        })
      : Promise.resolve([] as PendenciaBase[]),
    p.verProcessos
      ? prisma.phaseWorkflowInstance.findMany({
          where: { status: "CONCLUIDO" as any },
          select: { processoId: true, faseMacroKey: true },
        })
      : Promise.resolve([] as { processoId: number; faseMacroKey: string }[]),
  ])

  const processos = new Map<number, ProcessoBase>()
  for (const pr of processosRaw as ProcessoBase[]) processos.set(pr.id, pr)

  // Passo só conta se pertence à FASE ATUAL do processo — passos de fases
  // anteriores (mesmo vivos) não são trabalho de hoje.
  const passos = (passosRaw as PassoBase[]).filter((s) => {
    const pr = processos.get(s.processoId)
    return !!pr && pr.faseAtualKey === s.faseMacroKey
  })

  const prontos = new Set<number>()
  for (const inst of instanciasRaw as { processoId: number; faseMacroKey: string }[]) {
    const pr = processos.get(inst.processoId)
    if (!pr || !pr.faseAtualKey) continue
    if (pr.faseAtualKey === inst.faseMacroKey && pr.faseAtualKey !== FASE_FINAL) prontos.add(inst.processoId)
  }

  const parados = [...processos.values()].filter(
    (pr) => pr.faseAtualKey !== FASE_FINAL && pr.updatedAt < limiteParado,
  )

  // SLA: uma chamada à engine oficial para TODOS os processos visíveis (3 queries
  // agregadas, sem N+1). O card e o drill-down leem daqui — nunca recalculam.
  const idsProcessos = [...processos.keys()]
  const slaLista = p.verProcessos && idsProcessos.length > 0
    ? await resolveSlaProjectionBatch(idsProcessos, agora)
    : []
  const sla = new Map<number, SlaProcesso>(slaLista.map((s) => [s.processoId, s]))

  return {
    processos,
    passos,
    tarefas: tarefasRaw as TarefaBase[],
    pendencias: pendenciasRaw as PendenciaBase[],
    prontosParaAvancar: [...prontos],
    parados,
    sla,
  }
}

// ---------------------------------------------------------------------------
// MEMBROS DE CADA FILA (mesma definição para contar e para listar)
// ---------------------------------------------------------------------------
type Membro =
  | { tipo: "passo"; passo: PassoBase }
  | { tipo: "tarefa"; tarefa: TarefaBase }
  | { tipo: "processo"; processo: ProcessoBase }
  | { tipo: "processo-sla"; processo: ProcessoBase; sla: SlaProcesso }
  | { tipo: "pendencia"; pendencia: PendenciaBase }

function membrosDaFila(key: string, base: BaseOperacional, agora: Date): Membro[] {
  // --- filas de SLA (faixa de prazo do processo) ---
  const faixa = faixaDaFilaSla(key)
  if (faixa) {
    const membros: Membro[] = []
    for (const sla of base.sla.values()) {
      if (sla.faixa !== faixa) continue
      const processo = base.processos.get(sla.processoId)
      if (!processo) continue
      membros.push({ tipo: "processo-sla", processo, sla })
    }
    return membros
  }

  // --- filas de passo (trabalho do Workflow) ---
  if (FILAS_PASSO.some((f) => f.key === key)) {
    return base.passos
      .filter(
        (s) =>
          STATUS_PASSO_ACIONAVEL.has(s.status) &&
          !ehPassoDeEspera(s.stepKey) &&
          filaDoStepKey(s.stepKey) === key,
      )
      .map((passo) => ({ tipo: "passo" as const, passo }))
  }

  switch (key) {
    case "bloqueios":
      return [
        ...base.passos.filter((s) => s.status === "BLOQUEADO").map((passo) => ({ tipo: "passo" as const, passo })),
        ...base.tarefas
          .filter((t) => t.statusTarefa === "BLOQUEADA")
          .map((tarefa) => ({ tipo: "tarefa" as const, tarefa })),
      ]
    case "tarefas-vencidas":
      return base.tarefas
        .filter((t) => estaAtrasado(t.dataPrazo, agora))
        .map((tarefa) => ({ tipo: "tarefa" as const, tarefa }))
    case "tarefas-hoje":
      return base.tarefas
        .filter((t) => venceHoje(t.dataPrazo, agora))
        .map((tarefa) => ({ tipo: "tarefa" as const, tarefa }))
    case "aguardando-cliente":
      return base.tarefas
        .filter((t) => t.statusTarefa === "AGUARDANDO_CLIENTE")
        .map((tarefa) => ({ tipo: "tarefa" as const, tarefa }))
    case "sem-responsavel": {
      // Um processo aparece uma vez, mesmo com vários passos órfãos.
      const ids = new Set<number>()
      for (const s of base.passos) {
        if (STATUS_PASSO_ACIONAVEL.has(s.status) && s.responsavelId == null) ids.add(s.processoId)
      }
      for (const t of base.tarefas) {
        if (t.responsavelId == null && t.processoId != null) ids.add(t.processoId)
      }
      return [...ids]
        .map((id) => base.processos.get(id))
        .filter((pr): pr is ProcessoBase => !!pr)
        .map((processo) => ({ tipo: "processo" as const, processo }))
    }
    case "processos-parados":
      return base.parados.map((processo) => ({ tipo: "processo" as const, processo }))
    case "avancar-fase":
      return base.prontosParaAvancar
        .map((id) => base.processos.get(id))
        .filter((pr): pr is ProcessoBase => !!pr)
        .map((processo) => ({ tipo: "processo" as const, processo }))
    case "pendencias-financeiras":
      return base.pendencias.map((pendencia) => ({ tipo: "pendencia" as const, pendencia }))
    default:
      return []
  }
}

function prazoDoMembro(m: Membro): Date | null {
  if (m.tipo === "passo") return m.passo.prazo
  if (m.tipo === "tarefa") return m.tarefa.dataPrazo
  if (m.tipo === "processo-sla") return m.sla.prazoPrevisto ? new Date(m.sla.prazoPrevisto) : null
  return null
}

function permissaoDaFila(key: string, p: HomePermissions): boolean {
  const def = acharFila(key)
  if (!def) return false
  if (def.modulo === "financeiro") return p.verFinanceiro
  if (def.modulo === "tarefas") return p.verTarefas
  return p.verProcessos
}

// ---------------------------------------------------------------------------
// FILAS (contagem) — Central Operacional
// ---------------------------------------------------------------------------
export function montarFilas(base: BaseOperacional, ctx: ContextoHome): FilaOperacional[] {
  const filas: FilaOperacional[] = []
  for (const def of [...FILAS_PASSO, ...FILAS_ESTADO]) {
    if (!permissaoDaFila(def.key, ctx.permissoes)) continue
    const membros = membrosDaFila(def.key, base, ctx.agora)
    if (membros.length === 0) continue
    const atrasados = membros.filter((m) => estaAtrasado(prazoDoMembro(m), ctx.agora)).length
    filas.push({
      key: def.key,
      titulo: def.titulo,
      descricao: atrasados > 0 ? `${def.descricao} · ${atrasados} em atraso` : def.descricao,
      quantidade: membros.length,
      nivel: nivelDaFila(def.nivelBase, atrasados),
      modulo: def.modulo,
      href: `/dashboard/fila/${def.key}`,
    })
  }
  return ordenarFilas(filas)
}

// ---------------------------------------------------------------------------
// SLA — bloco de prazo da Central Operacional
// ---------------------------------------------------------------------------
/**
 * Os quatro cards de prazo. A contagem sai da MESMA definição de membros usada
 * pelo drill-down (`membrosDaFila`), então o número do card e o tamanho da lista
 * são o mesmo cálculo. Faixa zerada continua aparecendo — "0 atrasados" é
 * resultado operacional, não ausência de bloco.
 */
export function montarSla(base: BaseOperacional, ctx: ContextoHome): PainelSla | null {
  if (!ctx.permissoes.verProcessos) return null

  const cards: FilaOperacional[] = FILAS_SLA.map((def) => {
    const quantidade = membrosDaFila(def.key, base, ctx.agora).length
    return {
      key: def.key,
      titulo: def.titulo,
      descricao: def.descricao,
      quantidade,
      nivel: quantidade > 0 ? def.nivelBase : "baixo",
      modulo: def.modulo,
      href: `/dashboard/fila/${def.key}`,
    }
  })

  return { cards, resumo: resumirSla([...base.sla.values()]) }
}

// ---------------------------------------------------------------------------
// DRILL-DOWN — itens de UMA fila
// ---------------------------------------------------------------------------
const LIMITE_ITENS = 100

function hrefProcesso(pr: ProcessoBase | undefined, extra = ""): string {
  if (!pr) return "/kanban"
  return `/kanban?pais=${encodeURIComponent((pr.pais ?? "").toLowerCase())}&processoId=${pr.id}${extra}`
}

export async function listarFila(
  key: string,
  base: BaseOperacional,
  ctx: ContextoHome,
): Promise<FilaDetalhe | null> {
  const def = acharFila(key)
  if (!def || !permissaoDaFila(key, ctx.permissoes)) return null

  const membros = membrosDaFila(key, base, ctx.agora)
  const atrasados = membros.filter((m) => estaAtrasado(prazoDoMembro(m), ctx.agora)).length

  // Atrasado primeiro, depois prazo mais próximo, depois sem prazo.
  const ordenados = [...membros].sort((a, b) => {
    const pa = prazoDoMembro(a)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const pb = prazoDoMembro(b)?.getTime() ?? Number.MAX_SAFE_INTEGER
    return pa - pb
  })
  const pagina = ordenados.slice(0, LIMITE_ITENS)

  // Hidratação dos rótulos SÓ da página exibida (evita N+1 sobre a fila inteira).
  const docIds = pagina.flatMap((m) => (m.tipo === "passo" && m.passo.documentoId ? [m.passo.documentoId] : []))
  const necIds = pagina.flatMap((m) => (m.tipo === "passo" && m.passo.necessidadeId ? [m.passo.necessidadeId] : []))
  const respIds = [
    ...new Set(
      pagina.flatMap((m) =>
        m.tipo === "passo" && m.passo.responsavelId
          ? [m.passo.responsavelId]
          : m.tipo === "tarefa" && m.tarefa.responsavelId
            ? [m.tarefa.responsavelId]
            : [],
      ),
    ),
  ]

  const [documentos, necessidades, responsaveis] = await Promise.all([
    docIds.length
      ? prisma.documento.findMany({
          where: { id: { in: docIds } },
          select: {
            id: true,
            tipo: true,
            descricao: true,
            status: true,
            pessoa: { select: { nome: true, sobrenome: true } },
          },
        })
      : Promise.resolve([] as any[]),
    necIds.length
      ? prisma.necessidadeDocumental.findMany({
          where: { id: { in: necIds } },
          select: {
            id: true,
            itemCatalogo: { select: { name: true } },
            pessoa: { select: { nome: true, sobrenome: true } },
          },
        })
      : Promise.resolve([] as any[]),
    respIds.length
      ? prisma.usuario.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })
      : Promise.resolve([] as { id: number; nome: string }[]),
  ])

  const docPorId = new Map(documentos.map((d: any) => [d.id, d]))
  const necPorId = new Map(necessidades.map((n: any) => [n.id, n]))
  const respPorId = new Map(responsaveis.map((u: any) => [u.id, u.nome]))
  const nomePessoa = (p?: { nome?: string | null; sobrenome?: string | null } | null) =>
    p ? [p.nome, p.sobrenome].filter(Boolean).join(" ") : null

  const itens: FilaItem[] = pagina.map((m): FilaItem => {
    if (m.tipo === "passo") {
      const s = m.passo
      const pr = base.processos.get(s.processoId)
      const doc = s.documentoId ? docPorId.get(s.documentoId) : null
      const nec = s.necessidadeId ? necPorId.get(s.necessidadeId) : null
      const alvo =
        doc?.descricao ||
        (doc?.tipo ? String(doc.tipo).replace(/_/g, " ").toLowerCase() : null) ||
        nec?.itemCatalogo?.name ||
        s.stepKey.replace(/_/g, " ")
      const pessoa = nomePessoa(doc?.pessoa) ?? nomePessoa(nec?.pessoa)
      const responsavel = s.responsavelId ? respPorId.get(s.responsavelId) : null
      return {
        id: `passo-${s.id}`,
        titulo: alvo.charAt(0).toUpperCase() + alvo.slice(1),
        subtitulo: [pessoa, responsavel ?? "Sem responsável"].filter(Boolean).join(" · "),
        processoId: s.processoId,
        processoCodigo: pr?.codigo ?? null,
        processoNome: pr?.nome ?? null,
        pais: pr?.pais ?? null,
        prazo: s.prazo ? s.prazo.toISOString() : null,
        atrasado: estaAtrasado(s.prazo, ctx.agora),
        href: hrefProcesso(pr, s.documentoId ? `&sidebarTab=documentos` : ""),
      }
    }
    if (m.tipo === "tarefa") {
      const t = m.tarefa
      const pr = t.processoId ? base.processos.get(t.processoId) : undefined
      const responsavel = t.responsavelId ? respPorId.get(t.responsavelId) : null
      return {
        id: `tarefa-${t.id}`,
        titulo: t.titulo,
        subtitulo: [responsavel ?? "Sem responsável", t.statusTarefa?.replace(/_/g, " ").toLowerCase()]
          .filter(Boolean)
          .join(" · "),
        processoId: t.processoId,
        processoCodigo: pr?.codigo ?? null,
        processoNome: pr?.nome ?? null,
        pais: pr?.pais ?? null,
        prazo: t.dataPrazo ? t.dataPrazo.toISOString() : null,
        atrasado: estaAtrasado(t.dataPrazo, ctx.agora),
        href: pr ? hrefProcesso(pr, `&tab=tarefas&atividadeId=${t.id}`) : "/operacao",
      }
    }
    if (m.tipo === "processo-sla") {
      const pr = m.processo
      const s = m.sla
      return {
        id: `sla-${pr.id}`,
        titulo: pr.nome,
        subtitulo: [s.rotuloDias, s.faseAtual?.label ?? pr.faseAtualKey?.replace(/_/g, " ") ?? null]
          .filter(Boolean)
          .join(" · "),
        processoId: pr.id,
        processoCodigo: pr.codigo,
        processoNome: pr.nome,
        pais: pr.pais,
        prazo: s.prazoPrevisto,
        atrasado: s.status === "atrasado",
        href: hrefProcesso(pr),
      }
    }
    if (m.tipo === "processo") {
      const pr = m.processo
      return {
        id: `processo-${pr.id}`,
        titulo: pr.nome,
        subtitulo: pr.faseAtualKey ? pr.faseAtualKey.replace(/_/g, " ") : "sem fase",
        processoId: pr.id,
        processoCodigo: pr.codigo,
        processoNome: pr.nome,
        pais: pr.pais,
        prazo: null,
        atrasado: false,
        href: hrefProcesso(pr),
      }
    }
    const pe = m.pendencia
    const pr = base.processos.get(pe.processoId)
    return {
      id: `pendencia-${pe.id}`,
      titulo: pe.detalhe,
      subtitulo: `${pe.motivo.replace(/_/g, " ").toLowerCase()} · ${pe.phaseKey.replace(/_/g, " ")}`,
      processoId: pe.processoId,
      processoCodigo: pr?.codigo ?? null,
      processoNome: pr?.nome ?? null,
      pais: pr?.pais ?? null,
      prazo: null,
      atrasado: false,
      href: pr ? hrefProcesso(pr, "&tab=faturas") : "/financeiro",
    }
  })

  return {
    key: def.key,
    titulo: def.titulo,
    descricao: def.descricao,
    nivel: nivelDaFila(def.nivelBase, atrasados),
    modulo: def.modulo,
    quantidade: membros.length,
    itens,
    truncado: membros.length > pagina.length,
  }
}

// ---------------------------------------------------------------------------
// AGENDA — hoje / amanhã / próximos dias
// ---------------------------------------------------------------------------
export async function montarAgenda(ctx: ContextoHome): Promise<Agenda> {
  const vazia: Agenda = { hoje: [], amanha: [], proximos: [] }
  if (!ctx.permissoes.verEventos) return vazia

  const eventos = await prisma.evento.findMany({
    where: {
      dataInicio: { gte: inicioDoDia(ctx.agora), lte: fimDoDia(somarDias(ctx.agora, DIAS_AGENDA)) },
    },
    orderBy: { dataInicio: "asc" },
    select: {
      id: true,
      titulo: true,
      tipo: true,
      dataInicio: true,
      diaInteiro: true,
      local: true,
      processo: { select: { id: true, nome: true, pais: true } },
    },
  })

  for (const e of eventos as any[]) {
    const grupo = grupoDaData(e.dataInicio, ctx.agora)
    if (!grupo) continue
    const item: AgendaItem = {
      id: e.id,
      grupo,
      horario: e.diaInteiro ? null : new Date(e.dataInicio).toISOString(),
      diaInteiro: e.diaInteiro,
      dia: rotuloDoDia(e.dataInicio),
      titulo: e.titulo,
      tipo: e.tipo,
      processoId: e.processo?.id ?? null,
      processoNome: e.processo?.nome ?? null,
      local: e.local ?? null,
      href: e.processo?.id
        ? `/kanban?pais=${encodeURIComponent(((e.processo?.paisCanonico?.countryKey ?? null) ?? "").toLowerCase())}&processoId=${e.processo.id}`
        : "/events",
    }
    vazia[grupo].push(item)
  }
  return vazia
}

// ---------------------------------------------------------------------------
// RESUMO DO DIA — trabalho de hoje, nunca estatística histórica
// ---------------------------------------------------------------------------
export async function montarResumoDia(base: BaseOperacional, ctx: ContextoHome): Promise<ResumoDia> {
  const ini = inicioDoDia(ctx.agora)
  const fim = fimDoDia(ctx.agora)

  const [tarefasConcluidas, docsPorStatus] = await Promise.all([
    ctx.permissoes.verTarefas
      ? prisma.tarefa.count({
          where: {
            concluida: true,
            updatedAt: { gte: ini, lte: fim },
            ...(ctx.isAdmin ? {} : { responsavelId: ctx.userId }),
          },
        })
      : Promise.resolve(0),
    ctx.permissoes.verProcessos
      ? prisma.documento.groupBy({ by: ["status"], _count: { _all: true } })
      : Promise.resolve([] as { status: string; _count: { _all: number } }[]),
  ])

  const porStatus = new Map<string, number>(
    (docsPorStatus as any[]).map((d) => [String(d.status), d._count._all as number]),
  )
  const soma = (...st: string[]) => st.reduce((acc, s) => acc + (porStatus.get(s) ?? 0), 0)

  const bloqueados = new Set<number>()
  for (const s of base.passos) if (s.status === "BLOQUEADO") bloqueados.add(s.processoId)
  for (const t of base.tarefas) if (t.statusTarefa === "BLOQUEADA" && t.processoId) bloqueados.add(t.processoId)

  return {
    tarefasConcluidas,
    aguardandoCliente: base.tarefas.filter((t) => t.statusTarefa === "AGUARDANDO_CLIENTE").length,
    aguardandoCartorio: soma("SOLICITADO", "EM_BUSCA"),
    emValidacao: soma("EM_ANALISE"),
    processosBloqueados: bloqueados.size,
  }
}

// ---------------------------------------------------------------------------
// ALERTAS — só o que é realmente crítico; lista vazia = bloco não existe
// ---------------------------------------------------------------------------
export async function montarAlertas(base: BaseOperacional, ctx: ContextoHome): Promise<AlertaOperacional[]> {
  const alertas: AlertaOperacional[] = []
  const amanha = fimDoDia(somarDias(ctx.agora, 1))

  // 1) Prazo vencendo — passos e tarefas com prazo até amanhã.
  const prazosCriticos =
    base.passos.filter((s) => STATUS_PASSO_ACIONAVEL.has(s.status) && s.prazo && s.prazo <= amanha).length +
    base.tarefas.filter((t) => t.dataPrazo && t.dataPrazo <= amanha).length
  if (prazosCriticos > 0) {
    alertas.push({
      key: "prazo",
      tipo: "prazo",
      titulo: "Prazos vencendo",
      detalhe: `${prazosCriticos} ${prazosCriticos === 1 ? "item vence" : "itens vencem"} até amanhã`,
      nivel: "critico",
      quantidade: prazosCriticos,
      href: "/dashboard/fila/tarefas-vencidas",
    })
  }

  const [documentosInvalidos, automacoesFalhas] = await Promise.all([
    ctx.permissoes.verProcessos
      ? prisma.documento.count({ where: { status: { in: ["INVALIDO", "NAO_ENCONTRADO"] as any } } })
      : Promise.resolve(0),
    ctx.permissoes.isAdmin
      ? prisma.domainOutbox.count({ where: { status: "ERRO" as any } })
      : Promise.resolve(0),
  ])

  // 2) Documento inválido / não encontrado — trava a esteira documental.
  if (documentosInvalidos > 0) {
    alertas.push({
      key: "documento_invalido",
      tipo: "documento_invalido",
      titulo: "Documentos inválidos",
      detalhe: `${documentosInvalidos} ${documentosInvalidos === 1 ? "documento precisa" : "documentos precisam"} de reemissão ou retificação`,
      nivel: "alto",
      quantidade: documentosInvalidos,
      href: "/dashboard/fila/conferir",
    })
  }

  // 3) Automação falhou — outbox com erro (o motor parou de propagar efeitos).
  if (automacoesFalhas > 0) {
    alertas.push({
      key: "automacao",
      tipo: "automacao",
      titulo: "Automação falhou",
      detalhe: `${automacoesFalhas} ${automacoesFalhas === 1 ? "evento não foi processado" : "eventos não foram processados"}`,
      nivel: "critico",
      quantidade: automacoesFalhas,
      // O lugar onde essa falha é DIAGNOSTICADA e reprocessada é o motor, no
      // Gerenciamento — não a antiga tela de conta do usuário (removida).
      href: "/administrator?screen=runtimediag",
    })
  }

  // 4) Câmbio defasado NÃO vira alerta da Home.
  // ---------------------------------------------------------------------------
  // O `CambioMini` do topo (presente em TODAS as telas) já mostra o estado do
  // câmbio: cotação, ⚠ quando defasado e link para /cambio. Repetir isso como
  // card de alerta dizia a mesma coisa duas vezes na mesma tela e, pior, gastava
  // o bloco de Alertas — que existe para o que TRAVA a operação — com uma
  // informação que não bloqueia trabalho nenhum. A informação não se perdeu:
  // mudou de lugar (fonte única, no chip). `cambio` segue sendo lido pelo
  // contexto para as demais leituras da Home.

  return alertas
}
