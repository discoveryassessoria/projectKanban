// src/components/kanban/ResumoFaseDocumental.tsx
// ============================================================================
// PAINEL ADITIVO de KPIs para fases DOCUMENTO-escopadas de "enviar a
// terceiro e aguardar retorno" (Tradução Juramentada, Apostilamento) — mostra
// as 4 subtarefas reais da Biblioteca em números agregados (preparar/enviar/
// receber/conferir). Renderiza ACIMA da Central Operacional genérica
// (`PainelDaFase`), nunca a substitui: mesmo dado, mesmas portas de execução
// (a linha da tabela abaixo já abre `DocumentoOperationalDrawer` de verdade).
//
// Mandato 24/09/2026 — reconstrução da tela de Tradução/Apostilamento em cima
// do motor canônico (a bespoke antiga, com tabela Pasta própria, foi removida).
// ============================================================================
"use client"

import { useState } from "react"
import { useApi } from "@/src/lib/dados"
import { Loader2, PlayCircle } from "lucide-react"

interface Totais {
  documentosNecessarios: number
  aptos: number
  bloqueados: number
  preparados: number
  enviados: number
  recebidos: number
  conferidos: number
  validados: number
}

interface DocumentoResumo {
  documentoId: number
  subtarefas: Array<{ key: string; label: string; status: string; concluida: boolean; disponivel: boolean }>
}
interface Resposta {
  totais: Totais
  pessoas: Array<{ pessoaId: number; nome: string; documentos: DocumentoResumo[] }>
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const jsonHeaders = () => ({ "Content-Type": "application/json", ...authHeaders() })

const CONFIG: Record<string, { titulo: string; icones: Record<keyof Totais, string> }> = {
  traducao_juramentada: {
    titulo: "Tradução Juramentada · resumo das 4 etapas",
    icones: {
      documentosNecessarios: "📄", aptos: "✅", bloqueados: "⚠️",
      preparados: "🗂️", enviados: "📤", recebidos: "📥", conferidos: "🔍", validados: "🏅",
    },
  },
  apostilamento: {
    titulo: "Apostilamento · resumo das 4 etapas",
    icones: {
      documentosNecessarios: "📄", aptos: "✅", bloqueados: "⚠️",
      preparados: "🗂️", enviados: "📤", recebidos: "📥", conferidos: "🔍", validados: "🏅",
    },
  },
}

const LABEL: Record<keyof Totais, string> = {
  documentosNecessarios: "Documentos necessários",
  aptos: "Aptos para seguir",
  bloqueados: "Bloqueados",
  preparados: "Preparados",
  enviados: "Enviados",
  recebidos: "Recebidos",
  conferidos: "Conferidos",
  validados: "Validados",
}

export function ResumoFaseDocumental({ processoId, stepKey }: { processoId: number; stepKey: "traducao_juramentada" | "apostilamento" }) {
  const { dados, carregando, recarregar } = useApi<Resposta>(`/api/processos/${processoId}/fase-documental-kpis/${stepKey}`)
  const cfg = CONFIG[stepKey]
  const [avancando, setAvancando] = useState(false)
  const [resultadoLote, setResultadoLote] = useState<string | null>(null)

  const documentosComEtapaDisponivel = (dados?.pessoas ?? [])
    .flatMap((p) => p.documentos)
    .filter((d) => d.subtarefas.some((s) => !s.concluida && s.disponivel))
    .map((d) => d.documentoId)

  const avancarLote = async () => {
    if (documentosComEtapaDisponivel.length === 0 || avancando) return
    setAvancando(true); setResultadoLote(null)
    try {
      const res = await fetch(`/api/processos/${processoId}/fase-documental-kpis/${stepKey}/avancar-lote`, {
        method: "POST", headers: jsonHeaders(),
        body: JSON.stringify({ documentoIds: documentosComEtapaDisponivel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.mensagem || data.error || "Não foi possível avançar em lote.")
      setResultadoLote(`${data.concluidos} concluído(s)${data.falhas > 0 ? `, ${data.falhas} não avançaram (veja motivo abrindo o documento)` : ""}.`)
      await recarregar()
    } catch (e) {
      setResultadoLote(e instanceof Error ? e.message : "Erro ao avançar em lote.")
    } finally {
      setAvancando(false)
    }
  }

  if (carregando) {
    return (
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4 mb-4 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }
  if (!dados) return null

  const t = dados.totais
  const ordem: Array<keyof Totais> = ["documentosNecessarios", "aptos", "bloqueados", "preparados", "enviados", "recebidos", "conferidos", "validados"]

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-popover)] p-4 mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm font-semibold text-white/95">{cfg.titulo}</div>
        {documentosComEtapaDisponivel.length > 0 && (
          <button
            onClick={avancarLote}
            disabled={avancando}
            title="Cada documento avança na SUA própria etapa corrente — nenhuma exige dado (só confirmar), por isso é seguro em lote."
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--action-primary-ink)] bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] disabled:opacity-50 rounded-md"
          >
            {avancando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
            Avançar etapa de {documentosComEtapaDisponivel.length} documento{documentosComEtapaDisponivel.length > 1 ? "s" : ""}
          </button>
        )}
      </div>
      {resultadoLote && <div className="mb-3 text-xs text-[var(--text-secondary)] bg-[var(--surface-secondary)] rounded-md px-3 py-2">{resultadoLote}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {ordem.map((k) => (
          <div key={k} className="rounded-lg border border-[var(--border-default)] px-3 py-2.5">
            <div className="text-base leading-none">{cfg.icones[k]}</div>
            <div className={`text-xl font-bold mt-1 ${
              k === "bloqueados" && t[k] > 0 ? "text-red-700" : k === "validados" || k === "aptos" ? "text-green-800" : "text-white/95"}`}>
              {t[k]}
            </div>
            <div className="text-[11px] text-[var(--text-secondary)]">{LABEL[k]}</div>
          </div>
        ))}
      </div>
      {t.documentosNecessarios === 0 && (
        <div className="mt-2 text-xs text-[var(--text-secondary)]">Nenhum documento da linha reta se aplica a esta fase ainda.</div>
      )}
    </div>
  )
}
