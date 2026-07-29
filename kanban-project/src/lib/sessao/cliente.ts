// src/lib/sessao/cliente.ts
// ============================================================================
// GERENTE DE SESSÃO (cliente) — UMA instância, UM timer, todas as abas.
//
// Como funciona:
//  • a verdade de tempo é o próprio token (exp + sessaoInicio). Depois de um
//    refresh de página o estado se reconstrói dele, sem depender de memória;
//  • atividade real do usuário (ponteiro/teclado/rolagem/foco) é registrada com
//    throttle e ANUNCIADA às outras abas — usar uma aba mantém todas vivas;
//  • um único timer, que alterna entre 5 s (repouso) e 1 s (contagem regressiva).
//    Nada de um timer por listener, nada de timer por componente;
//  • a renovação só sai quando resta pouco E houve atividade desde a emissão do
//    token. Sem isso, "renovar durante o uso" viraria uma chamada por clique;
//  • encerrar propaga por BroadcastChannel e por `storage` (fallback), então as
//    outras abas saem no mesmo instante — sem esperar o próprio tick.
//
// `iniciarSessao` devolve a função de parada; quem monta é responsável por
// chamá-la. Sem listener órfão, sem timer órfão.
// ============================================================================
"use client"

import {
  avaliarSessao, devoRenovar, type EstadoSessao, type MotivoEncerramento,
} from "@/lib/sessao/politica"

const CANAL = "discovery:sessao"
const K_ATIVIDADE = "sessao:ultimaAtividade"
const K_ENCERRADA = "sessao:encerrada"
const THROTTLE_ATIVIDADE_MS = 5_000
const TICK_REPOUSO_MS = 5_000
const TICK_AVISO_MS = 1_000

export interface TokenLido {
  exp: number
  sessaoInicio: number
  iat: number
  email: string | null
}

/** Lê as datas do JWT sem verificar assinatura — a autoridade é o servidor. */
export function lerToken(token: string | null): TokenLido | null {
  if (!token) return null
  try {
    const corpo = token.split(".")[1]
    if (!corpo) return null
    const json = atob(corpo.replace(/-/g, "+").replace(/_/g, "/"))
    const p = JSON.parse(json) as Record<string, unknown>
    const exp = typeof p.exp === "number" ? p.exp * 1000 : 0
    const iat = typeof p.iat === "number" ? p.iat * 1000 : 0
    if (!exp) return null
    return {
      exp,
      iat,
      sessaoInicio: typeof p.sessaoInicio === "number" ? p.sessaoInicio : iat,
      email: typeof p.email === "string" ? p.email : null,
    }
  } catch {
    return null
  }
}

const token = (): string | null => (typeof window !== "undefined" ? localStorage.getItem("authToken") : null)

function limparCredenciais() {
  localStorage.removeItem("authToken")
  localStorage.removeItem("user")
  document.cookie = "authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
}

/**
 * ENCERRAMENTO ÚNICO da sessão — o único caminho de saída do sistema.
 * Audita no servidor, apaga credenciais, avisa as outras abas e vai para o login.
 * `propagar=false` quando a saída já veio de outra aba (evita eco infinito).
 */
export async function encerrarSessao(motivo: MotivoEncerramento = "manual", propagar = true): Promise<void> {
  if (typeof window === "undefined") return
  const t = token()
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({ motivo }),
      // Sobrevive à navegação que vem logo em seguida.
      keepalive: true,
    })
  } catch {
    /* sair nunca pode ficar preso numa falha de rede */
  }
  limparCredenciais()
  if (propagar) {
    try { localStorage.setItem(K_ENCERRADA, `${motivo}:${Date.now()}`) } catch { /* storage cheio */ }
    anunciar({ tipo: "encerrada", motivo })
  }
  window.location.href = "/login"
}

// ── canal entre abas ────────────────────────────────────────────────────────
type Mensagem =
  | { tipo: "atividade"; em: number }
  | { tipo: "renovado"; token: string }
  | { tipo: "encerrada"; motivo: MotivoEncerramento }

let canal: BroadcastChannel | null = null
function obterCanal(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null
  if (!canal) canal = new BroadcastChannel(CANAL)
  return canal
}
function anunciar(m: Mensagem) {
  try { obterCanal()?.postMessage(m) } catch { /* canal fechado */ }
}

// ── gerente ─────────────────────────────────────────────────────────────────
export interface OpcoesSessao {
  /** Chamado a cada avaliação — a UI só desenha o que vier daqui. */
  aoEstado: (e: EstadoSessao | null) => void
  /** Agora injetável para teste; em produção é Date.now. */
  agora?: () => number
}

export interface Sessao {
  /** Renova imediatamente (botão "Continuar conectado"). */
  renovarAgora: () => Promise<void>
  /** Marca atividade manualmente (usado pela própria UI do aviso). */
  registrarAtividade: () => void
  parar: () => void
}

export function iniciarSessao({ aoEstado, agora = Date.now }: OpcoesSessao): Sessao {
  let vivo = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let periodoAtual = 0
  let ultimaAtividade = lerUltimaAtividade() ?? agora()
  let renovando = false

  function lerUltimaAtividade(): number | null {
    try {
      const v = localStorage.getItem(K_ATIVIDADE)
      return v ? Number(v) : null
    } catch { return null }
  }

  function marcarAtividade(propagar = true) {
    const t = agora()
    if (t - ultimaAtividade < THROTTLE_ATIVIDADE_MS) return
    ultimaAtividade = t
    try { localStorage.setItem(K_ATIVIDADE, String(t)) } catch { /* storage cheio */ }
    if (propagar) anunciar({ tipo: "atividade", em: t })
  }

  async function renovar(): Promise<void> {
    if (renovando || !vivo) return
    renovando = true
    try {
      const t = token()
      const r = await fetch("/api/auth/sessao", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) {
        await encerrarSessao(j?.motivo === "expiracao_absoluta" ? "expiracao_absoluta" : "token_invalido")
        return
      }
      if (j.renovado && typeof j.token === "string") {
        localStorage.setItem("authToken", j.token)
        document.cookie = `authToken=${j.token}; path=/; max-age=${Math.max(0, Math.ceil((j.expiraEm - agora()) / 1000))}`
        anunciar({ tipo: "renovado", token: j.token })
      }
    } catch {
      /* rede instável não derruba a sessão: o próximo tick tenta de novo */
    } finally {
      renovando = false
    }
  }

  function avaliar() {
    if (!vivo) return
    const info = lerToken(token())
    if (!info) { aoEstado(null); agendar(TICK_REPOUSO_MS); return }

    const t = agora()
    const estado = avaliarSessao(t, info.exp, info.sessaoInicio)
    aoEstado(estado)

    if (estado.expirada) {
      void encerrarSessao(estado.motivo ?? "inatividade")
      return
    }
    // Renova quando a janela está acabando E houve uso desde a emissão do token.
    if (devoRenovar(t, info.exp, info.sessaoInicio) && ultimaAtividade >= info.iat) void renovar()

    agendar(estado.emAviso ? TICK_AVISO_MS : TICK_REPOUSO_MS)
  }

  function agendar(periodo: number) {
    if (!vivo) return
    // Um timer só. Se o período não mudou, deixa o agendamento em pé.
    if (timer && periodo === periodoAtual) return
    if (timer) clearTimeout(timer)
    periodoAtual = periodo
    timer = setTimeout(() => { timer = null; periodoAtual = 0; avaliar() }, periodo)
  }

  // ── escutas ──
  const eventos: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel", "touchstart", "focus"]
  const aoAgir = () => marcarAtividade()
  const aoVisibilidade = () => { if (document.visibilityState === "visible") { marcarAtividade(); avaliar() } }
  const aoStorage = (e: StorageEvent) => {
    if (e.key === K_ENCERRADA && e.newValue) { void encerrarSessao("outra_aba", false); return }
    if (e.key === K_ATIVIDADE && e.newValue) ultimaAtividade = Math.max(ultimaAtividade, Number(e.newValue))
    if (e.key === "authToken") avaliar()
  }
  const aoMensagem = (ev: MessageEvent<Mensagem>) => {
    const m = ev.data
    if (m?.tipo === "atividade") ultimaAtividade = Math.max(ultimaAtividade, m.em)
    else if (m?.tipo === "renovado") avaliar()
    else if (m?.tipo === "encerrada") void encerrarSessao(m.motivo, false)
  }

  if (typeof window !== "undefined") {
    for (const e of eventos) window.addEventListener(e, aoAgir, { passive: true })
    document.addEventListener("visibilitychange", aoVisibilidade)
    window.addEventListener("storage", aoStorage)
    obterCanal()?.addEventListener("message", aoMensagem as EventListener)
    avaliar()
  }

  return {
    renovarAgora: async () => { marcarAtividade(); await renovar(); avaliar() },
    registrarAtividade: () => marcarAtividade(),
    parar: () => {
      vivo = false
      if (timer) { clearTimeout(timer); timer = null }
      if (typeof window !== "undefined") {
        for (const e of eventos) window.removeEventListener(e, aoAgir)
        document.removeEventListener("visibilitychange", aoVisibilidade)
        window.removeEventListener("storage", aoStorage)
        obterCanal()?.removeEventListener("message", aoMensagem as EventListener)
      }
    },
  }
}
