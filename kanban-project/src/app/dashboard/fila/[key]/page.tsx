"use client"

// ============================================================================
// FILA OPERACIONAL — drill-down de um card da Central Operacional
// ----------------------------------------------------------------------------
// O clique no card da Home abre EXATAMENTE esta fila: os mesmos itens que
// formaram a contagem (mesma coleta no backend). Cada linha leva ao lugar onde
// o trabalho é executado (processo, tarefa, documento, financeiro).
// ============================================================================

import { use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, ChevronRight, Flag } from "lucide-react"
import { useFila } from "@/src/components/home/use-home"
import { HomeShell } from "@/src/components/home/home-shell"
import {
  BlocoCard,
  EmptyState,
  ErrorState,
  OURO, OURO_TINTA,
  formatarPrazo,
  nivelStyle,
} from "@/src/components/home/home-primitives"

const BANDEIRA: Record<string, string> = {
  ALEMANHA: "🇩🇪",
  ESPANHA: "🇪🇸",
  ITALIA: "🇮🇹",
  PORTUGAL: "🇵🇹",
}

export default function FilaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const router = useRouter()
  const { data, error, isLoading, recarregar } = useFila(key)

  const status = (error as (Error & { status?: number }) | undefined)?.status
  const st = nivelStyle(data?.nivel ?? "baixo")

  return (
    <HomeShell titulo={data?.titulo ?? "Fila operacional"} subtitulo={data?.descricao ?? "Central Operacional"}>
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-5 md:px-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao Centro Operacional
        </button>

        <BlocoCard>
          {isLoading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--surface-primary)]" />
              ))}
            </div>
          ) : status === 404 ? (
            <EmptyState>Esta fila não existe ou você não tem acesso a ela.</EmptyState>
          ) : error ? (
            <ErrorState onRetry={() => recarregar()} mensagem="Não foi possível carregar a fila." />
          ) : !data || data.itens.length === 0 ? (
            <EmptyState icon={CheckCircle2}>Nada pendente nesta fila.</EmptyState>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${st.ponto}`} />
                  <h2 className="text-sm font-semibold text-white">{data.titulo}</h2>
                </div>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums ${st.chip}`}>
                  {data.quantidade}
                </span>
              </div>

              <ul className="space-y-1.5">
                {data.itens.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)] focus:outline-none focus:ring-2 focus:ring-white/20"
                    >
                      <span className="w-6 shrink-0 text-center text-base">
                        {item.pais ? (BANDEIRA[item.pais] ?? "🏳️") : "•"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{item.titulo}</p>
                        <p className="truncate text-xs text-[var(--text-secondary)]">
                          {[item.processoCodigo ?? item.processoNome, item.subtitulo].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {item.prazo && (
                        <span
                          className={`hidden shrink-0 text-xs font-medium sm:inline ${
                            item.atrasado ? "text-red-700" : "text-[var(--text-secondary)]"
                          }`}
                        >
                          {formatarPrazo(item.prazo)}
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>

              {data.truncado && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <Flag className="h-3.5 w-3.5" style={{ color: OURO_TINTA }} />
                  Mostrando os {data.itens.length} itens mais urgentes de {data.quantidade}.
                </p>
              )}
            </>
          )}
        </BlocoCard>
      </div>
    </HomeShell>
  )
}
