"use client"

import { useEffect, useState, useCallback, useMemo, Fragment } from "react"
import { useApi } from "@/src/lib/dados"

interface Log {
  id: number; acao: string; entidade: string; entidadeId: number | null
  descricao: string; detalhes: unknown; usuarioId: number | null
  usuarioNome: string | null; criadoEm: string
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const inputCls = "rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const opt = "bg-zinc-900"

function fmt(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

// ESCOPOS de recorte da MESMA trilha (mesma API, mesmos dados, mesmas ações).
// Sistema › Auditoria e Logs usa a trilha inteira; Financeiro › Governança usa o
// recorte das entidades financeiras/de configuração. Nenhuma segunda fonte.
const ESCOPOS: Record<string, { titulo: string; descricao: string; entidades: RegExp }> = {
  acessos: {
    titulo: "Auditoria de Acessos",
    descricao:
      "Autenticações, tentativas negadas e alterações de acesso. A trilha é gravada pelo próprio login (entidade ACESSO) — somente leitura.",
    entidades: /^acesso$|usuario|perfil|permiss/i,
  },
  financeiro: {
    titulo: "Governança",
    descricao:
      "Trilha das alterações que afetam o financeiro: configurações financeiras, tabela de valores, catálogo, condições, taxas, formas de pagamento e lançamentos. Somente leitura.",
    entidades:
      /financ|tabelavalor|preco|preço|catalogo|item|condicao|condição|taxa|forma|adquirente|bandeira|receita|custo|cobranca|cobrança|lancamento|lançamento|servico|serviço|economic|comiss|imposto|conta/i,
  },
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function LogAuditoriaTab({ escopo }: { escopo?: string }) {
  const cfg = escopo ? ESCOPOS[escopo] : undefined
  const [fEntidade, setFEntidade] = useState("")
  const [fAcao, setFAcao] = useState("")
  const [busca, setBusca] = useState("")
  const [aberto, setAberto] = useState<number | null>(null)

  // Consulta em cache (src/lib/dados): loading e erro derivam da camada.
  const { dados, carregando: loading, erro: erroCarregar, recarregar: load } =
    useApi<{ logs?: Log[] }>("/api/gerenciamento/auditoria")
  const logs = dados?.logs ?? SEM_ITENS
  const erro = erroCarregar ? (erroCarregar.message || 'Não foi possível carregar a auditoria.') : null

  // recorte do escopo (quando houver): tudo o mais abaixo opera sobre ele
  const logsEscopo = useMemo(
    () => (cfg ? logs.filter(l => cfg.entidades.test(l.entidade)) : logs),
    [logs, cfg],
  )
  const entidades = useMemo(() => Array.from(new Set(logsEscopo.map(l => l.entidade))).sort(), [logsEscopo])
  const acoes = useMemo(() => Array.from(new Set(logsEscopo.map(l => l.acao))).sort(), [logsEscopo])

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return logsEscopo.filter(l =>
      (!fEntidade || l.entidade === fEntidade) &&
      (!fAcao || l.acao === fAcao) &&
      (!q || l.descricao.toLowerCase().includes(q) || (l.usuarioNome || "").toLowerCase().includes(q))
    )
  }, [logsEscopo, fEntidade, fAcao, busca])

  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{cfg?.titulo ?? "Logs / Auditoria"}</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
              {cfg?.descricao ?? "Registro das ações no sistema."} Mostrando {logsEscopo.length} de {logs.length} registros recentes.
            </p>
          </div>
          <button onClick={() => void load()} className="flex-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-white/80 hover:bg-[var(--surface-hover)]">Atualizar</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={fEntidade} onChange={e => setFEntidade(e.target.value)} className={inputCls}>
            <option value="" className={opt}>Todas as entidades</option>
            {entidades.map(x => <option key={x} value={x} className={opt}>{x}</option>)}
          </select>
          <select value={fAcao} onChange={e => setFAcao(e.target.value)} className={inputCls}>
            <option value="" className={opt}>Todas as ações</option>
            {acoes.map(x => <option key={x} value={x} className={opt}>{x}</option>)}
          </select>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar na descrição ou usuário…" className={`${inputCls} min-w-[220px] flex-1`} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
            <tr><th className="px-4 py-3 font-medium">Data/hora</th><th className="px-4 py-3 font-medium">Ação</th><th className="px-4 py-3 font-medium">Entidade</th><th className="px-4 py-3 font-medium">Descrição</th><th className="px-4 py-3 font-medium">Usuário</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">Nenhum log encontrado.</td></tr>
            ) : filtered.map(l => (
              <Fragment key={l.id}>
                <tr className={`border-b border-[var(--border-subtle)] last:border-0 ${l.detalhes ? "cursor-pointer hover:bg-[var(--surface-hover)]" : ""}`} onClick={() => l.detalhes && setAberto(aberto === l.id ? null : l.id)}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--text-secondary)]">{fmt(l.criadoEm)}</td>
                  <td className="px-4 py-2.5"><span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">{l.acao}</span></td>
                  <td className="px-4 py-2.5 text-white/70">{l.entidade}{l.entidadeId != null && <span className="text-[var(--text-muted)]"> #{l.entidadeId}</span>}</td>
                  <td className="px-4 py-2.5 text-white">{l.descricao}{l.detalhes ? <span className="ml-1 text-[10px] text-[var(--text-muted)]">(detalhes)</span> : null}</td>
                  <td className="px-4 py-2.5 text-white/70">{l.usuarioNome || (l.usuarioId != null ? `#${l.usuarioId}` : "sistema")}</td>
                </tr>
                {aberto === l.id && l.detalhes != null && (
                  <tr className="border-b border-[var(--border-subtle)] bg-black/20">
                    <td colSpan={5} className="px-4 py-3">
                      <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-white/70">{JSON.stringify(l.detalhes, null, 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}