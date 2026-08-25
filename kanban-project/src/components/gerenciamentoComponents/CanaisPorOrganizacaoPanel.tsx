"use client"
// src/components/gerenciamentoComponents/CanaisPorOrganizacaoPanel.tsx
//
// POR ONDE CADA ORGANIZAÇÃO ATENDE.
//
// O painel ao lado cadastra os TIPOS de canal — o vocabulário do domínio, fechado.
// Este aqui cadastra a DISPONIBILIDADE: quais desses tipos um cartório concreto
// atende, com que endereço e exigindo o quê.
//
// A diferença não é organizacional, é de dono: "existe o canal CRC" é fato do
// sistema; "este cartório atende por CRC" é fato do cartório. Enquanto as duas coisas
// moravam juntas, todo passo oferecia todos os canais — e o operador descobria
// tentando que aquele cartório só atende no balcão.

import { useEffect, useState } from "react"

interface Tipo {
  id: number; key: string; label: string
  protocoloObrigatorio: boolean; anexoObrigatorioLabel: string | null
  rastreioObrigatorio: boolean; observacaoObrigatoria: boolean
}
interface Vinculo {
  canalKey: string
  ativo: boolean
  ordem: number
  exigeProtocolo: boolean | null
  exigeAnexo: boolean | null
  exigeRastreio: boolean | null
  exigeObservacao: boolean | null
  endereco: string | null
  prazoDias: number | null
}
interface Organizacao {
  id: number; name: string; nomeFantasia: string | null
  type: string | null; city: string | null; country: string | null
  canais: Array<{ canal: { key: string; label: string } }>
}

const inp = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-blue-400/50"

function headers(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export default function CanaisPorOrganizacaoPanel() {
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [organizacoes, setOrganizacoes] = useState<Organizacao[] | null>(null)
  const [busca, setBusca] = useState("")
  const [aberta, setAberta] = useState<Organizacao | null>(null)
  const [vinculos, setVinculos] = useState<Vinculo[]>([])
  const [salvando, setSalvando] = useState(false)
  const [flash, setFlash] = useState("")

  async function carregarLista(q: string) {
    const r = await fetch(`/api/gerenciamento/organizacoes-canais?q=${encodeURIComponent(q)}`, { headers: headers() })
    const j = await r.json()
    setTipos(j.tipos ?? [])
    setOrganizacoes(j.organizacoes ?? [])
  }

  useEffect(() => {
    let vivo = true
    void Promise.resolve().then(() => { if (vivo) return carregarLista(busca) })
    return () => { vivo = false }
  }, [busca])

  async function abrir(org: Organizacao) {
    const r = await fetch(`/api/gerenciamento/organizacoes-canais?organizacaoId=${org.id}`, { headers: headers() })
    const j = await r.json()
    setTipos(j.tipos ?? [])
    setAberta(j.organizacao ?? org)
    setVinculos((j.organizacao?.canais ?? []).map((c: {
      canal: { key: string }; ativo: boolean; ordem: number
      exigeProtocolo: boolean | null; exigeAnexo: boolean | null
      exigeRastreio: boolean | null; exigeObservacao: boolean | null
      endereco: string | null; prazoDias: number | null
    }) => ({
      canalKey: c.canal.key, ativo: c.ativo, ordem: c.ordem,
      exigeProtocolo: c.exigeProtocolo, exigeAnexo: c.exigeAnexo,
      exigeRastreio: c.exigeRastreio, exigeObservacao: c.exigeObservacao,
      endereco: c.endereco, prazoDias: c.prazoDias,
    })))
  }

  const temCanal = (key: string) => vinculos.some((v) => v.canalKey === key)
  const doCanal = (key: string) => vinculos.find((v) => v.canalKey === key)

  function alternar(t: Tipo, marcado: boolean) {
    setVinculos((atual) => marcado
      ? [...atual, {
          canalKey: t.key, ativo: true, ordem: atual.length + 1,
          exigeProtocolo: null, exigeAnexo: null, exigeRastreio: null, exigeObservacao: null,
          endereco: null, prazoDias: null,
        }]
      : atual.filter((v) => v.canalKey !== t.key))
  }
  function ajustar(key: string, patch: Partial<Vinculo>) {
    setVinculos((atual) => atual.map((v) => (v.canalKey === key ? { ...v, ...patch } : v)))
  }

  async function salvar() {
    if (!aberta) return
    setSalvando(true)
    try {
      const r = await fetch("/api/gerenciamento/organizacoes-canais", {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ organizacaoId: aberta.id, canais: vinculos }),
      })
      if (!r.ok) { setFlash("Não foi possível salvar."); return }
      setFlash(`Canais de "${aberta.nomeFantasia || aberta.name}" atualizados.`)
      setAberta(null)
      await carregarLista(busca)
    } finally { setSalvando(false) }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/50">
        Quais canais cada organização atende. É esta lista que o operador vê quando uma subtarefa
        declara &ldquo;usar os canais do fornecedor relacionado&rdquo; — nunca o catálogo inteiro.
      </p>

      <input className={inp} placeholder="Buscar organização por nome ou cidade…"
        value={busca} onChange={(e) => setBusca(e.target.value)} />

      {flash && <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2 text-xs text-emerald-200">{flash}</div>}

      {organizacoes === null && <p className="text-sm text-white/40">Carregando organizações…</p>}
      {organizacoes?.length === 0 && <p className="text-sm text-white/40">Nenhuma organização encontrada.</p>}

      <div className="space-y-1.5">
        {(organizacoes ?? []).map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{o.nomeFantasia || o.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                {o.type && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-white/60">{o.type}</span>}
                {o.city && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-white/60">{o.city}</span>}
                {o.canais.length === 0
                  ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300" title="Toda subtarefa que dependa de canal fica bloqueada nesta organização.">sem canal cadastrado</span>
                  : o.canais.map((c) => (
                      <span key={c.canal.key} className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">{c.canal.label}</span>
                    ))}
              </div>
            </div>
            <button onClick={() => abrir(o)}
              className="flex-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-1.5 text-xs text-white/70 hover:bg-[var(--surface-hover)]">
              Configurar canais
            </button>
          </div>
        ))}
      </div>

      {aberta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setAberta(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="font-semibold text-white">Canais de {aberta.nomeFantasia || aberta.name}</h3>
              <p className="mt-0.5 text-xs text-white/50">
                Marque por onde esta organização atende. As exigências abaixo SOMAM às do tipo de canal —
                uma organização pode pedir mais, nunca menos.
              </p>
            </div>
            <div className="flex-1 space-y-2 overflow-auto px-6 py-4">
              {tipos.map((t) => {
                const v = doCanal(t.key)
                const doTipo = [
                  t.protocoloObrigatorio ? "protocolo" : null,
                  t.anexoObrigatorioLabel ? "anexo" : null,
                  t.rastreioObrigatorio ? "rastreio" : null,
                  t.observacaoObrigatoria ? "observação" : null,
                ].filter(Boolean)
                return (
                  <div key={t.key} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                    <label className="flex items-center gap-2 text-sm text-white/80">
                      <input type="checkbox" checked={temCanal(t.key)} onChange={(e) => alternar(t, e.target.checked)} />
                      {t.label} <code className="text-[11px] text-white/35">{t.key}</code>
                    </label>
                    <p className="mt-1 text-[11px] text-white/35">
                      {doTipo.length ? `O tipo já exige: ${doTipo.join(", ")}.` : "O tipo não exige nada."}
                    </p>
                    {v && (
                      <>
                        <div className="mt-2 grid grid-cols-[1fr_120px] gap-2">
                          <input className={inp} placeholder="E-mail, portal, telefone ou guichê desta organização"
                            value={v.endereco ?? ""} onChange={(e) => ajustar(t.key, { endereco: e.target.value || null })} />
                          <input className={inp} type="number" min={0} placeholder="prazo (dias)"
                            value={v.prazoDias ?? ""} onChange={(e) => ajustar(t.key, { prazoDias: Number(e.target.value) || null })} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-4">
                          {([
                            ["exigeProtocolo", "Protocolo"], ["exigeAnexo", "Anexo"],
                            ["exigeRastreio", "Rastreio"], ["exigeObservacao", "Observação"],
                          ] as Array<[keyof Vinculo, string]>).map(([campo, rotulo]) => (
                            <label key={String(campo)} className="flex items-center gap-2 text-xs text-white/60">
                              <input type="checkbox" checked={v[campo] === true}
                                onChange={(e) => ajustar(t.key, { [campo]: e.target.checked ? true : null } as Partial<Vinculo>)} />
                              exige {rotulo.toLowerCase()}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setAberta(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/70 hover:bg-[var(--surface-hover)]">Cancelar</button>
              <button onClick={salvar} disabled={salvando}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-[#fff] hover:bg-blue-500 disabled:opacity-50">
                {salvando ? "Salvando…" : "Salvar canais"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
