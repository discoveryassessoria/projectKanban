// src/components/financeiro/v3/ProcessoFinanceiroV3.tsx
// ============================================================================
// FINANCEIRO DO PROCESSO — V3 (Motor Financeiro · Ledger). Tela definitiva dentro
// do processo, alimentada EXCLUSIVAMENTE pelo Ledger/projeções V3. Exibe valor
// contratado, obrigações, distribuição entre requerentes, responsáveis
// contratuais, pagadores, pagamentos parciais, extras, descontos/juros/multas/
// estornos, saldo, timeline e comprovantes. Registra ocorrências pelas rotas V3.
// A tela antiga (ProcessoFinanceiro) fica como fallback por feature flag.
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, CheckCircle2, AlertTriangle, FileText, Users } from "lucide-react"
import { LancamentoExtraForm } from "@/src/components/financeiro/lancamento-extra-form"

const OURO = "#C6A15B"
const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const authHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return { ...(extra ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

interface Props { processoId: number }

export function ProcessoFinanceiroV3({ processoId }: Props) {
  const [d, setD] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [showExtra, setShowExtra] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const r = await fetch(`/api/financeiro/v3/processo/${processoId}`, { headers: authHeaders() })
      const j = await r.json()
      if (r.ok && j.disponivel) setD(j.posicao)
      else setErro(j.fallbackLegado ? "Financeiro V3 indisponível — usando o legado como fallback." : (j.erro || "Falha ao carregar."))
    } catch { setErro("Falha de rede ao carregar o financeiro V3.") }
  }, [processoId])
  useEffect(() => { carregar() }, [carregar])

  if (erro) return <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">{erro}</div>
  if (!d) return <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> carregando financeiro V3…</div>
  const nome = (id: number | null) => (id != null && d.nomesPessoas[id]) ? d.nomesPessoas[id] : (id != null ? `pessoa #${id}` : "—")

  return (
    <div className="space-y-5 text-neutral-100">
      {/* Cabeçalho + totais */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold" style={{ color: OURO }}>Financeiro V3 · {d.processo?.codigo ?? `Processo #${processoId}`}</div>
            <div className="text-xs text-neutral-500">{d.processo?.nome} · {d.processo?.pais} · fonte: Ledger</div>
          </div>
          <button onClick={() => setShowExtra(true)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500"><Plus className="h-4 w-4" /> Lançamento extra</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Contratado", fmt(d.totais.contratado)], ["Saldo", fmt(d.totais.saldo)], ["Recebido", fmt(d.totais.recebido)], ["Obrigações", String(d.totais.obrigacoes)]].map(([k, v]) => (
            <div key={k}><div className="text-xs text-neutral-500">{k}</div><div className="mt-0.5 text-lg font-semibold" style={{ color: OURO }}>{v}</div></div>
          ))}
        </div>
      </div>

      {/* Responsáveis contratuais */}
      {d.responsaveis.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-neutral-500"><Users className="h-3.5 w-3.5" /> Responsáveis contratuais</div>
          <div className="flex flex-wrap gap-2 text-sm">{d.responsaveis.map((r: any) => <span key={r.id} className="rounded bg-neutral-800 px-2 py-1">{r.nome}{r.cpf ? ` · ${r.cpf}` : ""}</span>)}</div>
        </div>
      )}

      {showExtra && <LancamentoExtraForm processoIdInicial={processoId} onClose={() => setShowExtra(false)} onDone={() => { setShowExtra(false); carregar() }} />}

      {/* Obrigações */}
      {d.obrigacoes.length === 0 && <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">Nenhuma obrigação no Ledger para este processo ainda.</div>}
      {d.obrigacoes.map((o: any) => <ObrigacaoCard key={o.obrigacaoId} o={o} nome={nome} onChange={carregar} />)}
    </div>
  )
}

function ObrigacaoCard({ o, nome, onChange }: { o: any; nome: (id: number | null) => string; onChange: () => void }) {
  const [show, setShow] = useState(false)
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-semibold">{o.codigoOperacional ?? `Obrigação #${o.obrigacaoId}`}</span>
          <span className="ml-2 text-xs text-neutral-400">{o.natureza} · {o.direcao} · {o.status}</span>
        </div>
        <div className="text-right"><div className="text-xs text-neutral-500">Saldo</div><div className="text-xl font-semibold" style={{ color: o.saldo <= 0.005 ? "#5FB878" : OURO }}>{fmt(o.saldo, o.moedaContratual)}</div></div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-xs text-neutral-500">Contratado</div>{fmt(o.valorContratado, o.moedaContratual)}</div>
        <div><div className="text-xs text-neutral-500">Recebido</div>{fmt(o.recebidoBruto, o.moedaContratual)}</div>
        <div className={`flex items-center gap-1 text-xs ${o.divergencia?.consistente ? "text-emerald-400" : "text-red-400"}`}>{o.divergencia?.consistente ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{o.divergencia?.consistente ? "Ledger consistente" : "divergência"}</div>
      </div>

      {/* Distribuição entre requerentes */}
      {o.posicaoRequerentes.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs uppercase tracking-wider text-neutral-500">Distribuição por requerente <span className="normal-case text-neutral-600">(informativa)</span></div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1">Requerente</th><th className="pb-1">Participação</th><th className="pb-1">Pago</th><th className="pb-1">Por terceiros</th><th className="pb-1">Saldo</th></tr></thead>
            <tbody>{o.posicaoRequerentes.map((r: any) => (
              <tr key={r.pessoaId} className="border-t border-neutral-800"><td className="py-1">{nome(r.pessoaId)}</td><td>{fmt(r.participacao)}</td><td>{fmt(r.pago)}</td><td>{r.pagoEmNomeDeTerceiros > 0 ? fmt(r.pagoEmNomeDeTerceiros) : "—"}</td><td>{fmt(r.saldoEconomico)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* Pagadores externos + créditos */}
      {(o.pagadoresExternos.length > 0 || o.creditos.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-400">
          {o.pagadoresExternos.map((p: any, i: number) => <span key={i}>Externo: {p.nome} {fmt(p.valor)}</span>)}
          {o.creditos.map((c: any) => <span key={c.id}>Crédito {c.destino}: {fmt(c.valor)} ({c.status})</span>)}
        </div>
      )}

      {/* Timeline financeira + comprovantes */}
      <div className="mt-4">
        <div className="mb-1 text-xs uppercase tracking-wider text-neutral-500">Timeline financeira</div>
        <div className="space-y-1">{o.timeline.map((t: any) => (
          <div key={t.ocorrenciaId} className="flex items-center justify-between border-b border-neutral-800 py-1.5 text-sm last:border-0">
            <div><span className="font-medium">{t.tipo}</span><span className="ml-2 text-xs text-neutral-500">{new Date(t.data).toLocaleDateString("pt-BR")}</span>{t.pagador && <span className="ml-2 text-xs text-neutral-500">· {t.pagador.externoNome ?? nome(t.pagador.pessoaId)}</span>}</div>
            <div className="flex items-center gap-3"><span>{fmt(t.valor, t.moeda)}</span>{t.comprovanteUrl && <a href={t.comprovanteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"><FileText className="h-3 w-3" /> comprovante</a>}</div>
          </div>
        ))}</div>
      </div>

      <button onClick={() => setShow((s) => !s)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500"><Plus className="h-4 w-4" /> Registrar ocorrência</button>
      {show && <FormOcorrencia obrigacaoId={o.obrigacaoId} moeda={o.moedaContratual} onDone={() => { setShow(false); onChange() }} />}
    </div>
  )
}

// Registro de ocorrência via rota V3 (pagamento/parcial/desconto/juros/multa).
function FormOcorrencia({ obrigacaoId, moeda, onDone }: { obrigacaoId: number; moeda: string; onDone: () => void }) {
  const [tipo, setTipo] = useState("PAGAMENTO")
  const [valor, setValor] = useState("")
  const [politica, setPolitica] = useState("FIFO")
  const [pagadorTipo, setPagadorTipo] = useState("REQUERENTE")
  const [pessoaId, setPessoaId] = useState("")
  const [externo, setExterno] = useState("")
  const [comprovante, setComprovante] = useState("")
  const [obs, setObs] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const ehPagamento = tipo === "PAGAMENTO" || tipo === "PAGAMENTO_PARCIAL"

  const enviar = async () => {
    setSalvando(true); setErro(null)
    const pagador = pagadorTipo === "EXTERNO" ? { tipo: "EXTERNO", parteExterna: { nome: externo || "Externo" } } : (pessoaId ? { tipo: pagadorTipo, pessoaId: Number(pessoaId) } : null)
    const body: any = { obrigacaoId, tipo, valor: Number(valor), moeda, comprovanteUrl: comprovante || null, observacao: obs || null }
    if (ehPagamento) { body.aplicacao = { politica }; body.pagador = pagador; body.excedenteDestino = "CREDITO" }
    try {
      const r = await fetch("/api/financeiro/v3/ocorrencias", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) })
      const j = await r.json()
      if (r.ok && j.ok) onDone(); else setErro(j.erro || j.motivo || "Falha ao registrar.")
    } catch { setErro("Falha de rede.") } finally { setSalvando(false) }
  }
  const inp = "mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm text-neutral-100"
  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-neutral-700 bg-neutral-950/60 p-4 sm:grid-cols-2">
      <label className="text-xs text-neutral-400">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inp}>{["PAGAMENTO", "PAGAMENTO_PARCIAL", "DESCONTO", "JUROS", "MULTA", "ESTORNO"].map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="text-xs text-neutral-400">Valor ({moeda})<input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={inp} /></label>
      {ehPagamento && <>
        <label className="text-xs text-neutral-400">Política<select value={politica} onChange={(e) => setPolitica(e.target.value)} className={inp}>{["FIFO", "PROPORCIONAL", "PARCELA_ESPECIFICA", "MANUAL"].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="text-xs text-neutral-400">Pagador<select value={pagadorTipo} onChange={(e) => setPagadorTipo(e.target.value)} className={inp}>{["REQUERENTE", "EMPRESA", "TERCEIRO", "EXTERNO"].map((t) => <option key={t}>{t}</option>)}</select></label>
        {pagadorTipo === "EXTERNO"
          ? <label className="text-xs text-neutral-400">Nome externo<input value={externo} onChange={(e) => setExterno(e.target.value)} className={inp} /></label>
          : <label className="text-xs text-neutral-400">Pessoa (id)<input value={pessoaId} onChange={(e) => setPessoaId(e.target.value)} inputMode="numeric" className={inp} /></label>}
      </>}
      <label className="text-xs text-neutral-400 sm:col-span-2">Comprovante (URL)<input value={comprovante} onChange={(e) => setComprovante(e.target.value)} className={inp} placeholder="https://…" /></label>
      <label className="text-xs text-neutral-400 sm:col-span-2">Observação<input value={obs} onChange={(e) => setObs(e.target.value)} className={inp} /></label>
      {erro && <div className="sm:col-span-2 text-xs text-red-400">{erro}</div>}
      <div className="sm:col-span-2 flex justify-end"><button onClick={enviar} disabled={salvando || !valor} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40" style={{ backgroundColor: OURO }}>{salvando ? "Registrando…" : "Registrar"}</button></div>
    </div>
  )
}

export default ProcessoFinanceiroV3
