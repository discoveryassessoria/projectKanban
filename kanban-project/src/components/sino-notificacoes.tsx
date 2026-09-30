"use client"

// src/components/sino-notificacoes.tsx
// ============================================================================
// O SININHO — UM componente só (redesenho 29/09/2026). Os dois cabeçalhos
// (`header-bar.tsx` e `header-bar-app.tsx`) tinham, cada um, sua cópia do sino; agora os
// dois usam este.
//
// PRINCÍPIO: o sino mostra o que é NOVO desde a última vez que a pessoa olhou. A lista
// de pendências é a Operação. Ele lê SÓ `/api/notificacoes` (a tabela de avisos): nenhum
// balde de prazo é recalculado aqui.
//
// "Viu, saiu": abrir o sino NÃO apaga nada; clicar no aviso o marca como lido, tira do
// contador e leva à Operação já na família. "Marcar todas como lidas" limpa o contador.
// Os lidos ficam em "Ver anteriores" por 30 dias.
// ============================================================================
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Bell } from "lucide-react"
import { useJsonLocalStorage } from "@/src/lib/cliente"
import { linkDoAvisoParaAdmin } from "@/src/lib/torre-absorcao"

interface AvisoDoSino {
  id: number
  tipo: string
  titulo: string
  link: string | null
  familiaId: number | null
  contagem: number
  atualizadoEm: string
  lidaEm: string | null
}

interface RespostaDoSino {
  avisos: AvisoDoSino[]
  anteriores: AvisoDoSino[]
  total: number
}

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const fetcher = async (url: string): Promise<RespostaDoSino> => {
  if (!authHeaders().Authorization) throw new Error("Sem token")
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Cor do marcador por tipo — só três significados (trabalho novo / agir / saiu) + gestor. */
const COR_DO_TIPO: Record<string, string> = {
  CHEGOU_TRABALHO: "border-[var(--action-primary)]",
  PRECISA_AGIR: "border-amber-500",
  MUDOU_DE_MAO: "border-[var(--border-strong)]",
  ESCALADA: "border-red-500",
  SEM_RESPONSAVEL: "border-red-500",
  INTEGRIDADE: "border-red-500",
  FASE_CONCLUIDA: "border-[var(--border-strong)]",
}

function haQuanto(iso: string, agora = Date.now()): string {
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60_000))
  if (min < 1) return "agora"
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return `há ${d} ${d === 1 ? "dia" : "dias"}`
}

export function SinoNotificacoes() {
  const router = useRouter()
  const usuarioSalvo = useJsonLocalStorage<{ tipo?: string }>("user")
  const [aberto, setAberto] = useState(false)
  const [verAnteriores, setVerAnteriores] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)

  const opcoes = { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 10000, errorRetryCount: 2 }
  const { data, mutate } = useSWR("/api/notificacoes", fetcher, opcoes)
  // "Anteriores" só é buscado quando a pessoa pede — o contador nunca depende dele.
  const { data: comAnteriores } = useSWR(aberto && verAnteriores ? "/api/notificacoes?anteriores=1" : null, fetcher)

  const avisos = data?.avisos ?? []
  const total = data?.total ?? 0
  const anteriores = comAnteriores?.anteriores ?? []

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto])

  // Marcar como lida NUNCA muda estado operacional — só `lidaEm` do próprio aviso. A
  // falha é silenciosa de propósito: não pode bloquear a navegação ao trabalho real.
  const abrirAviso = (a: AvisoDoSino) => {
    setAberto(false)
    if (a.lidaEm == null) {
      void mutate(
        (atual) => atual && { ...atual, avisos: atual.avisos.filter((x) => x.id !== a.id), total: Math.max(0, atual.total - 1) },
        { revalidate: false },
      )
      fetch(`/api/notificacoes/${a.id}/lida`, { method: "POST", headers: authHeaders() })
        .catch(() => {})
        .finally(() => void mutate())
    }
    // ADMIN: o link do aviso é traduzido para o lugar equivalente na Torre (aviso já gravado continua valendo).
    const destino = linkDoAvisoParaAdmin(a.link, usuarioSalvo?.tipo)
    if (destino) router.push(destino)
  }

  const marcarTodas = () => {
    void mutate((atual) => atual && { ...atual, avisos: [], total: 0 }, { revalidate: false })
    fetch("/api/notificacoes/marcar-todas", { method: "POST", headers: authHeaders() })
      .catch(() => {})
      .finally(() => void mutate())
  }

  const renderLinha = (a: AvisoDoSino, lido: boolean) => (
    <button
      key={`${lido ? "ant" : "novo"}-${a.id}`}
      className={`w-full text-left px-3 py-2 border-l-4 ${COR_DO_TIPO[a.tipo] ?? "border-[var(--border-default)]"} hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer block ${lido ? "opacity-60" : ""}`}
      onClick={() => abrirAviso(a)}
    >
      <p className={`text-sm text-[var(--text-primary)] ${lido ? "" : "font-medium"}`}>{a.titulo}</p>
      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{haQuanto(lido && a.lidaEm ? a.lidaEm : a.atualizadoEm)}</p>
    </button>
  )

  return (
    <div className="relative hidden md:block" ref={raiz}>
      <button
        className="relative inline-flex items-center justify-center rounded-full p-2 border border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition"
        onClick={() => setAberto(!aberto)}
        aria-label={total > 0 ? `Notificações: ${total} não lidas` : "Notificações"}
      >
        <Bell className="h-4 w-4 text-white" aria-hidden="true" />
        {total > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-600 border-2 border-[var(--border-default)] text-[10px] font-bold flex items-center justify-center">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute top-full mt-2 right-0 w-80 bg-[var(--surface-primary)] border border-gray-200 rounded-xl shadow-[var(--elev-3)] overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-gray-800 text-sm">Notificações</h3>
              <p className="text-xs text-gray-500">{total} {total === 1 ? "não lida" : "não lidas"}</p>
            </div>
            {total > 0 && (
              <button className="text-xs text-[var(--action-primary)] hover:underline flex-none mt-0.5" onClick={marcarTodas}>
                Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {avisos.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="h-10 w-10 mx-auto mb-2 text-[var(--text-muted)]" aria-hidden="true" />
                <p className="text-sm text-gray-500">Nada novo</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Você está em dia!</p>
              </div>
            ) : (
              avisos.map((a) => renderLinha(a, false))
            )}

            <button
              className="w-full px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] border-t border-gray-100 text-left"
              onClick={() => setVerAnteriores((v) => !v)}
            >
              {verAnteriores ? "Ocultar anteriores" : "Ver anteriores"}
            </button>
            {verAnteriores && (
              anteriores.length === 0
                ? <p className="px-3 py-3 text-xs text-[var(--text-muted)]">Nenhum aviso lido nos últimos 30 dias.</p>
                : anteriores.map((a) => renderLinha(a, true))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
