// ============================================================================
// PROCESSOS EM ANDAMENTO — a tabela do mockup da Home.
//
// Consome /api/home/processos, que combina os motores canônicos (projeção
// operacional e engine de SLA) com três derivações declaradas a partir da
// TAREFA — pendências, prioridade e responsável, que o Processo não guarda.
// Esta tela só EXIBE: não recalcula progresso, prazo nem prioridade.
// ============================================================================
"use client"

import useSWR from "swr"
import Link from "next/link"
import { ChevronRight, Search, SlidersHorizontal } from "lucide-react"
import { BlocoCard, BlocoHeader, EmptyState } from "@/src/components/home/home-primitives"
import { ESTILO_FAIXA_SLA } from "@/src/components/sla/sla-ui"
import type { SlaProcesso } from "@/src/types/sla"

interface LinhaProcesso {
  id: number
  nome: string
  codigo: string | null
  pais: string | null
  faseAtualKey: string | null
  progresso: number
  sla: SlaProcesso | null
  pendencias: number
  prioridade: "URGENTE" | "ALTA" | "MEDIA" | "BAIXA" | null
  responsavel: { id: number; nome: string } | null
}

/** Prioridade: rótulo e cor. O SIGNIFICADO vem da Tarefa, não daqui. */
const PRIORIDADE = {
  URGENTE: { rotulo: "Urgente", cor: "var(--danger)" },
  ALTA:    { rotulo: "Alta",    cor: "var(--warning)" },
  MEDIA:   { rotulo: "Média",   cor: "var(--info)" },
  BAIXA:   { rotulo: "Baixa",   cor: "var(--success)" },
} as const

const iniciais = (v: string) =>
  v.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("")

/** phaseKey → rótulo legível, sem inventar tradução: troca _ por espaço. */
const rotuloFase = (k: string | null) =>
  k ? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—"

const buscar = (url: string) => {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })
}

export function ProcessosEmAndamento() {
  const { data, error, isLoading } = useSWR<{ total: number; processos: LinhaProcesso[] }>(
    "/api/home/processos?limite=6",
    buscar,
    { revalidateOnFocus: false },
  )

  const linhas = data?.processos ?? []

  return (
    <BlocoCard className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
        <BlocoHeader titulo="Processos em andamento" descricao="Situação de cada processo aberto" />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)]">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-[12px] text-[var(--text-muted)]">
            <Search className="h-3.5 w-3.5" /> Buscar processo…
          </span>
        </div>
      </div>

      {/* Quatro estados, como manda a Central: carregando, erro, vazio, conteúdo. */}
      {isLoading ? (
        <div className="space-y-2 px-5 pb-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />
          ))}
        </div>
      ) : error ? (
        <div className="px-5 pb-5">
          <EmptyState icon={ChevronRight}>
            Não foi possível carregar os processos agora.
          </EmptyState>
        </div>
      ) : linhas.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState icon={ChevronRight}>Nenhum processo em andamento.</EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-y border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
                {["Processo", "Fase atual", "Progresso", "Responsável", "Pendências", "SLA", "Prioridade"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => {
                const prio = p.prioridade ? PRIORIDADE[p.prioridade] : null
                const faixa = p.sla?.faixa ? ESTILO_FAIXA_SLA[p.sla.faixa] : null
                return (
                  <tr key={p.id} className="border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)]">
                    <td className="px-4 py-3">
                      <Link href={`/processos/${p.id}`} className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-secondary)] text-[10px] font-semibold text-[var(--text-secondary)]">
                          {iniciais(p.nome)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{p.nome}</span>
                          {p.codigo && <span className="block truncate text-[11px] text-[var(--text-muted)]">Proc. {p.codigo}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">{rotuloFase(p.faseAtualKey)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-9 shrink-0 text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">{p.progresso}%</span>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
                          <div className="h-full rounded-full bg-[var(--accent-primary)]" style={{ width: `${p.progresso}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
                      {p.responsavel ? p.responsavel.nome : <span className="text-[var(--text-muted)]">Sem responsável</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{p.pendencias}</span>
                      <span className="ml-1 text-[11px] text-[var(--text-muted)]">{p.pendencias === 1 ? "ação" : "ações"}</span>
                    </td>
                    <td className="px-4 py-3">
                      {faixa ? (
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold `}>{p.sla?.rotuloStatus}</span>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">Sem prazo</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {prio ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
                          <span className="h-2 w-2 rounded-full" style={{ background: prio.cor }} aria-hidden />
                          {prio.rotulo}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {data && data.total > linhas.length && (
            <div className="flex items-center justify-between px-5 py-3 text-[12px] text-[var(--text-muted)]">
              <span>Mostrando {linhas.length} de {data.total} processos</span>
              <Link href="/kanban" className="inline-flex items-center gap-1 font-medium text-[var(--accent-text)] hover:underline">
                Ver todos os processos <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}
    </BlocoCard>
  )
}
