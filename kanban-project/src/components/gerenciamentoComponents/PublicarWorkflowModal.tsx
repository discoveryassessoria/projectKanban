"use client"
// src/components/gerenciamentoComponents/PublicarWorkflowModal.tsx
//
// O QUE A PUBLICAÇÃO VAI FAZER — dito antes de fazer.
//
// Antes, salvar era publicar: cada ajuste virava uma versão, e o administrador
// descobria o que tinha mudado depois, olhando o número subir. Aqui ele vê a lista de
// alterações — por passo, por escopo, uma linha cada — e só então decide.
//
// A tela NÃO calcula o diff nem julga se pode publicar: as duas coisas vêm do
// servidor (`GET ?preview=1`), que é quem tem a versão congelada para comparar. Um
// diff montado no navegador seria uma segunda opinião sobre o que mudou, e a única
// que vale é a de quem vai congelar.

import { useEffect, useState } from "react"

interface Mudanca { escopo: string; tipo: string; passo: string; alvo: string; detalhe: string }
interface Preview {
  workflowId: string | number
  nome: string
  versaoAtual: number
  versaoNova: number
  temRascunho: boolean
  mudancas: Mudanca[]
  problemas: Array<{ codigo: string; stepKey: string | null; mensagem: string }>
  podePublicar: boolean
  aviso: string
}

const COR_DO_TIPO: Record<string, string> = {
  ACRESCENTADO: "bg-emerald-500/15 text-emerald-300",
  REMOVIDO: "bg-red-500/15 text-red-300",
  ALTERADO: "bg-amber-500/15 text-amber-300",
}

export default function PublicarWorkflowModal({
  workflowId, authHeaders, onFechar, onPublicado,
}: {
  workflowId: number
  authHeaders: () => HeadersInit
  onFechar: () => void
  onPublicado: (versaoNova: number, mensagem: string) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [erro, setErro] = useState<string>("")
  const [publicando, setPublicando] = useState(false)

  useEffect(() => {
    let vivo = true
    fetch(`/api/gerenciamento/workflows-fase/${workflowId}?preview=1`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => { if (vivo) { if (j.preview) setPreview(j.preview); else setErro(j.error || "Não foi possível montar a prévia.") } })
      .catch(() => { if (vivo) setErro("Erro de conexão ao montar a prévia.") })
    return () => { vivo = false }
  }, [workflowId, authHeaders])

  async function publicar() {
    if (!preview) return
    setPublicando(true)
    setErro("")
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${workflowId}?acao=publicar`, {
        method: "POST", headers: authHeaders(),
        // A VERSÃO QUE ESTA TELA VIU. Se alguém publicou no meio, o servidor recusa em
        // vez de sobrescrever — e o motivo volta com o número novo.
        body: JSON.stringify({ versaoEsperada: preview.versaoAtual }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        onPublicado(j.versaoNova ?? preview.versaoNova,
          j.code === "SEM_ALTERACOES"
            ? "Não havia alterações para publicar."
            : `Publicado na versão ${j.versaoNova}. Os processos em andamento continuam na versão que registraram.`)
        return
      }
      setErro(j.error || "A publicação foi recusada.")
      if (Array.isArray(j.problemas) && j.problemas.length) {
        setPreview((p) => (p ? { ...p, problemas: j.problemas, podePublicar: false } : p))
      }
    } finally { setPublicando(false) }
  }

  const porPasso = new Map<string, Mudanca[]>()
  for (const m of preview?.mudancas ?? []) {
    const atual = porPasso.get(m.passo) ?? []
    atual.push(m)
    porPasso.set(m.passo, atual)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onFechar}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/10 px-6 py-4">
          <h3 className="font-semibold text-white">Publicar {preview ? `“${preview.nome}”` : "workflow"}</h3>
          {preview && (
            <p className="mt-0.5 text-xs text-white/50">
              Versão {preview.versaoAtual} → {preview.versaoNova} · {preview.mudancas.length} alteração(ões)
            </p>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-6 py-4">
          {!preview && !erro && <p className="text-sm text-white/40">Comparando o rascunho com a versão publicada…</p>}
          {erro && <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">{erro}</div>}

          {preview && preview.problemas.length > 0 && (
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3">
              <div className="text-xs font-medium text-red-200">A configuração não pode ser publicada:</div>
              <ul className="mt-1 space-y-0.5 text-xs text-red-200/80">
                {preview.problemas.map((p, i) => <li key={i}>· {p.stepKey ? `[${p.stepKey}] ` : ""}{p.mensagem}</li>)}
              </ul>
            </div>
          )}

          {preview && !preview.temRascunho && preview.problemas.length === 0 && (
            <p className="text-sm text-white/50">
              Não há alterações para publicar: o rascunho é idêntico à versão {preview.versaoAtual}.
            </p>
          )}

          {preview && [...porPasso.entries()].map(([passo, itens]) => (
            <div key={passo} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="text-xs font-medium text-white/80">{passo || "(workflow)"}</div>
              <ul className="mt-1.5 space-y-1">
                {itens.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 flex-none rounded px-1.5 py-0.5 text-[10px] ${COR_DO_TIPO[m.tipo] ?? "bg-white/10 text-white/60"}`}>
                      {m.tipo.toLowerCase()}
                    </span>
                    <span className="text-white/40">{m.escopo}</span>
                    <span className="text-white/80">{m.alvo}</span>
                    <span className="text-white/50">{m.detalhe}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {preview && (
            <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] leading-relaxed text-white/45">{preview.aviso}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
          <button onClick={onFechar} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10">Fechar</button>
          <button onClick={publicar} disabled={!preview || !preview.podePublicar || publicando}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40">
            {publicando ? "Publicando…" : `Publicar versão ${preview?.versaoNova ?? ""}`}
          </button>
        </div>
      </div>
    </div>
  )
}
