"use client"

// src/components/gerenciamentoComponents/ConfiguracaoSistemaTab.tsx
//
// Duas telas sobre a MESMA configuração global (ConfiguracaoSistema), separadas
// por grupo — a forma dos campos vem do backend, não é duplicada aqui:
//   ConfiguracoesGeraisSistemaTab → Sistema › Configurações Gerais  (grupo "geral")
//   IdentidadeVisualTab           → Sistema › Identidade Visual     (grupo "identidade")
// Backend: /api/gerenciamento/configuracao-sistema (GET/PUT)
//
// A Identidade Visual mostra ainda, em leitura, o ambiente visual por país — que
// é gerado em build (motor de ambiente) e não é editável por tela.

import { useCallback, useEffect, useState } from "react"

interface ChaveSpec {
  chave: string
  grupo: "geral" | "identidade"
  label: string
  tipo: "text" | "textarea" | "select" | "bool" | "cor"
  opcoes?: string[]
  ajuda?: string
  padrao?: string
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"
const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"

function useConfiguracao(grupo: "geral" | "identidade") {
  const [chaves, setChaves] = useState<ChaveSpec[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const [inicial, setInicial] = useState<Record<string, string>>({})
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const MSG = "Não foi possível carregar as configurações."
  // BUSCA (só rede) × APLICAÇÃO (só estado).
  const buscar = useCallback(async (sinal?: AbortSignal) => {
    const res = await fetch("/api/gerenciamento/configuracao-sistema", { headers: authHeaders(), cache: "no-store", signal: sinal })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || MSG)
    return j
  }, [])
  const aplicar = useCallback((j: any) => {
    setChaves((j.chaves as ChaveSpec[]).filter((c) => c.grupo === grupo))
    setValores(j.valores || {}); setInicial(j.valores || {}); setAtualizadoEm(j.atualizadoEm ?? null)
  }, [grupo])
  useEffect(() => {
    const ac = new AbortController()
    buscar(ac.signal)
      .then((j) => { if (!ac.signal.aborted) aplicar(j) })
      .catch((e: any) => { if (!ac.signal.aborted) setErro(e?.message || MSG) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [buscar, aplicar])
  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try { aplicar(await buscar()) }
    catch (e: any) { setErro(e?.message || MSG) } finally { setLoading(false) }
  }, [buscar, aplicar])

  return { chaves, valores, setValores, inicial, setInicial, atualizadoEm, setAtualizadoEm, loading, erro, setErro, load }
}

function FormularioConfig({
  titulo, descricao, grupo, extra,
}: { titulo: string; descricao: string; grupo: "geral" | "identidade"; extra?: (valores: Record<string, string>) => React.ReactNode }) {
  const { chaves, valores, setValores, inicial, setInicial, atualizadoEm, setAtualizadoEm, loading, erro, setErro, load } = useConfiguracao(grupo)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState("")

  const sujo = chaves.some((c) => (valores[c.chave] ?? "") !== (inicial[c.chave] ?? ""))

  async function salvar() {
    setBusy(true); setErro(null)
    try {
      const payload = Object.fromEntries(chaves.map((c) => [c.chave, valores[c.chave] ?? ""]))
      const res = await fetch("/api/gerenciamento/configuracao-sistema", {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ valores: payload }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(j.error || "Erro ao salvar."); return }
      setInicial({ ...inicial, ...payload })
      setAtualizadoEm(new Date().toISOString())
      setFlash("Configurações salvas."); setTimeout(() => setFlash(""), 3000)
    } finally { setBusy(false) }
  }

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {flash && <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>}
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { setErro(null); load() }} className="ml-2 underline hover:text-white">Recarregar</button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{titulo}</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">{descricao}</p>
            {atualizadoEm && (
              <p className="mt-1 text-[11px] text-white/40">Última alteração: {new Date(atualizadoEm).toLocaleString("pt-BR")}</p>
            )}
          </div>
          <div className="flex flex-none items-center gap-2">
            {sujo && <span className="text-xs text-amber-300/80">alterações não salvas</span>}
            <button
              onClick={salvar} disabled={busy || !sujo}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              title={sujo ? "" : "Nada alterado"}
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>

      <div className={`${CARD} p-5`}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {chaves.map((c) => (
            <div key={c.chave} className={c.tipo === "textarea" ? "sm:col-span-2" : ""}>
              <label className={labelCls}>{c.label}</label>
              {c.tipo === "textarea" ? (
                <textarea rows={3} value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls} />
              ) : c.tipo === "select" ? (
                <select value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls}>
                  <option value="" className="bg-zinc-900">—</option>
                  {(c.opcoes ?? []).map((o) => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}
                </select>
              ) : c.tipo === "cor" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(valores[c.chave] ?? "") ? valores[c.chave] : (c.padrao ?? "#38bdf8")}
                    onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })}
                    className="h-9 w-12 flex-none cursor-pointer rounded border border-white/10 bg-transparent"
                  />
                  <input value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls} placeholder={c.padrao} />
                </div>
              ) : (
                <input value={valores[c.chave] ?? ""} onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} className={inputCls} placeholder={c.padrao} />
              )}
              {c.ajuda && <p className="mt-1 text-[11px] text-white/40">{c.ajuda}</p>}
            </div>
          ))}
        </div>
      </div>

      {extra?.(valores)}
    </div>
  )
}

export function ConfiguracoesGeraisSistemaTab() {
  return (
    <FormularioConfig
      grupo="geral"
      titulo="Configurações Gerais"
      descricao="Parâmetros globais e técnicos transversais do sistema. Regras de domínio continuam em cada módulo — aqui só o que vale para o sistema inteiro."
    />
  )
}

export function IdentidadeVisualTab() {
  return (
    <FormularioConfig
      grupo="identidade"
      titulo="Identidade Visual"
      descricao="Marca, logotipo e cores institucionais usados nas comunicações e documentos gerados. O fundo por país das telas operacionais é o motor de ambiente e continua definido em build."
      extra={(valores) => (
        <div className={`${CARD} p-5`}>
          <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Pré-visualização</div>
          <div className="flex flex-wrap items-center gap-4">
            <div
              className="flex h-16 min-w-[220px] items-center gap-3 rounded-xl px-4"
              style={{ backgroundColor: valores["identidade.corDestaque"] || "#38bdf8", color: valores["identidade.corTexto"] || "#0b1220" }}
            >
              {valores["identidade.logoUrl"] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={valores["identidade.logoUrl"]} alt="" className="h-9 w-9 rounded object-contain" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded bg-black/15 text-sm font-bold">
                  {(valores["identidade.marca"] || "D").slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-base font-semibold">{valores["identidade.marca"] || "Marca"}</span>
            </div>
            <p className="max-w-md text-[12px] text-white/45">
              É assim que a marca aparece nos materiais gerados pelo sistema. O tema das telas operacionais
              (fundo por nacionalidade) é decidido pelo processo, não por esta tela.
            </p>
          </div>
        </div>
      )}
    />
  )
}
