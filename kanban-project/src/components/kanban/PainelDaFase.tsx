// src/components/kanban/PainelDaFase.tsx
//
// Painel da fase operacional, clone fiel do mockup discovery-central-operacional-v2.html
// (funções renderCentral / coWorkflow / coKpis / coGroups / personRow / docExpRow).
//
// Substitui o conteúdo principal antigo da Central Operacional (matriz escura +
// cards de fila) pelo painel da fase do mockup:
//   - Cabeçalho da fase (título + badge "Fase atual · operacional" + "Abrir painel da fase" + abas)
//   - 5 etapas em linha (Solicitar / Aguardar / Receber / Conferir / Validar)
//   - 7 contadores (Obrigatórios / Validados / Solicitados / Aguardando / Recebidos / Conferidos / Divergentes)
//   - Barra de progresso da fase
//   - Tabela por pessoa (Linha principal / Fora da linhagem) com linhas expansíveis
//
// É a CASCA visual fiel. Recebe os dados via props (vindos da rota
// /api/processos/[id]/central-operacional + /phase). Onde o backend ainda não
// fornece um contador, ele aparece zerado (igual o mockup quando não há dado).

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
  motivo: string | null
  bloqueioAbertura: string | null
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
  steps: FaseStep[]                // as 5 etapas
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
  onAbrirOperacao?: (docId: number, necessidadeId?: number | null) => void
  onAbrirPainelCompleto?: () => void
  // Delegação direto na fila (Genealogia): lista de funcionários + callback.
  usuarios?: Array<{ id: number; nome: string; publicCode?: string | null }>
  onDelegar?: (necessidadeId: number, responsavelId: number | null) => void
  // Operação Antecipada: capacidade nativa — usa a operação oficial de outra fase p/ atender esta necessidade.
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  // Operações antecipadas existentes por necessidade — exibidas INLINE dentro do documento.
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
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
  steps,
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
  onAbrirOperacao,
  onAbrirPainelCompleto,
  usuarios,
  onDelegar,
  onNovaOperacao,
  operacoesPorNec,
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
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
        {/* --- 5 ETAPAS EM LINHA --- */}
        <div className="flex items-center mb-5 overflow-x-auto pb-1">
          {steps.map((s, i) => {
            const cls =
              s.status === "concluida" ? "done"
              : s.status === "em_andamento" ? "active"
              : "pend"
            const icBorder =
              cls === "done" ? "border-[#4ade80]/40 text-[#4ade80]"
              : cls === "active" ? "border-[#2563eb] text-[#7dd3fc]"
              : "border-white/10 text-white/40"
            const titColor = cls === "pend" ? "text-white/40" : "text-white/95"
            const subColor =
              cls === "done" ? "text-[#4ade80]"
              : cls === "active" ? "text-[#7dd3fc]"
              : "text-white/40"
            const subTxt =
              s.status === "concluida" ? "Concluído"
              : s.status === "em_andamento" ? "Em andamento"
              // "pendente" = etapa SEM item aplicável. Anunciar "Em andamento" aqui era
              // a mentira que fazia o operador clicar numa etapa que não abre nada.
              : s.status === "pendente" ? "Sem itens aplicáveis"
              : "Bloqueada"
            return (
              <div key={i} className="flex items-center flex-none">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-full grid place-items-center border-[1.5px] bg-[#1b2027] ${icBorder}`}>
                    {s.status === "concluida" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : s.status === "em_andamento" ? (
                      <Search className="w-3.5 h-3.5" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div>
                    <div className={`text-[12.5px] font-bold leading-tight ${titColor}`}>{s.title}</div>
                    <div className={`text-[11px] font-semibold mt-px ${subColor}`}>{subTxt}</div>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className={`h-px min-w-[28px] flex-1 mx-2.5 ${s.status === "concluida" ? "bg-[#4ade80]" : "bg-[#252c35]"}`} style={{ width: 60 }} />
                )}
              </div>
            )
          })}
        </div>

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
        <ListaDeTarefas tarefas={tarefas} onAbrir={onAbrirTarefa} readOnly={readOnly} faseNome={faseNome} />

        {/* --- TABELA POR PESSOA --- */}
        <div className="border border-white/10 rounded-xl overflow-hidden">
          {/* Cabeçalho de colunas */}
          <div
            className="grid items-center gap-2.5 px-5 py-2.5 text-[10px] font-bold text-white/40 uppercase tracking-wider bg-[#20262e] border-b border-white/10"
            style={{ gridTemplateColumns: "52px minmax(160px,1.6fr) 1fr 1.2fr 1fr 0.7fr 1.2fr 124px" }}
          >
            <div />
            <div>
              PESSOA
              <div className="text-[9px] font-semibold text-white/25 normal-case tracking-normal mt-0.5">Linha / Código</div>
            </div>
            <div>
              TRANSMISSÃO
              <div className="text-[9px] font-semibold text-white/25 normal-case tracking-normal mt-0.5">Status</div>
            </div>
            <div>
              DOCUMENTOS
              <div className="text-[9px] font-semibold text-white/25 normal-case tracking-normal mt-0.5">Solicitados / Recebidos</div>
            </div>
            <div>RESPONSÁVEL</div>
            <div>PRAZO</div>
            <div>PRÓXIMA AÇÃO</div>
            <div className="text-right">AÇÃO</div>
          </div>

          {/* Grupo Linha Principal */}
          <GroupBar
            icon={<Star className="w-3 h-3" />}
            title="Linha principal · transmissão de cidadania"
            count={linhaPrincipal.length}
            tone="linha"
          />
          {linhaPrincipal.map((p) => (
            <PersonRow key={p.pessoaId} p={p} onAbrirOperacao={onAbrirOperacao} usuarios={usuarios} onDelegar={onDelegar} onNovaOperacao={onNovaOperacao} operacoesPorNec={operacoesPorNec} onAvaliarOperacao={onAvaliarOperacao} onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada} ocultarValidacao={modoReestruturacao} readOnly={readOnly} />
          ))}

          {/* Grupo Fora da linhagem */}
          <GroupBar
            icon={<Users className="w-3 h-3" />}
            title="Fora da linhagem · cônjuges / apoio"
            count={foraDaLinha.length}
            tone="fora"
          />
          {foraDaLinha.map((p) => (
            <PersonRow key={p.pessoaId} p={p} onAbrirOperacao={onAbrirOperacao} usuarios={usuarios} onDelegar={onDelegar} onNovaOperacao={onNovaOperacao} operacoesPorNec={operacoesPorNec} onAvaliarOperacao={onAvaliarOperacao} onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada} ocultarValidacao={modoReestruturacao} readOnly={readOnly} />
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
                <PersonRow key={p.pessoaId} p={p} onAbrirOperacao={onAbrirOperacao} usuarios={usuarios} onDelegar={onDelegar} onNovaOperacao={onNovaOperacao} operacoesPorNec={operacoesPorNec} onAvaliarOperacao={onAvaliarOperacao} onAbrirOperacaoAntecipada={onAbrirOperacaoAntecipada} ocultarValidacao={modoReestruturacao} readOnly={readOnly} />
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
// LISTA DE TAREFAS DA FASE
// ------------------------------------------------------------
// A lista operacional REAL: uma linha por passo materializado da fase, agrupada em
// Pendentes / Em andamento / Concluídas. Clicar abre a tela oficial da operação.
//
// REGRAS que esta lista respeita, porque a ausência delas foi o defeito:
//  • Aparece com UMA tarefa tanto quanto com cinquenta — agrupar não é filtrar.
//  • Concluídas continuam visíveis (histórico da fase), nunca somem.
//  • Documento obrigatório configurado NÃO é condição de exibição nem de abertura.
//  • Quando não há nenhuma tarefa, diz POR QUE — não devolve uma área em branco.
const GRUPOS_TAREFA: Array<{ balde: BaldeTarefa; titulo: string; cor: string }> = [
  { balde: "PENDENTE", titulo: "Pendentes", cor: "text-white/55" },
  { balde: "EM_ANDAMENTO", titulo: "Em andamento", cor: "text-[#7dd3fc]" },
  { balde: "CONCLUIDA", titulo: "Concluídas", cor: "text-[#4ade80]" },
]

function ListaDeTarefas({
  tarefas,
  onAbrir,
  readOnly,
  faseNome,
}: {
  tarefas: FaseTarefaRow[]
  onAbrir?: (t: FaseTarefaRow) => void
  readOnly: boolean
  faseNome: string
}) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden mb-5">
      <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-white/10 bg-[#20262e]/70">
        <span className="w-[22px] h-[22px] rounded-lg grid place-items-center flex-none bg-[#252c35] text-white/55">
          <PlayCircle className="w-3 h-3" />
        </span>
        <b className="text-[11.5px] font-extrabold tracking-wide uppercase text-white/55">
          Tarefas da fase {faseNome}
        </b>
        <span className="ml-auto text-[11px] font-bold text-white/40 bg-[#1b2027] border border-white/10 rounded-full px-2.5 py-0.5">
          {tarefas.length} tarefa(s)
        </span>
      </div>

      {tarefas.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <div className="text-[13px] text-white/68">Nenhuma tarefa materializada nesta fase.</div>
          <div className="text-[11.5px] text-white/40 mt-1 leading-relaxed">
            As tarefas da fase nascem dos requisitos documentais publicados que se aplicam
            às pessoas da árvore. Enquanto nenhuma Regra Documental publicada exigir algo
            nesta fase, não há o que executar — as pessoas abaixo continuam disponíveis.
          </div>
        </div>
      ) : (
        GRUPOS_TAREFA.map((g) => {
          const doGrupo = tarefas.filter((t) => t.balde === g.balde)
          return (
            <div key={g.balde}>
              <div className="flex items-center gap-2 px-5 py-2 bg-[#1b2027] border-b border-white/10">
                <b className={`text-[11px] font-extrabold uppercase tracking-wider ${g.cor}`}>{g.titulo}</b>
                <span className="text-[11px] font-bold text-white/40">{doGrupo.length}</span>
              </div>
              {doGrupo.length === 0 ? (
                <div className="px-5 py-2.5 text-[11.5px] text-white/25 border-b border-white/10">Nenhuma</div>
              ) : (
                doGrupo.map((t) => (
                  <TarefaRow key={t.stepInstanceId} t={t} onAbrir={onAbrir} readOnly={readOnly} />
                ))
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function TarefaRow({
  t,
  onAbrir,
  readOnly,
}: {
  t: FaseTarefaRow
  onAbrir?: (t: FaseTarefaRow) => void
  readOnly: boolean
}) {
  // ABRIR é o caminho normal. Só não abre quando o próprio passo não tem item
  // operacional (etapa genérica da fase) — e nesse caso o motivo fica escrito.
  const podeAbrir = !readOnly && !!onAbrir && !t.bloqueioAbertura
  const concluida = t.balde === "CONCLUIDA"

  return (
    <button
      type="button"
      onClick={() => podeAbrir && onAbrir!(t)}
      disabled={!podeAbrir}
      title={t.bloqueioAbertura ?? (readOnly ? "Somente leitura" : `Abrir: ${t.titulo}`)}
      className={`w-full text-left grid items-center gap-2.5 px-5 py-3 border-b border-white/10 transition-colors ${
        podeAbrir ? "hover:bg-[#20262e] cursor-pointer" : "cursor-default"
      }`}
      style={{ gridTemplateColumns: "28px minmax(180px,2fr) 1.4fr 1fr 0.8fr 118px" }}
    >
      <span className={`w-6 h-6 rounded-full grid place-items-center border-[1.5px] flex-none ${
        concluida ? "border-[#4ade80]/40 text-[#4ade80]"
        : t.balde === "EM_ANDAMENTO" ? "border-[#2563eb] text-[#7dd3fc]"
        : "border-white/10 text-white/40"
      }`}>
        {concluida ? <CheckCircle2 className="w-3 h-3" /> : t.balde === "EM_ANDAMENTO" ? <Search className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      </span>

      <span className="min-w-0 block">
        <b className={`text-[13.5px] font-bold block leading-tight truncate ${concluida ? "text-white/68" : "text-white/95"}`}>
          {t.titulo}
        </b>
        <span className="text-[11.5px] text-white/40 block truncate">
          {[t.pessoaNome, t.assunto].filter(Boolean).join(" · ") || "Etapa da fase"}
          {!t.obrigatorio && " · opcional"}
        </span>
      </span>

      <span className="block">
        <span className={`text-[12px] font-semibold ${concluida ? "text-[#4ade80]" : t.balde === "EM_ANDAMENTO" ? "text-[#7dd3fc]" : "text-white/68"}`}>
          {t.statusLabel}
        </span>
        {t.motivo && <span className="text-[11px] text-white/40 block truncate">{t.motivo}</span>}
        {t.bloqueioAbertura && <span className="text-[11px] text-white/40 block">{t.bloqueioAbertura}</span>}
      </span>

      <span className="text-[12px] block truncate">
        {t.responsavelNome ? (
          <span className="text-white/80 font-semibold">{t.responsavelNome}</span>
        ) : (
          <span className="text-white/40">Sem responsável</span>
        )}
      </span>

      <span className="text-[12px] block">
        {t.diasParaPrazo != null ? (
          <span className={t.diasParaPrazo < 0 ? "text-[#f87171] font-semibold" : "text-white/68"}>
            {t.diasParaPrazo < 0 ? `${Math.abs(t.diasParaPrazo)}d atrasada` : `${t.diasParaPrazo}d`}
          </span>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </span>

      <span className="flex justify-end">
        {podeAbrir ? (
          <span className="inline-flex items-center gap-1.5 bg-[#252c35] text-white/95 border border-white/10 text-[12px] font-bold px-3 py-1.5 rounded-lg">
            {concluida ? "Ver" : "Abrir"} <ChevronRight className="w-3 h-3" />
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-white/40">
            {readOnly ? "Somente leitura" : "—"}
          </span>
        )}
      </span>
    </button>
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

function PersonRow({
  p,
  onAbrirOperacao,
  usuarios,
  onDelegar,
  onNovaOperacao,
  operacoesPorNec,
  onAvaliarOperacao,
  onAbrirOperacaoAntecipada,
  ocultarValidacao = false,
  readOnly = false,
}: {
  p: FasePersonRow
  onAbrirOperacao?: (docId: number, necessidadeId?: number | null) => void
  usuarios?: Array<{ id: number; nome: string; publicCode?: string | null }>
  onDelegar?: (necessidadeId: number, responsavelId: number | null) => void
  onNovaOperacao?: (necessidadeId: number, pessoaId: number | null, label: string) => void
  operacoesPorNec?: Map<number, OpAntecipadaInline[]>
  onAvaliarOperacao?: AvaliarFn
  onAbrirOperacaoAntecipada?: (op: OpAntecipadaInline) => void
  ocultarValidacao?: boolean
  readOnly?: boolean
}) {
  const [exp, setExp] = useState(false)

  const borderCls = !p.isLinha
    ? "border-l-[3px] border-white/10 bg-[#15191f]"
    : p.transmissao.state === "BLOQUEADA"
    ? "border-l-[3px] border-white/10"
    : p.transmissao.state === "OK"
    ? "border-l-[3px] border-white/10"
    : "border-l-[3px] border-transparent"

  const transDot =
    p.transmissao.state === "OK" ? "bg-[#4ade80]"
    : p.transmissao.state === "BLOQUEADA" ? "bg-[#f87171]"
    : "bg-white/25"
  const transColor =
    p.transmissao.state === "OK" ? "text-[#4ade80]"
    : p.transmissao.state === "BLOQUEADA" ? "text-[#f87171]"
    : "text-white/40"

  const pctVal = p.total > 0 ? Math.round((p.validados / p.total) * 100) : 0

  // Delegação em nível de pessoa: aplica a TODAS as necessidades dos documentos.
  const necIds = p.docs.map((d) => d.necessidadeId).filter((v): v is number => v != null)
  const respIds = new Set(p.docs.map((d) => d.responsavelId ?? null))
  const commonResp = respIds.size === 1 ? [...respIds][0] : null

  return (
    <>
      <div
        className={`grid items-center gap-2.5 px-5 py-3 border-b border-white/10 hover:bg-[#20262e] transition-colors ${borderCls}`}
        style={{ gridTemplateColumns: "52px minmax(160px,1.6fr) 1fr 1.2fr 1fr 0.7fr 1.2fr 124px" }}
      >
        {/* G */}
        <div className="text-center text-[11px] font-extrabold text-white/55 bg-[#1b2027] border border-white/10 rounded-lg py-1.5 leading-tight">
          {p.geracao === "Atual" ? (
            <>
              <span className="text-[13px]">{p.iniciais}</span>
              <small className="block text-[8.5px] font-bold text-white/40">Atual</small>
            </>
          ) : (
            p.geracao
          )}
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
            {p.pendencia && (
              <span className="text-[11px] text-[#d2a948] font-semibold flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3 h-3 flex-none" />
                {p.pendencia}
              </span>
            )}
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

        {/* Documentos (resumo + barra) */}
        <div>
          {p.docsResumo.length === 0 ? (
            <span className="text-[11.5px] text-white/40">—</span>
          ) : (
            p.docsResumo.map((d, i) => (
              <div key={i} className="grid gap-2 text-[11.5px] leading-relaxed" style={{ gridTemplateColumns: "34px auto" }}>
                <span className="text-white/55 font-bold">{d.abbr}</span>
                <span className={`flex items-center gap-1.5 font-semibold ${docCls(d.statusCls)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-none ${docDot(d.statusCls)}`} />
                  {d.statusLabel.toLowerCase()}
                </span>
              </div>
            ))
          )}
          {!ocultarValidacao && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[11px] font-bold text-white/55">{p.validados} / {p.total}</span>
              <div className="w-24 h-1 rounded bg-[#252c35] overflow-hidden">
                <div className="h-full bg-[#7dd3fc]" style={{ width: `${pctVal}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Responsável */}
        <div className="text-[12px]">
          {p.responsavel ? (
            <div className="flex items-center gap-1.5 font-bold text-white/85">
              <span className="w-1.5 h-1.5 rounded-full bg-white/25 flex-none" />
              {p.responsavel}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-white/60 font-semibold">
              <UserRound className="w-3.5 h-3.5 flex-none" />
              Sem responsável
            </div>
          )}
          {!readOnly && onDelegar && usuarios && usuarios.length > 0 && necIds.length > 0 && (
            <select
              value={commonResp ?? ""}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null
                necIds.forEach((nid) => onDelegar(nid, v))
              }}
              onClick={(e) => e.stopPropagation()}
              className={`mt-1 text-[12px] rounded-md border px-1.5 py-1 bg-[#1b2027] max-w-[150px] focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25 ${commonResp ? "text-white/80 border-white/10" : "text-white/40 border-dashed border-white/15"}`}
              title="Delegar responsável"
            >
              <option value="">Delegar…</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.publicCode ? u.publicCode + ' — ' : ''}{u.nome}</option>
              ))}
            </select>
          )}
        </div>

        {/* Prazo — vazio para a linha da pessoa */}
        <div />

        {/* Próxima ação — ação + subtítulo */}
        <div>
          {p.proximaAcao?.txt ? (
            <>
              <div className="flex items-center gap-1.5">
                {p.proximaAcao.cls === "crit" && <Ban className="text-[#f87171] w-3.5 h-3.5 flex-none" />}
                <span className="text-white/90 font-semibold text-[13px]">{p.proximaAcao.txt}</span>
              </div>
              <div className="text-[11px] text-white/40 mt-0.5">{p.proximaAcao.sub || "Aguardando solicitação"}</div>
            </>
          ) : (
            <span className="text-white/40">—</span>
          )}
        </div>

        {/* Ação */}
        {/* "Abrir" NUNCA é botão morto: abre o painel operacional da pessoa mesmo sem
            documento/necessidade — lá dentro o estado vazio explica o porquê. Antes
            `p.docs.length && setExp(true)` deixava o botão inerte justamente no caso
            em que o operador mais precisa de resposta. */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => setExp(!exp)}
            className="inline-flex items-center gap-1.5 bg-[#12161c] text-white text-[12.5px] font-bold px-3.5 py-2 rounded-lg hover:bg-[#20262e] transition-colors"
          >
            {exp ? "Fechar" : "Abrir"}
            {exp ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Painel operacional da pessoa — necessidades/documentos dela. Vazio explicado. */}
      {exp && p.docs.length === 0 && (
        <div className="border-t border-white/10 px-5 py-4 bg-[#15191f]">
          <div className="text-[12.5px] text-white/68">Nenhuma necessidade documental para {p.nome} nesta fase.</div>
          <div className="text-[11.5px] text-white/40 mt-1 leading-relaxed">
            As necessidades desta pessoa são materializadas a partir das Regras Documentais
            publicadas que se aplicam a ela. Enquanto nenhuma se aplicar, não há documento
            a localizar — e isso não impede o cadastro nem a classificação dela.
          </div>
        </div>
      )}

      {/* Linhas expandidas (documentos) */}
      {exp &&
        p.docs.map((d) => {
        const ops = d.necessidadeId != null ? (operacoesPorNec?.get(d.necessidadeId) ?? []) : []
        return (
          <div key={d.id}>
          <div
            className="grid items-center gap-2.5 border-t border-white/10 py-3 px-5"
            style={{ gridTemplateColumns: "52px minmax(160px,1.6fr) 1fr 1.2fr 1fr 0.7fr 1.2fr 124px" }}
          >
            {/* (1) G — vazio */}
            <div />

            {/* (2) Pessoa — nome do doc (indenta sob Pessoa) */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#1b2027] border border-white/10 grid place-items-center text-white/55 flex-none">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <b className="text-[13px] font-bold block leading-tight">{d.tipoLabel}</b>
                <span className="text-[11px] text-white/40">{d.subtitulo || "Inteiro teor"}</span>
              </div>
            </div>

            {/* (3) Transmissão — vazio */}
            <div />

            {/* (4) Documentos — vazio */}
            <div />

            {/* (5) Responsável — "Sem responsável" + seletor de delegação */}
            <div className="text-[12px]">
              {d.responsavel ? (
                <div className="flex items-center gap-1.5 font-semibold text-white/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/25 flex-none" />
                  {d.responsavel}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-white/60 font-semibold">
                  <UserRound className="w-3.5 h-3.5 flex-none" />
                  Sem responsável
                </div>
              )}
              {onDelegar && usuarios && usuarios.length > 0 && d.necessidadeId != null ? (
                <select
                  value={d.responsavelId ?? ""}
                  onChange={(e) => onDelegar(d.necessidadeId as number, e.target.value ? Number(e.target.value) : null)}
                  onClick={(e) => e.stopPropagation()}
                  className={`mt-1 text-[12px] rounded-md border px-1.5 py-1 bg-[#1b2027] max-w-[150px] focus:outline-none focus:border-[#7dd3fc]/50 focus:ring-1 focus:ring-[#7dd3fc]/25 ${d.responsavelId ? "text-white/80 border-white/10" : "text-white/40 border-dashed border-white/15"}`}
                  title="Delegar responsável"
                >
                  <option value="">Delegar…</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.publicCode ? u.publicCode + ' — ' : ''}{u.nome}</option>
                  ))}
                </select>
              ) : null}
            </div>

            {/* (6) Prazo — SLA + rótulo */}
            <div>
              {d.sla ? (
                <>
                  <div className="flex items-center gap-1.5 text-[12px] text-white/80">
                    <CalendarDays className="w-3.5 h-3.5 text-white/40 flex-none" />
                    {d.sla}
                  </div>
                  <div className="text-[11px] text-white/40 mt-0.5">Prazo</div>
                </>
              ) : (
                <span className="text-[12px] text-white/40">—</span>
              )}
            </div>

            {/* (7) Próxima ação — botão "+ Operação antecipada" */}
            <div>
              {!readOnly && onNovaOperacao && d.necessidadeId != null && !d.emissaoConcluida && (
                <button
                  onClick={() => onNovaOperacao(d.necessidadeId as number, p.pessoaId ?? null, `${d.tipoLabel}${d.subtitulo ? " · " + d.subtitulo : ""} — ${p.nome}`)}
                  title="Nova operação antecipada"
                  className="text-[11px] font-semibold text-white/55 hover:text-[#7dd3fc] underline decoration-dotted underline-offset-2"
                >
                  + Operação antecipada
                </button>
              )}
            </div>

            {/* (8) Ação — botão abrir/ver/somente leitura */}
            <div className="flex justify-end items-center gap-2">
              {readOnly || !onAbrirOperacao ? (
                <span className="text-[11px] font-semibold text-white/40 px-3 py-2">Somente leitura</span>
              ) : (
                <button
                  onClick={() => onAbrirOperacao(d.id, d.necessidadeId)}
                  className={`text-[12px] font-bold px-3 py-2 rounded-lg transition-colors ${
                    d.emissaoConcluida
                      ? "border border-white/10 text-white/80 bg-[#1b2027] hover:bg-[#20262e]"
                      : "bg-[#252c35] text-white/95 border border-white/10 hover:bg-[#2d353f]"
                  }`}
                >
                  {d.emissaoConcluida ? "Ver workflow" : "Abrir operação"}
                </button>
              )}
            </div>
          </div>
          {ops.length > 0 && (
            <OperacoesAntecipadasInline ops={ops} readOnly={readOnly} onAvaliar={onAvaliarOperacao} onAbrir={onAbrirOperacaoAntecipada} />
          )}
          </div>
        )})}
    </>
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

// OPERAÇÕES ANTECIPADAS de UMA necessidade — linha COMPACTA (objetivo · operação vinculada ·
// status da operação oficial · Abrir operação). NUNCA mostra o workflow inteiro aqui.
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

