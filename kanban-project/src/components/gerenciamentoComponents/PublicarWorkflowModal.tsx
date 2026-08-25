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

/**
 * O DIFF AGRUPADO PELO MODELO MENTAL, não pelas tabelas do motor.
 *
 * A prévia listava por escopo técnico — PASSO, AÇÃO, CAMPO, OPÇÃO, CANAL, CHECKLIST,
 * REQUISITO, SUBTAREFA — que é a divisão do banco. Quem revisa antes de publicar
 * pergunta outra coisa: o que mudou no que o operador FAZ, no que precisa estar
 * cumprido, no que pode acontecer. As mesmas mudanças, reagrupadas.
 */
const AREA_DO_ESCOPO: Record<string, string> = {
  PASSO: "Geral", SLA: "Geral", "RESPONSÁVEL": "Geral",
  SUBTAREFA: "Execução", CAMPO: "Execução", "OPÇÃO": "Execução", CHECKLIST: "Execução", CANAL: "Execução",
  REQUISITO: "Conclusão",
  "AÇÃO": "Resultados",
  "DEPENDÊNCIA": "Avançado", EXECUTOR: "Avançado",
}
const ORDEM_DAS_AREAS = ["Geral", "Execução", "Conclusão", "Resultados", "Avançado"]

const COR_DO_TIPO: Record<string, string> = {
  ACRESCENTADO: "bg-[var(--surface-secondary)] text-green-800",
  REMOVIDO: "bg-[var(--surface-secondary)] text-red-700",
  ALTERADO: "bg-[var(--surface-secondary)] text-amber-800",
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

  const porArea = new Map<string, Mudanca[]>()
  for (const m of preview?.mudancas ?? []) {
    const area = AREA_DO_ESCOPO[m.escopo] ?? "Avançado"
    const atual = porArea.get(area) ?? []
    atual.push(m)
    porArea.set(area, atual)
  }
  const areasComMudanca = ORDEM_DAS_AREAS.filter((a) => porArea.has(a))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={onFechar}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="font-semibold text-white">Publicar {preview ? `“${preview.nome}”` : "workflow"}</h3>
          {preview && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Versão {preview.versaoAtual} → {preview.versaoNova} · {preview.mudancas.length} alteração(ões)
            </p>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-auto px-6 py-4">
          {!preview && !erro && <p className="text-sm text-[var(--text-muted)]">Comparando o rascunho com a versão publicada…</p>}
          {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-xs text-red-700">{erro}</div>}

          {preview && preview.problemas.length > 0 && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
              <div className="text-xs font-medium text-red-700">A configuração não pode ser publicada:</div>
              <ul className="mt-1 space-y-0.5 text-xs text-red-700/80">
                {preview.problemas.map((p, i) => <li key={i}>· {p.stepKey ? `[${p.stepKey}] ` : ""}{p.mensagem}</li>)}
              </ul>
            </div>
          )}

          {preview && !preview.temRascunho && preview.problemas.length === 0 && (
            <p className="text-sm text-[var(--text-secondary)]">
              Não há alterações para publicar: o rascunho é idêntico à versão {preview.versaoAtual}.
            </p>
          )}

          {preview && areasComMudanca.map((area) => (
            <div key={area} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
              <div className="text-xs font-medium text-white/80">
                {area} <span className="text-[var(--text-muted)]">· {porArea.get(area)!.length} alteração(ões)</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {porArea.get(area)!.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs">
                    <span className={`mt-0.5 flex-none rounded px-1.5 py-0.5 text-[10px] ${COR_DO_TIPO[m.tipo] ?? "bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}>
                      {m.tipo.toLowerCase()}
                    </span>
                    <span className="text-white/80">{m.alvo}</span>
                    {m.passo && <span className="text-[var(--text-muted)]">em {m.passo}</span>}
                    <span className="text-[var(--text-secondary)]">{m.detalhe}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {preview && (
            <p className="rounded-lg border border-[var(--border-default)] bg-black/20 p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">{preview.aviso}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
          <button onClick={onFechar} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Fechar</button>
          <button onClick={publicar} disabled={!preview || !preview.podePublicar || publicando}
            className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-40">
            {publicando ? "Publicando…" : `Publicar versão ${preview?.versaoNova ?? ""}`}
          </button>
        </div>
      </div>
    </div>
  )
}
