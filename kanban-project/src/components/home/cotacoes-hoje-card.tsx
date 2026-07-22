'use client'
// src/components/home/cotacoes-hoje-card.tsx
// Card "Cotações de hoje" da Home. LÊ SÓ o banco (/api/cambio/snapshot) — nunca a
// Confidence no carregamento. Responsivo, clicável → tela de histórico (/cambio).
// Estilo alinhado à identidade da Home (light/executivo). Distingue estados:
// atualizado · sem nova publicação · desatualizado · indisponível.
import * as React from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, RefreshCw, AlertTriangle } from 'lucide-react'

type MoedaSnap = {
  moeda: 'EUR' | 'USD'; valor: number | null; dataReferencia: string | null; consultadoEm: string | null
  modalidade: string | null; origem: string | null; estado: 'ATUALIZADO' | 'SEM_NOVA_PUBLICACAO' | 'DESATUALIZADO' | 'INDISPONIVEL' | 'CONFIGURACAO_PENDENTE'
  variacaoAbs: number | null; variacaoPct: number | null
}

const brl = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }))
const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—')
const dth = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const NOME = { EUR: 'Euro', USD: 'Dólar' } as const

const ESTADO = {
  ATUALIZADO: { txt: 'Atualizado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  SEM_NOVA_PUBLICACAO: { txt: 'Sem nova publicação hoje', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  DESATUALIZADO: { txt: 'Desatualizado', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  INDISPONIVEL: { txt: 'Indisponível', cls: 'bg-red-50 text-red-700 border-red-200' },
  CONFIGURACAO_PENDENTE: { txt: 'Configuração pendente', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
} as const

export function CotacoesHojeCard() {
  const [dados, setDados] = React.useState<{ moedas: MoedaSnap[]; fonte: string } | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)

  React.useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
    fetch('/api/cambio/snapshot', { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then(setDados).catch(() => setErro('indisponível'))
  }, [])

  const moedas = dados?.moedas ?? []
  return (
    <Link
      href="/cambio"
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-sky-500/30 md:p-5"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Cotações de hoje</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700" title="Atualização automática diária">
            <RefreshCw className="h-3 w-3" /> automático
          </span>
        </div>
        <span className="text-[11px] text-slate-400">Fonte: {dados?.fonte ?? 'Confidence Câmbio'}</span>
      </div>

      {erro && <p className="text-xs text-red-600">Cotações indisponíveis no momento.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(['EUR', 'USD'] as const).map((cod) => {
          const m = moedas.find((x) => x.moeda === cod)
          const est = ESTADO[m?.estado ?? 'INDISPONIVEL']
          const sobe = (m?.variacaoAbs ?? 0) > 0
          const desce = (m?.variacaoAbs ?? 0) < 0
          return (
            <div key={cod} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{NOME[cod]} · {cod}/BRL</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${est.cls}`}>{est.txt}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums text-slate-900">1 {cod} = {brl(m?.valor ?? null)}</span>
                {m?.variacaoAbs != null && (
                  <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${sobe ? 'text-emerald-600' : desce ? 'text-red-600' : 'text-slate-400'}`}>
                    {sobe ? <TrendingUp className="h-3 w-3" /> : desce ? <TrendingDown className="h-3 w-3" /> : null}
                    {m.variacaoAbs > 0 ? '+' : ''}{m.variacaoAbs.toFixed(4)} ({m.variacaoPct != null ? `${m.variacaoPct > 0 ? '+' : ''}${m.variacaoPct}%` : '—'})
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                <span>Cotação: {dt(m?.dataReferencia ?? null)}</span>
                <span>· Atualiz.: {dth(m?.consultadoEm ?? null)}</span>
                {m?.modalidade && <span>· {m.modalidade}</span>}
                {(m?.estado === 'DESATUALIZADO' || m?.estado === 'SEM_NOVA_PUBLICACAO') && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600"><AlertTriangle className="h-3 w-3" /> defasagem</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-right text-[11px] text-sky-600">Ver histórico de câmbio →</p>
    </Link>
  )
}
