// src/components/sessao/SessaoProvider.tsx
// ============================================================================
// Monta o gerente de sessão UMA vez, na raiz da aplicação, e desenha o aviso
// com contagem regressiva. Fora isso não interfere em nada: sem token (tela de
// login, páginas públicas) o gerente fica quieto e nada é renderizado.
//
// O aviso é informativo e reversível — qualquer atividade real já renova a
// sessão; o botão existe para quem está lendo a tela sem tocar em nada.
// ============================================================================
"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Clock } from "lucide-react"
import { encerrarSessao, iniciarSessao, type Sessao } from "@/src/lib/sessao/cliente"
import { formatarContagem, type EstadoSessao } from "@/lib/sessao/politica"

export function SessaoProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<EstadoSessao | null>(null)
  const sessao = useRef<Sessao | null>(null)

  useEffect(() => {
    const s = iniciarSessao({ aoEstado: setEstado })
    sessao.current = s
    return () => { s.parar(); sessao.current = null }
  }, [])

  return (
    <>
      {children}
      {estado?.emAviso && !estado.expirada && (
        <AvisoSessao
          restanteMs={estado.restanteMs}
          absoluta={estado.motivo === "expiracao_absoluta"}
          onContinuar={() => void sessao.current?.renovarAgora()}
          onSair={() => void encerrarSessao("manual")}
        />
      )}
    </>
  )
}

function AvisoSessao({
  restanteMs, absoluta, onContinuar, onSair,
}: {
  restanteMs: number
  absoluta: boolean
  onContinuar: () => void
  onSair: () => void
}) {
  // Sem guarda de "montado": este componente só é renderizado quando o gerente
  // (que roda em efeito, no cliente) reporta estado de aviso — ou seja, já
  // depois da hidratação. A guarda seria um setState em efeito à toa.
  const conteudo = (
    <div
      role="alertdialog" aria-modal="true" aria-labelledby="sessao-titulo" aria-describedby="sessao-desc"
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-[var(--app-overlay)] p-4"
    >
      <div className="w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", color: "var(--accent-primary)" }}>
            <Clock className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 id="sessao-titulo" className="text-sm font-semibold text-[var(--text-primary)]">
              {absoluta ? "Sua sessão vai encerrar" : "Você ainda está aí?"}
            </h2>
            <p id="sessao-desc" className="mt-1 text-xs text-[var(--text-secondary)]">
              {absoluta
                ? "A duração máxima da sessão foi atingida. Por segurança será necessário entrar de novo."
                : "Por segurança, sessões sem uso são encerradas automaticamente."}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] py-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Encerra em</div>
          <div className="font-mono text-2xl font-semibold text-[var(--text-primary)]" aria-live="polite" data-testid="contagem-sessao">
            {formatarContagem(restanteMs)}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onSair}
            className="rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3.5 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
            Sair agora
          </button>
          {!absoluta && (
            <button type="button" onClick={onContinuar} autoFocus
              className="rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]">
              Continuar conectado
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document !== "undefined" ? createPortal(conteudo, document.body) : null
}
