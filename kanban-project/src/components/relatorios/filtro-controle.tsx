"use client"

// Um filtro na tela. O componente NÃO sabe o que é "órgão" ou "situação": ele
// desenha o TIPO que o domínio declarou e busca as opções na fonte que o domínio
// apontou. Filtro novo no motor aparece aqui sem uma linha de front.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ValorDeFiltro } from "@/src/lib/relatorios/motor/tipos"

export interface FiltroMeta {
  key: string
  rotulo: string
  tipo: string
  descricao: string | null
  opcoes: { valor: string; rotulo: string }[] | null
  fonte: string | null
}
export interface Opcao { valor: string; rotulo: string; detalhe?: string | null }

const auth = () => ({ Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}` })

const CAMPO =
  "w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"

export function FiltroControle({
  meta, valor, onChange, onRemover,
}: {
  meta: FiltroMeta
  valor: ValorDeFiltro | null
  onChange: (v: ValorDeFiltro | null) => void
  onRemover: () => void
}) {
  const [opcoes, setOpcoes] = useState<Opcao[]>(meta.opcoes ?? [])
  const [busca, setBusca] = useState("")
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const carregar = useCallback(async (q: string) => {
    if (!meta.fonte) return
    setCarregando(true); setErro(false)
    try {
      const r = await fetch(`/api/relatorios/opcoes?fonte=${meta.fonte}&q=${encodeURIComponent(q)}`, { headers: auth() })
      if (!r.ok) throw new Error()
      setOpcoes((await r.json()).opcoes ?? [])
    } catch { setErro(true) } finally { setCarregando(false) }
  }, [meta.fonte])

  useEffect(() => { if (meta.fonte) void carregar("") }, [meta.fonte, carregar])

  const buscar = (q: string) => {
    setBusca(q)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void carregar(q), 300)
  }

  const corpo = () => {
    switch (meta.tipo) {
      case "intervalo_data": {
        const v = valor?.tipo === "intervalo_data" ? valor : { tipo: "intervalo_data" as const, de: null, ate: null }
        return (
          <div className="flex items-center gap-1.5">
            <input type="date" value={v.de ?? ""} className={CAMPO}
              onChange={(e) => onChange({ tipo: "intervalo_data", de: e.target.value || null, ate: v.ate })} />
            <span className="text-[11px] text-[var(--text-muted)]">até</span>
            <input type="date" value={v.ate ?? ""} className={CAMPO}
              onChange={(e) => onChange({ tipo: "intervalo_data", de: v.de, ate: e.target.value || null })} />
          </div>
        )
      }
      case "booleano":
        return (
          <select className={CAMPO} value={valor?.tipo === "booleano" ? String(valor.valor) : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : { tipo: "booleano", valor: e.target.value === "true" })}>
            <option value="">Indiferente</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        )
      case "numero":
        return (
          <input type="number" className={CAMPO} value={valor?.tipo === "numero" ? valor.numero : ""}
            onChange={(e) => onChange(e.target.value === "" ? null : { tipo: "numero", numero: Number(e.target.value) })} />
        )
      case "texto":
        return (
          <input className={CAMPO} placeholder="Buscar…" value={valor?.tipo === "texto" ? valor.texto : ""}
            onChange={(e) => onChange(e.target.value ? { tipo: "texto", texto: e.target.value } : null)} />
        )
      case "entidade": {
        const sel = valor?.tipo === "entidade" ? valor : null
        return (
          <div>
            <input className={CAMPO} placeholder={sel ? sel.rotulo ?? `#${sel.id}` : "Buscar…"}
              value={busca} onChange={(e) => buscar(e.target.value)} />
            {carregando && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Carregando…</p>}
            {erro && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Falhou. <button type="button" className="underline" onClick={() => void carregar(busca)}>Tentar novamente</button>
              </p>
            )}
            {!carregando && !erro && busca && (
              <div className="mt-1 max-h-44 overflow-auto rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
                {opcoes.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]">Nada encontrado.</p>}
                {opcoes.map((o) => (
                  <button key={o.valor} type="button"
                    className="block w-full px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]"
                    onClick={() => { onChange({ tipo: "entidade", id: Number(o.valor), rotulo: o.rotulo }); setBusca("") }}>
                    {o.rotulo}{o.detalhe ? <span className="text-[var(--text-muted)]"> · {o.detalhe}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      }
      case "multi_selecao": {
        const sel = valor?.tipo === "multi_selecao" ? valor.valores : []
        const alternar = (v: string) => {
          const novo = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]
          // Os rótulos viajam junto para o resumo "Consulta atual" mostrar
          // "Estados Unidos" em vez do id do cadastro.
          const rotulos = novo.map((k) => opcoes.find((o) => o.valor === k)?.rotulo ?? k)
          onChange(novo.length ? { tipo: "multi_selecao", valores: novo, rotulos } : null)
        }
        return (
          <div className="max-h-40 overflow-auto rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1">
            {carregando && <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">Carregando…</p>}
            {erro && (
              <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">
                Falhou. <button type="button" className="underline" onClick={() => void carregar("")}>Tentar novamente</button>
              </p>
            )}
            {!carregando && !erro && opcoes.length === 0 && (
              <p className="px-1.5 py-1 text-[11px] text-[var(--text-muted)]">Sem opções cadastradas.</p>
            )}
            {opcoes.map((o) => (
              <label key={o.valor} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]">
                <input type="checkbox" checked={sel.includes(o.valor)} onChange={() => alternar(o.valor)} />
                {o.detalhe && o.detalhe.length <= 3 ? `${o.detalhe} ` : ""}{o.rotulo}
              </label>
            ))}
          </div>
        )
      }
      default:
        return <p className="text-[11px] text-[var(--text-muted)]">Tipo não suportado.</p>
    }
  }

  return (
    <div className="min-w-[210px]">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]" title={meta.descricao ?? undefined}>
          {meta.rotulo}
        </label>
        <button type="button" onClick={onRemover}
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">remover</button>
      </div>
      {corpo()}
    </div>
  )
}
