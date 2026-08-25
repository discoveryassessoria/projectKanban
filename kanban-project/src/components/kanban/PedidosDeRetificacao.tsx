"use client"

// src/components/kanban/PedidosDeRetificacao.tsx
//
// ABRIR E ACOMPANHAR OS PEDIDOS DE RETIFICAÇÃO DE UM PROCESSO.
//
// ─── POR QUE ESTA TELA PRECISA EXISTIR ──────────────────────────────────────
// Com a retificação passando a operar POR PEDIDO, a fase só materializa etapas para
// os pedidos abertos: zero pedidos, zero trabalho, e o operador vê uma fase vazia sem
// saber o que fazer. Abrir o pedido — e dizer quais divergências vão nele — era uma
// operação que só existia em API.
//
// ─── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────
// Não agrupa sozinha. Quais divergências entram no mesmo procedimento é decisão de
// quem analisa: uma petição judicial pode corrigir registros de duas pessoas, e duas
// divergências na mesma certidão podem exigir peças separadas. Agrupar por processo,
// por pessoa ou por documento acertaria num caso e erraria no seguinte.
//
// O modo (judicial/administrativa) NÃO é pedido aqui de propósito: ele é decidido no
// passo "Definir modo", que é onde a fundamentação também fica registrada.

import { useCallback, useEffect, useState } from "react"

interface Divergencia {
  id: number
  campoLabel: string
  pessoaNome: string
  documentoTitulo: string
  valorArvore: string | null
  valorDocumento: string | null
  severidade: string
}

interface Pedido {
  id: number
  num: string
  tipo: string | null
  status: string
  orgaoId: number | null
  protocoloId: number | null
  divergencias: Divergencia[]
}

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") ?? localStorage.getItem("authToken") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export function PedidosDeRetificacao({ processoId, aoMudar }: { processoId: number; aoMudar?: () => void }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [disponiveis, setDisponiveis] = useState<Divergencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)

  // Sem estado mexido antes do primeiro `await`: dentro de um efeito isso dispara
  // render em cascata. A recarga entra como dependência; `carregando` nasce ligado.
  const [recarga, setRecarga] = useState(0)
  const carregar = useCallback(() => setRecarga((n) => n + 1), [])

  useEffect(() => {
    let vivo = true
    Promise.all([
      fetch(`/api/processos/${processoId}/retificacoes`, { headers: headers() }).then(async (r) => ({ ok: r.ok, j: await r.json() })),
      fetch(`/api/processos/${processoId}/retificacoes/divergencias`, { headers: headers() })
        .then(async (r) => (r.ok ? await r.json() : { divergencias: [] }))
        .catch(() => ({ divergencias: [] })),
    ])
      .then(([ped, div]) => {
        if (!vivo) return
        if (!ped.ok) { setErro(ped.j.mensagem || ped.j.error || "Não foi possível carregar os pedidos."); return }
        setPedidos(ped.j.pacotes ?? [])
        setDisponiveis((div as { divergencias?: Divergencia[] }).divergencias ?? [])
        setErro(null)
      })
      .catch(() => { if (vivo) setErro("Erro ao carregar.") })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [processoId, recarga])

  async function abrirPedido() {
    setSalvando(true); setErro(null)
    try {
      const r = await fetch(`/api/processos/${processoId}/retificacoes`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ divergenciaIds: [...selecionadas], motivo: motivo.trim() || null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.mensagem || j.error || "Não foi possível abrir o pedido.")
      setAbrindo(false); setSelecionadas(new Set()); setMotivo("")
      carregar()
      aoMudar?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao abrir o pedido.")
    } finally {
      setSalvando(false)
    }
  }

  const alternar = (id: number) =>
    setSelecionadas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">Pedidos de retificação</h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Cada pedido é um procedimento independente: tem o próprio órgão, protocolo, responsável e
            etapas. Concluir ou reabrir um não mexe nos outros.
          </p>
        </div>
        <button
          onClick={() => { setErro(null); setAbrindo(true) }}
          disabled={disponiveis.length === 0}
          title={disponiveis.length === 0 ? "Não há divergência marcada para retificação e ainda sem pedido." : undefined}
          className="whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-white hover:bg-[var(--surface-hover)] disabled:opacity-40"
        >+ Abrir pedido</button>
      </div>

      {erro && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-amber-700">{erro}</div>}

      {carregando ? (
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">Carregando…</p>
      ) : pedidos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-default)] p-6 text-center text-xs text-[var(--text-muted)]">
          Nenhum pedido aberto. A fase só cria etapas depois que existir um — abra o pedido com as
          divergências que vão no mesmo procedimento.
        </p>
      ) : (
        <div className="space-y-2">
          {pedidos.map((p) => (
            <div key={p.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm text-white/90">{p.num}</span>
                <span className="text-xs text-[var(--text-secondary)]">{p.tipo ?? "modo a definir"}</span>
                <span className="text-xs text-[var(--text-muted)]">{p.status}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {p.divergencias.map((d) => (
                  <li key={d.id} className="text-xs text-[var(--text-secondary)]">
                    <span className="text-white/75">{d.campoLabel}</span>
                    {" — "}{d.valorDocumento ?? "—"} → {d.valorArvore ?? "—"}
                    <span className="ml-2 text-[var(--text-muted)]">{d.pessoaNome} · {d.documentoTitulo}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {abrindo && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={() => setAbrindo(false)}>
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-white">Abrir pedido de retificação</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Marque as divergências que vão no MESMO procedimento. As que ficarem de fora podem ir num
              pedido separado — e o modo judicial ou administrativo é decidido na primeira etapa.
            </p>

            <div className="mt-4 space-y-1.5">
              {disponiveis.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">Nenhuma divergência disponível para agrupar.</p>
              )}
              {disponiveis.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
                  <input type="checkbox" className="mt-0.5" checked={selecionadas.has(d.id)} onChange={() => alternar(d.id)} />
                  <span className="text-xs text-white/70">
                    <b className="text-white/90">{d.campoLabel}</b> — {d.valorDocumento ?? "—"} → {d.valorArvore ?? "—"}
                    <span className="block text-[var(--text-muted)]">{d.pessoaNome} · {d.documentoTitulo} · {d.severidade}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Motivo (opcional)</label>
              <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white outline-none focus:border-white/20" />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAbrindo(false)} className="rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button onClick={() => void abrirPedido()} disabled={salvando || selecionadas.size === 0}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white hover:bg-[var(--surface-hover)] disabled:opacity-40">
                {salvando ? "Abrindo…" : `Abrir com ${selecionadas.size} divergência(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
