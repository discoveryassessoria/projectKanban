// src/components/arvore/sincronizar-com-genealogia.tsx
// ============================================================================
// "SINCRONIZAR COM A GENEALOGIA" (06/10/2026) — botão na árvore de cada processo. Mostra a LISTA DE DIFERENÇAS entre a árvore e os registros localizados (campo, valor da
// árvore, valor do registro) e só aplica depois de confirmação. Vale o registro; cada campo gravado vai ao histórico (antes → depois) e as divergências ficam como
// "resolvidas" na Inteligência da árvore. Nunca cria, remove nem religa pessoa. Nenhum script em massa: cada processo faz a sua.
// ============================================================================
"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Loader2 } from "lucide-react"
import { LAYER } from "@/src/lib/ui/layers"

interface Item { chave: string; rotulo: string; alvo: "PESSOA" | "UNIAO"; alvoId: number; pessoaNome: string; tipo: "PREENCHER" | "CONFLITO"; arvoreTexto: string; registroTexto: string; logId?: number }
interface Previa { itens: Item[]; registrosLocalizados: number; preencher: number; conflitos: number }

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const chaveDe = (i: Item) => `${i.alvo}:${i.alvoId}:${i.chave}`

export function SincronizarComGenealogiaModal({ arvoreId, onFechar, onAplicado }: { arvoreId: number; onFechar: () => void; onAplicado?: () => void }) {
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aplicando, setAplicando] = useState(false)
  const [aplicados, setAplicados] = useState<Item[] | null>(null)
  const [desfeitos, setDesfeitos] = useState<Set<number>>(new Set())

  useEffect(() => {
    let vivo = true
    void fetch(`/api/arvore/${arvoreId}/sincronizacao`, { headers: auth() }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((p: Previa) => {
      if (!vivo) return
      setPrevia(p); setMarcados(new Set(p.itens.map(chaveDe)))
    }).catch(() => { if (vivo) setErro("Não foi possível ler as diferenças agora.") })
    return () => { vivo = false }
  }, [arvoreId])

  const aplicar = async () => {
    setAplicando(true); setErro(null)
    try {
      const r = await fetch(`/api/arvore/${arvoreId}/sincronizacao`, { method: "POST", headers: auth(), body: JSON.stringify({ confirmar: true, selecao: [...marcados] }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? "Não foi possível sincronizar. Nada foi alterado."); return }
      setAplicados(j.aplicados ?? []); onAplicado?.()
    } catch { setErro("Não foi possível sincronizar agora. Nada foi alterado.") } finally { setAplicando(false) }
  }
  const desfazer = async (logId: number) => {
    const r = await fetch(`/api/sincronizacao-registral/${logId}/desfazer`, { method: "POST", headers: auth() })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setDesfeitos((s) => new Set(s).add(logId)); onAplicado?.() } else setErro(j.error ?? "Não foi possível desfazer.")
  }

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: LAYER.aboveProcessCritical }} data-testid="modal-sincronizar-genealogia">
      <div className="w-[760px] max-w-[95vw] max-h-[92vh] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface-popover)] p-5">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Sincronizar com a Genealogia</h3>
        <p className="text-[12px] text-[var(--text-secondary)] mb-3">A árvore começa como guia; o dado real é o do registro localizado na Genealogia. Quando diferem, vale o do registro. Nada é criado, removido ou religado.</p>
        {!previa && !erro && <div className="flex items-center gap-2 text-[13px] py-6"><Loader2 className="w-4 h-4 animate-spin" /> Lendo as diferenças…</div>}
        {erro && <div className="text-[12px] text-[var(--warning-text)] mb-2">{erro}</div>}

        {aplicados ? (
          <div data-testid="resultado-sincronizacao">
            <p className="text-[13px] mb-2">{aplicados.length === 0 ? "Nada a sincronizar." : `${aplicados.length} campo${aplicados.length === 1 ? "" : "s"} sincronizado${aplicados.length === 1 ? "" : "s"}:`}</p>
            <ul className="space-y-1.5 mb-3">
              {aplicados.map((a, i) => (
                <li key={i} className="text-[12.5px] flex items-center gap-2 flex-wrap">
                  <span><b>{a.pessoaNome}</b> — {a.rotulo}: {a.arvoreTexto} → {a.registroTexto}</span>
                  {a.logId != null && (desfeitos.has(a.logId) ? <span className="text-[11px] text-[var(--text-secondary)]">desfeito</span> : <button type="button" onClick={() => void desfazer(a.logId!)} className="text-[11px] underline text-[var(--accent-text)]">Desfazer</button>)}
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><button type="button" onClick={onFechar} className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-primary)] text-white">Fechar</button></div>
          </div>
        ) : previa && (
          <>
            <p className="text-[12px] mb-2" data-testid="resumo-sincronizacao">
              {previa.registrosLocalizados === 0 ? "Nenhum registro localizado ainda neste processo." : previa.itens.length === 0 ? `${previa.registrosLocalizados} registro(s) localizado(s): a árvore já está de acordo.` : `${previa.itens.length} diferença(s): ${previa.preencher} para preencher (vazio na árvore) e ${previa.conflitos} onde a árvore diverge do registro.`}
            </p>
            {previa.itens.length > 0 && (
              <div className="rounded-md border border-[var(--border-default)] overflow-hidden mb-3">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-[var(--surface-secondary)] text-left text-[10.5px] uppercase text-[var(--text-secondary)]">
                    <tr><th className="px-2 py-1.5 w-8" /><th className="px-2 py-1.5">Pessoa · campo</th><th className="px-2 py-1.5">Valor da árvore</th><th className="px-2 py-1.5">Valor do registro</th><th className="px-2 py-1.5">O que acontece</th></tr>
                  </thead>
                  <tbody>
                    {previa.itens.map((i) => (
                      <tr key={chaveDe(i)} className="border-t border-[var(--border-default)]">
                        <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Aplicar ${i.rotulo} de ${i.pessoaNome}`} checked={marcados.has(chaveDe(i))} onChange={(e) => setMarcados((s) => { const n = new Set(s); if (e.target.checked) n.add(chaveDe(i)); else n.delete(chaveDe(i)); return n })} /></td>
                        <td className="px-2 py-1.5"><b>{i.pessoaNome}</b><div className="text-[11px] text-[var(--text-secondary)]">{i.rotulo}</div></td>
                        <td className="px-2 py-1.5">{i.arvoreTexto}</td>
                        <td className="px-2 py-1.5 font-semibold">{i.registroTexto}</td>
                        <td className="px-2 py-1.5 text-[11.5px]">{i.tipo === "PREENCHER" ? "preenche o vazio" : "vale o registro (divergência resolvida)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onFechar} className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--border-default)] text-[var(--text-primary)]">Cancelar</button>
              <button type="button" data-testid="confirmar-sincronizacao" disabled={aplicando || marcados.size === 0} onClick={() => void aplicar()} className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--accent-primary)] text-white disabled:opacity-50">
                {aplicando ? "Aplicando…" : `Confirmar e aplicar (${marcados.size})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
