"use client"
// src/components/torre/torre-base.tsx
// ============================================================================
// BASE DA TORRE (Blocos G/H) — contexto (toast com "Desfazer" — FIXO na Torre, 6 s fora dela —, recarga,
// permissões), o cliente HTTP e a Modal comum. Nada aqui decide regra: a tela só
// chama as portas /api/torre/… e mostra o resultado real (item a item).
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { JANELA_DO_DESFAZER_MS, JANELA_DO_DESFAZER_TEXTO } from "@/lib/operacional/torre-desfazer"
import { auth } from "@/src/components/operacao/kit-operacional"

export interface PermissoesTorre {
  editar: boolean; bloquear: boolean; iniciar: boolean; equipe: boolean; admin: boolean; usuarioId: number
}
export interface Desfazer { tipo: "ATRIBUICAO" | "PRIORIDADE" | "PRAZO" | "AUSENCIA" | "COBRANCA"; tarefaIds: number[]; /** "COBRANCA": os contatos que a ação criou (o Desfazer os ESTORNA, não os apaga). */ contatoIds?: number[]; /** "Aplicar saída": o Desfazer encerra a ausência junto. "AUSENCIA" (Marcar ausência): só ela, sem tarefas. */ ausenciaId?: number }

/** A janela do "Desfazer" é UMA SÓ na Torre inteira (`lib/operacional/torre-desfazer.ts`): cliente e servidor leem a mesma constante. */
export { JANELA_DO_DESFAZER_MS }
/** Toast sem `fixo` (telas fora da Torre, ex.: Gerenciamento › Saúde) some sozinho depois disto. */
const TOAST_AUTOMATICO_MS = 6000

export interface RespostaApi<T = Record<string, unknown>> { status: number; ok: boolean; data: T }

/** Uma chamada às portas — devolve sempre o corpo (mesmo em erro), nunca lança. */
export async function api<T = Record<string, unknown>>(url: string, metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET", corpo?: unknown): Promise<RespostaApi<T>> {
  try {
    const r = await fetch(url, { method: metodo, headers: auth(), ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) })
    const data = (await r.json().catch(() => ({}))) as T
    return { status: r.status, ok: r.ok, data }
  } catch {
    return { status: 0, ok: false, data: { mensagem: "Erro de conexão." } as unknown as T }
  }
}

/** A mensagem de erro de qualquer porta (`mensagem`, `erro` ou `error`). */
export function erroDe(d: unknown, padrao = "Não foi possível concluir a ação."): string {
  const o = (d ?? {}) as Record<string, unknown>
  for (const k of ["mensagem", "erro", "error"]) if (typeof o[k] === "string" && o[k]) return o[k] as string
  return padrao
}

/** O que o Relatório de controle precisa saber de uma família. */
export interface AlvoDoRelatorio { processoId: number; familiaId: number | null; familiaNome: string; codigo: string | null }

interface Ctx {
  permissoes: PermissoesTorre | null
  avisar: (msg: string, desfazer?: Desfazer | null) => void
  recarregar: () => void
  /** Abre o Foco da família (Bloco I3) — de qualquer aba (Tarefas, Radar, Processos). Implementado pelo casco (Torre.tsx). */
  abrirFoco: (processoId: number) => void
  /** Abre o Relatório de controle (Bloco I4) — de qualquer aba. Implementado pelo casco (Torre.tsx). */
  abrirRelatorio: (alvo: AlvoDoRelatorio) => void
}
const TorreCtx = createContext<Ctx | null>(null)
export const useTorre = (): Ctx => {
  const c = useContext(TorreCtx)
  if (!c) throw new Error("useTorre fora do TorreProvider")
  return c
}

export function TorreProvider({ permissoes, recarregar, fixo = false, abrirFoco = () => {}, abrirRelatorio = () => {}, children }: {
  permissoes: PermissoesTorre | null; recarregar: () => void
  /** Toast FIXO (T013–T015): não some sozinho — só pelo ✕ ou quando outro o substitui — e fica acima de modais e gaveta. A Torre usa; o resto mantém os 6 s. */
  fixo?: boolean
  abrirFoco?: (processoId: number) => void; abrirRelatorio?: (alvo: AlvoDoRelatorio) => void; children: ReactNode
}) {
  const [toast, setToast] = useState<{ msg: string; desfazer: Desfazer | null; em: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Fixo: o aviso fica até o ✕ ou até outro aviso o substituir. Sem `fixo`: some em 6 s (Decisão 6 do Passo 0).
  const avisar = useCallback((msg: string, desfazer: Desfazer | null = null) => {
    setToast({ msg, desfazer, em: Date.now() })
    if (timer.current) clearTimeout(timer.current)
    timer.current = fixo ? null : setTimeout(() => setToast(null), TOAST_AUTOMATICO_MS)
  }, [fixo])

  const desfazer = async () => {
    const d = toast?.desfazer
    if (!d) return
    // O servidor só aceita o Desfazer dentro da janela única. Como o aviso fixo pode ficar na tela além disso, o botão NUNCA falha em silêncio:
    // passou da janela → mensagem clara (o servidor também recusaria; a tarefa pode ser corrigida pela própria gaveta).
    if (fixo && Date.now() - toast.em > JANELA_DO_DESFAZER_MS) {
      avisar(`Não foi possível desfazer: passaram mais de ${JANELA_DO_DESFAZER_TEXTO} desde a ação. Corrija pela própria tarefa (tudo fica no histórico).`)
      return
    }
    setToast(null)
    const r = await api<{ total: number; desfeitas: number; mensagem?: string; itens: Array<{ ok: boolean; mensagem: string }> }>("/api/torre/tarefas/desfazer", "POST", d)
    if (r.data && typeof r.data.desfeitas === "number") {
      const falha = r.data.itens?.find((i) => !i.ok)
      if (d.tipo === "AUSENCIA" && r.data.mensagem) { avisar(r.data.desfeitas === 0 ? `Não foi possível desfazer: ${r.data.mensagem}` : r.data.mensagem); recarregar(); return }
      avisar(r.data.desfeitas === 0 && falha ? `Não foi possível desfazer: ${falha.mensagem}` : `Desfeito: ${r.data.desfeitas} de ${r.data.total}.${falha ? ` ${falha.mensagem}` : ""}`)
    } else avisar(erroDe(r.data))
    recarregar()
  }

  return (
    <TorreCtx.Provider value={{ permissoes, avisar, recarregar, abrirFoco, abrirRelatorio }}>
      {children}
      {toast && (
        <div className="tor-toast" role="status">
          <span>{toast.msg}</span>
          {toast.desfazer && <button className="tor-btn" onClick={() => void desfazer()}>Desfazer</button>}
          <button className="tor-btn" aria-label="Fechar aviso" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
    </TorreCtx.Provider>
  )
}

/** Resume um lote item a item: "3 de 4 · primeira falha: …". */
export function resumoDoLote(d: { total?: number; sucesso?: number; itens?: Array<{ ok: boolean; mensagem?: string }> }): string {
  const falha = d.itens?.find((i) => !i.ok)
  return `${d.sucesso ?? 0} de ${d.total ?? 0}${falha ? ` · ${d.itens!.filter((i) => !i.ok).length} não passou(aram): ${falha.mensagem ?? "recusada"}` : ""}`
}

export function Modal({ titulo, subtitulo, onFechar, children, rodape, ocupado }: {
  titulo: string; subtitulo?: string; onFechar: () => void; children: ReactNode; rodape: ReactNode; ocupado?: boolean
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] px-4" style={{ zIndex: LAYER.popover }} onClick={ocupado ? undefined : onFechar}>
      <div role="dialog" aria-label={titulo} className="tor w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--surface-popover)] shadow-[var(--elev-3)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-[15px] font-extrabold">{titulo}</h3>
          {subtitulo && <p className="small mt-0.5">{subtitulo}</p>}
        </div>
        {children}
        <div className="flex items-center justify-end gap-2 pt-1">{rodape}</div>
      </div>
    </div>
  )
}

export const Campo = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</span>
    {children}
  </label>
)

/** Modal de um campo de texto obrigatório + confirmar (motivo de bloqueio, justificativa de reabertura…). */
export function ModalTexto({ titulo, subtitulo, rotulo, confirmar, minimo = 5, onFechar, onEnviar }: {
  titulo: string; subtitulo?: string; rotulo: string; confirmar: string; minimo?: number
  onFechar: () => void; onEnviar: (texto: string) => Promise<{ ok: boolean; mensagem?: string }>
}) {
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const valido = texto.trim().length >= minimo
  const enviar = async () => {
    setEnviando(true); setErro(null)
    const r = await onEnviar(texto.trim())
    setEnviando(false)
    if (!r.ok) setErro(r.mensagem ?? "Não foi possível concluir.")
  }
  return (
    <Modal titulo={titulo} subtitulo={subtitulo} onFechar={onFechar} ocupado={enviando} rodape={<>
      <button className="tor-btn" onClick={onFechar} disabled={enviando}>Cancelar</button>
      <button className="tor-btn pri" onClick={() => void enviar()} disabled={enviando || !valido}>{enviando ? "Enviando…" : confirmar}</button>
    </>}>
      <Campo rotulo={`${rotulo} (obrigatório)`}>
        <textarea className="tor-in w-full" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Campo>
      {erro && <div className="text-[12px] rounded-lg px-3 py-2 bg-[var(--danger-tile)] text-[var(--danger-text)]">{erro}</div>}
    </Modal>
  )
}

export const fmtDia = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }) : "—")
export const fmtDataHora = (iso: string): string => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
