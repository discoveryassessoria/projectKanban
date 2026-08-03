// src/components/kanban/PainelDaFase.tsx
//
// Painel da fase operacional. Ordem do que aparece, e por quê:
//
//   1. Cabeçalho da fase (título, subtítulo, abas)
//   2. Contadores da fase
//   3. Barra de progresso
//   4. WORKFLOW DA FASE — a única lista de trabalho. Um passo publicado por linha,
//      expansível, mostrando as instâncias operacionais reais (pessoa, registro,
//      certidão ou documento). É aqui que se abre a execução, e é aqui que vive a
//      Operação Antecipada de cada alvo.
//   5. PESSOAS DO PROCESSO — contexto, não fila: quem são, onde estão na linha de
//      transmissão, o que falta no cadastro delas. Nenhuma tarefa se repete aqui.
//
// A Central EXECUTA o workflow publicado; não mantém uma lista própria em paralelo.

"use client"

import { useState } from "react"
import {
  ExternalLink,
  Search,
  Clock,
  Download,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Star,
  Users,
  ArrowLeftRight,
  UserRound,
  Ban,
  CalendarDays,
  AlertTriangle,
  PlayCircle,
} from "lucide-react"
import { FASES } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

// Rótulo amigável da fase a partir do código técnico (origem da operação antecipada).
function faseLabel(code: string | null): string {
  if (!code) return "—"
  return FASES[code as FaseCode]?.label ?? code
}

// ============================================================
// TIPOS
// ============================================================

export interface FaseStep {
  title: string
  status: "concluida" | "em_andamento" | "bloqueada" | "pendente"
}

/** Balde operacional da tarefa — espelho de central-operacional-core. */
export type BaldeTarefa = "PENDENTE" | "EM_ANDAMENTO" | "CONCLUIDA"

/** Tarefa da fase (PhaseWorkflowStepInstance) exibida na lista operacional. */
export interface FaseTarefaRow {
  stepInstanceId: number
  stepKey: string
  titulo: string
  balde: BaldeTarefa
  statusRaw: string
  statusLabel: string
  obrigatorio: boolean
  pessoaId: number | null
  pessoaNome: string | null
  assunto: string | null
  necessidadeId: number | null
  documentoId: number | null
  responsavelId: number | null
  responsavelNome: string | null
  prazo: string | null
  diasParaPrazo: number | null
  slaDays: number | null
  motivo: string | null
  escopo: "GLOBAL" | "PESSOA" | "DOCUMENTO"
  executor: "OPERACAO_DOCUMENTO" | null
  /** Falta de configuração — exibida na linha; a tarefa nunca é escondida. */
  erroAdministrativo: string | null
}

export interface FaseKpi {
  label: string
  value: number
  tone?: "" | "ok" | "busca" | "late"
}

export interface FaseDocRow {
  id: number
  // Genealogia V2: necessidade da certidão (usada p/ garantir o registro
  // operacional ao abrir a operação quando ainda não há Documento, id=0).
  necessidadeId?: number | null
  responsavelId?: number | null   // responsável atual do passo (seletor "Delegar")
  tipoLabel: string        // "Certidão de Nascimento"
  subtitulo?: string       // "Inteiro teor"
  statusLabel: string      // "A SOLICITAR"
  statusCls: string        // "pendente" | "em_busca" | "localizado" | "bloqueado" | ...
  responsavel?: string | null
  sla?: string | null
  proximaAcao?: string | null
  emissaoConcluida?: boolean
}

export interface FasePersonRow {
  pessoaId: number
  /** Código oficial da pessoa (CodeGeneratorService). null = ainda não gerado. */
  publicCode?: string | null
  nome: string
  iniciais: string
  papel: string
  geracao: string          // "G1", "Atual", "—"
  isLinha: boolean
  /** Pendência ADMINISTRATIVA de cadastro. Exibida na linha; nunca esconde a pessoa. */
  pendencia?: string | null
  transmissao: {
    state: "OK" | "BLOQUEADA" | "FORA"
    label: string
    sub?: string
  }
  docsResumo: Array<{ abbr: string; statusLabel: string; statusCls: string }>
  validados: number
  total: number
  responsavel?: string | null
  proximaAcao?: { txt: string; cls?: "crit" | "" ; semResp?: boolean; sub?: string | null } | null
  docs: FaseDocRow[]
}

// Operação Antecipada vinculada a uma necessidade — VÍNCULO com a operação oficial (sem etapas
// próprias). O status vem do workflow OFICIAL da operação-alvo.
export interface OpAntecipadaInline {
  id: number
  publicCode: string | null
  necessidadeId: number | null
  status: string
  operationType: string
  targetOperationId: number | null
  originPhaseCode: string | null
  targetPhaseCode: string | null
  objetivo: string | null
  resultadoObtido: string | null
  targetTipoDocumentoId?: number | null
  responsavel?: { id: number; nome: string | null } | null
  operacao: { statusRaw: string; statusLabel: string; concluida: boolean; uiRef: { kind: string; id: number | null; necessidadeId?: number | null } }
  aguardandoAvaliacao: boolean
  // true = documento-alvo É o exigido pela necessidade (será vinculado). false = documento de APOIO
  // (a avaliação captura RESULTADO estruturado; não vincula o doc à necessidade).
  vinculavel: boolean
  encerrada: boolean
}

export type ResultadoAvaliacaoUI = "SIM" | "PARCIAL" | "NAO" | "CANCELAR"
export type AvaliarFn = (id: number, resultado: ResultadoAvaliacaoUI, resultadoObtido: string, resultadoDados?: Record<string, unknown>) => void

export interface PainelDaFaseProps {
  faseNome: string                 // "Emissão documental"
  faseSub: string                  // subtítulo da fase
  faseTabs: string[]               // abas do mockup pra essa fase
  kpis: FaseKpi[]                  // os 7 contadores
  progressoPct: number             // % da fase
  progressoConcluidos: number      // ex: 0
  progressoTotal: number           // ex: 1
  progressoTexto: string           // "Solicite, receba... Falta 1 documento..."
  linhaPrincipal: FasePersonRow[]
  foraDaLinha: FasePersonRow[]
  /** Pessoas com inconsistência real de cadastro — visíveis, nunca descartadas. */
  pendenteClassificacao?: FasePersonRow[]
  /** Lista operacional REAL das tarefas da fase (não o agregado das etapas). */
  tarefas?: FaseTarefaRow[]
  /** Abre a tarefa na tela oficial da operação. undefined ⇒ só leitura. */
  onAbrirTarefa?: (t: FaseTarefaRow) => void
  // OPERAÇÃO ANTECIPADA — capacidade nativa preservada INTEGRALMENTE. Ela sempre
  // pertenceu ao ALVO (a necessidade), não à tabela por pessoa: criar, listar,
  // avaliar e abrir agora acontecem na instância do passo, onde o alvo está.
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  onAbrirPainelCompleto?: () => void
  // Delegação direto na fila (Genealogia): lista de funcionários + callback.
  usuarios?: Array<{ id: number; nome: string; publicCode?: string | null }>
  // Operação Antecipada: capacidade nativa — usa a operação oficial de outra fase p/ atender esta necessidade.
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  // Operações antecipadas existentes por necessidade — exibidas INLINE dentro do documento.
  // CONSULTA de fase passada (PAST_READ_ONLY): mesmo layout/dados, mas SEM ações de
  // mutação (abrir operação/delegar). Só leitura. onAbrirOperacao/onDelegar chegam
  // undefined; readOnly deixa a intenção explícita para a UI.
  readOnly?: boolean
  // LEGADO_INATIVO (desativação Genealogia): em modo reestruturação, o painel NÃO
  // exibe as etapas/KPIs/progresso/"validados" antigos (derivados de
  // Documento.status + linhaReta). Mostra apenas um aviso neutro + a lista de
  // pessoas. Os documentos existentes aparecem como "registros operacionais
  // existentes", sem rótulo de obrigatório/validado.
  modoReestruturacao?: boolean
  avisoReestruturacao?: string
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export function PainelDaFase({
  faseNome,
  faseSub,
  faseTabs,
  kpis,
  progressoPct,
  progressoConcluidos,
  progressoTotal,
  progressoTexto,
  linhaPrincipal,
  foraDaLinha,
  pendenteClassificacao = [],
  tarefas = [],
  onAbrirTarefa,
  operacoesPorNec,
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
  onAbrirPainelCompleto,
  usuarios,
  onNovaOperacao,
  readOnly = false,
  modoReestruturacao = false,
  avisoReestruturacao,
}: PainelDaFaseProps) {
  const [abaAtiva, setAbaAtiva] = useState("Resumo")

  return (
    <div>
      {/* ============== CABEÇALHO DA FASE (shell pps) ============== */}
      <div className="bg-[#1b2027] border border-white/10 border-b-0 rounded-t-2xl px-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[19px] font-extrabold text-white/95">{faseNome}</h2>
          </div>
          <button
            onClick={onAbrirPainelCompleto}
            className="inline-flex items-center gap-1.5 border-[1.5px] border-white/10 bg-[#1b2027] text-white/80 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg whitespace-nowrap hover:border-white/20 hover:text-white transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir painel da fase
          </button>
        </div>
        <div className="text-[13px] text-white/55 mt-1.5">{faseSub}</div>

        {/* Abas */}
        <div className="flex gap-1 overflow-x-auto mt-3.5 border-b border-white/10">
          {faseTabs.map((t) => (
            <button
              key={t}
              onClick={() => setAbaAtiva(t)}
              className={`text-[12.5px] font-semibold px-3 py-2.5 border-b-2 whitespace-nowrap transition-colors ${
                abaAtiva === t
                  ? "border-[#2563eb] text-white"
                  : "text-white/55 border-transparent hover:text-white/95"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ============== CORPO DA FASE ============== */}
      <div className="bg-[#1b2027] border border-white/10 border-t-0 rounded-b-2xl px-5 py-5">

        {modoReestruturacao ? (
          /* --- LEGADO_INATIVO: aviso neutro de reestruturação --- */
          <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-5 py-4 mb-5">
            <div className="text-[13px] font-bold text-[#d2a948] mb-1">
              Fase em reestruturação
            </div>
            <div className="text-[12.5px] text-[#d2a948] leading-relaxed">
              {avisoReestruturacao ||
                "A definição documental da Genealogia está em reestruturação. Nenhum progresso automático é calculado nesta etapa."}
            </div>
            <div className="text-[11.5px] text-[#d2a948]/80 mt-2">
              A árvore e os dados civis continuam disponíveis. Documentos exibidos são
              registros operacionais existentes — não representam obrigatoriedade nem validação.
            </div>
          </div>
        ) : (
        <>
        {/* A esteira de etapas em linha saiu daqui: ela repetia, em forma de resumo,
            o mesmo workflow que agora é renderizado abaixo com os passos expansíveis
            e as instâncias reais de cada um. Duas representações do mesmo workflow
            divergem no primeiro dia em que uma delas deixa de ser atualizada. */}

        {/* --- 7 CONTADORES --- */}
        <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: `repeat(${kpis.length}, 1fr)` }}>
          {kpis.map((k, i) => {
            const valColor =
              k.label === "Solicitados" ? "text-[#7dd3fc]"
              : k.tone === "ok" ? "text-[#4ade80]"
              : k.tone === "busca" ? "text-[#d2a948]"
              : k.tone === "late" ? "text-[#f87171]"
              : "text-white/95"
            return (
              <div key={i} className="bg-[#1b2027] border border-white/10 rounded-[10px] px-4 py-3">
                <b className={`text-[22px] font-extrabold block leading-none ${valColor}`}>{k.value}</b>
                <span className="text-[11px] text-white/40 font-semibold block mt-1.5">{k.label}</span>
              </div>
            )
          })}
        </div>

        {/* --- BARRA DE PROGRESSO DA FASE --- */}
        <div className="bg-[#1b2027] border border-white/10 rounded-xl px-5 py-4 mb-5">
          <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
            <div>
              <div className="text-[13px] font-semibold text-white/55 mb-1">Progresso da fase {faseNome}</div>
              <div className="text-[28px] font-extrabold text-white/95 leading-none">{progressoPct}%</div>
            </div>
            <div className="text-[13px] text-white/55">{progressoConcluidos} de {progressoTotal} documentos validados</div>
          </div>
          <div className="h-1.5 bg-[#252c35] rounded-full overflow-hidden mt-3">
            <div className="h-full bg-[#7dd3fc] transition-all duration-500" style={{ width: `${progressoPct}%` }} />
          </div>
          <div className="text-center text-[12.5px] text-white/40 mt-3">{progressoTexto}</div>
        </div>
        </>
        )}

        {/* --- TAREFAS DA FASE (lista operacional real) --- */}
        <WorkflowDaFase tarefas={tarefas} onAbrir={onAbrirTarefa} onNovaOperacao={onNovaOperacao} operacoesPorNec={operacoesPorNec} onAvaliarOperacao={onAvaliarOperacao} onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada} readOnly={readOnly} faseNome={faseNome} />

        {/* --- PESSOAS DO PROCESSO (contexto, não fila de trabalho) ---
            O trabalho por pessoa/certidão vive DENTRO do passo do workflow, acima.
            Repetir aqui as mesmas tarefas criava duas listas para a mesma coisa —
            e duas listas divergem. Aqui ficam só quem são as pessoas, onde estão na
            linha de transmissão e o que falta no cadastro delas. */}
        <div className="border border-white/10 rounded-xl overflow-hidden">
          {/* Cabeçalho de colunas */}
          <div
            className="grid items-center gap-2.5 px-5 py-2.5 text-[10px] font-bold text-white/40 uppercase tracking-wider bg-[#20262e] border-b border-white/10"
            style={{ gridTemplateColumns: "52px minmax(200px,2fr) 1.2fr 1.6fr" }}
          >
            <div />
            <div>
              PESSOA
              <div className="text-[9px] font-semibold text-white/25 normal-case tracking-normal mt-0.5">Posição / Código</div>
            </div>
            <div>
              TRANSMISSÃO
              <div className="text-[9px] font-semibold text-white/25 normal-case tracking-normal mt-0.5">Status</div>
            </div>
            <div>PENDÊNCIA DE CADASTRO</div>
          </div>

          {/* Grupo Linha Principal */}
          <GroupBar
            icon={<Star className="w-3 h-3" />}
            title="Linha principal · transmissão de cidadania"
            count={linhaPrincipal.length}
            tone="linha"
          />
          {linhaPrincipal.map((p) => (
            <PersonRow key={p.pessoaId} p={p} />
          ))}

          {/* Grupo Fora da linhagem */}
          <GroupBar
            icon={<Users className="w-3 h-3" />}
            title="Fora da linhagem · cônjuges / apoio"
            count={foraDaLinha.length}
            tone="fora"
          />
          {foraDaLinha.map((p) => (
            <PersonRow key={p.pessoaId} p={p} />
          ))}

          {/* Grupo Pendente de classificação — só aparece quando há inconsistência
              REAL de cadastro. Nenhuma pessoa é descartada em silêncio. */}
          {pendenteClassificacao.length > 0 && (
            <>
              <GroupBar
                icon={<AlertTriangle className="w-3 h-3" />}
                title="Pendente de classificação · revisar cadastro"
                count={pendenteClassificacao.length}
                tone="pendente"
              />
              {pendenteClassificacao.map((p) => (
                <PersonRow key={p.pessoaId} p={p} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SUBCOMPONENTES
// ============================================================

// ------------------------------------------------------------
// WORKFLOW DA FASE
// ------------------------------------------------------------
// A Central não mantém uma lista própria de tarefas: ela RENDERIZA o workflow
// publicado da fase. Cada passo aparece uma vez, com o estado agregado das suas
// instâncias; expandir o passo mostra as instâncias operacionais reais (a pessoa,
// o registro, a certidão ou o documento de cada uma) e é ali que se abre a execução.
//
// O workflow é a fonte única. Se um passo tem 1 alvo, aparece 1 instância; se tem
// 40, aparecem 40 — sem piso de quantidade e sem esconder as concluídas.

/** Estado agregado de um passo a partir das suas instâncias. */
function resumirPasso(instancias: FaseTarefaRow[]) {
  const total = instancias.length
  const concluidas = instancias.filter((t) => t.balde === "CONCLUIDA").length
  const emAndamento = instancias.filter((t) => t.balde === "EM_ANDAMENTO").length
  const divergentes = instancias.filter((t) => t.statusRaw === "BLOQUEADO" || t.statusRaw === "FALHOU").length
  const estado: "concluida" | "em_andamento" | "pendente" =
    total > 0 && concluidas >= total ? "concluida"
    : emAndamento > 0 || concluidas > 0 ? "em_andamento"
    : "pendente"
  return { total, concluidas, emAndamento, divergentes, pendentes: total - concluidas - divergentes, estado }
}

function WorkflowDaFase({
  tarefas,
  onAbrir,
  onNovaOperacao,
  operacoesPorNec,
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
  readOnly,
  faseNome,
}: {
  tarefas: FaseTarefaRow[]
  onAbrir?: (t: FaseTarefaRow) => void
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  readOnly: boolean
  faseNome: string
}) {
  // Agrupa por passo publicado, preservando a ordem em que a fase os entrega.
  const passos: Array<{ stepKey: string; titulo: string; instancias: FaseTarefaRow[] }> = []
  const indice = new Map<string, number>()
  for (const t of tarefas) {
    let i = indice.get(t.stepKey)
    if (i == null) {
      i = passos.length
      indice.set(t.stepKey, i)
      passos.push({ stepKey: t.stepKey, titulo: t.titulo, instancias: [] })
    }
    passos[i].instancias.push(t)
  }

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden mb-5">
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-white/10 bg-[#20262e]/70">
        <span className="w-[22px] h-[22px] rounded-lg grid place-items-center flex-none bg-[#252c35] text-white/55">
          <PlayCircle className="w-3 h-3" />
        </span>
        <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">
          Workflow · {faseNome}
        </b>
        <span className="ml-auto text-[11px] font-bold text-white/40 bg-[#1b2027] border border-white/10 rounded-full px-2.5 py-0.5">
          {passos.length} passo(s)
        </span>
      </div>

      {passos.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <div className="text-[13px] text-white/68">O workflow desta fase não tem passos materializados.</div>
          <div className="text-[11.5px] text-white/40 mt-1 leading-relaxed">
            Publique os passos da fase em Gerenciamento › Workflows das Fases. Enquanto
            não houver passo publicado, não há o que executar aqui.
          </div>
        </div>
      ) : (
        passos.map((p) => (
          <PassoDoWorkflow
            key={p.stepKey} passo={p} onAbrir={onAbrir} onNovaOperacao={onNovaOperacao}
            operacoesPorNec={operacoesPorNec} onAvaliarOperacao={onAvaliarOperacao}
            onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada} readOnly={readOnly}
          />
        ))
      )}
    </div>
  )
}

function PassoDoWorkflow({
  passo,
  onAbrir,
  onNovaOperacao,
  operacoesPorNec,
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
  readOnly,
}: {
  passo: { stepKey: string; titulo: string; instancias: FaseTarefaRow[] }
  onAbrir?: (t: FaseTarefaRow) => void
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  readOnly: boolean
}) {
  const r = resumirPasso(passo.instancias)
  // Abre já expandido o passo em que há trabalho; concluído entra recolhido.
  const [exp, setExp] = useState(r.estado !== "concluida")

  const icBorder =
    r.estado === "concluida" ? "border-[#4ade80]/40 text-[#4ade80]"
    : r.estado === "em_andamento" ? "border-[#2563eb] text-[#7dd3fc]"
    : "border-white/10 text-white/40"

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={() => setExp(!exp)}
        className="w-full text-left flex items-center gap-3 px-5 py-3 hover:bg-[#20262e] transition-colors"
      >
        <span className={`w-7 h-7 rounded-full grid place-items-center border-[1.5px] flex-none bg-[#1b2027] ${icBorder}`}>
          {r.estado === "concluida" ? <CheckCircle2 className="w-3.5 h-3.5" />
            : r.estado === "em_andamento" ? <Search className="w-3.5 h-3.5" />
            : <Clock className="w-3.5 h-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <b className="text-[13.5px] font-bold block leading-tight text-white/95">{passo.titulo}</b>
          <span className="text-[11.5px] text-white/40">
            {r.concluidas} de {r.total} concluída(s)
            {r.divergentes > 0 && <span className="text-[#f87171]"> · {r.divergentes} divergente(s)</span>}
          </span>
        </span>
        <span className="w-28 h-1.5 rounded bg-[#252c35] overflow-hidden flex-none">
          <span className="block h-full bg-[#7dd3fc]" style={{ width: `${r.total > 0 ? Math.round((r.concluidas / r.total) * 100) : 0}%` }} />
        </span>
        <span className="text-white/40 flex-none">
          {exp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </button>

      {exp && (
        <div className="bg-[#15191f] border-t border-white/10">
          {passo.instancias.map((t) => (
            <InstanciaDoPasso
              key={t.stepInstanceId} t={t} onAbrir={onAbrir} onNovaOperacao={onNovaOperacao}
              ops={t.necessidadeId != null ? operacoesPorNec?.get(t.necessidadeId) ?? [] : []}
              onAvaliarOperacao={onAvaliarOperacao} onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Uma instância operacional do passo: o alvo concreto (pessoa/registro/documento). */
function InstanciaDoPasso({
  t,
  onAbrir,
  onNovaOperacao,
  ops = [],
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
  readOnly,
}: {
  t: FaseTarefaRow
  onAbrir?: (t: FaseTarefaRow) => void
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  ops?: OpAntecipadaInline[]
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  readOnly: boolean
}) {
  const podeAbrir = !readOnly && !!onAbrir && !!t.executor
  const concluida = t.balde === "CONCLUIDA"

  return (
    <>
    <button
      type="button"
      onClick={() => podeAbrir && onAbrir!(t)}
      disabled={!podeAbrir}
      title={t.erroAdministrativo ?? (readOnly ? "Somente leitura" : `Abrir: ${t.pessoaNome ?? t.assunto ?? t.titulo}`)}
      className={`w-full text-left grid items-center gap-2.5 pl-14 pr-5 py-2.5 border-b border-white/10 last:border-b-0 transition-colors ${
        podeAbrir ? "hover:bg-[#20262e] cursor-pointer" : "cursor-default"
      }`}
      style={{ gridTemplateColumns: "minmax(160px,2fr) 1.2fr 1fr 0.7fr 108px" }}
    >
      <span className="min-w-0 block">
        <b className={`text-[13px] font-bold block leading-tight truncate ${concluida ? "text-white/68" : "text-white/95"}`}>
          {t.pessoaNome ?? t.assunto ?? "Etapa da fase"}
        </b>
        {t.pessoaNome && t.assunto && (
          <span className="text-[11.5px] text-white/40 block truncate">{t.assunto}</span>
        )}
      </span>

      <span className="block">
        <span className={`text-[12px] font-semibold ${concluida ? "text-[#4ade80]" : t.balde === "EM_ANDAMENTO" ? "text-[#7dd3fc]" : "text-white/68"}`}>
          {t.statusLabel}
        </span>
        {t.motivo && <span className="text-[11px] text-white/40 block truncate">{t.motivo}</span>}
        {t.erroAdministrativo && (
          <span className="text-[11px] text-[#d2a948] block leading-snug mt-0.5">⚠ {t.erroAdministrativo}</span>
        )}
      </span>

      <span className="text-[12px] block truncate">
        {t.responsavelNome
          ? <span className="text-white/80 font-semibold">{t.responsavelNome}</span>
          : <span className="text-white/40">Sem responsável</span>}
      </span>

      <span className="text-[12px] block">
        {t.diasParaPrazo != null ? (
          <span className={t.diasParaPrazo < 0 ? "text-[#f87171] font-semibold" : "text-white/68"}>
            {t.diasParaPrazo < 0 ? `${Math.abs(t.diasParaPrazo)}d atrasada` : `${t.diasParaPrazo}d`}
          </span>
        ) : t.slaDays ? (
          <span className="text-white/40">SLA {t.slaDays}d</span>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </span>

      <span className="flex justify-end items-center gap-2">
        {/* OPERAÇÃO ANTECIPADA — vive AQUI, junto do alvo a que se refere. Antes ficava
            na linha do documento dentro da tabela por pessoa; com o trabalho todo no
            workflow, este é o lugar dela. */}
        {!readOnly && onNovaOperacao && t.necessidadeId != null && !concluida && (
          <span
            role="button"
            tabIndex={0}
            title="Nova operação antecipada"
            onClick={(e) => { e.stopPropagation(); onNovaOperacao(t.necessidadeId as number, t.pessoaId, `${t.assunto ?? t.titulo} — ${t.pessoaNome ?? ""}`.trim()) }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onNovaOperacao(t.necessidadeId as number, t.pessoaId, `${t.assunto ?? t.titulo} — ${t.pessoaNome ?? ""}`.trim()) } }}
            className="text-[11px] font-semibold text-white/40 hover:text-[#7dd3fc] underline decoration-dotted underline-offset-2 cursor-pointer"
          >
            + antecipada
          </span>
        )}
        {podeAbrir ? (
          <span className="inline-flex items-center gap-1.5 bg-[#252c35] text-white/95 border border-white/10 text-[12px] font-bold px-3 py-1.5 rounded-lg">
            {concluida ? "Ver" : "Abrir"} <ChevronRight className="w-3 h-3" />
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-[#d2a948]">
            {readOnly ? "Somente leitura" : "Sem executor"}
          </span>
        )}
      </span>
    </button>
    {/* Operações antecipadas DESTE alvo — mesma lista, mesma avaliação e mesma
        abertura de antes; agora ancoradas na instância do passo a que pertencem. */}
    {ops.length > 0 && (
      <OperacoesAntecipadasInline
        ops={ops} readOnly={readOnly}
        onAvaliar={onAvaliarOperacao} onAbrir={onAbrirOperacaoAntecipada}
      />
    )}
    </>
  )
}

function GroupBar({
  icon,
  title,
  count,
  tone,
}: {
  icon: React.ReactNode
  title: string
  count: number
  tone: "linha" | "fora" | "pendente"
}) {
  return (
    <div className={`flex items-center gap-2.5 px-5 py-2.5 border-b border-white/10 ${tone === "pendente" ? "bg-[#d2a948]/12" : tone === "fora" ? "bg-[#252c35]" : "bg-[#20262e]/70"}`}>
      <span className={`w-[22px] h-[22px] rounded-lg grid place-items-center flex-none ${tone === "pendente" ? "bg-[#d2a948]/20 text-[#d2a948]" : tone === "fora" ? "bg-[#252c35] text-white/40" : "bg-[#252c35] text-white/55"}`}>
        {icon}
      </span>
      <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">{title}</b>
      <span className="ml-auto text-[11px] font-bold text-white/40 bg-[#1b2027] border border-white/10 rounded-full px-2.5 py-0.5">
        {count} pessoa(s)
      </span>
    </div>
  )
}

// ------------------------------------------------------------
// PESSOA — CONTEXTO, não fila de trabalho
// ------------------------------------------------------------
// O que esta linha responde: quem é a pessoa, onde ela está na linha de transmissão
// e se o cadastro dela tem pendência. O TRABALHO dela (buscar o registro, solicitar
// a certidão) aparece dentro do passo do workflow, junto com todos os outros alvos
// daquele passo. Duas listas para o mesmo trabalho divergem; esta deixou de ser uma.
function PersonRow({ p }: { p: FasePersonRow }) {
  const borderCls = !p.isLinha
    ? "border-l-[3px] border-white/10 bg-[#15191f]"
    : "border-l-[3px] border-white/10"

  const transDot =
    p.transmissao.state === "OK" ? "bg-[#4ade80]"
    : p.transmissao.state === "BLOQUEADA" ? "bg-[#f87171]"
    : "bg-white/25"
  const transColor =
    p.transmissao.state === "OK" ? "text-[#4ade80]"
    : p.transmissao.state === "BLOQUEADA" ? "text-[#f87171]"
    : "text-white/40"

  return (
    <div
      className={`grid items-center gap-2.5 px-5 py-3 border-b border-white/10 last:border-b-0 ${borderCls}`}
      style={{ gridTemplateColumns: "52px minmax(200px,2fr) 1.2fr 1.6fr" }}
    >
      {/* Geração */}
      <div className="text-center text-[11px] font-extrabold text-white/55 bg-[#1b2027] border border-white/10 rounded-lg py-1.5 leading-tight">
        {p.geracao}
      </div>

      {/* Pessoa */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-[34px] h-[34px] rounded-full grid place-items-center text-white font-extrabold text-[12.5px] flex-none bg-[#252c35]">
          {p.iniciais}
        </div>
        <div className="min-w-0">
          <b className="text-[14px] font-extrabold block leading-tight truncate text-white/95">{p.nome}</b>
          <span className="text-[11.5px] text-white/40 font-semibold block truncate">
            {[p.publicCode, p.papel].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>

      {/* Transmissão */}
      <div>
        <div className={`flex items-center gap-1.5 text-[13px] font-bold ${transColor}`}>
          <span className={`w-2 h-2 rounded-full flex-none ${transDot}`} />
          {p.transmissao.label}
        </div>
        {p.transmissao.sub && (
          <div className="text-[11.5px] text-white/40 font-medium mt-0.5">{p.transmissao.sub}</div>
        )}
      </div>

      {/* Pendência de cadastro — o que falta para a pessoa estar íntegra */}
      <div>
        {p.pendencia ? (
          <span className="text-[11.5px] text-[#d2a948] font-semibold flex items-start gap-1.5 leading-snug">
            <AlertTriangle className="w-3.5 h-3.5 flex-none mt-px" />
            {p.pendencia}
          </span>
        ) : (
          <span className="text-[11.5px] text-white/25">—</span>
        )}
      </div>
    </div>
  )
}

const ST_OP_LABEL: Record<string, { t: string; c: string }> = {
  CRIADA: { t: "Criada", c: "bg-[#252c35] text-white/68" },
  EM_EXECUCAO: { t: "Em execução", c: "bg-[#7dd3fc]/15 text-[#7dd3fc]" },
  AGUARDANDO_RESULTADO: { t: "Aguardando avaliação", c: "bg-[#d2a948]/15 text-[#d2a948]" },
  CONCLUIDA: { t: "Concluída", c: "bg-[#4ade80]/15 text-[#4ade80]" },
  CONCLUIDA_PARCIAL: { t: "Concluída parcial", c: "bg-teal-500/15 text-teal-300" },
  NAO_ATINGIDA: { t: "Não atingida", c: "bg-[#f87171]/15 text-[#f87171]" },
  CANCELADA: { t: "Cancelada", c: "bg-[#252c35] text-white/40" },
}

function OperacoesAntecipadasInline({ ops, readOnly, onAvaliar, onAbrir }: {
  ops: OpAntecipadaInline[]
  readOnly?: boolean
  onAvaliar?: AvaliarFn
  onAbrir?: (op: OpAntecipadaInline) => void
}) {
  const abertas = ops.filter((o) => !o.encerrada).length
  return (
    <div className="pr-5 pb-2" style={{ paddingLeft: 76 }}>
      <div className="rounded-lg border border-[#a78bfa]/25 bg-[#a78bfa]/12 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[#a78bfa]/20 text-[10.5px] font-bold uppercase tracking-wide text-[#a78bfa]">
          <ArrowLeftRight className="w-3 h-3" /> Operações antecipadas
          <span className="font-semibold text-[#a78bfa]/70 normal-case tracking-normal">· {ops.length}{abertas > 0 ? ` (${abertas} aberta${abertas > 1 ? "s" : ""})` : ""}</span>
        </div>
        <div className="divide-y divide-[#a78bfa]/15">
          {ops.map((o) => (
            <OperacaoAntecipadaItem key={o.id} o={o} readOnly={readOnly} onAvaliar={onAvaliar} onAbrir={onAbrir} />
          ))}
        </div>
      </div>
    </div>
  )
}

function OperacaoAntecipadaItem({ o, readOnly, onAvaliar, onAbrir }: {
  o: OpAntecipadaInline
  readOnly?: boolean
  onAvaliar?: AvaliarFn
  onAbrir?: (op: OpAntecipadaInline) => void
}) {
  const [avaliando, setAvaliando] = useState(false)
  const [resultado, setResultado] = useState("")
  const [dados, setDados] = useState<Record<string, string>>({})
  const st = ST_OP_LABEL[o.status] ?? { t: o.status, c: "bg-[#252c35] text-white/68" }
  const objetivo = o.objetivo || "Operação antecipada"
  const apoio = !o.vinculavel // documento-alvo diferente do exigido → captura resultado estruturado
  const setD = (k: string, v: string) => setDados((d) => ({ ...d, [k]: v }))
  const enviar = (r: ResultadoAvaliacaoUI) => {
    onAvaliar?.(o.id, r, resultado, r === "SIM" && apoio ? { ...dados } : undefined)
    setAvaliando(false)
  }

  return (
    <div className={`px-3 py-2.5 ${o.encerrada ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
          {/* Operação Antecipada é orquestração interna: identificada pelo objetivo/documento/serviço vinculado, sem código público próprio (OPA-n removido). */}
          <span className="text-[12.5px] font-semibold text-white/95">{objetivo}</span>
          <span className="text-[11px] text-white/40">
            {o.operacao.statusLabel}
            {o.originPhaseCode ? ` · origem ${faseLabel(o.originPhaseCode)}` : ""}
            {apoio && o.targetTipoDocumentoId ? " · documento de apoio" : ""}
            {o.responsavel?.nome ? ` · ${o.responsavel.nome}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${st.c}`}>{st.t}</span>
          {onAbrir && (
            <button onClick={() => onAbrir(o)} className="text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-[#252c35] text-white/95 border border-white/10 hover:bg-[#2d353f]">Abrir operação</button>
          )}
        </div>
      </div>

      {/* AVALIAÇÃO FINAL — só após o workflow oficial concluir. Documento de APOIO captura o
          resultado ESTRUTURADO (é ele que resolve a necessidade de origem, não o doc em si). */}
      {!readOnly && o.aguardandoAvaliacao && onAvaliar && (
        avaliando ? (
          <div className="mt-2 rounded-md border border-white/10 bg-[#1b2027] p-2 space-y-2">
            {apoio && (
              <div className="grid grid-cols-2 gap-2">
                {[["cartorio", "Cartório"], ["municipio", "Município"], ["livro", "Livro"], ["folha", "Folha"], ["termo", "Termo"], ["data", "Data"], ["fonte", "Fonte da informação"]].map(([k, label]) => (
                  <input key={k} value={dados[k] ?? ""} onChange={(e) => setD(k, e.target.value)} placeholder={label} className="text-[12px] rounded-md border border-white/10 px-2 py-1.5 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25" />
                ))}
              </div>
            )}
            <input value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder={apoio ? "Observações" : "Resultado obtido"} className="w-full text-[12px] rounded-md border border-white/10 px-2 py-1.5 focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25" autoFocus />
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => enviar("SIM")} className="inline-flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1.5 rounded-md bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40 hover:bg-[#4ade80]/25"><CheckCircle2 className="w-3.5 h-3.5" /> Objetivo atingido</button>
              <button onClick={() => enviar("PARCIAL")} className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md border border-teal-500/25 text-teal-300 hover:bg-teal-500/10">Parcialmente</button>
              <button onClick={() => enviar("NAO")} className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md border border-white/10 text-white/80 hover:bg-[#20262e]">Não atingido</button>
              <button onClick={() => enviar("CANCELAR")} className="text-[11.5px] text-white/40 hover:text-[#f87171] ml-auto">Cancelar operação</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setAvaliando(true); setResultado("") }} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-bold px-2.5 py-1.5 rounded-md bg-[#4ade80]/15 text-[#4ade80] border border-[#4ade80]/40 hover:bg-[#4ade80]/25"><CheckCircle2 className="w-3.5 h-3.5" /> Operação concluída — avaliar objetivo</button>
        )
      )}
      {o.resultadoObtido && <div className="text-[11px] text-white/55 mt-1">Resultado: {o.resultadoObtido}</div>}
    </div>
  )
}

// ============================================================
// HELPERS DE COR (status do documento)
// ============================================================

function docCls(cls: string): string {
  switch (cls) {
    case "localizado":
    case "validado":
    case "recebido": return "text-[#4ade80]"
    case "em_busca":
    case "solicitado": return "text-[#d2a948]"
    case "bloqueado": return "text-[#f87171]"
    case "desnecessario": return "text-white/40"
    default: return "text-white/40"
  }
}

function docDot(cls: string): string {
  switch (cls) {
    case "localizado":
    case "validado":
    case "recebido": return "bg-[#4ade80]"
    case "em_busca":
    case "solicitado": return "bg-[#d2a948]"
    case "bloqueado": return "bg-[#f87171]"
    default: return "bg-white/25"
  }
}

