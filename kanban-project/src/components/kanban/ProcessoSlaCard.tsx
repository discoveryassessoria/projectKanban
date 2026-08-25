"use client"

// ============================================================================
// CARD "SLA" — detalhe do processo
// ----------------------------------------------------------------------------
// Mostra o prazo do processo do jeito que a operação pergunta: quando vence,
// quanto já correu, quanto falta, quanto atrasou, qual fase está rodando, qual
// fase queimou o prazo e qual é o próximo vencimento.
//
// NÃO calcula nada: tudo vem pronto do GET /api/processos/[id]/sla, que delega
// à engine única (src/lib/motor/sla-core.ts) — a mesma da Central Operacional e
// da listagem de processos.
// ============================================================================

import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react"
import { useApi } from "@/src/lib/dados"
import { SlaBadge, ESTILO_STATUS_SLA } from "@/src/components/sla/sla-ui"
import type { SlaProcesso } from "@/src/types/sla"

function formatarData(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("pt-BR")
}

const plural = (n: number) => (n === 1 ? "dia" : "dias")

function Campo({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{rotulo}</p>
      <p className={`truncate text-sm font-medium ${destaque ?? "text-white/90"}`}>{valor}</p>
    </div>
  )
}

export function ProcessoSlaCard({ processoId }: { processoId: number }) {
  const { dados, carregando, erro, recarregar } = useApi<SlaProcesso>(
    processoId ? `/api/processos/${processoId}/sla` : null,
  )

  const corpo = (() => {
    if (carregando && !dados) {
      return (
        <div className="flex items-center gap-2 py-6 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando o SLA…
        </div>
      )
    }
    if (erro || !dados) {
      return (
        <div className="flex flex-col items-start gap-2 py-4">
          <p className="flex items-center gap-2 text-sm text-white/70">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            Não foi possível carregar o SLA deste processo.
          </p>
          <button
            onClick={() => recarregar()}
            className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-[var(--surface-hover)]"
          >
            Tentar novamente
          </button>
        </div>
      )
    }

    const s = dados
    if (!s.configurado) {
      return (
        <p className="py-4 text-sm text-[var(--text-secondary)]">
          Este tipo de processo ainda não tem SLA configurado. Defina os prazos em{" "}
          <span className="text-white/80">Gerenciamento › Workflow › Fluxos › Workflow Macro</span>.
        </p>
      )
    }

    const st = ESTILO_STATUS_SLA[s.status]
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Campo rotulo="Prazo previsto" valor={formatarData(s.prazoPrevisto)} />
          <Campo
            rotulo="Tempo decorrido"
            valor={`${s.diasDecorridos} de ${s.prazoTotalDias} ${plural(s.prazoTotalDias)}`}
          />
          <Campo
            rotulo="Dias restantes"
            valor={s.diasRestantes > 0 ? `${s.diasRestantes} ${plural(s.diasRestantes)}` : "—"}
            destaque={s.status === "proximo_vencimento" ? st.texto : undefined}
          />
          <Campo
            rotulo="Dias em atraso"
            valor={s.diasAtraso > 0 ? `${s.diasAtraso} ${plural(s.diasAtraso)}` : "—"}
            destaque={s.diasAtraso > 0 ? "text-red-700" : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-[var(--border-default)] pt-3 sm:grid-cols-3">
          <Campo
            rotulo="Fase atual"
            valor={
              s.faseAtual
                ? s.faseAtual.slaDias > 0
                  ? `${s.faseAtual.label} · ${s.faseAtual.diasDecorridos}/${s.faseAtual.slaDias} ${plural(s.faseAtual.slaDias)}`
                  : `${s.faseAtual.label} · sem SLA de fase`
                : "—"
            }
            destaque={s.faseAtual?.status === "atrasado" ? "text-red-700" : undefined}
          />
          <Campo
            rotulo="Fase responsável pelo atraso"
            valor={
              s.faseResponsavelAtraso
                ? `${s.faseResponsavelAtraso.label} · +${s.faseResponsavelAtraso.diasExcedidos} ${plural(s.faseResponsavelAtraso.diasExcedidos)}`
                : "Nenhuma fase estourou o prazo"
            }
            destaque={s.faseResponsavelAtraso ? "text-red-700" : undefined}
          />
          <Campo
            rotulo="Próximo vencimento"
            valor={
              s.proximoVencimento
                ? `${formatarData(s.proximoVencimento.data)} · ${s.proximoVencimento.rotulo}`
                : s.concluido
                  ? "Processo encerrado"
                  : "—"
            }
          />
        </div>
      </div>
    )
  })()

  return (
    <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          <CalendarClock className="h-4 w-4" /> SLA
        </h3>
        {dados && <SlaBadge status={dados.status} rotulo={dados.rotuloStatus} />}
      </div>
      {corpo}
    </section>
  )
}
