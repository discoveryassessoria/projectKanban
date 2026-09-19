// ============================================================================
// PROCESSOS EM ANDAMENTO — a tabela do mockup da Home.
//
// Consome /api/home/processos, que combina o motor canônico de projeção
// operacional com três derivações declaradas a partir da TAREFA —
// pendências, prioridade e responsável, que o Processo não guarda. Esta tela
// só EXIBE: não recalcula progresso nem prioridade.
//
// Achado real (17/09/2026): a coluna "SLA" aqui era o relógio de FaseMacro —
// um terceiro controle de prazo concorrente com os dois oficiais (Tarefa
// macro / Subtarefa operacional). Removida — ver [[prazo-tarefa-subtarefa-dois-relogios]].
// ============================================================================
"use client"

import useSWR from "swr"
import Link from "next/link"
import { ArrowRight, ChevronRight } from "lucide-react"
import { BlocoCard, BlocoHeader, EmptyState } from "@/src/components/home/home-primitives"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"
import { pluralizar } from "@/src/lib/ui/pluralizar"

interface LinhaProcesso {
  id: number
  nome: string
  codigo: string | null
  pais: string | null
  faseAtualKey: string | null
  progresso: number
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

/** phaseKey → rótulo legível. Catálogo canônico primeiro (mesma fonte do
 *  Kanban/Gerenciamento — nunca uma segunda tradução ad hoc); troca `_` por
 *  espaço só como rede de segurança para uma chave que o catálogo não conhece. */
const rotuloFase = (k: string | null) =>
  k ? (labelDaFasePorPhaseKey(k) ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())) : "—"

const buscar = (url: string) => {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })
}

export function ProcessosEmAndamento({ titulo = "Processos em andamento" }: { titulo?: string } = {}) {
  const { data, error, isLoading } = useSWR<{ total: number; processos: LinhaProcesso[] }>(
    "/api/home/processos?limite=6",
    buscar,
    { revalidateOnFocus: false },
  )

  const linhas = data?.processos ?? []

  return (
    <BlocoCard className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
        <BlocoHeader
          titulo={data ? `${titulo} · ${data.total}` : titulo}
          descricao="Situação de cada processo aberto"
        />
        <Link
          href="/kanban"
          className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-[var(--action-primary)] transition hover:opacity-80"
        >
          Ver todos os processos <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Quatro estados, como manda a Central: carregando, erro, vazio, conteúdo. */}
      {isLoading ? (
        <div className="space-y-2 px-5 pb-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--surface-secondary)]/60" />
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
        <div>
          {/* ABAIXO DE md: cards empilhados — a tabela de 6 colunas não cabe
              numa tela estreita sem cortar dado ou forçar rolagem lateral. */}
          <div className="space-y-2 px-5 pb-5 md:hidden">
            {linhas.map((p) => {
              const prio = p.prioridade ? PRIORIDADE[p.prioridade] : null
              return (
                <Link
                  key={p.id}
                  href={`/processos/${p.id}`}
                  className="block rounded-lg border border-[var(--border-subtle)] p-3 transition-colors hover:bg-[var(--surface-secondary)]/40"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[10px] font-semibold text-[var(--info)]">
                      {iniciais(p.nome)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{p.nome}</span>
                      <span className="block truncate text-[11px] text-[var(--text-muted)]">{rotuloFase(p.faseAtualKey)}</span>
                    </span>
                    {prio && (
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: prio.cor }} aria-hidden />
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[12px] font-semibold tabular-nums text-[var(--text-primary)]">{p.progresso}%</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                      <div className="h-full rounded-full bg-[var(--action-primary)]" style={{ width: `${p.progresso}%` }} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                    <span>{p.responsavel ? p.responsavel.nome : <span className="text-[var(--text-muted)]">Sem responsável</span>}</span>
                    <span className="text-[var(--text-muted)]">{pluralizar(p.pendencias, "ação", "ações")}</span>
                    {prio && <span>{prio.rotulo}</span>}
                  </div>
                </Link>
              )
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {["Processo", "Fase atual", "Progresso", "Responsável", "Pendências", "Prioridade"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {linhas.map((p) => {
                const prio = p.prioridade ? PRIORIDADE[p.prioridade] : null
                return (
                  <tr key={p.id} className="transition-colors hover:bg-[var(--surface-secondary)]/40">
                    <td className="px-4 py-3.5">
                      <Link href={`/processos/${p.id}`} className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--info-tile)] text-[10px] font-semibold text-[var(--info)]">
                          {iniciais(p.nome)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{p.nome}</span>
                          {p.codigo && <span className="block truncate text-[11px] text-[var(--text-muted)]">Proc. {p.codigo}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">{rotuloFase(p.faseAtualKey)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="w-9 shrink-0 text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">{p.progresso}%</span>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                          <div className="h-full rounded-full bg-[var(--action-primary)]" style={{ width: `${p.progresso}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[12.5px] text-[var(--text-secondary)]">
                      {p.responsavel ? p.responsavel.nome : <span className="text-[var(--text-muted)]">Sem responsável</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{p.pendencias}</span>{" "}
                      <span className="text-[11px] text-[var(--text-muted)]">{p.pendencias === 1 ? "ação" : "ações"}</span>
                    </td>
                    <td className="px-4 py-3.5">
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
          </div>
          {data && data.total > linhas.length && (
            <div className="flex items-center justify-between px-5 py-3 text-[12px] text-[var(--text-muted)]">
              <span>Mostrando {linhas.length} de {data.total} processos</span>
              <Link href="/kanban" className="inline-flex items-center gap-1 font-medium text-[var(--action-primary)] hover:underline">
                Ver todos os processos <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}
    </BlocoCard>
  )
}
