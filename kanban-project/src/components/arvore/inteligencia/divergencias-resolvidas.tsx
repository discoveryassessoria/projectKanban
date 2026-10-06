// src/components/arvore/inteligencia/divergencias-resolvidas.tsx
// ============================================================================
// DIVERGÊNCIAS RESOLVIDAS (06/10/2026) — na Inteligência da árvore: onde a árvore divergia do registro localizado na Genealogia e o registro venceu (antes → depois, quem e quando).
// Cada uma pode ser DESFEITA (devolve o valor da árvore, desde que o campo não tenha mudado depois).
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"

interface Divergencia { logId: number; quando: string; quem: string | null; pessoaId: number | null; pessoaNome: string | null; rotulo: string; antes: string | null; depois: string; desfeita: boolean }
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` })
const quandoBR = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

export function DivergenciasResolvidas({ arvoreId, ativo, onDesfeito }: { arvoreId: number | null | undefined; ativo: boolean; onDesfeito?: () => void }) {
  const [lista, setLista] = useState<Divergencia[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(() => {
    if (!arvoreId) return
    void fetch(`/api/arvore/${arvoreId}/divergencias-resolvidas`, { headers: auth() }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { divergencias: Divergencia[] }) => setLista(j.divergencias)).catch(() => setLista([]))
  }, [arvoreId])
  useEffect(() => { if (ativo) carregar() }, [ativo, carregar])

  const desfazer = async (logId: number) => {
    setErro(null)
    const r = await fetch(`/api/sincronizacao-registral/${logId}/desfazer`, { method: "POST", headers: auth() })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { carregar(); onDesfeito?.() } else setErro(j.error ?? "Não foi possível desfazer.")
  }

  if (!lista || lista.length === 0) return null
  return (
    <section data-testid="divergencias-resolvidas" aria-label="Divergências resolvidas pela Genealogia">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Divergências resolvidas ({lista.length})</h3>
      <p className="mb-2 text-[11px] text-[var(--text-muted)]">A árvore divergia do registro localizado na Genealogia; o registro venceu.</p>
      {erro && <p className="mb-2 text-[11px] text-[var(--warning-text)]">{erro}</p>}
      <ul className="space-y-1.5">
        {lista.map((d) => (
          <li key={d.logId} className="rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-[12px]">
            <b>{d.pessoaNome ?? "Pessoa"}</b> — {d.rotulo}: {d.antes ?? "vazio"} → <b>{d.depois}</b>
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
              <span>{quandoBR(d.quando)}{d.quem ? ` · ${d.quem}` : ""}</span>
              {d.desfeita ? <span>desfeita</span> : <button type="button" onClick={() => void desfazer(d.logId)} className="underline text-[var(--accent-text)]">Desfazer</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
