"use client"

// src/components/gerenciamentoComponents/CatalogoFaseRevisoesTab.tsx
// PROCESSOS → CONFIGURAÇÕES → VERSÕES.
// Revisões do CATÁLOGO DE FASES (CatalogoFaseRevisao) — NUNCA versões de
// Workflow Macro/Interno (mandato "Catálogo de Fases", correção 20/09/2026,
// bug 2). Backend: GET /api/gerenciamento/catalogo-fases/revisoes.

import { useApi } from "@/src/lib/dados"

interface Mudanca { campo: string; de: unknown; para: unknown }
interface RevisaoRow {
  catalogoFaseId: number
  fase: string
  phaseKey: string
  revisao: number
  status: string
  escopo: string | null
  data: string
  autor: string
  origem: string
  revisaoAnterior: number | null
  revisaoAtualDaFase: number | null
  ehVigente: boolean
  alteracoes: Mudanca[]
  resultadoPublicacao: string
  resultadoReconciliacao: string
}

const STATUS_COR: Record<string, string> = {
  PUBLICADA: "text-green-400", RASCUNHO: "text-yellow-400", INATIVA: "text-white/40",
}

export default function CatalogoFaseRevisoesTab() {
  const consulta = useApi<{ revisoes?: RevisaoRow[] }>("/api/gerenciamento/catalogo-fases/revisoes")
  const linhas = consulta.dados?.revisoes ?? []
  const loading = consulta.carregando
  const erro = consulta.erro ? consulta.erro.message : null

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700">
          {erro} <button onClick={() => { void consulta.recarregar() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Versões — Catálogo de Fases</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
          Toda revisão publicada de uma fase, com autor, data, o que mudou, o resultado da publicação e o resultado
          da reconciliação retroativa nos processos em andamento. Nunca é versão de Workflow Macro nem de Workflow
          Interno — essas vivem nas telas próprias de Workflow.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Fase</th>
              <th className="px-4 py-3 font-medium">Chave</th>
              <th className="px-4 py-3 font-medium">Revisão</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Escopo</th>
              <th className="px-4 py-3 font-medium">Autor</th>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Alterações</th>
              <th className="px-4 py-3 font-medium">Publicação</th>
              <th className="px-4 py-3 font-medium">Reconciliação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {linhas.map((r) => (
              <tr key={`${r.catalogoFaseId}-${r.revisao}`} className="align-top">
                <td className="px-4 py-2.5 text-white/90">{r.fase}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-[var(--text-muted)]">{r.phaseKey}</td>
                <td className="px-4 py-2.5 text-white/80">
                  {r.revisaoAnterior != null ? `${r.revisaoAnterior} → ` : ""}{r.revisao}
                  {r.ehVigente && <span className="ml-1.5 rounded bg-[var(--surface-secondary)] px-1 py-0.5 text-[10px] text-green-400">vigente</span>}
                </td>
                <td className={`px-4 py-2.5 ${STATUS_COR[r.status] ?? "text-white/60"}`}>{r.status}</td>
                <td className="px-4 py-2.5 text-white/70">{r.escopo ?? "—"}</td>
                <td className="px-4 py-2.5 text-white/70">{r.autor}</td>
                <td className="px-4 py-2.5 text-[11px] text-[var(--text-muted)]">{new Date(r.data).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2.5 text-[11px] text-white/70">
                  {r.alteracoes.length === 0 ? <span className="text-[var(--text-muted)]">nenhuma</span> : (
                    <ul className="space-y-0.5">
                      {r.alteracoes.map((m, i) => (
                        <li key={i}><span className="text-white/50">{m.campo}:</span> {JSON.stringify(m.de)} → {JSON.stringify(m.para)}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[11px] text-white/70">{r.resultadoPublicacao}</td>
                <td className="px-4 py-2.5 text-[11px] text-white/70">{r.resultadoReconciliacao}</td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-[var(--text-muted)]">Nenhuma revisão registrada ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
