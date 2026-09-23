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
import { ehEsperaExterna } from "@/lib/operacional/proximo-acontecimento"
import { estadoTemporal, estadoTemporalSubtarefa } from "@/lib/operacional/tempo-operacional"
import {
  FILAS_PASSO,
  FILAS_ESTADO,
  FILAS_PRAZO_TAREFA,
  FILAS_ACOMPANHAMENTO,
  faixaDaFilaPrazo,
  faixaDaFilaAcompanhamento,
  faixaPrazoDoEstado,
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
  PrazosResumo,
  ResumoDia,
} from "@/src/types/home"
import { escopoTarefa, escopoPasso, escopoProcesso, escopoDocumento, escopoEvento } from "@/src/lib/autorizacao/escopo-operacional"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"

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
  /** BLOQUEADO por espera de terceiro (motivoCodigo da Tarefa dele) não é bloqueio genérico. */
  motivoCodigoDaTarefa: string | null
}
interface TarefaBase {
  id: number
  titulo: string
  statusTarefa: string | null
  dataPrazo: Date | null
  processoId: number | null
  responsavelId: number | null
  motivoCodigo: string | null
}
interface PendenciaBase {
  id: number
  processoId: number
  motivo: string
  detalhe: string
  phaseKey: string
  criadoEm: Date
}
/** Subtarefa ATIVA (DISPONIVEL/EM_ANDAMENTO/AGUARDANDO_EXTERNO) — sem relógio de execução próprio (decisão definitiva, 23/09/2026); só carrega acompanhamento. */
interface SubtarefaBase {
  id: number
  stepInstanceId: number
  subtaskKey: string
  status: string
  /** Dimensão D — quando esta espera volta à atenção. Nunca prazo/SLA. */
  proximoAcompanhamentoEm: Date | null
  processoId: number
  documentoId: number | null
  necessidadeId: number | null
  responsavelId: number | null
}

export interface BaseOperacional {
  processos: Map<number, ProcessoBase>
  /** passos vivos JÁ filtrados para a fase atual do processo */
  passos: PassoBase[]
  tarefas: TarefaBase[]
  /** subtarefas ATIVAS — prazo OPERACIONAL, nunca o mesmo relógio da Tarefa. */
  subtarefas: SubtarefaBase[]
  pendencias: PendenciaBase[]
  /** processos cuja fase atual está concluída no motor (prontos para avançar) */
  prontosParaAvancar: number[]
  parados: ProcessoBase[]
}

export async function carregarBase(ctx: ContextoHome): Promise<BaseOperacional> {
  const { permissoes: p, isAdmin, userId, agora } = ctx
  const limiteParado = somarDias(inicioDoDia(agora), -DIAS_PROCESSO_PARADO)

  // ESCOPO CANÔNICO — admin sem filtro; operacional só o que é DELE (nunca o
  // sem-dono: isso é fila da empresa, não "minha fila" — ver
  // src/lib/autorizacao/escopo-operacional.ts).
  const usuarioEscopo = { userId, tipo: isAdmin ? "admin" : "operacional" }
  const escopoResponsavel = escopoTarefa(usuarioEscopo)
  const escopoDoPasso = escopoPasso(usuarioEscopo)
  const escopoDoProcesso = escopoProcesso(usuarioEscopo)

  const [processosRaw, passosRaw, tarefasRaw, subtarefasRaw, pendenciasRaw, instanciasRaw] = await Promise.all([
    p.verProcessos
      ? prisma.processo.findMany({
          where: escopoDoProcesso,
          select: { id: true, codigo: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, faseAtualKey: true, updatedAt: true },
        })
      : Promise.resolve([] as ProcessoBase[]),
    p.verProcessos
      ? prisma.phaseWorkflowStepInstance.findMany({
          where: { status: { in: STATUS_PASSO_VIVO as unknown as any[] }, ...(escopoDoPasso as any) },
          select: {
            id: true,
            stepKey: true,
            status: true,
            processoId: true,
            faseMacroKey: true,
            prazo: true,
            documentoId: true,
            necessidadeId: true,
            // MESMA SEMÂNTICA DE `ehEsperaExterna` — BLOQUEADO por espera de
            // terceiro (motivoCodigo da Tarefa dele) não é bloqueio genérico.
            // `responsavelId` vem DAQUI (da Tarefa), nunca do campo solto do
            // próprio passo — ver `escopoPasso`.
            tarefas: { select: { motivoCodigo: true, responsavelId: true }, take: 1 },
          },
        }).then((rows) => rows.map((r) => ({
          ...r,
          responsavelId: r.tarefas[0]?.responsavelId ?? null,
          motivoCodigoDaTarefa: r.tarefas[0]?.motivoCodigo ?? null,
        })))
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
            motivoCodigo: true,
          },
        })
      : Promise.resolve([] as any[]),
    // SUBTAREFAS ATIVAS — mesmo escopo do passo (o responsável do STEP, não
    // um campo próprio na subtarefa). DISPONIVEL/EM_ANDAMENTO/AGUARDANDO_EXTERNO
    // são as únicas vivas; CONCLUIDO/CANCELADO/INVALIDADO/FALHOU já
    // encerraram. Sem relógio de execução próprio (decisão definitiva,
    // 23/09/2026) — só acompanhamento (`proximoAcompanhamentoEm`) importa aqui.
    p.verTarefas
      ? prisma.subtaskExecution.findMany({
          where: {
            supersededAt: null,
            status: { in: ["DISPONIVEL", "EM_ANDAMENTO", "AGUARDANDO_EXTERNO"] },
            stepInstance: { ...(escopoDoPasso as any) },
          },
          select: {
            id: true, stepInstanceId: true, subtaskKey: true, status: true, proximoAcompanhamentoEm: true,
            stepInstance: {
              select: {
                processoId: true, documentoId: true, necessidadeId: true,
                // `responsavelId` vem da TAREFA do passo, nunca do campo solto
                // do próprio `PhaseWorkflowStepInstance` — mesma correção de
                // `escopoPasso`.
                tarefas: { select: { responsavelId: true }, take: 1 },
              },
            },
          },
        }).then((rows) => rows.map((r) => ({
          id: r.id, stepInstanceId: r.stepInstanceId, subtaskKey: r.subtaskKey, status: r.status,
          proximoAcompanhamentoEm: r.proximoAcompanhamentoEm,
          processoId: r.stepInstance.processoId, documentoId: r.stepInstance.documentoId,
          necessidadeId: r.stepInstance.necessidadeId, responsavelId: r.stepInstance.tarefas[0]?.responsavelId ?? null,
        })))
      : Promise.resolve([] as SubtarefaBase[]),
    // Financeiro: módulo (`verFinanceiro`) E escopo — as duas coisas, não uma
    // no lugar da outra. Sem `processo`, a pendência não tem como ser filtrada.
    p.verFinanceiro
      ? prisma.pendenciaFinanceira.findMany({
          where: { resolvida: false, processo: escopoDoProcesso },
          select: { id: true, processoId: true, motivo: true, detalhe: true, phaseKey: true, criadoEm: true },
          orderBy: { criadoEm: "desc" },
        })
      : Promise.resolve([] as PendenciaBase[]),
    p.verProcessos
      ? prisma.phaseWorkflowInstance.findMany({
          where: { status: "CONCLUIDO" as any, processo: escopoDoProcesso },
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

  return {
    processos,
    passos,
    tarefas: tarefasRaw as TarefaBase[],
    subtarefas: subtarefasRaw as SubtarefaBase[],
    pendencias: pendenciasRaw as PendenciaBase[],
    prontosParaAvancar: [...prontos],
    parados,
  }
}

// ---------------------------------------------------------------------------
// MEMBROS DE CADA FILA (mesma definição para contar e para listar)
// ---------------------------------------------------------------------------
type Membro =
  | { tipo: "passo"; passo: PassoBase }
  | { tipo: "tarefa"; tarefa: TarefaBase }
  | { tipo: "subtarefa"; subtarefa: SubtarefaBase }
  | { tipo: "processo"; processo: ProcessoBase }
  | { tipo: "pendencia"; pendencia: PendenciaBase }

function membrosDaFila(key: string, base: BaseOperacional, agora: Date): Membro[] {
  // --- fila de prazo da TAREFA (único relógio de vencimento — decisão definitiva, 23/09/2026) ---
  const filaPrazo = faixaDaFilaPrazo(key)
  if (filaPrazo) {
    return base.tarefas
      .filter((t) => {
        const est = estadoTemporal({ dataPrazo: t.dataPrazo, statusTarefa: t.statusTarefa, agora })
        return faixaPrazoDoEstado(est.diasParaPrazo, est.atrasado) === filaPrazo.faixa
      })
      .map((tarefa) => ({ tipo: "tarefa" as const, tarefa }))
  }

  // --- filas de ACOMPANHAMENTO (dimensão D, própria da espera de terceiro) ---
  const filaAcompanhamento = faixaDaFilaAcompanhamento(key)
  if (filaAcompanhamento) {
    return base.subtarefas
      .filter((s) => {
        // SÓ espera de terceiro tem acompanhamento — ação interna (DISPONIVEL/
        // EM_ANDAMENTO) não entra aqui, ela já mora no painel de PRAZO.
        if (s.status !== "AGUARDANDO_EXTERNO") return false
        // Sem `proximoAcompanhamentoEm` configurado, não há o que mostrar —
        // nunca inventa uma data pra encaixar num balde.
        if (s.proximoAcompanhamentoEm == null) return false
        const est = estadoTemporalSubtarefa({ dataPrazo: s.proximoAcompanhamentoEm, status: s.status, agora })
        return faixaPrazoDoEstado(est.diasParaPrazo, est.atrasado) === filaAcompanhamento.faixa
      })
      .map((subtarefa) => ({ tipo: "subtarefa" as const, subtarefa }))
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
      // MESMA SEMÂNTICA DE `ehEsperaExterna` — BLOQUEADO/BLOQUEADA por espera
      // de terceiro (motivoCodigo=AGUARDANDO_TERCEIRO) não é bloqueio
      // genérico: essa fila é "algo travado que PRECISA de decisão interna",
      // não "está esperando o cartório responder" (isso é a fila/coluna
      // "Aguardando terceiro").
      return [
        ...base.passos
          .filter((s) => s.status === "BLOQUEADO" && !ehEsperaExterna("BLOQUEADA", s.motivoCodigoDaTarefa))
          .map((passo) => ({ tipo: "passo" as const, passo })),
        ...base.tarefas
          .filter((t) => t.statusTarefa === "BLOQUEADA" && !ehEsperaExterna(t.statusTarefa, t.motivoCodigo))
          .map((tarefa) => ({ tipo: "tarefa" as const, tarefa })),
      ]
    case "prazos-vencendo":
      // Central de Prazos — TODO passo/tarefa com prazo definido, sem teto de
      // data (a tela filtra por status/período no cliente). Achado real, dois
      // problemas na mesma fila: (1) o alerta "Prazos vencendo" contava
      // passo+tarefa até amanhã, mas apontava pra "tarefas-vencidas", que só
      // pegava o já vencido e só tarefa — clique abria fila vazia mesmo com
      // "28 itens"; (2) cada janela de tempo (vencidas/hoje/vencendo) abria
      // uma tela DIFERENTE, sem filtro nenhum — pedido explícito do usuário:
      // uma tela só, com abas de status e período por calendário. As antigas
      // "tarefas-vencidas"/"tarefas-hoje" saíram do catálogo: a aba de status
      // desta fila cobre as duas.
      return [
        ...base.passos
          .filter((s) => STATUS_PASSO_ACIONAVEL.has(s.status) && s.prazo)
          .map((passo) => ({ tipo: "passo" as const, passo })),
        ...base.tarefas.filter((t) => t.dataPrazo).map((tarefa) => ({ tipo: "tarefa" as const, tarefa })),
      ]
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
  // "subtarefa" só aparece na fila de acompanhamento (dataDoMembroNaFila
  // resolve o dela via `proximoAcompanhamentoEm` antes de chegar aqui) — ela
  // não tem relógio de execução/prazo próprio (decisão definitiva, 23/09/2026).
  return null
}

/**
 * A DATA QUE IMPORTA NESTA FILA — `prazo` na maioria, mas
 * `proximoAcompanhamentoEm` nas filas de Acompanhamento (dimensão D). Nunca
 * confundir os dois campos: um vira "atrasada"/"vence hoje" na tela errada
 * se olhar o relógio errado.
 */
function dataDoMembroNaFila(m: Membro, ehAcompanhamento: boolean): Date | null {
  if (ehAcompanhamento && m.tipo === "subtarefa") return m.subtarefa.proximoAcompanhamentoEm
  return prazoDoMembro(m)
}

function permissaoDaFila(key: string, p: HomePermissions): boolean {
  const def = acharFila(key)
  if (!def) return false
  if (def.modulo === "financeiro") return p.verFinanceiro
  if (def.modulo === "tarefas") return p.verTarefas
  return p.verProcessos
}

/**
 * IDENTIDADE REAL do membro — não a fila em que ele apareceu. Um Step com
 * prazo aparece em DUAS filas (a do verbo, ex. "localizar", e
 * "prazos-vencendo"); um Tarefa AGUARDANDO_CLIENTE com prazo idem
 * ("aguardando-cliente" + "prazos-vencendo"). É o MESMO Step/Tarefa nas duas —
 * a identidade tem que dizer isso, senão ele conta duas vezes.
 */
function identidadeDoMembro(m: Membro): string {
  if (m.tipo === "passo") return `passo:${m.passo.id}`
  if (m.tipo === "tarefa") return `tarefa:${m.tarefa.id}`
  if (m.tipo === "subtarefa") return `subtarefa:${m.subtarefa.id}`
  if (m.tipo === "processo") return `processo:${m.processo.id}`
  return `pendencia:${m.pendencia.id}`
}

/**
 * QUANTIDADE DE ITENS DE TRABALHO PENDENTES DISTINTOS, agregada de todas as
 * filas visíveis para o usuário (Step/Tarefa/Processo/Pendência Financeira —
 * grãos DIFERENTES, deliberadamente combinados aqui como métrica composta de
 * "coisas que pedem atenção hoje").
 *
 * NÃO é `Σ fila.quantidade`: essa soma contava o MESMO item mais de uma vez
 * quando ele pertencia a mais de uma fila ao mesmo tempo (achado real, ver
 * auditoria de 10/09/2026 — "35 ações pendentes" era essa soma). Aqui a
 * identidade (`identidadeDoMembro`) é resolvida ANTES de contar — um mesmo
 * Step/Tarefa/Processo/Pendência conta 1 vez, não importa em quantas filas
 * apareça.
 *
 * NUNCA chamar isto de "tarefas" nem de contagem de um grão só — é
 * explicitamente uma métrica composta. `home-logic.ts` só recebe o número
 * pronto e não decide o que ele representa.
 */
export function contarTrabalhoPendenteDistinto(base: BaseOperacional, ctx: ContextoHome): number {
  const vistos = new Set<string>()
  for (const def of [...FILAS_PASSO, ...FILAS_ESTADO]) {
    if (!permissaoDaFila(def.key, ctx.permissoes)) continue
    for (const m of membrosDaFila(def.key, base, ctx.agora)) vistos.add(identidadeDoMembro(m))
  }
  return vistos.size
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
// SLA de FaseMacro/Processo — REMOVIDO (17/09/2026).
//
// Existia aqui um terceiro relógio de prazo (`montarSla`, engine
// `sla-core.ts`/FaseMacro), concorrente com os dois oficiais: Tarefa (macro)
// e Subtarefa (operacional) — ver [[prazo-tarefa-subtarefa-dois-relogios]].
// A engine (`lib/motor/sla-core.ts`, `src/lib/process-stage/sla-projection.ts`)
// continua existindo porque tem UM consumidor legítimo restante — o painel de
// inteligência da Árvore Genealógica (`src/components/arvore/inteligencia/
// barra-linhagem.tsx`, via GET .../genealogia/operacional), que está sob
// congelamento de UI (ver [[arvore-layout-definitivo]]) e não foi tocado. Mas
// ela não é mais apresentada como "prazo do processo" em Home, Kanban, Lista
// ou detalhe do processo — quem já foi lá é `deleted` ali, não uma nova
// fonte de verdade em disputa.
// ---------------------------------------------------------------------------
// PRAZOS DE TAREFA — o relógio MACRO, grain TAREFA. Nunca somado ao SLA de
// Processo (FaseMacro, acima) nem ao de Subtarefa (abaixo) — os três são
// obrigações diferentes (CLAUDE.md §5/§18).
//
// Achado real (16/09/2026): a Daniela tinha uma Tarefa com prazo amanhã e o
// usuário esperava vê-la refletida num card de prazo — mas o único painel de
// prazo da Home (`montarSla`) é 100% Processo. Este painel é o equivalente
// pra Tarefa: mesma base já carregada (`base.tarefas`), sem query nova.
//
// Achado real (17/09/2026): a versão anterior desta função recalculava
// "amanhã"/"3 dias"/"7 dias" com a própria conta (`diasEntre`, sem fuso
// operacional) e não tinha os baldes "atrasadas"/"hoje"/"no prazo" — regra de
// negócio definitiva do usuário: os DOIS relógios (Tarefa + Subtarefa) usam
// a MESMA engine (`estadoTemporal`/`estadoTemporalSubtarefa`) e os MESMOS 5
// baldes, lado a lado, cada contador levando pra fila filtrada de verdade
// (`/dashboard/fila/[key]`, o mesmo drill-down genérico que o SLA já usa).
// ---------------------------------------------------------------------------
function montarPainelDePrazo(
  defs: typeof FILAS_PRAZO_TAREFA,
  base: BaseOperacional,
  ctx: ContextoHome,
): FilaOperacional[] {
  return defs.map((def) => {
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
}

export function montarPrazosDeTarefas(base: BaseOperacional, ctx: ContextoHome): FilaOperacional[] | null {
  if (!ctx.permissoes.verTarefas) return null
  return montarPainelDePrazo(FILAS_PRAZO_TAREFA, base, ctx)
}

// `montarPrazosDeSubtarefas` — REMOVIDO (23/09/2026, decisão definitiva): a
// subtarefa não tem relógio de execução próprio. Existia aqui um segundo
// painel de "prazo" (grain subtarefa) ao lado do prazo real da Tarefa —
// exatamente o que a seção abaixo já dizia para nunca fazer.

// ---------------------------------------------------------------------------
// ACOMPANHAMENTOS — painel PRÓPRIO, nunca fundido com PRAZOS. Mandato
// "correção definitiva do modelo temporal" (19-20/09/2026), seção 5: "a Home
// NÃO deve continuar comunicando dois 'prazos' concorrentes" — acompanhamento
// não é prazo, não é SLA; é "quando esta espera volta à atenção". Mesma
// engine (`estadoTemporalSubtarefa`) do painel de prazo da Tarefa, alimentada
// com `proximoAcompanhamentoEm` em vez de `dataPrazo`.
// ---------------------------------------------------------------------------
export function montarAcompanhamentos(base: BaseOperacional, ctx: ContextoHome): FilaOperacional[] | null {
  if (!ctx.permissoes.verTarefas) return null
  return montarPainelDePrazo(FILAS_ACOMPANHAMENTO, base, ctx)
}

// ---------------------------------------------------------------------------
// PRAZOS — resumo por status pra aba "Prazos" da Central de Notificações.
// MESMOS membros de `membrosDaFila("prazos-vencendo", ...)` — só que já
// quebrados em atrasadas/hoje/futuro, pra Home mostrar a prévia sem baixar a
// fila inteira (92 itens) só pra contar três números.
// ---------------------------------------------------------------------------
export function montarPrazosResumo(base: BaseOperacional, ctx: ContextoHome): PrazosResumo | null {
  if (!ctx.permissoes.verProcessos) return null

  const membros = membrosDaFila("prazos-vencendo", base, ctx.agora)
  const resumo: PrazosResumo = { atrasadas: 0, hoje: 0, futuro: 0, total: membros.length }
  for (const m of membros) {
    const prazo = prazoDoMembro(m)
    if (estaAtrasado(prazo, ctx.agora)) resumo.atrasadas++
    else if (venceHoje(prazo, ctx.agora)) resumo.hoje++
    else resumo.futuro++
  }
  return resumo
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

  const ehAcompanhamento = faixaDaFilaAcompanhamento(key) != null
  const membros = membrosDaFila(key, base, ctx.agora)
  const atrasados = membros.filter((m) => estaAtrasado(dataDoMembroNaFila(m, ehAcompanhamento), ctx.agora)).length

  // Atrasado primeiro, depois prazo/acompanhamento mais próximo, depois sem data.
  const ordenados = [...membros].sort((a, b) => {
    const pa = dataDoMembroNaFila(a, ehAcompanhamento)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const pb = dataDoMembroNaFila(b, ehAcompanhamento)?.getTime() ?? Number.MAX_SAFE_INTEGER
    return pa - pb
  })
  const pagina = ordenados.slice(0, LIMITE_ITENS)

  // Hidratação dos rótulos SÓ da página exibida (evita N+1 sobre a fila inteira).
  const docIds = pagina.flatMap((m) =>
    m.tipo === "passo" && m.passo.documentoId ? [m.passo.documentoId]
    : m.tipo === "subtarefa" && m.subtarefa.documentoId ? [m.subtarefa.documentoId]
    : [],
  )
  const necIds = pagina.flatMap((m) =>
    m.tipo === "passo" && m.passo.necessidadeId ? [m.passo.necessidadeId]
    : m.tipo === "subtarefa" && m.subtarefa.necessidadeId ? [m.subtarefa.necessidadeId]
    : [],
  )
  const respIds = [
    ...new Set(
      pagina.flatMap((m) =>
        m.tipo === "passo" && m.passo.responsavelId
          ? [m.passo.responsavelId]
          : m.tipo === "tarefa" && m.tarefa.responsavelId
            ? [m.tarefa.responsavelId]
            : m.tipo === "subtarefa" && m.subtarefa.responsavelId
              ? [m.subtarefa.responsavelId]
              : [],
      ),
    ),
  ]

  // Rótulo canônico da fase — catálogo de código primeiro (10 fases), cadastro
  // do Gerenciamento em lote depois (mesma precedência de resolverRotuloDaFase).
  // Sem isto, "processo"/"pendência" na fila caíam no "troca `_` por espaço":
  // TESTEVIS_fase virava "TESTEVIS fase" nas notificações enquanto o processo
  // já mostrava "Fase de Teste Visual" (achado real, 20/09/2026).
  const chavesFaseForaDoCodigo = [
    ...new Set(
      pagina.flatMap((m) => {
        const chave = m.tipo === "processo" ? m.processo.faseAtualKey : m.tipo === "pendencia" ? m.pendencia.phaseKey : null
        return chave && !labelDaFasePorPhaseKey(chave) ? [chave] : []
      }),
    ),
  ]
  const rotuloCadastroPorChave = chavesFaseForaDoCodigo.length
    ? new Map(
        (await prisma.catalogoFase.findMany({ where: { phaseKey: { in: chavesFaseForaDoCodigo } }, select: { phaseKey: true, label: true } }))
          .map((f) => [f.phaseKey, f.label]),
      )
    : new Map<string, string>()
  const rotuloFase = (k: string | null | undefined) =>
    k ? (labelDaFasePorPhaseKey(k) ?? rotuloCadastroPorChave.get(k) ?? `⚠ Fase não cadastrada (${k})`) : null

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
    if (m.tipo === "subtarefa") {
      const s = m.subtarefa
      const dataNaFila = dataDoMembroNaFila(m, ehAcompanhamento)
      const pr = base.processos.get(s.processoId)
      const doc = s.documentoId ? docPorId.get(s.documentoId) : null
      const nec = s.necessidadeId ? necPorId.get(s.necessidadeId) : null
      const pessoa = nomePessoa(doc?.pessoa) ?? nomePessoa(nec?.pessoa)
      const responsavel = s.responsavelId ? respPorId.get(s.responsavelId) : null
      return {
        id: `subtarefa-${s.id}`,
        // Rótulo pelo cadastro exigiria buscar a definição histórica por
        // instância — custo real de N+1 numa fila que pode ter dezenas de
        // linhas. A chave prettificada é o MESMO fallback que a fila de
        // passo já usa quando falta um rótulo melhor (ver branch "passo"
        // acima) — não é um padrão novo.
        titulo: s.subtaskKey.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        subtitulo: [pessoa, responsavel ?? "Sem responsável"].filter(Boolean).join(" · "),
        processoId: s.processoId,
        processoCodigo: pr?.codigo ?? null,
        processoNome: pr?.nome ?? null,
        pais: pr?.pais ?? null,
        prazo: dataNaFila ? dataNaFila.toISOString() : null,
        atrasado: estaAtrasado(dataNaFila, ctx.agora),
        href: hrefProcesso(pr, s.documentoId ? `&sidebarTab=documentos` : ""),
      }
    }
    if (m.tipo === "processo") {
      const pr = m.processo
      return {
        id: `processo-${pr.id}`,
        titulo: pr.nome,
        subtitulo: rotuloFase(pr.faseAtualKey) ?? "sem fase",
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
      subtitulo: `${pe.motivo.replace(/_/g, " ").toLowerCase()} · ${rotuloFase(pe.phaseKey) ?? pe.phaseKey}`,
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
      ...escopoEvento({ userId: ctx.userId, tipo: ctx.isAdmin ? "admin" : "operacional" }),
    },
    orderBy: { dataInicio: "asc" },
    select: {
      id: true,
      titulo: true,
      tipo: true,
      dataInicio: true,
      diaInteiro: true,
      local: true,
      processo: { select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } },
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

  const usuarioEscopo = { userId: ctx.userId, tipo: ctx.isAdmin ? "admin" : "operacional" }
  const [tarefasConcluidas, passosEmValidacao] = await Promise.all([
    ctx.permissoes.verTarefas
      ? prisma.tarefa.count({
          where: {
            concluida: true,
            updatedAt: { gte: ini, lte: fim },
            ...(ctx.isAdmin ? {} : { responsavelId: ctx.userId }),
          },
        })
      : Promise.resolve(0),
    // `AGUARDANDO_APROVACAO` fica de fora de `STATUS_PASSO_VIVO` (não é fila
    // executável do dono do passo) — por isso não vem em `base.passos`, e
    // precisa da própria consulta, com o MESMO escopo e o MESMO recorte de
    // fase atual que `carregarBase` já aplica.
    ctx.permissoes.verProcessos
      ? prisma.phaseWorkflowStepInstance.findMany({
          where: { status: "AGUARDANDO_APROVACAO" as any, ...(escopoPasso(usuarioEscopo) as any) },
          select: { processoId: true, faseMacroKey: true },
        })
      : Promise.resolve([] as { processoId: number; faseMacroKey: string }[]),
  ])
  const emValidacao = passosEmValidacao.filter((s) => {
    const pr = base.processos.get(s.processoId)
    return !!pr && pr.faseAtualKey === s.faseMacroKey
  }).length

  // MESMA SEMÂNTICA DE `ehEsperaExterna` — um processo com uma Tarefa
  // aguardando o cartório não é um processo "bloqueado" (que precisa de
  // decisão interna); é um processo em andamento normal, só esperando.
  const bloqueados = new Set<number>()
  for (const s of base.passos) if (s.status === "BLOQUEADO" && !ehEsperaExterna("BLOQUEADA", s.motivoCodigoDaTarefa)) bloqueados.add(s.processoId)
  for (const t of base.tarefas) if (t.statusTarefa === "BLOQUEADA" && !ehEsperaExterna(t.statusTarefa, t.motivoCodigo) && t.processoId) bloqueados.add(t.processoId)

  return {
    tarefasConcluidas,
    aguardandoCliente: base.tarefas.filter((t) => t.statusTarefa === "AGUARDANDO_CLIENTE").length,
    // GRAIN TAREFA, NUNCA `Documento.status` — esse campo é o workflow escrito
    // uma segunda vez (enum legado, ver memória "documento-status-legado":
    // decisão de 26/08/2026 já tirou o campo da superfície operacional em
    // PainelDaFase/DocumentoOperationalDrawer). `soma("SOLICITADO","EM_BUSCA")`
    // contava TODO documento nesses status, mesmo quando a Tarefa dona já
    // tinha avançado para um passo seguinte que não escreve nesse campo —
    // achado real: família Santin, 4 documentos com `status=SOLICITADO`
    // (nunca atualizado), mas só 2 Tarefas realmente aguardando o cartório
    // (`ehEsperaExterna`); as outras 2 já estavam em "Conferir e validar
    // certidão", e o card mostrava 4 em vez de 2. `AGUARDANDO_CLIENTE` sai
    // daqui porque já tem o próprio balde acima.
    aguardandoCartorio: base.tarefas.filter((t) => t.statusTarefa != null && ehEsperaExterna(t.statusTarefa, t.motivoCodigo) && t.statusTarefa !== "AGUARDANDO_CLIENTE").length,
    // GRAIN PASSO — `AGUARDANDO_APROVACAO` é o status NATIVO do passo para
    // "executado, esperando alguém validar" (mesmo enum que
    // `PASSO_AGUARDANDO_APROVACAO`/`PASSO_APROVADO` já usam em
    // andamento-operacional.ts), nunca `Documento.status = "EM_ANALISE"`
    // (mesma razão do campo acima — segunda fonte de verdade legada).
    emValidacao,
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
      // ?ate= pré-carrega a Central de Prazos já filtrada no mesmo período que
      // este alerta conta ("até amanhã") — sem isso o clique abria a tela cheia
      // de tudo, obrigando a filtrar de novo pra ver só o que o alerta prometeu.
      href: `/dashboard/fila/prazos-vencendo?ate=${amanha.toISOString().slice(0, 10)}`,
    })
  }

  const usuarioEscopoAlertas = { userId: ctx.userId, tipo: ctx.isAdmin ? "admin" : "operacional" }
  const [documentosInvalidos, automacoesFalhas] = await Promise.all([
    ctx.permissoes.verProcessos
      ? prisma.documento.count({
          where: { status: { in: ["INVALIDO", "NAO_ENCONTRADO"] as any }, ...escopoDocumento(usuarioEscopoAlertas) },
        })
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
