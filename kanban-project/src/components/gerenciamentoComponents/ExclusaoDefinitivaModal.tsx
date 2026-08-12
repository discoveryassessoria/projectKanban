// src/components/gerenciamentoComponents/ExclusaoDefinitivaModal.tsx
//
// Modal ADMIN de remoção. Ele NÃO decide nada: só desenha o veredito do motor canônico
// (analyzeServiceDeletion e irmãos), que separa em duas listas fechadas:
//
//   • DEPENDÊNCIAS DE CONFIGURAÇÃO → serão excluídas em cascata ou apenas desvinculadas.
//     Nunca impedem a exclusão: a Regra de Aplicabilidade Econômica e a Configuração
//     Financeira aparecem AQUI, não entre os bloqueios.
//   • FATOS HISTÓRICOS → nunca são apagados. Um único fato já troca a ação disponível
//     de "Excluir definitivamente" para "Inativar e preservar histórico".
//
// A permissão é SEMPRE revalidada no backend; este modal é só a camada de UX.
"use client"

import { useState, useEffect, useCallback } from "react"

const authHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") : ""}`,
})

interface DependenciaConfig { entidade: string; rotulo: string; quantidade: number; acao: "EXCLUIR" | "DESVINCULAR"; ids: number[] }
interface FatoHistorico { entidade: string; rotulo: string; quantidade: number }
interface Analise {
  alvo: { tipo: string; id: number; nome: string; codigo: string | null; ativo: boolean }
  configDependencies: { itens: DependenciaConfig[]; total: number }
  historicalFacts: { itens: FatoHistorico[]; total: number }
  deletionAllowed: boolean
  deactivationRequired: boolean
  fraseConfirmacao: string
}

export function ExclusaoDefinitivaModal({ titulo, previewUrl, deleteUrl, entidadeLabel = "Registro", onInativar, onDone, onClose }: {
  titulo: string
  previewUrl: string
  deleteUrl: string
  entidadeLabel?: string
  onInativar?: () => Promise<void>
  onDone: () => void
  onClose: () => void
}) {
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [frase, setFrase] = useState("")
  const [motivo, setMotivo] = useState("")
  const [executando, setExecutando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<"inativado" | "excluido" | null>(null)

  useEffect(() => {
    fetch(previewUrl, { headers: authHeaders() })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`); return r.json() })
      .then((j) => setAnalise(j))
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [previewUrl])

  const emCascata = analise?.configDependencies.itens.filter((d) => d.acao === "EXCLUIR") ?? []
  const desvinculadas = analise?.configDependencies.itens.filter((d) => d.acao === "DESVINCULAR") ?? []
  const fatos = analise?.historicalFacts.itens ?? []

  const inativar = useCallback(async () => {
    if (!onInativar) return
    setExecutando(true); setErro(null)
    try { await onInativar(); setSucesso("inativado") } catch (e) { setErro((e as Error).message || "Falha ao inativar.") } finally { setExecutando(false) }
  }, [onInativar])

  const excluirDefinitivo = useCallback(async () => {
    setExecutando(true); setErro(null)
    try {
      const r = await fetch(deleteUrl, { method: "DELETE", headers: authHeaders(), body: JSON.stringify({ confirmacao: frase.trim(), motivo: motivo.trim() || null }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j?.error || `Falha (HTTP ${r.status}).`); return }
      setSucesso("excluido")
    } catch { setErro("Falha de rede ao excluir definitivamente.") }
    finally { setExecutando(false) }
  }, [deleteUrl, frase, motivo])

  const fraseOk = !!analise && frase.trim() === analise.fraseConfirmacao

  // TELA DE RESULTADO — informa exatamente o que aconteceu (nunca "prometer excluir e só inativar").
  if (sucesso) {
    const excluido = sucesso === "excluido"
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => onDone()}>
        <div className="max-w-md w-full rounded-2xl bg-[#12151b] border border-white/10 shadow-xl text-white/90 p-5" onClick={(e) => e.stopPropagation()}>
          <div className={`text-[15px] font-extrabold ${excluido ? "text-red-300" : "text-amber-300"}`}>
            {excluido ? `${entidadeLabel} excluído definitivamente` : `${entidadeLabel} inativado`}
          </div>
          <p className="text-[12.5px] text-white/60 mt-1">
            {excluido
              ? "O cadastro e as suas configurações exclusivas foram apagados. Cadastros compartilhados foram apenas desvinculados e continuam existindo."
              : "O histórico foi preservado integralmente. O registro continua existindo, apenas inativo."}
          </p>
          <div className="flex justify-end mt-4">
            <button onClick={() => onDone()} className="px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-white/10 hover:bg-white/20">Fechar</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => !executando && onClose()}>
      <div className="max-w-lg w-full rounded-2xl bg-[#12151b] border border-white/10 shadow-xl text-white/90" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-white/10">
          <h3 className="text-[15px] font-extrabold">{titulo}</h3>
          <p className="text-[12px] text-white/50 mt-0.5">
            Configuração some junto; fato histórico nunca é apagado. Exclusão definitiva é restrita a administradores.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {carregando && <div className="text-[13px] text-white/50">Carregando prévia…</div>}
          {analise && (
            <>
              {/* CONFIGURAÇÃO — o que cai em cascata. Com histórico NADA cai: o rótulo não pode
                  prometer exclusão que não vai acontecer. */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[11px] uppercase font-bold tracking-wide text-white/40 mb-1.5">
                  {analise.deletionAllowed ? "Serão excluídos" : "Seriam excluídos, se não houvesse histórico"}
                </div>
                <ul className={`text-[12.5px] space-y-0.5 ${analise.deletionAllowed ? "" : "opacity-50"}`}>
                  <li className="flex items-center gap-2"><span className="font-semibold">{entidadeLabel}</span><span className="text-white/50">{analise.alvo.nome}</span></li>
                  {emCascata.map((d) => (
                    <li key={d.entidade} className="flex items-center gap-2">
                      <span className="text-white/40">{d.quantidade}×</span>
                      <span>{d.rotulo}</span>
                    </li>
                  ))}
                </ul>
                {emCascata.length === 0 && <div className="text-[12px] text-white/40 mt-1">Nenhuma configuração dependente.</div>}
              </div>

              {/* COMPARTILHADO — preservado, só perde o vínculo */}
              {desvinculadas.length > 0 && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[11px] uppercase font-bold tracking-wide text-white/40 mb-1.5">Serão apenas desvinculados (preservados)</div>
                  <ul className="text-[12.5px] space-y-0.5">
                    {desvinculadas.map((d) => (
                      <li key={d.entidade} className="flex items-center gap-2">
                        <span className="text-white/40">{d.quantidade}×</span>
                        <span>{d.rotulo}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* FATOS HISTÓRICOS — a única coisa que bloqueia */}
              <div className={`rounded-lg border p-3 ${fatos.length ? "border-red-500/30 bg-red-500/10" : "border-white/10 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase font-bold tracking-wide mb-1.5 ${fatos.length ? "text-red-300" : "text-white/40"}`}>Fatos históricos</div>
                {fatos.length === 0 ? (
                  <div className="text-[12.5px] text-white/50">Nenhum.</div>
                ) : (
                  <>
                    <ul className="text-[12.5px] space-y-0.5 text-red-200/90">
                      {fatos.map((f) => (
                        <li key={f.entidade} className="flex items-center gap-2"><span className="text-red-300/70">{f.quantidade}×</span><span>{f.rotulo}</span></li>
                      ))}
                    </ul>
                    <div className="text-[12px] text-red-200/70 mt-1.5">
                      Nada disso será apagado. Com histórico real, o caminho é inativar e preservar.
                    </div>
                  </>
                )}
              </div>

              {/* Confirmação forte — só quando não há fato histórico */}
              {analise.deletionAllowed && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 space-y-2">
                  <div className="text-[12.5px] text-white/70">Esta ação é <b>irreversível</b>. Para confirmar, digite exatamente:</div>
                  <div className="text-[12.5px] font-mono font-bold text-red-300">{analise.fraseConfirmacao}</div>
                  <input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={analise.fraseConfirmacao} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-red-400/40" />
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (auditoria) — opcional" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/20" />
                </div>
              )}
              {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">{erro}</div>}
            </>
          )}
          {!analise && erro && !carregando && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">{erro}</div>}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/10">
          <button disabled={executando} onClick={onClose} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">Cancelar</button>
          <div className="flex items-center gap-2">
            {onInativar && analise?.deactivationRequired && (
              <button disabled={executando} onClick={() => void inativar()} className="px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-amber-500/90 text-black hover:bg-amber-400 disabled:opacity-50">Inativar e preservar histórico</button>
            )}
            {onInativar && analise?.deletionAllowed && (
              <button disabled={executando} onClick={() => void inativar()} className="px-3.5 py-2 text-[12.5px] font-semibold rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50">Só inativar</button>
            )}
            {analise?.deletionAllowed && (
              <button disabled={executando || !fraseOk} onClick={() => void excluirDefinitivo()} className="px-3.5 py-2 text-[12.5px] font-bold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-40">Excluir definitivamente</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
