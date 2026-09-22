"use client"

// src/components/gerenciamentoComponents/PrazosSlaTab.tsx
// PROCESSOS → CONFIGURAÇÕES → PRAZOS E SLA.
// Cadastro PRÓPRIO de políticas de prazo/SLA/acompanhamento — não confundir com
// `sla` (Processos › Configurações › SLA), que é só leitura sobre a configuração
// de cada processo e continua intocada. Esta tela consome exclusivamente as
// rotas já prontas em /api/gerenciamento/politicas-prazo-sla e
// /api/gerenciamento/calendarios-oficiais — nenhuma rota nova foi criada aqui.
//
// Ciclo de vida (mandato "Prazos, SLA e Políticas de Acompanhamento"): a
// política nasce RASCUNHO (só nome/descrição); os PARÂMETROS de cálculo só
// existem congelados dentro de uma `PoliticaPrazoSlaVersao` — não há rota de
// "salvar rascunho de parâmetros". Por isso o editor mantém os parâmetros em
// estado local (pré-carregado da última versão publicada, ou de um padrão
// razoável quando a política nunca foi publicada) até o admin publicar — a
// PUBLICAÇÃO é o único ato que persiste os parâmetros, sempre com a estratégia
// de retroação escolhida explicitamente e a prévia de impacto já vista.

import { useCallback, useMemo, useState } from "react"
import { useApi, useConsulta, enviar, ErroApi } from "@/src/lib/dados"
import { jsonHeaders } from "@/src/lib/financeiro/http"
import { useDebounce } from "@/src/hooks/use-debounce"

// ============================================================================
// TIPOS — espelham o contrato das rotas prontas (services/prazo-sla), nunca
// nome de coluna cru na tela.
// ============================================================================
type StatusPolitica = "RASCUNHO" | "PUBLICADA" | "INATIVA"
type UnidadePrazo = "DIAS_CORRIDOS" | "DIAS_UTEIS"
type TratamentoDia = "PULA" | "CONTA"
type PoliticaDataNaoUtil = "PROXIMO_DIA_UTIL" | "DIA_UTIL_ANTERIOR"
type EstrategiaRetroacao =
  | "SOMENTE_NOVAS"
  | "RECALCULAR_DA_ORIGEM"
  | "APLICAR_DA_PUBLICACAO"
  | "MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO"

interface ParametrosPolitica {
  prazoQuantidade: number
  prazoUnidade: UnidadePrazo
  prazoEventoInicialChave: string
  calendarioChave: string | null
  tratamentoFimDeSemana: TratamentoDia
  tratamentoFeriado: TratamentoDia
  horarioLimite: string | null
  politicaDataNaoUtil: PoliticaDataNaoUtil
  riscoAntecedenciaDias: number
  escalonamentoAtivo: boolean
  escalonamentoPapel: string | null
  escalonamentoDestinatarioId: number | null
  lembreteAtrasoRecorrenciaDias: number | null
  acompanhamentoPrimeiroDias: number
  acompanhamentoPadraoDias: number
  acompanhamentoUnidade: UnidadePrazo
  acompanhamentoPermiteManual: boolean
  acompanhamentoExigeMotivo: boolean
  acompanhamentoLimiteSemResposta: number | null
  acompanhamentoEscalonamentoPapel: string | null
  esperaTerceiroPadraoAtivo: boolean
}

interface VersaoPolitica extends ParametrosPolitica {
  id: number
  versao: number
  estrategiaRetroacao: EstrategiaRetroacao
  motivoAlteracao: string | null
  publicadoEm: string
  publicadoPorId: number | null
}

interface Politica {
  id: number
  chave: string
  nome: string
  descricao: string | null
  status: StatusPolitica
  versaoAtual: number
  ativo: boolean
  versoes: VersaoPolitica[]
  _count: { tarefas: number }
}

interface Calendario {
  id: number
  chave: string
  nome: string
  descricao: string | null
  ativo: boolean
  _count: { feriados: number }
}

interface Feriado {
  id: number
  data: string
  nome: string
  recorrenteAnual: boolean
  ativo: boolean
}

interface ErroValidacao { campo: string; codigo: string; mensagem: string }

interface PreviaCalculo {
  valido: boolean
  erros?: ErroValidacao[]
  dataInicial?: string
  prazoResultante?: string
  primeiroAcompanhamento?: string
  classificacaoRisco?: string
  calendarioAplicado?: string
  feriadosConsiderados?: string[]
  diaInicialEhUtil?: boolean
}

interface PreviaImpacto {
  estrategia: string
  tarefasEmAndamentoVinculadas: number
  tarefasQueSeraoRetroagidas: number
  amostra: { id: number; titulo: string; processoId: number; dataPrazo: string | null; proximoAcompanhamentoEm: string | null }[]
}

// ============================================================================
// ESTILO — mesma paleta/classes de ModalidadesTab.tsx e TipoProcessoTab.tsx.
// ============================================================================
const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"
const opt = "bg-zinc-900"
const cardCls = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm"
const sectionTitleCls = "text-sm font-semibold text-white"
const checkboxCls = "h-4 w-4 accent-blue-500"
const btnPrimary = "rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:cursor-not-allowed disabled:opacity-50"
const btnSecondary = "rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-[var(--surface-hover)] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
const btnGhost = "rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
const btnDanger = "rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)] hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"

const STATUS_BADGE: Record<StatusPolitica, string> = {
  RASCUNHO: "bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
  PUBLICADA: "bg-[var(--surface-secondary)] text-green-800",
  INATIVA: "bg-[var(--surface-primary)] text-[var(--text-muted)]",
}
const STATUS_LABEL: Record<StatusPolitica, string> = { RASCUNHO: "Rascunho", PUBLICADA: "Publicada", INATIVA: "Inativa" }

const ESTRATEGIAS: { valor: EstrategiaRetroacao; titulo: string; explicacao: string }[] = [
  { valor: "SOMENTE_NOVAS", titulo: "Aplicar somente a tarefas novas", explicacao: "As tarefas que já estão em andamento continuam com a regra anterior. A nova regra só vale para tarefas criadas a partir de agora." },
  { valor: "RECALCULAR_DA_ORIGEM", titulo: "Recalcular do zero as tarefas em andamento", explicacao: "As tarefas em andamento vinculadas a esta política têm seu prazo e acompanhamento recalculados desde a origem, como se a nova regra já valesse desde o início." },
  { valor: "APLICAR_DA_PUBLICACAO", titulo: "Aplicar a partir de hoje", explicacao: "As tarefas em andamento passam a seguir a nova regra a partir de agora, sem alterar o que já se passou até a publicação." },
  { valor: "MANTER_PRAZO_ATUALIZAR_ACOMPANHAMENTO", titulo: "Manter o prazo, só atualizar o acompanhamento", explicacao: "O prazo já calculado das tarefas em andamento é preservado; só a régua de acompanhamento (próximos lembretes) passa a seguir a nova regra." },
]

const PARAMETROS_PADRAO: ParametrosPolitica = {
  prazoQuantidade: 5,
  prazoUnidade: "DIAS_UTEIS",
  prazoEventoInicialChave: "tarefa_criada",
  calendarioChave: null,
  tratamentoFimDeSemana: "PULA",
  tratamentoFeriado: "PULA",
  horarioLimite: null,
  politicaDataNaoUtil: "PROXIMO_DIA_UTIL",
  riscoAntecedenciaDias: 2,
  escalonamentoAtivo: false,
  escalonamentoPapel: null,
  escalonamentoDestinatarioId: null,
  lembreteAtrasoRecorrenciaDias: null,
  acompanhamentoPrimeiroDias: 3,
  acompanhamentoPadraoDias: 5,
  acompanhamentoUnidade: "DIAS_UTEIS",
  acompanhamentoPermiteManual: true,
  acompanhamentoExigeMotivo: true,
  acompanhamentoLimiteSemResposta: null,
  acompanhamentoEscalonamentoPapel: null,
  esperaTerceiroPadraoAtivo: false,
}

function parametrosDaVersao(v: VersaoPolitica): ParametrosPolitica {
  return {
    prazoQuantidade: v.prazoQuantidade, prazoUnidade: v.prazoUnidade, prazoEventoInicialChave: v.prazoEventoInicialChave,
    calendarioChave: v.calendarioChave, tratamentoFimDeSemana: v.tratamentoFimDeSemana, tratamentoFeriado: v.tratamentoFeriado,
    horarioLimite: v.horarioLimite, politicaDataNaoUtil: v.politicaDataNaoUtil, riscoAntecedenciaDias: v.riscoAntecedenciaDias,
    escalonamentoAtivo: v.escalonamentoAtivo, escalonamentoPapel: v.escalonamentoPapel, escalonamentoDestinatarioId: v.escalonamentoDestinatarioId,
    lembreteAtrasoRecorrenciaDias: v.lembreteAtrasoRecorrenciaDias, acompanhamentoPrimeiroDias: v.acompanhamentoPrimeiroDias,
    acompanhamentoPadraoDias: v.acompanhamentoPadraoDias, acompanhamentoUnidade: v.acompanhamentoUnidade,
    acompanhamentoPermiteManual: v.acompanhamentoPermiteManual, acompanhamentoExigeMotivo: v.acompanhamentoExigeMotivo,
    acompanhamentoLimiteSemResposta: v.acompanhamentoLimiteSemResposta, acompanhamentoEscalonamentoPapel: v.acompanhamentoEscalonamentoPapel,
    esperaTerceiroPadraoAtivo: v.esperaTerceiroPadraoAtivo,
  }
}

function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
const ESTRATEGIA_LABEL: Record<string, string> = Object.fromEntries(ESTRATEGIAS.map((e) => [e.valor, e.titulo]))

// número do input: string vazia vira `null` (campo opcional) em vez de NaN.
function numOuNulo(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ============================================================================
// PRÉVIA DE CÁLCULO — leitura por POST. Não usa `enviar` (que lança em 422),
// porque aqui 422 é resposta de negócio normal ("parâmetros inválidos ainda"),
// não falha de rede — a tela precisa do corpo de qualquer um dos dois status.
// ============================================================================
async function chamarPreviaCalculo(politicaId: number, parametros: ParametrosPolitica, dataInicial: string): Promise<PreviaCalculo> {
  const res = await fetch(`/api/gerenciamento/politicas-prazo-sla/${politicaId}/previa-calculo`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ parametros, dataInicial: dataInicial || undefined }),
  })
  const corpo = await res.json().catch(() => ({}))
  return corpo as PreviaCalculo
}

export default function PrazosSlaTab() {
  const [aba, setAba] = useState<"politicas" | "calendarios">("politicas")

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-white">Prazos e SLA</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Políticas de prazo, indicadores de risco e régua de acompanhamento — cadastro próprio, independente da tela
          "SLA" (que só exibe a configuração vigente de cada processo).
        </p>
      </div>

      <div className="flex gap-2 border-b border-[var(--border-default)]">
        {(["politicas", "calendarios"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${aba === k ? "border-[var(--action-primary)] text-white" : "border-transparent text-[var(--text-secondary)] hover:text-white"}`}
          >
            {k === "politicas" ? "Políticas de Prazo/SLA" : "Calendários Oficiais"}
          </button>
        ))}
      </div>

      {aba === "politicas" ? <PoliticasTab /> : <CalendariosTab />}
    </div>
  )
}

// ============================================================================
// ABA 1 — POLÍTICAS
// ============================================================================
function PoliticasTab() {
  const [busca, setBusca] = useState("")
  const [status, setStatus] = useState<"" | StatusPolitica>("")
  const buscaDeb = useDebounce(busca, 400)

  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [historicoId, setHistoricoId] = useState<number | null>(null)
  const [criando, setCriando] = useState(false)

  const [flash, setFlash] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 4000) }

  const qs = new URLSearchParams()
  if (buscaDeb.trim()) qs.set("busca", buscaDeb.trim())
  if (status) qs.set("status", status)
  const lista = useApi<{ politicas?: Politica[] }>(`/api/gerenciamento/politicas-prazo-sla?${qs.toString()}`)
  const politicas = lista.dados?.politicas ?? []
  const loading = lista.carregando
  const recarregar = lista.recarregar

  const [busyLinha, setBusyLinha] = useState<number | null>(null)

  async function alternarAtivo(p: Politica) {
    if (busyLinha) return
    setBusyLinha(p.id); setErro(null)
    try {
      await enviar(`/api/gerenciamento/politicas-prazo-sla/${p.id}`, { metodo: "PUT", corpo: { ativo: !p.ativo } })
      showFlash(p.ativo ? "Política inativada." : "Política reativada.")
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar a política.")
    } finally { setBusyLinha(null) }
  }

  async function excluir(p: Politica) {
    if (busyLinha) return
    if ((p._count?.tarefas ?? 0) > 0) return
    if (!confirm(`Excluir a política "${p.nome}"? Esta ação não pode ser desfeita.`)) return
    setBusyLinha(p.id); setErro(null)
    try {
      await enviar(`/api/gerenciamento/politicas-prazo-sla/${p.id}`, { metodo: "DELETE" })
      showFlash("Política excluída.")
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir a política.")
    } finally { setBusyLinha(null) }
  }

  if (editandoId !== null) {
    return (
      <PoliticaEditor
        politicaId={editandoId}
        onVoltar={() => { setEditandoId(null); void recarregar() }}
        onPublicado={(msg) => { showFlash(msg); void recarregar() }}
      />
    )
  }

  return (
    <div className="space-y-4">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-800">{flash}</div>}
      {(erro || lista.erro) && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">
          {erro ?? lista.erro?.message}
          <button onClick={() => { setErro(null); void recarregar() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou chave..."
              aria-label="Buscar política de prazo/SLA"
              className={`${inputCls} max-w-xs`}
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | StatusPolitica)}
              aria-label="Filtrar por status"
              className={`${inputCls} max-w-[180px]`}
            >
              <option value="" className={opt}>Todos os status</option>
              <option value="RASCUNHO" className={opt}>Rascunho</option>
              <option value="PUBLICADA" className={opt}>Publicada</option>
              <option value="INATIVA" className={opt}>Inativa</option>
            </select>
          </div>
          <button onClick={() => setCriando(true)} className={btnPrimary}>+ Nova política</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Política</th>
              <th className="px-4 py-3 font-medium">Chave</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Versão atual</th>
              <th className="px-4 py-3 font-medium">Tarefas vinculadas</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Carregando…</td></tr>
            ) : politicas.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Nenhuma política cadastrada ainda. Crie em "+ Nova política".</td></tr>
            ) : politicas.map((p) => (
              <tr key={p.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-white">{p.nome}</div>
                  {!p.ativo && <div className="text-[11px] text-[var(--text-muted)]">inativa</div>}
                </td>
                <td className="px-4 py-2.5"><code className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[11px] text-white/70">{p.chave}</code></td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_BADGE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.versaoAtual > 0 ? `v${p.versaoAtual}` : "— (nunca publicada)"}</td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p._count?.tarefas ?? 0}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setEditandoId(p.id)} className={btnGhost}>Editar</button>
                    <button onClick={() => setHistoricoId(p.id)} className={btnGhost}>Histórico</button>
                    <button
                      onClick={() => alternarAtivo(p)}
                      disabled={busyLinha === p.id}
                      className={btnGhost}
                      title={p.ativo ? "Inativar (para de valer para tarefas novas, sem apagar)" : "Reativar"}
                    >
                      {p.ativo ? "Inativar" : "Reativar"}
                    </button>
                    <button
                      onClick={() => excluir(p)}
                      disabled={busyLinha === p.id || (p._count?.tarefas ?? 0) > 0}
                      title={(p._count?.tarefas ?? 0) > 0 ? `Em uso por ${p._count.tarefas} tarefa(s) — inative em vez de excluir` : "Excluir"}
                      className={btnDanger}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {criando && (
        <NovaPoliticaModal
          onFechar={() => setCriando(false)}
          onCriada={async (id) => { setCriando(false); showFlash("Política criada como rascunho."); await recarregar(); setEditandoId(id) }}
        />
      )}

      {historicoId !== null && (
        <HistoricoPoliticaModal politicaId={historicoId} onFechar={() => setHistoricoId(null)} />
      )}
    </div>
  )
}

function NovaPoliticaModal({ onFechar, onCriada }: { onFechar: () => void; onCriada: (id: number) => void }) {
  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (salvando) return
    if (!nome.trim()) { setErro("Informe o nome da política."); return }
    setSalvando(true); setErro(null)
    try {
      const d = await enviar<{ politica: Politica }>("/api/gerenciamento/politicas-prazo-sla", {
        metodo: "POST",
        corpo: { nome: nome.trim(), descricao: descricao.trim() || undefined },
      })
      onCriada(d.politica.id)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar a política.")
    } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Nova política de prazo/SLA</h3>
          <button onClick={onFechar} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
        </div>
        <div className="space-y-4 px-6 py-4">
          <p className="text-xs text-[var(--text-secondary)]">
            A política nasce como rascunho. Depois de criada, configure os parâmetros de prazo e publique para que ela
            passe a valer.
          </p>
          <div>
            <label htmlFor="psla-nome" className={labelCls}>Nome *</label>
            <input id="psla-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Prazo padrão — Emissão Documental" className={inputCls} />
          </div>
          <div>
            <label htmlFor="psla-desc" className={labelCls}>Descrição</label>
            <textarea id="psla-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Quando esta política deve ser usada." className={inputCls} />
          </div>
          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erro}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
          <button onClick={onFechar} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className={btnPrimary}>{salvando ? "Criando…" : "Criar rascunho"}</button>
        </div>
      </div>
    </div>
  )
}

function HistoricoPoliticaModal({ politicaId, onFechar }: { politicaId: number; onFechar: () => void }) {
  const detalhe = useApi<{ politica?: Politica }>(`/api/gerenciamento/politicas-prazo-sla/${politicaId}`)
  const politica = detalhe.dados?.politica
  const versoes = politica?.versoes ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Histórico de versões {politica ? `— ${politica.nome}` : ""}</h3>
          <button onClick={onFechar} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
        </div>
        <div className="space-y-3 px-6 py-4">
          {detalhe.carregando && <div className="py-8 text-center text-sm text-[var(--text-muted)]">Carregando…</div>}
          {!detalhe.carregando && versoes.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--text-muted)]">Esta política ainda não foi publicada — nenhuma versão congelada.</div>
          )}
          {!detalhe.carregando && versoes.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[var(--surface-primary)]">
                    <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Versão</th>
                    <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Publicada em</th>
                    <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Publicada por</th>
                    <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Estratégia de retroação</th>
                    <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {versoes.map((v) => (
                    <tr key={v.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-3 py-2 font-medium text-white">v{v.versao}</td>
                      <td className="px-3 py-2 text-white/70">{fmtDataHora(v.publicadoEm)}</td>
                      <td className="px-3 py-2 text-white/70">{v.publicadoPorId ? `Usuário #${v.publicadoPorId}` : "—"}</td>
                      <td className="px-3 py-2 text-white/70">{ESTRATEGIA_LABEL[v.estrategiaRetroacao] ?? v.estrategiaRetroacao}</td>
                      <td className="px-3 py-2 text-white/70">{v.motivoAlteracao || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// EDITOR DE PARÂMETROS + PRÉVIA AO VIVO + PUBLICAÇÃO
// ============================================================================
function PoliticaEditor({ politicaId, onVoltar, onPublicado }: { politicaId: number; onVoltar: () => void; onPublicado: (msg: string) => void }) {
  const detalhe = useApi<{ politica?: Politica }>(`/api/gerenciamento/politicas-prazo-sla/${politicaId}`)
  const politica = detalhe.dados?.politica

  // Dados de identificação (nome/descrição) — PUT independente, nunca mexe em
  // parâmetros/versão. Espelha o registro só depois de carregado.
  const [nome, setNome] = useState<string | null>(null)
  const [descricao, setDescricao] = useState<string | null>(null)
  const [salvandoDados, setSalvandoDados] = useState(false)
  const [erroDados, setErroDados] = useState<string | null>(null)
  const [flashDados, setFlashDados] = useState("")

  // Parâmetros — estado local, pré-carregado da última versão publicada (se
  // houver) ou do padrão. `iniciado` evita reescrever o form a cada revalidação.
  const [params, setParams] = useState<ParametrosPolitica | null>(null)
  const [iniciado, setIniciado] = useState(false)
  if (politica && !iniciado) {
    setNome(politica.nome)
    setDescricao(politica.descricao ?? "")
    setParams(politica.versoes[0] ? parametrosDaVersao(politica.versoes[0]) : { ...PARAMETROS_PADRAO })
    setIniciado(true)
  }

  const [dataInicialSimulada, setDataInicialSimulada] = useState("")
  const [publicarAberto, setPublicarAberto] = useState(false)

  const set = useCallback(<K extends keyof ParametrosPolitica>(campo: K, valor: ParametrosPolitica[K]) => {
    setParams((prev) => (prev ? { ...prev, [campo]: valor } : prev))
  }, [])

  const paramsJson = params ? JSON.stringify(params) : ""
  const paramsDeb = useDebounce(paramsJson, 600)
  const dataInicialDeb = useDebounce(dataInicialSimulada, 600)

  const previaReq = useConsulta<PreviaCalculo | null>(
    params && paramsDeb ? `previa-calculo:${politicaId}:${paramsDeb}:${dataInicialDeb}` : null,
    async () => {
      if (!params) return null
      const parsed = JSON.parse(paramsDeb) as ParametrosPolitica
      return chamarPreviaCalculo(politicaId, parsed, dataInicialDeb)
    },
  )
  const previa = previaReq.dados ?? null
  const errosPorCampo = useMemo(() => {
    const m: Record<string, string> = {}
    for (const e of previa?.erros ?? []) m[e.campo] = e.mensagem
    return m
  }, [previa])

  const calendariosReq = useApi<{ calendarios?: Calendario[] }>("/api/gerenciamento/calendarios-oficiais")
  const calendarios = calendariosReq.dados?.calendarios ?? []

  async function salvarDados() {
    if (salvandoDados || nome === null) return
    if (!nome.trim()) { setErroDados("Informe o nome."); return }
    setSalvandoDados(true); setErroDados(null)
    try {
      await enviar(`/api/gerenciamento/politicas-prazo-sla/${politicaId}`, {
        metodo: "PUT",
        corpo: { nome: nome.trim(), descricao: (descricao ?? "").trim() || null },
      })
      setFlashDados("Dados salvos.")
      setTimeout(() => setFlashDados(""), 3000)
      await detalhe.recarregar()
    } catch (e) {
      setErroDados(e instanceof Error ? e.message : "Não foi possível salvar.")
    } finally { setSalvandoDados(false) }
  }

  if (detalhe.carregando || !politica || !params || nome === null) {
    return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onVoltar} className={btnSecondary}>← Voltar</button>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">{politica.nome}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_BADGE[politica.status]}`}>{STATUS_LABEL[politica.status]}</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {politica.versaoAtual > 0 ? `Versão publicada atual: v${politica.versaoAtual}` : "Nunca publicada — configure os parâmetros e publique."}
            </p>
          </div>
        </div>
        <button onClick={() => setPublicarAberto(true)} className={btnPrimary}>Publicar…</button>
      </div>

      {detalhe.erro && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">{detalhe.erro.message}</div>
      )}

      {/* IDENTIFICAÇÃO — PUT independente de parâmetros/versão */}
      <div className={cardCls}>
        <h4 className={sectionTitleCls}>Identificação</h4>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ed-nome" className={labelCls}>Nome *</label>
            <input id="ed-nome" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ed-desc" className={labelCls}>Descrição</label>
            <input id="ed-desc" value={descricao ?? ""} onChange={(e) => setDescricao(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={salvarDados} disabled={salvandoDados} className={btnSecondary}>{salvandoDados ? "Salvando…" : "Salvar dados"}</button>
          {flashDados && <span className="text-xs text-green-800">{flashDados}</span>}
          {erroDados && <span className="text-xs text-red-700">{erroDados}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* FORMULÁRIO DE PARÂMETROS */}
        <div className="space-y-5">
          <SecaoPrazoGeral params={params} set={set} erros={errosPorCampo} calendarios={calendarios} />
          <SecaoRisco params={params} set={set} erros={errosPorCampo} />
          <SecaoAcompanhamento params={params} set={set} erros={errosPorCampo} />
          <SecaoEsperaTerceiro params={params} set={set} />
        </div>

        {/* PRÉVIA AO VIVO */}
        <div className="space-y-3">
          <div className={`${cardCls} lg:sticky lg:top-4`}>
            <h4 className={sectionTitleCls}>Prévia ao vivo</h4>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Simula o cálculo com os parâmetros acima, sem publicar nada.</p>
            <div className="mt-3">
              <label htmlFor="ed-data-sim" className={labelCls}>Data inicial simulada</label>
              <input id="ed-data-sim" type="date" value={dataInicialSimulada} onChange={(e) => setDataInicialSimulada(e.target.value)} className={inputCls} />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Em branco = agora.</p>
            </div>

            <div className="mt-4 space-y-2 border-t border-[var(--border-default)] pt-4 text-sm">
              {previaReq.carregando && <p className="text-xs text-[var(--text-muted)]">Calculando…</p>}
              {!previaReq.carregando && previa && !previa.valido && (
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-xs text-red-700">
                  Parâmetros incompletos — corrija os campos destacados abaixo.
                </div>
              )}
              {!previaReq.carregando && previa?.valido && (
                <>
                  <LinhaPrevia label="Prazo resultante" valor={fmtDataHora(previa.prazoResultante)} />
                  <LinhaPrevia label="Primeiro acompanhamento" valor={fmtDataHora(previa.primeiroAcompanhamento)} />
                  <LinhaPrevia label="Classificação de risco" valor={previa.classificacaoRisco ?? "—"} />
                  <LinhaPrevia label="Calendário aplicado" valor={previa.calendarioAplicado ?? "—"} />
                  <LinhaPrevia label="Dia inicial é útil?" valor={previa.diaInicialEhUtil ? "Sim" : "Não"} />
                  <div>
                    <span className="text-xs text-[var(--text-secondary)]">Feriados considerados:</span>
                    {previa.feriadosConsiderados && previa.feriadosConsiderados.length > 0 ? (
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {previa.feriadosConsiderados.map((f) => (
                          <li key={f} className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[11px] text-white/70">{fmtData(f)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-white/70">nenhum no período</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {publicarAberto && (
        <PublicarModal
          politicaId={politicaId}
          politica={politica}
          params={params}
          onFechar={() => setPublicarAberto(false)}
          onPublicado={(reconciliadas) => {
            setPublicarAberto(false)
            onPublicado(reconciliadas > 0 ? `Política publicada — ${reconciliadas} tarefa(s) em andamento reconciliada(s).` : "Política publicada.")
          }}
          onErroValidacao={(erros) => {
            // erros de campo (422) aparecem junto ao campo correspondente no formulário —
            // a prévia ao vivo (mesma validação) já os traduz visualmente ao recalcular.
            void erros
          }}
        />
      )}
    </div>
  )
}

function LinhaPrevia({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-right text-sm text-white">{valor}</span>
    </div>
  )
}

function CampoErro({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null
  return <p className="mt-1 text-[11px] text-red-700">{mensagem}</p>
}

type SetCampo = <K extends keyof ParametrosPolitica>(campo: K, valor: ParametrosPolitica[K]) => void

function SecaoPrazoGeral({ params, set, erros, calendarios }: { params: ParametrosPolitica; set: SetCampo; erros: Record<string, string>; calendarios: Calendario[] }) {
  return (
    <div className={cardCls}>
      <h4 className={sectionTitleCls}>Prazo geral</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Como o prazo principal da tarefa é contado, a partir de que evento e sobre qual calendário.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="pg-qtd" className={labelCls}>Quantidade de dias *</label>
          <input id="pg-qtd" type="number" min={1} value={params.prazoQuantidade} onChange={(e) => set("prazoQuantidade", Number(e.target.value))} className={inputCls} />
          <CampoErro mensagem={erros.prazoQuantidade} />
        </div>
        <div>
          <label htmlFor="pg-unid" className={labelCls}>Unidade de contagem *</label>
          <select id="pg-unid" value={params.prazoUnidade} onChange={(e) => set("prazoUnidade", e.target.value as UnidadePrazo)} className={inputCls}>
            <option value="DIAS_UTEIS" className={opt}>Dias úteis</option>
            <option value="DIAS_CORRIDOS" className={opt}>Dias corridos</option>
          </select>
          <CampoErro mensagem={erros.prazoUnidade} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pg-evento" className={labelCls}>Evento que inicia a contagem *</label>
          <input id="pg-evento" value={params.prazoEventoInicialChave} onChange={(e) => set("prazoEventoInicialChave", e.target.value)} placeholder="ex.: tarefa_criada" className={inputCls} />
          <CampoErro mensagem={erros.prazoEventoInicialChave} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pg-cal" className={labelCls}>Calendário de feriados aplicado</label>
          <select id="pg-cal" value={params.calendarioChave ?? ""} onChange={(e) => set("calendarioChave", e.target.value || null)} className={inputCls}>
            <option value="" className={opt}>Nacional (padrão)</option>
            {calendarios.map((c) => <option key={c.chave} value={c.chave} className={opt}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pg-fds" className={labelCls}>Fim de semana</label>
          <select id="pg-fds" value={params.tratamentoFimDeSemana} onChange={(e) => set("tratamentoFimDeSemana", e.target.value as TratamentoDia)} className={inputCls}>
            <option value="PULA" className={opt}>Pular (não conta)</option>
            <option value="CONTA" className={opt}>Contar normalmente</option>
          </select>
        </div>
        <div>
          <label htmlFor="pg-fer" className={labelCls}>Feriado</label>
          <select id="pg-fer" value={params.tratamentoFeriado} onChange={(e) => set("tratamentoFeriado", e.target.value as TratamentoDia)} className={inputCls}>
            <option value="PULA" className={opt}>Pular (não conta)</option>
            <option value="CONTA" className={opt}>Contar normalmente</option>
          </select>
        </div>
        <div>
          <label htmlFor="pg-hora" className={labelCls}>Horário-limite do último dia</label>
          <input id="pg-hora" type="time" value={params.horarioLimite ?? ""} onChange={(e) => set("horarioLimite", e.target.value || null)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="pg-naoutil" className={labelCls}>Se o prazo cair em dia não útil</label>
          <select id="pg-naoutil" value={params.politicaDataNaoUtil} onChange={(e) => set("politicaDataNaoUtil", e.target.value as PoliticaDataNaoUtil)} className={inputCls}>
            <option value="PROXIMO_DIA_UTIL" className={opt}>Adiar para o próximo dia útil</option>
            <option value="DIA_UTIL_ANTERIOR" className={opt}>Antecipar para o dia útil anterior</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function SecaoRisco({ params, set, erros }: { params: ParametrosPolitica; set: SetCampo; erros: Record<string, string> }) {
  return (
    <div className={cardCls}>
      <h4 className={sectionTitleCls}>Indicadores de risco</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Quando a tarefa passa a ser sinalizada como em risco, e o que acontece a partir daí.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ir-ant" className={labelCls}>Antecedência para marcar como risco (dias) *</label>
          <input id="ir-ant" type="number" min={0} value={params.riscoAntecedenciaDias} onChange={(e) => set("riscoAntecedenciaDias", Number(e.target.value))} className={inputCls} />
          <CampoErro mensagem={erros.riscoAntecedenciaDias} />
        </div>
        <div>
          <label htmlFor="ir-lembrete" className={labelCls}>Repetir lembrete de atraso a cada (dias)</label>
          <input id="ir-lembrete" type="number" min={0} value={params.lembreteAtrasoRecorrenciaDias ?? ""} onChange={(e) => set("lembreteAtrasoRecorrenciaDias", numOuNulo(e.target.value))} placeholder="opcional" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={params.escalonamentoAtivo} onChange={(e) => set("escalonamentoAtivo", e.target.checked)} className={checkboxCls} />
            Escalonar automaticamente quando a tarefa entrar em risco
          </label>
        </div>
        {params.escalonamentoAtivo && (
          <>
            <div>
              <label htmlFor="ir-papel" className={labelCls}>Papel/função para quem escalonar</label>
              <input id="ir-papel" value={params.escalonamentoPapel ?? ""} onChange={(e) => set("escalonamentoPapel", e.target.value || null)} placeholder="ex.: supervisor" className={inputCls} />
            </div>
            <div>
              <label htmlFor="ir-dest" className={labelCls}>ID do usuário destinatário do escalonamento</label>
              <input id="ir-dest" type="number" value={params.escalonamentoDestinatarioId ?? ""} onChange={(e) => set("escalonamentoDestinatarioId", numOuNulo(e.target.value))} placeholder="opcional" className={inputCls} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SecaoAcompanhamento({ params, set, erros }: { params: ParametrosPolitica; set: SetCampo; erros: Record<string, string> }) {
  return (
    <div className={cardCls}>
      <h4 className={sectionTitleCls}>Acompanhamento</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Régua de retorno da tarefa à atenção — nunca é o prazo/SLA em si, é quando ela volta a pedir olhar.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ac-primeiro" className={labelCls}>Primeiro acompanhamento em (dias) *</label>
          <input id="ac-primeiro" type="number" min={1} value={params.acompanhamentoPrimeiroDias} onChange={(e) => set("acompanhamentoPrimeiroDias", Number(e.target.value))} className={inputCls} />
          <CampoErro mensagem={erros.acompanhamentoPrimeiroDias} />
        </div>
        <div>
          <label htmlFor="ac-padrao" className={labelCls}>Acompanhamentos seguintes a cada (dias) *</label>
          <input id="ac-padrao" type="number" min={1} value={params.acompanhamentoPadraoDias} onChange={(e) => set("acompanhamentoPadraoDias", Number(e.target.value))} className={inputCls} />
          <CampoErro mensagem={erros.acompanhamentoPadraoDias} />
        </div>
        <div>
          <label htmlFor="ac-unid" className={labelCls}>Unidade de contagem *</label>
          <select id="ac-unid" value={params.acompanhamentoUnidade} onChange={(e) => set("acompanhamentoUnidade", e.target.value as UnidadePrazo)} className={inputCls}>
            <option value="DIAS_UTEIS" className={opt}>Dias úteis</option>
            <option value="DIAS_CORRIDOS" className={opt}>Dias corridos</option>
          </select>
          <CampoErro mensagem={erros.acompanhamentoUnidade} />
        </div>
        <div>
          <label htmlFor="ac-limite" className={labelCls}>Limite de acompanhamentos sem resposta antes de escalonar</label>
          <input id="ac-limite" type="number" min={0} value={params.acompanhamentoLimiteSemResposta ?? ""} onChange={(e) => set("acompanhamentoLimiteSemResposta", numOuNulo(e.target.value))} placeholder="opcional" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ac-papel" className={labelCls}>Papel/função para escalonamento do acompanhamento</label>
          <input id="ac-papel" value={params.acompanhamentoEscalonamentoPapel ?? ""} onChange={(e) => set("acompanhamentoEscalonamentoPapel", e.target.value || null)} placeholder="opcional" className={inputCls} />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={params.acompanhamentoPermiteManual} onChange={(e) => set("acompanhamentoPermiteManual", e.target.checked)} className={checkboxCls} />
            Permitir reprogramação manual do acompanhamento
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={params.acompanhamentoExigeMotivo} onChange={(e) => set("acompanhamentoExigeMotivo", e.target.checked)} className={checkboxCls} />
            Exigir motivo ao reprogramar o acompanhamento
          </label>
        </div>
      </div>
    </div>
  )
}

function SecaoEsperaTerceiro({ params, set }: { params: ParametrosPolitica; set: SetCampo }) {
  return (
    <div className={cardCls}>
      <h4 className={sectionTitleCls}>Espera de terceiro</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Comportamento padrão desta política quando a tarefa depende de retorno de alguém de fora da equipe.</p>
      <label className="mt-3 flex items-center gap-2 text-sm text-white/80">
        <input type="checkbox" checked={params.esperaTerceiroPadraoAtivo} onChange={(e) => set("esperaTerceiroPadraoAtivo", e.target.checked)} className={checkboxCls} />
        Ativar espera de terceiro por padrão nesta política
      </label>
    </div>
  )
}

// ============================================================================
// PUBLICAÇÃO — exige estratégia explícita + prévia de impacto vista +
// motivo (obrigatório a partir da 2ª publicação).
// ============================================================================
function PublicarModal({
  politicaId, politica, params, onFechar, onPublicado, onErroValidacao,
}: {
  politicaId: number
  politica: Politica
  params: ParametrosPolitica
  onFechar: () => void
  onPublicado: (tarefasReconciliadas: number) => void
  onErroValidacao: (erros: ErroValidacao[]) => void
}) {
  const [estrategia, setEstrategia] = useState<EstrategiaRetroacao | null>(null)
  const [motivo, setMotivo] = useState("")
  const [publicando, setPublicando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<ErroValidacao[]>([])
  const [viuImpacto, setViuImpacto] = useState(false)

  const impactoReq = useApi<PreviaImpacto>(
    estrategia ? `/api/gerenciamento/politicas-prazo-sla/${politicaId}/previa-impacto?estrategia=${estrategia}` : null,
  )
  const impacto = impactoReq.dados ?? null

  function escolherEstrategia(v: EstrategiaRetroacao) {
    setEstrategia(v)
    setViuImpacto(false)
  }

  const primeiraPublicacao = politica.versaoAtual === 0
  const motivoObrigatorio = !primeiraPublicacao
  const podeConfirmar = estrategia !== null && !impactoReq.carregando && impacto !== null && viuImpacto && (!motivoObrigatorio || motivo.trim().length > 0)

  async function confirmar() {
    if (publicando || !podeConfirmar || !estrategia) return
    setPublicando(true); setErro(null); setErros([])
    try {
      const d = await enviar<{ reconciliacao?: { tarefasAlcancadas?: number } }>(`/api/gerenciamento/politicas-prazo-sla/${politicaId}/publicar`, {
        metodo: "POST",
        corpo: { parametros: params, estrategiaRetroacao: estrategia, motivoAlteracao: motivo.trim() || undefined },
      })
      onPublicado(d.reconciliacao?.tarefasAlcancadas ?? 0)
    } catch (e) {
      if (e instanceof ErroApi && e.corpo && typeof e.corpo === "object" && "erros" in (e.corpo as Record<string, unknown>)) {
        const lista = (e.corpo as { erros?: ErroValidacao[] }).erros ?? []
        setErros(lista)
        onErroValidacao(lista)
        setErro("Há campos inválidos nos parâmetros — veja abaixo.")
      } else {
        setErro(e instanceof Error ? e.message : "Não foi possível publicar.")
      }
    } finally { setPublicando(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Publicar — {politica.nome}</h3>
          <button onClick={onFechar} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div>
            <span className={labelCls}>Estratégia de retroação para as tarefas em andamento *</span>
            <div className="space-y-2">
              {ESTRATEGIAS.map((e) => (
                <label
                  key={e.valor}
                  className={`block cursor-pointer rounded-lg border p-3 text-sm transition ${estrategia === e.valor ? "border-[var(--action-primary)] bg-[var(--surface-secondary)]" : "border-[var(--border-default)] bg-[var(--surface-primary)] hover:bg-[var(--surface-hover)]"}`}
                >
                  <div className="flex items-start gap-2">
                    <input type="radio" name="estrategia" checked={estrategia === e.valor} onChange={() => escolherEstrategia(e.valor)} className="mt-1 accent-blue-500" />
                    <div>
                      <div className="font-medium text-white">{e.titulo}</div>
                      <div className="text-xs text-[var(--text-secondary)]">{e.explicacao}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {estrategia && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
              {impactoReq.carregando ? (
                <p className="text-xs text-[var(--text-muted)]">Calculando impacto…</p>
              ) : impacto ? (
                <div className="space-y-2">
                  <p className={`text-sm font-medium ${impacto.tarefasQueSeraoRetroagidas > 0 ? "text-amber-800" : "text-white"}`}>
                    {impacto.tarefasQueSeraoRetroagidas > 0
                      ? `⚠ ${impacto.tarefasQueSeraoRetroagidas} tarefa(s) em andamento serão retroagidas por esta publicação.`
                      : "Nenhuma tarefa em andamento será retroagida — a nova regra só vale para tarefas novas."}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {impacto.tarefasEmAndamentoVinculadas} tarefa(s) em andamento estão vinculadas a esta política no total.
                  </p>
                  {impacto.amostra.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded border border-[var(--border-default)]">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-[var(--surface-primary)] text-left text-[var(--text-secondary)]">
                            <th className="px-2 py-1">Tarefa</th>
                            <th className="px-2 py-1">Processo</th>
                            <th className="px-2 py-1">Prazo atual</th>
                          </tr>
                        </thead>
                        <tbody>
                          {impacto.amostra.map((t) => (
                            <tr key={t.id} className="border-t border-[var(--border-subtle)]">
                              <td className="px-2 py-1 text-white/80">{t.titulo}</td>
                              <td className="px-2 py-1 text-white/60">#{t.processoId}</td>
                              <td className="px-2 py-1 text-white/60">{fmtData(t.dataPrazo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!viuImpacto && (
                    <button onClick={() => setViuImpacto(true)} className={btnSecondary}>
                      Vi o impacto — liberar confirmação
                    </button>
                  )}
                  {viuImpacto && <p className="text-[11px] text-green-800">Impacto confirmado.</p>}
                </div>
              ) : null}
            </div>
          )}

          <div>
            <label htmlFor="pub-motivo" className={labelCls}>
              Motivo da alteração {motivoObrigatorio ? "*" : "(opcional na primeira publicação)"}
            </label>
            <textarea id="pub-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Por que esta política está sendo alterada." className={inputCls} />
          </div>

          {erros.length > 0 && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-xs text-red-700">
              <ul className="list-disc space-y-1 pl-4">
                {erros.map((e) => <li key={e.campo}>{e.mensagem}</li>)}
              </ul>
            </div>
          )}
          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erro}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
          <button onClick={onFechar} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
          <button onClick={confirmar} disabled={!podeConfirmar || publicando} className={btnPrimary}>
            {publicando ? "Publicando…" : "Confirmar publicação"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// ABA 2 — CALENDÁRIOS OFICIAIS
// ============================================================================
function CalendariosTab() {
  const lista = useApi<{ calendarios?: Calendario[] }>("/api/gerenciamento/calendarios-oficiais")
  const calendarios = lista.dados?.calendarios ?? []
  const loading = lista.carregando

  const [criando, setCriando] = useState(false)
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null)
  const [flash, setFlash] = useState("")
  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3500) }

  return (
    <div className="space-y-4">
      {flash && <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-800">{flash}</div>}
      {lista.erro && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">
          {lista.erro.message}
          <button onClick={() => void lista.recarregar()} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">Calendários de feriados que uma política de prazo/SLA pode aplicar no lugar do calendário nacional padrão.</p>
        <button onClick={() => setCriando(true)} className={btnPrimary}>+ Novo calendário</button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Calendário</th>
              <th className="px-4 py-3 font-medium">Chave</th>
              <th className="px-4 py-3 font-medium">Feriados cadastrados</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Carregando…</td></tr>
            ) : calendarios.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">Nenhum calendário cadastrado. Sem calendário próprio, as políticas usam o calendário nacional padrão.</td></tr>
            ) : calendarios.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 font-medium text-white">{c.nome}</td>
                <td className="px-4 py-2.5"><code className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[11px] text-white/70">{c.chave}</code></td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{c._count?.feriados ?? 0}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.ativo ? "bg-[var(--surface-secondary)] text-green-800" : "bg-[var(--surface-primary)] text-[var(--text-muted)]"}`}>
                    {c.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => setSelecionadoId(c.id)} className={btnGhost}>Feriados</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {criando && (
        <NovoCalendarioModal
          onFechar={() => setCriando(false)}
          onCriado={async () => { setCriando(false); showFlash("Calendário criado."); await lista.recarregar() }}
        />
      )}

      {selecionadoId !== null && (
        <FeriadosModal
          calendario={calendarios.find((c) => c.id === selecionadoId) ?? null}
          onFechar={() => setSelecionadoId(null)}
          onAlterado={() => void lista.recarregar()}
        />
      )}
    </div>
  )
}

function NovoCalendarioModal({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    if (salvando) return
    if (!nome.trim()) { setErro("Informe o nome do calendário."); return }
    setSalvando(true); setErro(null)
    try {
      await enviar("/api/gerenciamento/calendarios-oficiais", { metodo: "POST", corpo: { nome: nome.trim(), descricao: descricao.trim() || undefined } })
      onCriado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o calendário.")
    } finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Novo calendário oficial</h3>
          <button onClick={onFechar} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div>
            <label htmlFor="cal-nome" className={labelCls}>Nome *</label>
            <input id="cal-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Feriados — Itália" className={inputCls} />
          </div>
          <div>
            <label htmlFor="cal-desc" className={labelCls}>Descrição</label>
            <input id="cal-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputCls} />
          </div>
          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erro}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
          <button onClick={onFechar} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className={btnPrimary}>{salvando ? "Criando…" : "Criar"}</button>
        </div>
      </div>
    </div>
  )
}

function FeriadosModal({ calendario, onFechar, onAlterado }: { calendario: Calendario | null; onFechar: () => void; onAlterado: () => void }) {
  const feriadosReq = useApi<{ feriados?: Feriado[] }>(calendario ? `/api/gerenciamento/calendarios-oficiais/${calendario.id}/feriados` : null)
  const feriados = feriadosReq.dados?.feriados ?? []

  const [data, setData] = useState("")
  const [nome, setNome] = useState("")
  const [recorrente, setRecorrente] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function adicionar() {
    if (salvando || !calendario) return
    if (!data) { setErro("Informe a data."); return }
    if (!nome.trim()) { setErro("Informe o nome do feriado."); return }
    setSalvando(true); setErro(null)
    try {
      await enviar(`/api/gerenciamento/calendarios-oficiais/${calendario.id}/feriados`, {
        metodo: "POST",
        corpo: { data, nome: nome.trim(), recorrenteAnual: recorrente },
      })
      setData(""); setNome(""); setRecorrente(false)
      await feriadosReq.recarregar()
      onAlterado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível adicionar o feriado.")
    } finally { setSalvando(false) }
  }

  if (!calendario) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Feriados — {calendario.nome}</h3>
          <button onClick={onFechar} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_auto]">
            <div>
              <label htmlFor="fer-data" className={labelCls}>Data *</label>
              <input id="fer-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="fer-nome" className={labelCls}>Nome *</label>
              <input id="fer-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Dia da Independência" className={inputCls} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 whitespace-nowrap text-sm text-white/80">
                <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} className={checkboxCls} />
                Repete todo ano
              </label>
            </div>
          </div>
          <button onClick={adicionar} disabled={salvando} className={btnPrimary}>{salvando ? "Adicionando…" : "+ Adicionar feriado"}</button>
          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erro}</div>}

          <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[var(--surface-primary)]">
                  <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Data</th>
                  <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Nome</th>
                  <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Recorrente</th>
                </tr>
              </thead>
              <tbody>
                {feriadosReq.carregando ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">Carregando…</td></tr>
                ) : feriados.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-xs text-[var(--text-muted)]">Nenhum feriado cadastrado ainda.</td></tr>
                ) : feriados.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="px-3 py-2 text-white/80">{fmtData(f.data)}</td>
                    <td className="px-3 py-2 text-white">{f.nome}</td>
                    <td className="px-3 py-2 text-white/70">{f.recorrenteAnual ? "Sim" : "Não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
