"use client"

// ============================================================================
// FILA OPERACIONAL — drill-down de um card da Central Operacional
// ----------------------------------------------------------------------------
// O clique no card da Home abre EXATAMENTE esta fila: os mesmos itens que
// formaram a contagem (mesma coleta no backend). Cada linha leva ao lugar onde
// o trabalho é executado (processo, tarefa, documento, financeiro).
// ============================================================================

import { use } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Flag } from "lucide-react"
import { useFila } from "@/src/components/home/use-home"
import { HomeShell } from "@/src/components/home/home-shell"
import { FilaAgrupada } from "@/src/components/home/fila-agrupada"
import {
  BlocoCard,
  EmptyState,
  ErrorState,
  OURO_TINTA,
  nivelStyle,
} from "@/src/components/home/home-primitives"

export default function FilaPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const router = useRouter()
  const { data, error, isLoading, recarregar } = useFila(key)

  const status = (error as (Error & { status?: number }) | undefined)?.status
  const st = nivelStyle(data?.nivel ?? "baixo")

  return (
    <HomeShell titulo={data?.titulo ?? "Fila operacional"} subtitulo={data?.descricao ?? "Central Operacional"}>
      <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 md:px-6">
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

              <FilaAgrupada itens={data.itens} />

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
