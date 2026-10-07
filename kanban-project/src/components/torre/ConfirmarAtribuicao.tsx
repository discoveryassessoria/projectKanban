"use client"
// SUGESTÃO NUNCA ATRIBUI SOZINHA (06/10/2026). Toda ação da Torre que atribui a partir de uma SUGESTÃO passa por aqui: a 1ª chamada ao
// servidor devolve a prévia (HTTP 428, nada gravado); o modal pergunta "Atribuir X a Y?" e só a confirmação explícita reenvia com
// `confirmado: true` + a assinatura da prévia. "Cancelar" não grava nada. Ver `src/lib/torre-confirmacao.ts` (servidor).
import { useCallback, useRef, useState, type ReactNode } from "react"
import { LAYER } from "@/src/lib/ui/layers"
import { api, type RespostaApi } from "./torre-base"

interface Previa { pergunta: string; itens: Array<{ pessoa: string; quantidade: number; tarefas: string[] }>; assinatura: string; alerta?: string; exigeConfirmacaoDeAndamento?: boolean; pedeMotivo?: boolean }

export function useConfirmarAtribuicao(): { postar: <T = Record<string, unknown>>(url: string, corpo?: Record<string, unknown>) => Promise<RespostaApi<T>>; modal: ReactNode } {
  const [pend, setPend] = useState<{ previa: Previa; resolver: (sim: boolean) => void } | null>(null)
  const [andamentoOk, setAndamentoOk] = useState(false)
  const [motivo, setMotivo] = useState('')

  const motivoRef = useRef(''); const andamentoRef = useRef(false)
  const postar = useCallback(async <T,>(url: string, corpo: Record<string, unknown> = {}): Promise<RespostaApi<T>> => {
    const r1 = await api<T>(url, "POST", corpo)
    if (r1.status !== 428) return r1
    const previa = (r1.data as unknown as { confirmacao?: Previa }).confirmacao
    if (!previa) return r1
    andamentoRef.current = false; motivoRef.current = ''
    setAndamentoOk(false); setMotivo('')
    const sim = await new Promise<boolean>((resolver) => setPend({ previa, resolver }))
    const m = motivoRef.current, a = andamentoRef.current
    setPend(null)
    if (!sim) return { status: 0, ok: false, data: { mensagem: "Ação não confirmada — nada foi gravado." } as unknown as T }
    return api<T>(url, "POST", { ...corpo, confirmado: true, assinatura: previa.assinatura, ...(previa.pedeMotivo && m.trim() ? { motivo: m.trim() } : {}), ...(previa.exigeConfirmacaoDeAndamento ? { confirmarAndamento: a } : {}) })
  }, [])

  const modal = pend ? (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--overlay-modal)] p-4" style={{ zIndex: LAYER.toast - 5 }} data-testid="confirmar-atribuicao" role="dialog" aria-modal="true">
      <div className="bg-[var(--surface-popover)] text-white rounded-xl shadow-[var(--elev-3)] w-full max-w-md p-5">
        <h3 className="text-base font-bold">{pend.previa.pergunta}</h3>
        <ul className="mt-3 space-y-2 text-sm max-h-60 overflow-auto">
          {pend.previa.itens.map((i) => (
            <li key={i.pessoa}><b>{i.pessoa}</b> — {i.quantidade} {i.quantidade === 1 ? "tarefa" : "tarefas"}
              <div className="opacity-70 text-xs">{i.tarefas.slice(0, 6).join(" · ")}{i.tarefas.length > 6 ? ` · +${i.tarefas.length - 6}` : ""}</div>
            </li>
          ))}
        </ul>
        {pend.previa.alerta && <p className="text-xs mt-3 font-semibold" style={{ color: "var(--warning-text)" }}>{pend.previa.alerta}</p>}
        {pend.previa.exigeConfirmacaoDeAndamento && (
          <label className="flex items-start gap-2 text-xs mt-2"><input type="checkbox" checked={andamentoOk} onChange={(e) => { andamentoRef.current = e.target.checked; setAndamentoOk(e.target.checked) }} />Confirmo remover o responsável de tarefa já iniciada (o andamento é preservado).</label>
        )}
        {pend.previa.pedeMotivo && (
          <textarea value={motivo} onChange={(e) => { motivoRef.current = e.target.value; setMotivo(e.target.value) }} rows={2} placeholder="Motivo (opcional)" className="w-full mt-3 rounded-lg p-2 text-sm bg-transparent border border-[var(--border-default)]" />
        )}
        {!pend.previa.pedeMotivo && <p className="text-xs opacity-70 mt-1">Só será gravada se você confirmar; fica no histórico como &quot;via sugestão (confirmada)&quot;.</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="tor-btn" onClick={() => pend.resolver(false)}>Cancelar</button>
          <button type="button" className="tor-btn pri" disabled={!!pend.previa.exigeConfirmacaoDeAndamento && !andamentoOk} onClick={() => pend.resolver(true)}>{pend.previa.pedeMotivo ? "Remover responsável" : "Confirmar atribuição"}</button>
        </div>
      </div>
    </div>
  ) : null

  return { postar, modal }
}
