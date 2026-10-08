"use client"
// src/components/gerenciamentoComponents/PrazoPorPaisDoPasso.tsx
// ============================================================================
// PRAZO POR PAÍS DO REGISTRO (08/10/2026) — o cadastro que a Genealogia lê: «Brasil: 1 dia; o resto: o prazo do passo».
// Salva NA HORA, pela própria rota (`/api/gerenciamento/prazo-por-pais`) — não depende de publicar o modelo e nunca reescreve o
// prazo de tarefa que já existe: vale para as certidões que nascem depois. A regra é lida por UM lugar do servidor
// (`lib/operacional/prazo-por-pais.ts`); esta tela só cadastra.
// ============================================================================
import { useEffect, useState } from "react"

// As rotas de Gerenciamento exigem o token; é o mesmo cabeçalho que as outras abas já mandam.
function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

interface Regra { id: number; paisNome: string; slaDays: number; ativo: boolean }

const inp = "w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1.5 text-[12.5px] text-[var(--text-primary)]"
const btn = "rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] disabled:opacity-50"

export default function PrazoPorPaisDoPasso({ stepKey, prazoPadrao }: { stepKey: string; prazoPadrao: number | null }) {
  const [regras, setRegras] = useState<Regra[] | null>(null)
  const [paises, setPaises] = useState<string[]>([])
  const [novoPais, setNovoPais] = useState("")
  const [novoDias, setNovoDias] = useState("")
  const [msg, setMsg] = useState("")
  const [ocupado, setOcupado] = useState(false)

  // `rodada` sobe a cada gravação: o efeito relê o cadastro (a única fonte) em vez de a tela remendar a lista sozinha.
  const [rodada, setRodada] = useState(0)
  useEffect(() => {
    let vivo = true
    fetch(`/api/gerenciamento/prazo-por-pais?stepKey=${encodeURIComponent(stepKey)}`, { cache: "no-store", headers: authHeaders() })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!vivo) return
        if (!ok) { setMsg(j.error ?? "Não foi possível carregar os prazos por país."); setRegras([]); return }
        setRegras(j.regras ?? []); setPaises(j.paises ?? [])
      })
      .catch(() => { if (vivo) { setMsg("Não foi possível carregar os prazos por país."); setRegras([]) } })
    return () => { vivo = false }
  }, [stepKey, rodada])
  const carregar = async () => { setRodada((x) => x + 1) }

  const salvar = async (paisNome: string, dias: number) => {
    setOcupado(true); setMsg("")
    try {
      const r = await fetch("/api/gerenciamento/prazo-por-pais", { method: "PUT", headers: authHeaders(), body: JSON.stringify({ stepKey, paisNome, slaDays: dias }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(j.error ?? "Não foi possível salvar."); return false }
      setMsg(`Salvo: ${paisNome} = ${dias} dia(s).`); await carregar(); return true
    } finally { setOcupado(false) }
  }
  const remover = async (r: Regra) => {
    setOcupado(true); setMsg("")
    try {
      const resp = await fetch(`/api/gerenciamento/prazo-por-pais?id=${r.id}`, { method: "DELETE", headers: authHeaders() })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) { setMsg(j.error ?? "Não foi possível remover."); return }
      setMsg(`Removido: ${r.paisNome} volta ao prazo do passo.`); await carregar()
    } finally { setOcupado(false) }
  }

  const jaTem = new Set((regras ?? []).map((r) => r.paisNome))
  const opcoes = ["Brasil", ...paises.filter((p) => p !== "Brasil")].filter((p) => !jaTem.has(p))

  return (
    <div className="rounded-lg border border-[var(--border-default)] p-3" data-testid="prazo-por-pais">
      <div className="text-[12px] font-semibold text-[var(--text-primary)]">Prazo por país do registro (dias corridos)</div>
      <p className="mt-1 mb-2 text-[11px] text-[var(--text-muted)]">
        Vale para a certidão pelo país do <b>evento</b> na árvore: nascimento = país de nascimento, casamento = país do casamento, óbito = país do óbito.
        País que não estiver na lista usa o prazo do passo{prazoPadrao ? ` (${prazoPadrao} dias)` : ""}; certidão sem país cadastrado também.
        Salva na hora e vale para as certidões que nascem depois — não muda tarefa que já existe.
      </p>
      {regras === null ? <p className="text-[12px] text-[var(--text-muted)]">Carregando…</p> : (
        <div className="space-y-1.5">
          {regras.length === 0 && <p className="text-[12px] text-[var(--text-muted)]">Nenhum país com prazo próprio: todos usam o prazo do passo.</p>}
          {regras.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_110px_auto] items-center gap-2" data-testid={`regra-pais-${r.paisNome}`}>
              <span className="text-[12.5px] text-[var(--text-primary)]">{r.paisNome}</span>
              <input className={inp} type="number" min={1} max={365} defaultValue={r.slaDays} disabled={ocupado} aria-label={`Prazo de ${r.paisNome} em dias`}
                onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== r.slaDays) void salvar(r.paisNome, n) }} />
              <button type="button" className={btn} disabled={ocupado} onClick={() => void remover(r)}>Remover</button>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_110px_auto] items-center gap-2 pt-1.5">
            <select className={inp} value={novoPais} onChange={(e) => setNovoPais(e.target.value)} aria-label="País">
              <option value="">Escolha o país…</option>
              {opcoes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className={inp} type="number" min={1} max={365} placeholder="dias" value={novoDias} onChange={(e) => setNovoDias(e.target.value)} aria-label="Prazo em dias" />
            <button type="button" className={btn} disabled={ocupado || !novoPais || !novoDias}
              onClick={async () => { if (await salvar(novoPais, Number(novoDias))) { setNovoPais(""); setNovoDias("") } }}>Adicionar</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-[11.5px] text-[var(--text-secondary)]" role="status">{msg}</p>}
    </div>
  )
}
