"use client"
// SUGESTÃO NUNCA ATRIBUI SOZINHA (06/10/2026). Toda ação da Torre que atribui a partir de uma SUGESTÃO passa por aqui: a 1ª chamada ao
// servidor devolve a prévia (HTTP 428, nada gravado); o modal pergunta "Atribuir X a Y?" e só a confirmação explícita reenvia com
// `confirmado: true` + a assinatura da prévia. "Cancelar" não grava nada. Ver `src/lib/torre-confirmacao.ts` (servidor).
import { useCallback, useState, type ReactNode } from "react"
import { api, type RespostaApi } from "./torre-base"

interface Previa { pergunta: string; itens: Array<{ pessoa: string; quantidade: number; tarefas: string[] }>; assinatura: string }

export function useConfirmarAtribuicao(): { postar: <T = Record<string, unknown>>(url: string, corpo?: Record<string, unknown>) => Promise<RespostaApi<T>>; modal: ReactNode } {
  const [pend, setPend] = useState<{ previa: Previa; resolver: (sim: boolean) => void } | null>(null)

  const postar = useCallback(async <T,>(url: string, corpo: Record<string, unknown> = {}): Promise<RespostaApi<T>> => {
    const r1 = await api<T>(url, "POST", corpo)
    if (r1.status !== 428) return r1
    const previa = (r1.data as unknown as { confirmacao?: Previa }).confirmacao
    if (!previa) return r1
    const sim = await new Promise<boolean>((resolver) => setPend({ previa, resolver }))
    setPend(null)
    if (!sim) return { status: 0, ok: false, data: { mensagem: "Atribuição não confirmada — nada foi gravado." } as unknown as T }
    return api<T>(url, "POST", { ...corpo, confirmado: true, assinatura: previa.assinatura })
  }, [])

  const modal = pend ? (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-[var(--overlay-modal)] p-4" data-testid="confirmar-atribuicao" role="dialog" aria-modal="true">
      <div className="bg-[var(--surface-popover)] text-white rounded-xl shadow-[var(--elev-3)] w-full max-w-md p-5">
        <h3 className="text-base font-bold">{pend.previa.pergunta}</h3>
        <ul className="mt-3 space-y-2 text-sm max-h-60 overflow-auto">
          {pend.previa.itens.map((i) => (
            <li key={i.pessoa}><b>{i.pessoa}</b> — {i.quantidade} {i.quantidade === 1 ? "tarefa" : "tarefas"}
              <div className="opacity-70 text-xs">{i.tarefas.slice(0, 6).join(" · ")}{i.tarefas.length > 6 ? ` · +${i.tarefas.length - 6}` : ""}</div>
            </li>
          ))}
        </ul>
        <p className="text-xs opacity-70 mt-3">É uma sugestão do sistema. Só será gravada se você confirmar; fica no histórico como &quot;via sugestão (confirmada)&quot;.</p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="tor-btn" onClick={() => pend.resolver(false)}>Cancelar</button>
          <button type="button" className="tor-btn pri" onClick={() => pend.resolver(true)}>Confirmar atribuição</button>
        </div>
      </div>
    </div>
  ) : null

  return { postar, modal }
}
