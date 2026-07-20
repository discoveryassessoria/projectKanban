// src/components/gerenciamentoComponents/ExclusaoDefinitivaModal.tsx
// Modal ADMIN — duas opções ao excluir algo com histórico:
//   1) Inativar e preservar histórico (quando aplicável)
//   2) Excluir DEFINITIVAMENTE como dado de teste (destrutivo, exige frase + sem uso real)
// A permissão é SEMPRE revalidada no backend; este modal é só a camada de UX.
"use client"

import { useState, useEffect, useCallback } from "react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface Preco { id: number; natureza: string; arquivado: boolean; legadoPendente: boolean; valor: string | null }
interface Preview {
  precos: Preco[]
  blockers: Record<string, number>
  podeExcluir: boolean
  fraseConfirmacao: string
}

const BLOCKER_LABELS: Record<string, string> = {
  lancamentosReceita: "lançamentos de receita", lancamentosCusto: "lançamentos de custo",
  regrasEconomicas: "regras de aplicabilidade econômica", automacoesFase: "automações financeiras de fase",
  vinculosServico: "vínculos de serviço", tiposDocumento: "tipos de documento",
  configsFinanceiras: "configurações financeiras", necessidades: "necessidades em processos",
}

export function ExclusaoDefinitivaModal({ titulo, previewUrl, deleteUrl, onInativar, onDone, onClose }: {
  titulo: string
  previewUrl: string
  deleteUrl: string
  onInativar?: () => Promise<void>
  onDone: () => void
  onClose: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [frase, setFrase] = useState("")
  const [motivo, setMotivo] = useState("")
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch(previewUrl, { headers: authHeaders() })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`); return r.json() })
      .then((j) => setPreview(j))
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [previewUrl])

  const blockersAtivos = preview ? Object.entries(preview.blockers).filter(([k, v]) => k !== "total" && v > 0) : []

  const inativar = useCallback(async () => {
    if (!onInativar) return
    setExecutando(true); setErro(null)
    try { await onInativar(); onDone() } catch (e) { setErro((e as Error).message || "Falha ao inativar.") } finally { setExecutando(false) }
  }, [onInativar, onDone])

  const excluirDefinitivo = useCallback(async () => {
    setExecutando(true); setErro(null)
    try {
      const r = await fetch(deleteUrl, { method: "DELETE", headers: authHeaders(), body: JSON.stringify({ confirmacao: frase.trim(), motivo: motivo.trim() || null }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j?.error || `Falha (HTTP ${r.status}).`); return }
      onDone()
    } catch { setErro("Falha de rede ao excluir definitivamente.") }
    finally { setExecutando(false) }
  }, [deleteUrl, frase, motivo, onDone])

  const fraseOk = !!preview && frase.trim() === preview.fraseConfirmacao

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => !executando && onClose()}>
      <div className="max-w-lg w-full rounded-2xl bg-[#12151b] border border-white/10 shadow-xl text-white/90" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-white/10">
          <h3 className="text-[15px] font-extrabold">{titulo}</h3>
          <p className="text-[12px] text-white/50 mt-0.5">Escolha como remover. Exclusão definitiva é restrita a administradores e só para dados de teste.</p>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {carregando && <div className="text-[13px] text-white/50">Carregando prévia…</div>}
          {preview && (
            <>
              {/* O que será apagado */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[11px] uppercase font-bold tracking-wide text-white/40 mb-1.5">Serão apagados definitivamente</div>
                {preview.precos.length === 0 ? (
                  <div className="text-[12.5px] text-white/50">Nenhum preço vinculado.</div>
                ) : (
                  <ul className="text-[12.5px] space-y-0.5">
                    {preview.precos.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="text-white/40">#{p.id}</span>
                        <span className="font-semibold">{p.natureza}</span>
                        {p.valor != null && <span className="text-white/50">R$ {p.valor}</span>}
                        {(p.arquivado || p.legadoPendente) && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">histórico</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Blockers — uso real impede a exclusão */}
              {!preview.podeExcluir && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <div className="text-[12.5px] font-bold text-red-300 mb-1">Não pode ser excluída definitivamente</div>
                  <div className="text-[12px] text-red-200/80">Existe uso operacional real: {blockersAtivos.map(([k, v]) => `${v} ${BLOCKER_LABELS[k] ?? k}`).join(", ")}. Remova esses vínculos antes.</div>
                </div>
              )}

              {/* Confirmação forte — só quando pode excluir */}
              {preview.podeExcluir && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 space-y-2">
                  <div className="text-[12.5px] text-white/70">Esta ação é <b>irreversível</b>. Para confirmar, digite exatamente:</div>
                  <div className="text-[12.5px] font-mono font-bold text-red-300">{preview.fraseConfirmacao}</div>
                  <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={preview.fraseConfirmacao} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-red-400/40" />
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (auditoria) — opcional" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20" />
                </div>
              )}
              {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">{erro}</div>}
            </>
          )}
          {!preview && erro && !carregando && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">{erro}</div>}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/10">
          <button disabled={executando} onClick={onClose} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">Cancelar</button>
          <div className="flex items-center gap-2">
            {onInativar && (
              <button disabled={executando} onClick={() => void inativar()} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50">Inativar e preservar histórico</button>
            )}
            {preview?.podeExcluir && (
              <button disabled={executando || !fraseOk} onClick={() => void excluirDefinitivo()} className="px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-40">Excluir definitivamente</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
