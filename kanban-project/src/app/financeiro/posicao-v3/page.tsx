// src/app/financeiro/posicao-v3/page.tsx
// ============================================================================
// POSIÇÃO FINANCEIRA (Motor Financeiro V3 · Fase 2) — tela de LEITURA da nova
// arquitetura, atrás de feature flag. Sem wizard: uma ação principal
// ("Registrar ocorrência"). Mostra identidade, saldo, timeline, posição por
// requerente (informativa), pagadores externos, créditos e divergência.
// Enquanto a flag estiver desligada, orienta o uso do fluxo legado (fallback).
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"
import { HeaderBar } from "@/src/components/header-bar"
import { Loader2, Search, Plus, AlertTriangle, CheckCircle2 } from "lucide-react"
import { LancamentoExtraForm } from "@/src/components/financeiro/lancamento-extra-form"

const OURO = "#C6A15B"

interface Posicao {
  obrigacaoId: number; codigoOperacional: string | null; natureza: string; direcao: string; status: string
  moedaContratual: string; valorContratado: number; saldo: number; recebidoBruto: number; recebidoLiquido: number
  timeline: { ocorrenciaId: number; tipo: string; valor: number; moeda: string; data: string; status: string; pagador?: { tipo: string; pessoaId: number | null; externoNome: string | null } | null; aplicado: number }[]
  posicaoRequerentes: { pessoaId: number; participacao: number; pago: number; pagoEmNomeDeTerceiros: number; saldoEconomico: number }[]
  pagadoresExternos: { nome: string; valor: number }[]
  creditos: { id: number; valor: number; destino: string; status: string }[]
  divergencia: { saldoProjecao: number | null; saldoReplay: number; consistente: boolean }
}

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v)

// O backend autentica por Authorization: Bearer <token> (localStorage.authToken).
const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return { ...(extra ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export default function PosicaoV3Page() {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [ref, setRef] = useState("")
  const [pos, setPos] = useState<Posicao | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [showOcorrencia, setShowOcorrencia] = useState(false)
  const [showExtra, setShowExtra] = useState(false)

  useEffect(() => {
    fetch("/api/financeiro/v3/flags", { headers: authHeaders() }).then((r) => r.json()).then((d) => setFlags(d.flags ?? {})).catch(() => setFlags({}))
  }, [])

  const buscar = useCallback(async () => {
    if (!ref.trim()) return
    setCarregando(true); setAviso(null); setPos(null)
    const q = /^\d+$/.test(ref.trim()) ? `receitaId=${ref.trim()}` : `codigo=${encodeURIComponent(ref.trim())}`
    try {
      const r = await fetch(`/api/financeiro/v3/posicao?${q}`, { headers: authHeaders() })
      const d = await r.json()
      if (r.ok && d.disponivel) setPos(d.posicao)
      else if (r.status === 404) setAviso("Nenhuma obrigação encontrada para este identificador.")
      else {
        // Falha técnica real da V3 → fallback discreto, sem bloquear (registra o erro).
        console.error("[posicao-v3] fallback técnico:", r.status, d?.motivo)
        setAviso("Não foi possível carregar a Posição V3 agora (falha técnica). O financeiro legado permanece disponível como fallback.")
      }
    } catch (e) {
      console.error("[posicao-v3] erro de rede:", e)
      setAviso("Não foi possível carregar a Posição V3 agora (rede). O financeiro legado permanece disponível como fallback.")
    } finally { setCarregando(false) }
  }, [ref])

  // No sandbox as flags V3 são padrão-ON; a tela abre direto. Enquanto carregam,
  // assume habilitado para não piscar bloqueio (o legado é só fallback técnico).
  const podeOcorrencia = flags ? flags.ocorrencias : true
  const podeExtra = flags ? flags.extras : true

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <HeaderBar title="Posição Financeira" subtitle="Motor Financeiro V3 · homologação" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-2 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold" style={{ color: OURO }}>Posição Financeira</h1>
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] uppercase tracking-wider text-neutral-400">Motor V3 · homologação</span>
        </div>
        <p className="mb-6 text-sm text-neutral-400">Leitura consolidada a partir do Ledger (fonte da verdade). Identifique pela Receita (REC-xxx) ou pelo id da receita.</p>

        <div className="mb-8 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()}
              placeholder="REC-105 ou 105"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-500" />
          </div>
          <button onClick={buscar} disabled={carregando}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40" style={{ backgroundColor: OURO }}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Consultar"}
          </button>
          {podeExtra && (
            <button onClick={() => setShowExtra(true)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500">
              <Plus className="h-4 w-4" /> Novo lançamento extra
            </button>
          )}
        </div>

        {showExtra && <LancamentoExtraForm onClose={() => setShowExtra(false)} onDone={() => { setShowExtra(false); if (pos) buscar() }} />}

        {aviso && <div className="mb-6 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">{aviso}</div>}

        {pos && (
          <div className="space-y-6">
            {/* Identidade + saldo */}
            <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold">{pos.codigoOperacional ?? `Obrigação #${pos.obrigacaoId}`}</div>
                  <div className="mt-1 flex gap-2 text-xs text-neutral-400">
                    <span className="rounded bg-neutral-800 px-2 py-0.5">{pos.natureza}</span>
                    <span className="rounded bg-neutral-800 px-2 py-0.5">{pos.direcao}</span>
                    <span className="rounded bg-neutral-800 px-2 py-0.5">{pos.status}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-neutral-500">Saldo</div>
                  <div className="text-2xl font-semibold" style={{ color: pos.saldo <= 0.005 ? "#5FB878" : OURO }}>{fmt(pos.saldo, pos.moedaContratual)}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <div><div className="text-xs text-neutral-500">Contratado</div><div>{fmt(pos.valorContratado, pos.moedaContratual)}</div></div>
                <div><div className="text-xs text-neutral-500">Recebido bruto</div><div>{fmt(pos.recebidoBruto, pos.moedaContratual)}</div></div>
                <div><div className="text-xs text-neutral-500">Recebido líquido</div><div>{fmt(pos.recebidoLiquido, pos.moedaContratual)}</div></div>
              </div>
              {podeOcorrencia && (
                <button onClick={() => setShowOcorrencia((s) => !s)} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">
                  <Plus className="h-4 w-4" /> Registrar ocorrência
                </button>
              )}
              {showOcorrencia && <FormOcorrencia obrigacaoId={pos.obrigacaoId} moeda={pos.moedaContratual} onDone={() => { setShowOcorrencia(false); buscar() }} />}
            </section>

            {/* Divergência */}
            <section className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${pos.divergencia.consistente ? "border-emerald-800/40 bg-emerald-950/20 text-emerald-300" : "border-red-800/50 bg-red-950/30 text-red-300"}`}>
              {pos.divergencia.consistente ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {pos.divergencia.consistente
                ? "Projeção consistente com o replay do Ledger."
                : `Divergência: projeção ${fmt(pos.divergencia.saldoProjecao ?? 0)} × replay ${fmt(pos.divergencia.saldoReplay)}.`}
            </section>

            {/* Posição por requerente */}
            {pos.posicaoRequerentes.length > 0 && (
              <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
                <h2 className="mb-3 text-sm font-semibold text-neutral-300">Posição por requerente <span className="font-normal text-neutral-500">(informativa — sem dívida interna)</span></h2>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-2">Pessoa</th><th className="pb-2">Participação</th><th className="pb-2">Pago</th><th className="pb-2">Por terceiros</th><th className="pb-2">Saldo econ.</th></tr></thead>
                  <tbody>{pos.posicaoRequerentes.map((r) => (
                    <tr key={r.pessoaId} className="border-t border-neutral-800"><td className="py-2">#{r.pessoaId}</td><td>{fmt(r.participacao)}</td><td>{fmt(r.pago)}</td><td>{r.pagoEmNomeDeTerceiros > 0 ? fmt(r.pagoEmNomeDeTerceiros) : "—"}</td><td>{fmt(r.saldoEconomico)}</td></tr>
                  ))}</tbody>
                </table>
              </section>
            )}

            {/* Pagadores externos + créditos */}
            {(pos.pagadoresExternos.length > 0 || pos.creditos.length > 0) && (
              <section className="grid gap-4 sm:grid-cols-2">
                {pos.pagadoresExternos.length > 0 && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
                    <h2 className="mb-3 text-sm font-semibold text-neutral-300">Pagadores externos</h2>
                    {pos.pagadoresExternos.map((p, i) => <div key={i} className="flex justify-between py-1 text-sm"><span>{p.nome}</span><span>{fmt(p.valor)}</span></div>)}
                  </div>
                )}
                {pos.creditos.length > 0 && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
                    <h2 className="mb-3 text-sm font-semibold text-neutral-300">Créditos (excedentes)</h2>
                    {pos.creditos.map((c) => <div key={c.id} className="flex justify-between py-1 text-sm"><span className="text-neutral-400">{c.destino} · {c.status}</span><span>{fmt(c.valor)}</span></div>)}
                  </div>
                )}
              </section>
            )}

            {/* Timeline */}
            <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
              <h2 className="mb-3 text-sm font-semibold text-neutral-300">Timeline de ocorrências</h2>
              <div className="space-y-2">
                {pos.timeline.map((t) => (
                  <div key={t.ocorrenciaId} className="flex items-center justify-between border-b border-neutral-800 py-2 text-sm last:border-0">
                    <div>
                      <span className="font-medium">{t.tipo}</span>
                      <span className="ml-2 text-xs text-neutral-500">{new Date(t.data).toLocaleDateString("pt-BR")}</span>
                      {t.pagador && <span className="ml-2 text-xs text-neutral-500">· {t.pagador.externoNome ?? (t.pagador.pessoaId ? `pessoa #${t.pagador.pessoaId}` : t.pagador.tipo)}</span>}
                    </div>
                    <div className="text-right"><span>{fmt(t.valor, t.moeda)}</span>{t.aplicado > 0 && t.aplicado !== t.valor && <span className="ml-2 text-xs text-neutral-500">apl. {fmt(t.aplicado, t.moeda)}</span>}</div>
                  </div>
                ))}
                {pos.timeline.length === 0 && <div className="text-sm text-neutral-500">Sem ocorrências.</div>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Ação principal única: registrar ocorrência (form mínimo, sem wizard) ──
function FormOcorrencia({ obrigacaoId, moeda, onDone }: { obrigacaoId: number; moeda: string; onDone: () => void }) {
  const [tipo, setTipo] = useState("PAGAMENTO")
  const [valor, setValor] = useState("")
  const [politica, setPolitica] = useState("FIFO")
  const [excedenteDestino, setExcedente] = useState("CREDITO")
  const [pagadorTipo, setPagadorTipo] = useState("REQUERENTE")
  const [pessoaId, setPessoaId] = useState("")
  const [externoNome, setExternoNome] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const enviar = async () => {
    setSalvando(true); setErro(null)
    const pagador = pagadorTipo === "EXTERNO"
      ? { tipo: "EXTERNO", parteExterna: { nome: externoNome || "Externo" } }
      : pessoaId ? { tipo: pagadorTipo, pessoaId: Number(pessoaId) } : null
    const body: Record<string, unknown> = { obrigacaoId, tipo, valor: Number(valor), moeda, pagador }
    if (tipo === "PAGAMENTO" || tipo === "PAGAMENTO_PARCIAL") { body.aplicacao = { politica }; body.excedenteDestino = excedenteDestino }
    try {
      const r = await fetch("/api/financeiro/v3/ocorrencias", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })
      const d = await r.json()
      if (r.ok && d.ok) onDone()
      else setErro(d.erro || d.motivo || "Falha ao registrar.")
    } catch { setErro("Falha de rede.") }
    finally { setSalvando(false) }
  }

  const ehPagamento = tipo === "PAGAMENTO" || tipo === "PAGAMENTO_PARCIAL"
  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-neutral-700 bg-neutral-950/60 p-4 sm:grid-cols-2">
      <label className="text-xs text-neutral-400">Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100">
          {["PAGAMENTO", "PAGAMENTO_PARCIAL", "DESCONTO", "JUROS", "MULTA"].map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="text-xs text-neutral-400">Valor ({moeda})
        <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" />
      </label>
      {ehPagamento && <>
        <label className="text-xs text-neutral-400">Política de aplicação
          <select value={politica} onChange={(e) => setPolitica(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100">
            {["FIFO", "PROPORCIONAL", "PARCELA_ESPECIFICA", "MANUAL"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-neutral-400">Destino do excedente
          <select value={excedenteDestino} onChange={(e) => setExcedente(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100">
            {["CREDITO", "ADIANTAMENTO", "DEVOLUCAO", "QUITAR_OUTRO"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-neutral-400">Pagador
          <select value={pagadorTipo} onChange={(e) => setPagadorTipo(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100">
            {["REQUERENTE", "EMPRESA", "TERCEIRO", "EXTERNO"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {pagadorTipo === "EXTERNO"
          ? <label className="text-xs text-neutral-400">Nome do pagador externo<input value={externoNome} onChange={(e) => setExternoNome(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" /></label>
          : <label className="text-xs text-neutral-400">Pessoa (id, opcional)<input value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100" /></label>}
      </>}
      {erro && <div className="sm:col-span-2 text-xs text-red-400">{erro}</div>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button onClick={enviar} disabled={salvando || !valor} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40" style={{ backgroundColor: OURO }}>
          {salvando ? "Registrando…" : "Registrar"}
        </button>
      </div>
    </div>
  )
}
