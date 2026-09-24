// src/components/kanban/ResumoFaseDocumental.tsx
// ============================================================================
// A PASTA como UMA linha do tempo só (Preparar → Enviar → Receber → Conferir
// e validar) — nunca quatro etapas repetidas por documento. Renderiza ACIMA
// da Central Operacional genérica (`PainelDaFase`), nunca a substitui: mesmo
// dado real (subtarefas do motor canônico), mesmas portas de execução.
//
// Mandato 24/09/2026 — correção do que foi entregue antes ("ficou igual à
// tela de Solicitar certidão, documento por documento — eu quero uma pasta
// única"). "Incluir na pasta" = concluir "preparar_documentos" para o
// documento; "Avançar" move TODOS os documentos da pasta juntos, na mesma
// subtarefa — nunca um de cada vez.
// ============================================================================
"use client"

import { useState } from "react"
import { useApi } from "@/src/lib/dados"
import { Loader2, Check, ChevronDown, ChevronRight, Send, FolderOpen, AlertTriangle } from "lucide-react"

interface DocumentoLinha {
  necessidadeId: number
  documentoId: number | null
  tipoLabel: string
  situacao: "falta" | "nao_apto" | "apto"
  motivo: string | null
  apto: boolean
  naPasta: boolean
  etapaAtualKey: string | null
  etapaAtualLabel: string | null
}
interface PessoaGrupo {
  pessoaId: number
  nome: string
  documentos: DocumentoLinha[]
}
interface Totais {
  documentosNecessarios: number
  aptos: number
  faltando: number
  naoAptos: number
  naPasta: number
  enviados: number
  recebidos: number
  validados: number
}
interface EstadoPasta {
  etapaAtualKey: string | null
  podeAvancar: boolean
  concluida: boolean
  dessincronizada: boolean
}
interface Resposta {
  totais: Totais
  pasta: EstadoPasta
  pessoas: PessoaGrupo[]
}

const TIMELINE: Array<{ key: string; label: string }> = [
  { key: "preparar_documentos", label: "Preparar" },
  { key: "enviar_documentos", label: "Enviar" },
  { key: "receber_documentos", label: "Receber" },
  { key: "conferir_validar_documentos", label: "Conferir e validar" },
]

const TITULO: Record<string, string> = {
  traducao_juramentada: "Pasta de Tradução Juramentada",
  apostilamento: "Pasta de Apostilamento",
}
const VERBO_AVANCAR: Record<string, string> = {
  enviar_documentos: "Enviar pasta ao tradutor/cartório",
  receber_documentos: "Confirmar recebimento da pasta",
  conferir_validar_documentos: "Confirmar conferência da pasta",
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })
const ini = (nome: string) => {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase()
}

export function ResumoFaseDocumental({ processoId, stepKey }: { processoId: number; stepKey: "traducao_juramentada" | "apostilamento" }) {
  const { dados, carregando, recarregar } = useApi<Resposta>(`/api/processos/${processoId}/fase-documental-kpis/${stepKey}`)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [colapsadas, setColapsadas] = useState<Set<number>>(new Set())
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  if (carregando) {
    return (
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4 mb-4 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }
  if (!dados) return null

  const { totais: t, pasta, pessoas } = dados
  const todosDocs = pessoas.flatMap((p) => p.documentos.map((d) => ({ ...d, pessoaNome: p.nome })))
  const candidatosParaIncluir = todosDocs.filter((d) => d.apto && !d.naPasta && d.documentoId != null)

  const toggle = (documentoId: number) => setSelecionados((prev) => {
    const next = new Set(prev)
    if (next.has(documentoId)) next.delete(documentoId); else next.add(documentoId)
    return next
  })
  const selecionarTodosAptos = () => setSelecionados(new Set(candidatosParaIncluir.map((d) => d.documentoId!)))
  const toggleColapsada = (pessoaId: number) => setColapsadas((prev) => {
    const next = new Set(prev)
    if (next.has(pessoaId)) next.delete(pessoaId); else next.add(pessoaId)
    return next
  })

  const incluirNaPasta = async () => {
    if (selecionados.size === 0 || processando) return
    setProcessando(true); setErro(null); setAviso(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/fase-documental-kpis/${stepKey}/incluir`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ documentoIds: [...selecionados] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.mensagem || data.error || "Não foi possível incluir na pasta.")
      setAviso(`${data.incluidos} documento(s) incluído(s) na pasta.`)
      setSelecionados(new Set())
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao incluir na pasta.")
    } finally {
      setProcessando(false)
    }
  }

  const avancarPasta = async () => {
    if (!pasta.etapaAtualKey || !pasta.podeAvancar || processando) return
    setProcessando(true); setErro(null); setAviso(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/fase-documental-kpis/${stepKey}/avancar`, {
        method: "POST", headers: jsonHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.mensagem || data.error || "Não foi possível avançar a pasta.")
      setAviso(`Pasta avançada: ${data.concluidos} documento(s).${data.falhas > 0 ? ` ${data.falhas} falharam.` : ""}`)
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao avançar a pasta.")
    } finally {
      setProcessando(false)
    }
  }

  const indiceAtual = pasta.etapaAtualKey ? TIMELINE.findIndex((s) => s.key === pasta.etapaAtualKey) : (pasta.concluida ? TIMELINE.length : -1)

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4 mb-4">
      <div className="text-sm font-semibold text-white/95 mb-3 inline-flex items-center gap-1.5">
        <FolderOpen className="w-4 h-4 text-[var(--action-primary)]" /> {TITULO[stepKey]}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Kpi value={t.documentosNecessarios} label="Documentos necessários" />
        <Kpi value={t.aptos} label="Aptos" tone="green" />
        <Kpi value={t.faltando + t.naoAptos} label="Faltando / não aptos" tone={t.faltando + t.naoAptos > 0 ? "red" : undefined} />
        <Kpi value={t.naPasta} label="Na pasta" tone="blue" />
        <Kpi value={t.enviados} label="Enviados" />
        <Kpi value={t.recebidos} label="Recebidos" />
        <Kpi value={t.validados} label="Conferidos e validados" tone="green" />
        <Kpi value={pasta.concluida ? 1 : 0} label="Pasta concluída" tone={pasta.concluida ? "green" : undefined} />
      </div>

      {/* Linha do tempo ÚNICA da pasta */}
      <div className="rounded-lg border border-[var(--border-default)] p-3 mb-4">
        <div className="flex items-start">
          {TIMELINE.map((s, i) => {
            const done = i < indiceAtual || pasta.concluida
            const active = i === indiceAtual && !pasta.concluida
            return (
              <div key={s.key} className={`flex items-start ${i < TIMELINE.length - 1 ? "flex-1" : ""}`}>
                <div className="flex flex-col items-center text-center w-[110px] shrink-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    done ? "bg-[var(--action-primary)] text-white" : active ? "bg-[var(--action-primary)] text-white" : "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"}`}>
                    {done ? <Check className="w-4 h-4" /> : i + 1}
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium text-white/80 leading-tight">{s.label}</div>
                  <div className={`text-[10px] ${done ? "text-green-800" : active ? "text-[var(--accent-text)]" : "text-[var(--text-muted)]"}`}>
                    {done ? "Concluído" : active ? "Etapa atual" : "Pendente"}
                  </div>
                </div>
                {i < TIMELINE.length - 1 && <div className={`flex-1 h-0.5 mt-3.5 ${done ? "bg-[var(--action-primary)]" : "bg-[var(--surface-tertiary)]"}`} />}
              </div>
            )
          })}
        </div>

        {pasta.dessincronizada && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-red-700 bg-[var(--surface-secondary)] rounded-md px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            Os documentos da pasta não estão todos na mesma etapa — algum foi aberto e avançado individualmente. Abra cada documento na Central Operacional pra ver o que aconteceu antes de avançar o grupo de novo.
          </div>
        )}

        {pasta.etapaAtualKey && !pasta.dessincronizada && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={avancarPasta}
              disabled={!pasta.podeAvancar || processando}
              className="px-4 py-2 text-sm font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed rounded-md inline-flex items-center gap-2">
              {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {VERBO_AVANCAR[pasta.etapaAtualKey] ?? "Avançar pasta"} ({t.naPasta})
            </button>
          </div>
        )}
      </div>

      {erro && <div className="mb-3 text-xs text-red-700 bg-[var(--surface-secondary)] rounded-md px-3 py-2">{erro}</div>}
      {aviso && <div className="mb-3 text-xs text-[var(--text-secondary)] bg-[var(--surface-secondary)] rounded-md px-3 py-2">{aviso}</div>}

      {/* Seleção de documentos por pessoa */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Documentos necessários, por pessoa</div>
        {candidatosParaIncluir.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={selecionarTodosAptos} className="px-2.5 py-1 text-[11px] font-semibold text-white/80 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)]">
              Selecionar todos os aptos
            </button>
            <button onClick={incluirNaPasta} disabled={selecionados.size === 0 || processando}
              className="px-2.5 py-1 text-[11px] font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed rounded-md">
              Incluir na pasta ({selecionados.size})
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
        {pessoas.length === 0 && <div className="p-4 text-center text-xs text-[var(--text-secondary)]">Nenhuma pessoa da linha reta com documento aplicável.</div>}
        {pessoas.map((p) => {
          const colapsada = colapsadas.has(p.pessoaId)
          return (
            <div key={p.pessoaId} className="border-b border-[var(--border-default)] last:border-b-0">
              <button onClick={() => toggleColapsada(p.pessoaId)} className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--surface-secondary)]/40 hover:bg-[var(--surface-secondary)] text-left">
                {colapsada ? <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                <span className="w-6 h-6 rounded-full bg-[var(--surface-tertiary)] text-white/68 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{ini(p.nome)}</span>
                <span className="text-sm font-semibold text-white/95">{p.nome}</span>
                <span className="text-[11px] text-[var(--text-secondary)] ml-1">{p.documentos.length} documento(s)</span>
              </button>
              {!colapsada && (
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-white/10">
                    {p.documentos.map((d) => (
                      <tr key={d.necessidadeId} className="hover:bg-[var(--surface-secondary)]">
                        <td className="w-8 px-3 py-2">
                          {d.apto && !d.naPasta && d.documentoId != null && (
                            <input type="checkbox" checked={selecionados.has(d.documentoId)} onChange={() => toggle(d.documentoId!)} className="accent-[var(--action-primary)]" />
                          )}
                        </td>
                        <td className="px-2 py-2 font-medium text-white/95">{d.tipoLabel}</td>
                        <td className="px-2 py-2">
                          {d.situacao === "falta" && <span className="text-[11px] font-semibold text-[var(--text-muted)]">Falta — {d.motivo}</span>}
                          {d.situacao === "nao_apto" && <span className="text-[11px] font-semibold text-red-700">Não apto — {d.motivo}</span>}
                          {d.situacao === "apto" && !d.naPasta && <span className="text-[11px] font-semibold text-green-800">Apto — pronto para incluir</span>}
                          {d.naPasta && <span className="text-[11px] font-semibold text-[var(--accent-text)]">Na pasta — {d.etapaAtualLabel ?? "concluído"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Kpi({ value, label, tone }: { value: number; label: string; tone?: "green" | "red" | "blue" }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] px-3 py-2.5">
      <div className={`text-xl font-bold ${tone === "green" ? "text-green-800" : tone === "red" ? "text-red-700" : tone === "blue" ? "text-[var(--accent-text)]" : "text-white/95"}`}>{value}</div>
      <div className="text-[11px] text-[var(--text-secondary)]">{label}</div>
    </div>
  )
}
