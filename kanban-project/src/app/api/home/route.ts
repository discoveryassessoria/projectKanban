// ============================================================================
// GET /api/home — API AGREGADORA da Central Operacional
// ----------------------------------------------------------------------------
// UMA resposta com todos os blocos da Home (attentionSummary, priorityAlerts,
// nextActions, teamQueue, processesByPhase, bottlenecks, todayAgenda,
// recentActivity). Um punhado de consultas agregadas (groupBy/count + poucos
// findMany enxutos) rodando em paralelo — sem N+1, sem uma consulta por card.
//
// Escopo/permissões:
//   - admin  → toda a operação
//   - comum  → tarefas próprias (responsavelId = eu OU sem responsável), e
//              blocos de processo apenas se tiver 'processos.ver'.
//
// NÃO reimplementa regra de negócio: "bloqueado"/"pronto"/"SLA vencido" são
// LIDOS do estado já persistido (Tarefa.statusTarefa, PhaseWorkflowInstance,
// Processo.faseAtualKey, CatalogoFase.slaDiasPadrao). A decisão autoritativa de
// avanço (calcularPendencias) permanece no detalhe do processo.
// ============================================================================

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import {
  agruparProcessosPorFase,
  calcularAttentionSummary,
  filtrarAtividades,
  fimDoDia,
  inicioDoDia,
  nivelPorQuantidade,
  normalizarPrioridade,
  ordenarProximasAcoes,
  rankBottlenecks,
  tipoAtividade,
} from "@/src/lib/home/home-logic"
import type {
  ActivityItem,
  AgendaItem,
  Bottleneck,
  HomeData,
  NextAction,
  PhaseColumn,
  PriorityAlert,
  TeamQueueGroup,
} from "@/src/types/home"

// Estados de tarefa que a encerram — não contam como "aberta"/acionável.
const STATUS_ENCERRADO = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "SUPERSEDIDA", "CANCELADA"]
const FASE_FINAL = "finalizado"
// Fases documentais — base do alerta "documentos aguardando ação".
const FASES_DOCUMENTAIS = ["genealogia", "emissao_documental", "analise_documental"]

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

    const isAdmin = usuario.tipo === "admin"
    const verProcessos = isAdmin || temPermissao(usuario.permissoes, "processos.ver")
    const verTarefas = isAdmin || temPermissao(usuario.permissoes, "tarefas.ver")
    const verEventos = isAdmin || temPermissao(usuario.permissoes, "eventos.ver")
    const criarProcesso = isAdmin || temPermissao(usuario.permissoes, "processos.criar")
    const criarTarefa = isAdmin || temPermissao(usuario.permissoes, "tarefas.criar")

    const agora = new Date()
    const iniHoje = inicioDoDia(agora)
    const fimHoje = fimDoDia(agora)

    // Escopo de tarefas para o usuário comum: as próprias + as sem dono
    // (espelha /api/tarefas). Admin vê tudo.
    const escopoTarefa = isAdmin ? {} : { OR: [{ responsavelId: usuario.userId }, { responsavelId: null }] }
    const abertaWhere = {
      concluida: false,
      statusTarefa: { notIn: STATUS_ENCERRADO as any },
    }

    // ================= Consultas em paralelo ==============================
    const [
      catalogo,
      processosSkinny,
      instancias,
      tarefasBloqueadasRaw,
      tarefasAcionaveisRaw,
      tarefasDocPendentes,
      overdueCount,
      minhasPendencias,
      unassignedCount,
      grpTotais,
      grpVencidas,
      grpCriticas,
      eventosHojeRaw,
      logsRaw,
    ] = await Promise.all([
      // 1) catálogo de fases (ordem/nomes reais — Workflow Macro / CatalogoFase)
      prisma.catalogoFase.findMany({
        where: { ativo: true },
        orderBy: { ordemPadrao: "asc" },
        select: { phaseKey: true, label: true, ordemPadrao: true, slaDiasPadrao: true },
      }),
      // 2) mapa fase-atual + totais por fase (colunas enxutas)
      verProcessos
        ? prisma.processo.findMany({ select: { id: true, faseAtualKey: true } })
        : Promise.resolve([] as { id: number; faseAtualKey: string | null }[]),
      // 3) instâncias de fase relevantes (bloqueio/pronto/SLA), consulta única indexada
      verProcessos
        ? prisma.phaseWorkflowInstance.findMany({
            where: { status: { in: ["ATIVO", "AGUARDANDO", "BLOQUEADO", "CONCLUIDO"] as any } },
            select: { processoId: true, faseMacroKey: true, status: true, startedAt: true },
          })
        : Promise.resolve([] as any[]),
      // 4) processos com tarefa bloqueada (impeditivo)
      verProcessos
        ? prisma.tarefa.findMany({
            where: { statusTarefa: "BLOQUEADA" as any, concluida: false, processoId: { not: null } },
            select: { processoId: true },
            distinct: ["processoId"],
          })
        : Promise.resolve([] as { processoId: number | null }[]),
      // 5) próximas ações (candidatas — ordenadas de novo em memória)
      verTarefas
        ? prisma.tarefa.findMany({
            where: { ...abertaWhere, ...escopoTarefa } as any,
            orderBy: [{ dataPrazo: { sort: "asc", nulls: "last" } }, { prioridade: "asc" }],
            take: 120,
            select: {
              id: true,
              titulo: true,
              prioridade: true,
              statusTarefa: true,
              dataPrazo: true,
              ordem: true,
              responsavelId: true,
              faseMacroKey: true,
              processoId: true,
              responsavel: { select: { nome: true } },
              processo: { select: { id: true, nome: true, faseAtualKey: true, familia: { select: { nome: true } } } },
            },
          })
        : Promise.resolve([] as any[]),
      // 6) documentos aguardando ação (tarefas abertas em fases documentais)
      verTarefas
        ? prisma.tarefa.count({
            where: { ...abertaWhere, ...escopoTarefa, faseMacroKey: { in: FASES_DOCUMENTAIS } } as any,
          })
        : Promise.resolve(0),
      // 7) tarefas vencidas
      verTarefas
        ? prisma.tarefa.count({ where: { ...abertaWhere, ...escopoTarefa, dataPrazo: { lt: iniHoje } } as any })
        : Promise.resolve(0),
      // 8) minhas pendências
      prisma.tarefa.count({ where: { ...abertaWhere, responsavelId: usuario.userId } as any }),
      // 9) tarefas sem responsável
      verTarefas
        ? prisma.tarefa.count({ where: { ...abertaWhere, responsavelId: null } as any })
        : Promise.resolve(0),
      // 10) fila da equipe — pendentes por responsável
      verTarefas
        ? prisma.tarefa.groupBy({ by: ["responsavelId"], where: { ...abertaWhere, ...escopoTarefa } as any, _count: { _all: true } })
        : Promise.resolve([] as any[]),
      // 11) fila da equipe — vencidas por responsável
      verTarefas
        ? prisma.tarefa.groupBy({ by: ["responsavelId"], where: { ...abertaWhere, ...escopoTarefa, dataPrazo: { lt: iniHoje } } as any, _count: { _all: true } })
        : Promise.resolve([] as any[]),
      // 12) fila da equipe — críticas (URGENTE) por responsável
      verTarefas
        ? prisma.tarefa.groupBy({ by: ["responsavelId"], where: { ...abertaWhere, ...escopoTarefa, prioridade: "URGENTE" as any } as any, _count: { _all: true } })
        : Promise.resolve([] as any[]),
      // 13) agenda de hoje
      verEventos
        ? prisma.evento.findMany({
            where: { dataInicio: { gte: iniHoje, lte: fimHoje } },
            orderBy: { dataInicio: "asc" },
            select: {
              id: true,
              titulo: true,
              tipo: true,
              dataInicio: true,
              diaInteiro: true,
              local: true,
              processo: { select: { id: true, nome: true } },
            },
          })
        : Promise.resolve([] as any[]),
      // 14) atividade recente (mais que 10 — filtramos ruído depois)
      verTarefas || verProcessos
        ? prisma.logAuditoria.findMany({
            orderBy: { criadoEm: "desc" },
            take: 40,
            select: {
              id: true,
              acao: true,
              entidade: true,
              entidadeId: true,
              descricao: true,
              criadoEm: true,
              usuario: { select: { nome: true } },
            },
          })
        : Promise.resolve([] as any[]),
    ])

    // ================= Derivações (em memória, O(n)) ======================
    const slaDiasPorFase = new Map(catalogo.map((f) => [f.phaseKey, f.slaDiasPadrao]))
    const catalogoLike = catalogo.map((f) => ({ phaseKey: f.phaseKey, label: f.label, ordem: f.ordemPadrao }))

    // fase atual por processo + totais por fase
    const faseDeProcesso = new Map<number, string>()
    for (const p of processosSkinny) if (p.faseAtualKey) faseDeProcesso.set(p.id, p.faseAtualKey)

    // instâncias da FASE ATUAL do processo → bloqueado / pronto / SLA vencido
    const bloqueadosInst = new Set<number>()
    const prontos = new Set<number>()
    const slaVencidos = new Set<number>()
    const agoraMs = agora.getTime()
    for (const inst of instancias) {
      const atual = faseDeProcesso.get(inst.processoId)
      if (!atual || inst.faseMacroKey !== atual) continue // só a fase corrente conta
      if (inst.status === "BLOQUEADO") bloqueadosInst.add(inst.processoId)
      if (inst.status === "CONCLUIDO" && atual !== FASE_FINAL) prontos.add(inst.processoId)
      if (inst.startedAt) {
        const sla = slaDiasPorFase.get(inst.faseMacroKey)
        if (sla && new Date(inst.startedAt).getTime() + sla * 86_400_000 < agoraMs) {
          slaVencidos.add(inst.processoId)
        }
      }
    }
    const bloqueados = new Set<number>(bloqueadosInst)
    for (const t of tarefasBloqueadasRaw) if (t.processoId) bloqueados.add(t.processoId)

    // ---- Processos por fase ----
    const processesByPhase: PhaseColumn[] = verProcessos
      ? agruparProcessosPorFase({
          catalogo: catalogoLike,
          faseDeProcesso,
          bloqueados,
          prontos,
          slaVencidos,
          href: (k) => `/kanban?fase=${encodeURIComponent(k)}`,
        })
      : []
    const totalPorFase = new Map(processesByPhase.map((c) => [c.phaseKey, c.total]))

    // ---- Attention summary ----
    const attentionSummary = calcularAttentionSummary({
      processosBloqueados: bloqueados.size,
      tarefasVencidas: overdueCount,
      fasesProntas: prontos.size,
      eventosHoje: eventosHojeRaw.length,
      minhasPendencias,
    })

    // ---- Priority alerts (zeros escondidos na UI) ----
    const priorityAlerts: PriorityAlert[] = []
    const pushAlert = (a: PriorityAlert) => { if (a.quantidade > 0) priorityAlerts.push(a) }
    if (verProcessos) {
      pushAlert({ key: "bloqueados", titulo: "Processos bloqueados", descricao: "Pendências impeditivas de avanço.", quantidade: bloqueados.size, nivel: "critico", href: "/kanban?filtro=bloqueados" })
      pushAlert({ key: "prontas", titulo: "Fases prontas para avançar", descricao: "Workflow interno concluído, aguardando avanço.", quantidade: prontos.size, nivel: "medio", href: "/kanban?filtro=prontas" })
      pushAlert({ key: "sla", titulo: "Fases acima do SLA", descricao: "Processos parados além do prazo da fase.", quantidade: slaVencidos.size, nivel: "alto", href: "/kanban?filtro=sla" })
    }
    if (verTarefas) {
      pushAlert({ key: "vencidas", titulo: "Tarefas vencidas", descricao: "Prazo expirado — requer ação.", quantidade: overdueCount, nivel: "critico", href: "/activities?status=vencidas" })
      pushAlert({ key: "documentos", titulo: "Documentos aguardando ação", descricao: "Tarefas abertas em fases documentais.", quantidade: tarefasDocPendentes, nivel: "medio", href: "/activities?status=pendente" })
    }
    if (verEventos) {
      pushAlert({ key: "eventos", titulo: "Eventos de hoje", descricao: "Compromissos com data para hoje.", quantidade: eventosHojeRaw.length, nivel: "alto", href: "/events?dia=hoje" })
    }
    // maior prioridade primeiro
    const ordemNivel = { critico: 0, alto: 1, medio: 2, baixo: 3 }
    priorityAlerts.sort((a, b) => ordemNivel[a.nivel] - ordemNivel[b.nivel] || b.quantidade - a.quantidade)

    // ---- Próximas ações ----
    const acionaveis = (tarefasAcionaveisRaw as any[]).filter((t) => t.statusTarefa !== "BLOQUEADA")
    const nextActions: NextAction[] = ordenarProximasAcoes(acionaveis as any, agora)
      .slice(0, 10)
      .map((t: any): NextAction => {
        const prazo = t.dataPrazo ? new Date(t.dataPrazo) : null
        const vencida = !!prazo && inicioDoDia(prazo).getTime() < iniHoje.getTime()
        const hoje = !!prazo && inicioDoDia(prazo).getTime() === iniHoje.getTime()
        const faseKey = t.faseMacroKey ?? t.processo?.faseAtualKey ?? null
        return {
          id: t.id,
          titulo: t.titulo,
          processoId: t.processoId ?? t.processo?.id ?? null,
          processoNome: t.processo?.nome ?? null,
          familiaNome: t.processo?.familia?.nome ?? null,
          faseLabel: faseKey ? catalogo.find((f) => f.phaseKey === faseKey)?.label ?? faseKey : null,
          responsavelNome: t.responsavel?.nome ?? null,
          prazo: prazo ? prazo.toISOString() : null,
          prioridade: normalizarPrioridade(t.prioridade),
          status: t.statusTarefa ?? "NAO_INICIADA",
          vencida,
          venceHoje: hoje,
          href: t.processoId ? `/kanban?processoId=${t.processoId}&tab=tarefas&atividadeId=${t.id}` : `/activities`,
        }
      })
    const nextActionsTotal = verTarefas
      ? await prisma.tarefa.count({ where: { ...abertaWhere, ...escopoTarefa, statusTarefa: { notIn: [...STATUS_ENCERRADO, "BLOQUEADA"] as any } } as any })
      : 0

    // ---- Fila da equipe ----
    // /activities filtra responsável por EMAIL (não id) → resolvemos o email.
    const nomeResp = new Map<number, string>()
    const emailResp = new Map<number, string>()
    const idsResp = [...new Set((grpTotais as any[]).map((g) => g.responsavelId).filter((x): x is number => x != null))]
    if (idsResp.length) {
      const users = await prisma.usuario.findMany({ where: { id: { in: idsResp } }, select: { id: true, nome: true, email: true } })
      users.forEach((u) => {
        nomeResp.set(u.id, u.nome)
        emailResp.set(u.id, u.email)
      })
    }
    const vencMap = new Map<number | null, number>((grpVencidas as any[]).map((g) => [g.responsavelId, g._count._all]))
    const critMap = new Map<number | null, number>((grpCriticas as any[]).map((g) => [g.responsavelId, g._count._all]))
    const teamQueue: TeamQueueGroup[] = (grpTotais as any[])
      .map((g): TeamQueueGroup => {
        const rid: number | null = g.responsavelId
        const ehMinhas = rid === usuario.userId
        const semResp = rid == null
        const email = rid != null ? emailResp.get(rid) ?? usuario.email : null
        return {
          key: semResp ? "sem-responsavel" : `resp-${rid}`,
          nome: semResp ? "Sem responsável" : ehMinhas ? "Minhas pendências" : nomeResp.get(rid!) ?? `Usuário #${rid}`,
          ehMinhas,
          semResponsavel: semResp,
          pendentes: g._count._all,
          vencidas: vencMap.get(rid) ?? 0,
          criticas: critMap.get(rid) ?? 0,
          href: semResp
            ? "/activities?status=pendente"
            : `/activities?responsavel=${encodeURIComponent(email ?? "")}`,
        }
      })
      .sort((a, b) => {
        if (a.ehMinhas !== b.ehMinhas) return a.ehMinhas ? -1 : 1
        if (a.semResponsavel !== b.semResponsavel) return a.semResponsavel ? 1 : -1
        return b.pendentes - a.pendentes
      })
      .slice(0, 8)

    // ---- Gargalos ----
    const bottlenecks: Bottleneck[] = rankBottlenecks([
      { key: "vencidas", titulo: "Tarefas vencidas", quantidade: overdueCount, nivel: nivelPorQuantidade(overdueCount), href: "/activities?status=vencidas" },
      { key: "bloqueados", titulo: "Processos bloqueados", quantidade: bloqueados.size, nivel: nivelPorQuantidade(bloqueados.size), href: "/kanban?filtro=bloqueados" },
      { key: "sem-resp", titulo: "Tarefas sem responsável", quantidade: unassignedCount, nivel: nivelPorQuantidade(unassignedCount), href: "/activities?status=pendente" },
      { key: "sla", titulo: "Processos acima do SLA", quantidade: slaVencidos.size, nivel: nivelPorQuantidade(slaVencidos.size), href: "/kanban?filtro=sla" },
      { key: "traducao", titulo: "Traduções pendentes", quantidade: totalPorFase.get("traducao") ?? 0, nivel: nivelPorQuantidade(totalPorFase.get("traducao") ?? 0), href: "/kanban?fase=traducao" },
      { key: "apostilamento", titulo: "Apostilamentos pendentes", quantidade: totalPorFase.get("apostilamento") ?? 0, nivel: nivelPorQuantidade(totalPorFase.get("apostilamento") ?? 0), href: "/kanban?fase=apostilamento" },
      { key: "retificacao", titulo: "Retificações paradas", quantidade: totalPorFase.get("retificacao") ?? 0, nivel: nivelPorQuantidade(totalPorFase.get("retificacao") ?? 0), href: "/kanban?fase=retificacao" },
      { key: "protocolo", titulo: "Aguardando protocolo", quantidade: totalPorFase.get("aguardando_protocolo") ?? 0, nivel: nivelPorQuantidade(totalPorFase.get("aguardando_protocolo") ?? 0), href: "/kanban?fase=aguardando_protocolo" },
    ]).slice(0, 6)

    // ---- Agenda de hoje ----
    const todayAgenda: AgendaItem[] = (eventosHojeRaw as any[]).map((e): AgendaItem => {
      const d = new Date(e.dataInicio)
      return {
        id: e.id,
        horario: e.diaInteiro ? null : d.toISOString(),
        diaInteiro: e.diaInteiro,
        titulo: e.titulo,
        tipo: e.tipo,
        processoId: e.processo?.id ?? null,
        processoNome: e.processo?.nome ?? null,
        local: e.local ?? null,
        href: e.processo?.id ? `/events?processoId=${e.processo.id}` : "/events",
      }
    })

    // ---- Atividade recente (ruído filtrado) ----
    const recentActivity: ActivityItem[] = filtrarAtividades(logsRaw as any[])
      .slice(0, 10)
      .map((l: any): ActivityItem => ({
        id: `${l.entidade}-${l.id}`,
        acao: l.acao,
        entidade: l.entidade,
        descricao: l.descricao,
        usuarioNome: l.usuario?.nome ?? null,
        quando: new Date(l.criadoEm).toISOString(),
        tipo: tipoAtividade(l.acao),
        href:
          l.entidade === "PROCESSO" && l.entidadeId
            ? `/kanban?processoId=${l.entidadeId}`
            : null,
      }))

    const payload: HomeData = {
      usuario: { id: usuario.userId, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo },
      geradoEm: agora.toISOString(),
      permissions: { verProcessos, verTarefas, verEventos, criarProcesso, criarTarefa, isAdmin },
      attentionSummary,
      priorityAlerts,
      nextActions,
      nextActionsTotal,
      teamQueue,
      processesByPhase,
      bottlenecks,
      todayAgenda,
      recentActivity,
    }
    return NextResponse.json(payload)
  } catch (e) {
    console.error("[/api/home] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar a Central Operacional" }, { status: 500 })
  }
}
