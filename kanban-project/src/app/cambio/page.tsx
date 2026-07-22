'use client'
// src/app/cambio/page.tsx — TELA DE HISTÓRICO / ADMIN de câmbio.
// Fonte oficial Confidence Câmbio · provider ativo · modalidade · última cotação por
// moeda · estado da integração · histórico completo. Botão "Atualizar agora" executa o
// MESMO serviço do cron (contingência). Lê só o banco; nunca consulta a Confidence na tela.
import * as React from 'react'
import Link from 'next/link'

type Snap = { moedas: any[]; fonte: string }
type Cot = { id: number; moedaDe: string; moedaPara: string; taxa: string | number; data: string | null; fonte: string | null; ativo: boolean; origem?: string | null; modalidade?: string | null; dataReferencia?: string | null; consultadoEm?: string | null; vigente?: boolean }

const brl = (v: any) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')
const dth = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

function tok() { return typeof window !== 'undefined' ? localStorage.getItem('authToken') : null }
async function jf(url: string, opts: RequestInit = {}) {
  const t = tok()
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(opts.headers || {}) }, cache: 'no-store' })
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d as any)?.error || `Erro ${r.status}`); return d
}

export default function CambioHistoricoPage() {
  const [snap, setSnap] = React.useState<Snap | null>(null)
  const [hist, setHist] = React.useState<Cot[]>([])
  const [erro, setErro] = React.useState<string | null>(null)
  const [rodando, setRodando] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    try {
      const [s, h] = await Promise.all([jf('/api/cambio/snapshot'), jf('/api/gerenciamento/cambio').catch(() => ({ cotacoes: [] }))])
      setSnap(s); setHist(((h as any).cotacoes || []) as Cot[])
    } catch (e: any) { setErro(e.message || 'erro') }
  }, [])
  React.useEffect(() => { carregar() }, [carregar])

  async function atualizarAgora() {
    setRodando(true); setMsg(null)
    try { const r = await jf('/api/gerenciamento/cambio/atualizar-agora', { method: 'POST' }); setMsg('Execução concluída: ' + (r.moedas || []).map((m: any) => `${m.moeda}=${m.status}`).join(' · ')); await carregar() }
    catch (e: any) { setMsg('Falha: ' + (e.message || 'erro')) }
    finally { setRodando(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-xs text-sky-600 hover:underline">← Início</Link>
            <h1 className="text-xl font-semibold text-slate-900">Histórico de câmbio</h1>
            <p className="text-sm text-slate-500">Fonte oficial: <b>Confidence Câmbio</b> · provider ativo: <b>CONFIDENCE</b> · atualização automática diária.</p>
          </div>
          <button onClick={atualizarAgora} disabled={rodando} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50">{rodando ? 'Atualizando…' : 'Atualizar agora'}</button>
        </div>
        {msg && <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">{msg}</div>}
        {erro && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

        {/* Vigentes por moeda */}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['EUR', 'USD'] as const).map((cod) => {
            const m = snap?.moedas?.find((x: any) => x.moeda === cod)
            return (
              <div key={cod} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">{cod}/BRL</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">{m?.estado ?? 'INDISPONIVEL'}</span>
                </div>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">1 {cod} = {brl(m?.valor)}</p>
                <div className="mt-1 text-[12px] text-slate-500">
                  <div>Data da cotação (fonte): {dt(m?.dataReferencia)}</div>
                  <div>Última consulta: {dth(m?.consultadoEm)}</div>
                  <div>Modalidade: {m?.modalidade ?? '—'} · Origem: {m?.origem ?? '—'}</div>
                  {m?.variacaoAbs != null && <div>Variação: {m.variacaoAbs > 0 ? '+' : ''}{m.variacaoAbs} ({m.variacaoPct}%)</div>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Histórico completo */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-[13px]">
            <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              {['Par', 'Valor', 'Data fonte', 'Consulta', 'Origem', 'Modalidade', 'Vigente'].map((h) => <th key={h} className="border-b border-slate-200 px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {hist.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Nenhuma cotação registrada.</td></tr>}
              {hist.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-800">{c.moedaDe}/{c.moedaPara}</td>
                  <td className="px-3 py-2 tabular-nums">{brl(c.taxa)}</td>
                  <td className="px-3 py-2 text-slate-500">{dt(c.dataReferencia ?? c.data)}</td>
                  <td className="px-3 py-2 text-slate-500">{dth(c.consultadoEm)}</td>
                  <td className="px-3 py-2 text-slate-500">{c.origem ?? c.fonte ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{c.modalidade ?? '—'}</td>
                  <td className="px-3 py-2">{(c.vigente ?? c.ativo) ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">vigente</span> : <span className="text-slate-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
