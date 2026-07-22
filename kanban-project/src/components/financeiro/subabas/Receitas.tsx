// src/components/financeiro/subabas/Receitas.tsx
// ============================================================================
// RECEITAS DO PROCESSO — central financeira operacional organizada por REQUERENTE.
//
// Hierarquia: FASE → REQUERENTE → RECEITA → COBRANÇA → PARCELA/PAGAMENTO.
// Não é uma tabela de lançamentos: cada receita abre o MODAL de Cobrança
// (ReceitaCobrancaModal), onde a cobrança é gerada, vista e recebida.
//
// Os lançamentos nascem EXCLUSIVAMENTE do FinanceRuleEngine — não há criação
// manual (o botão "Nova Receita" apenas explica isso). Moeda original é a
// apresentação principal; nunca soma moedas diferentes. Agrupamento/totais/status
// vêm do view model PURO lib/financeiro/receitas-processo-view (fonte única,
// testada); o backend agrega em /api/financeiro/processos/[id]/receitas-view.
// ============================================================================
'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  FileText, Plus, RefreshCw, Search, Filter, ChevronDown, ChevronUp, MoreVertical, User,
  Loader2, Wallet, Database, TrendingUp, PieChart, CalendarClock, Receipt, Printer, Download, X,
} from 'lucide-react'
import { filtrarView, type ReceitasView, type FaseVM, type RequerenteVM, type ReceitaVM, type StatusFinanceiro } from '@/lib/financeiro/receitas-processo-view'
import { ReceitaCobrancaModal } from '../ReceitaCobrancaModal'

interface ReceitasProps { processoId: number; onUpdate?: () => void; nomeFamilia?: string; fxHoje?: number }

const money = (v: number, m = 'BRL') => { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: m }).format(v || 0) } catch { return `${m} ${(v || 0).toFixed(2)}` } }
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

const ST: Record<StatusFinanceiro, { label: string; cls: string }> = {
  SEM_COBRANCA: { label: 'Sem cobrança', cls: 'bg-white/10 text-white/50 border-white/15' },
  A_VENCER: { label: 'A vencer', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  PARCIAL: { label: 'Parcialmente recebido', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  RECEBIDO: { label: 'Recebido', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  VENCIDO: { label: 'Vencido', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-white/10 text-white/40 border-white/15' },
  ESTORNADO: { label: 'Estornado', cls: 'bg-white/10 text-white/40 border-white/15' },
}
const Badge = ({ s }: { s: StatusFinanceiro }) => <span className={`inline-block shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${ST[s].cls}`}>{ST[s].label}</span>

async function jf(url: string) {
  const t = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const r = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((d as any)?.error || `Erro ${r.status}`)
  return d
}

export function Receitas({ processoId, onUpdate, nomeFamilia }: ReceitasProps) {
  const [data, setData] = useState<{ processo: { id: number; nome: string }; view: ReceitasView; cambio: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [agruparPor, setAgruparPor] = useState<'requerente' | 'fase' | 'tipo'>('requerente')
  const [fase, setFase] = useState('')
  const [status, setStatus] = useState<StatusFinanceiro | ''>('')
  const [busca, setBusca] = useState('')
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())
  const [receitaAberta, setReceitaAberta] = useState<number | null>(null)
  const [infoNova, setInfoNova] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try { setData(await jf(`/api/financeiro/processos/${processoId}/receitas-view`)) }
    catch (e: any) { setErro(e.message || 'Não foi possível carregar.') }
    finally { setLoading(false) }
  }, [processoId])
  useEffect(() => { carregar() }, [carregar])

  const view = data?.view
  const fasesVisiveis = useMemo(() => (view ? filtrarView(view, { fase: fase || null, status: status || null, busca }) : []), [view, fase, status, busca])

  // cards e resumo lateral refletem o conjunto VISÍVEL (fase selecionada ou tudo)
  const agg = useMemo(() => {
    const receitas = fasesVisiveis.flatMap((f) => f.requerentes.flatMap((r) => r.receitas))
    const moeda = receitas[0]?.moeda ?? view?.resumo.moeda ?? 'BRL'
    const total = receitas.reduce((s, r) => s + r.valorContratual, 0)
    const rec = receitas.reduce((s, r) => s + r.recebido, 0)
    const parcelas = receitas.flatMap((r) => r.cobrancas.flatMap((c) => c.parcelas))
    return {
      moeda, total, rec, saldo: total - rec, pct: total > 0 ? Math.round((rec / total) * 1000) / 10 : 0,
      qtdReceitas: receitas.length, qtdCobrancas: receitas.reduce((s, r) => s + r.cobrancas.length, 0),
      qtdParcelas: parcelas.length, qtdPagamentos: parcelas.filter((p) => p.pago).length,
      pendentes: parcelas.filter((p) => !p.pago).length,
      status: (fasesVisiveis.length ? fasesVisiveis.flatMap((f) => f.requerentes.map((r) => r.status)) : ['SEM_COBRANCA'] as StatusFinanceiro[]).reduce((a, b) => a, 'A_VENCER' as StatusFinanceiro),
      semCobranca: receitas.filter((r) => !r.temCobranca && r.status !== 'CANCELADO').length,
    }
  }, [fasesVisiveis, view])

  const totalReq = fasesVisiveis.reduce((s, f) => s + f.qtdRequerentes, 0)
  const totalRec = fasesVisiveis.reduce((s, f) => s + f.qtdReceitas, 0)
  const cambio = data?.cambio

  function abrir(id: number) { setReceitaAberta(id) }
  const toggleReq = (k: string) => setRecolhidos((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const recolherFase = (f: FaseVM) => setRecolhidos((s) => { const n = new Set(s); const chaves = f.requerentes.map((r) => `${f.faseKey}:${r.pessoaId}`); const todosRecolhidos = chaves.every((c) => n.has(c)); chaves.forEach((c) => todosRecolhidos ? n.delete(c) : n.add(c)); return n })

  return (
    <div className="text-white">
      {/* Cabeçalho */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="mb-1 flex items-center gap-1.5 text-xs text-white/40">
            <span>Processos</span><span>›</span><span>{nomeFamilia ?? data?.processo.nome ?? '…'}</span><span>›</span><span>Financeiro</span><span>›</span><span className="text-white/70">Receitas</span>
          </nav>
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-violet-400" />
            <h2 className="text-2xl font-bold">Receitas</h2>
          </div>
          <p className="mt-0.5 text-sm text-white/50">Visão organizada por requerentes e receitas do processo.</p>
        </div>
        <div className="flex items-center gap-2">
          {cambio && <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 sm:flex"><span className="font-semibold text-white">{cambio.moeda}</span> {money(cambio.cotacao, 'BRL')}</div>}
          <button onClick={carregar} className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/60 transition hover:text-white" title="Atualizar"><RefreshCw className="h-4 w-4" /></button>
          <button onClick={() => setInfoNova(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"><Plus className="h-4 w-4" /> Nova Receita</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/40" /></div>
      ) : erro ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erro} <button onClick={carregar} className="ml-2 underline">Tentar de novo</button></div>
      ) : (
        <>
          {/* 4 cards compactos */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card titulo="Total da fase" valor={money(agg.total, agg.moeda)} sub={`${agg.qtdReceitas} receita(s)`} icon={Database} cor="violet" />
            <Card titulo="Recebido" valor={money(agg.rec, agg.moeda)} sub={`${agg.pct}% do total`} icon={TrendingUp} cor="emerald" />
            <Card titulo="Saldo a receber" valor={money(agg.saldo, agg.moeda)} sub={`${Math.round((100 - agg.pct) * 10) / 10}% do total`} icon={PieChart} cor="sky" />
            <Card titulo="Situação geral" valor={ST[agg.status].label} sub={`${agg.pendentes} parcela(s) pendente(s)`} icon={CalendarClock} cor="amber" />
          </div>

          {/* barra única de filtros */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <Sel label="Agrupar por" value={agruparPor} onChange={(v) => setAgruparPor(v as any)} opts={[['requerente', 'Requerente'], ['fase', 'Fase'], ['tipo', 'Tipo de receita']]} />
            <Sel label="Fase" value={fase} onChange={setFase} opts={[['', 'Todas'], ...(view?.fases.map((f) => [f.faseKey, f.faseLabel] as [string, string]) ?? [])]} />
            <Sel label="Status" value={status} onChange={(v) => setStatus(v as any)} opts={[['', 'Todos'], ...(Object.keys(ST) as StatusFinanceiro[]).map((s) => [s, ST[s].label] as [string, string])]} />
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por requerente, serviço, descrição…" className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25" />
            </div>
            <button className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/50" title="Filtros avançados"><Filter className="h-4 w-4" /></button>
          </div>

          {/* conteúdo + painel lateral */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
            <div className="min-w-0 space-y-4">
              {fasesVisiveis.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] py-16 text-center text-sm text-white/50">
                  {busca || fase || status ? 'Nenhuma receita para os filtros selecionados.' : 'Nenhuma receita neste processo ainda. Elas nascem automaticamente ao avançar as fases.'}
                </div>
              ) : fasesVisiveis.map((f) => (
                <section key={f.faseKey} className="rounded-xl border border-white/10 bg-white/[0.03]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold uppercase tracking-wide text-white">{f.faseLabel}</h3>
                      <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300">{f.qtdRequerentes} requerente(s)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                      <span className="text-white/45">Receitas: <b className="text-white/80">{money(f.totalReceitas, f.moeda)}</b></span>
                      <span className="text-white/45">Recebido: <b className="text-emerald-300">{money(f.recebido, f.moeda)}</b></span>
                      <span className="text-white/45">Saldo: <b className="text-sky-300">{money(f.saldo, f.moeda)}</b></span>
                      <button onClick={() => recolherFase(f)} className="text-white/50 hover:text-white">Recolher todos</button>
                    </div>
                  </div>
                  <div className="space-y-3 p-3">
                    {f.requerentes.map((req) => (
                      <RequerenteBloco key={`${f.faseKey}:${req.pessoaId}`} req={req} recolhido={recolhidos.has(`${f.faseKey}:${req.pessoaId}`)} onToggle={() => toggleReq(`${f.faseKey}:${req.pessoaId}`)} onAbrir={abrir} />
                    ))}
                  </div>
                </section>
              ))}
              <p className="pb-2 text-center text-xs text-white/35">Exibindo {totalReq} requerente(s) e {totalRec} receita(s)</p>
            </div>

            {/* painel lateral */}
            <aside className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="mb-3 text-sm font-semibold text-white">Resumo da fase</h4>
                <Row l="Total contratado" v={money(agg.total, agg.moeda)} />
                <Row l="Total recebido" v={money(agg.rec, agg.moeda)} c="text-emerald-300" />
                <Row l="Saldo a receber" v={money(agg.saldo, agg.moeda)} c="text-sky-300" />
                <div className="my-2 border-t border-white/10" />
                <Row l="Receitas" v={String(agg.qtdReceitas)} />
                <Row l="Cobranças" v={String(agg.qtdCobrancas)} />
                <Row l="Parcelas" v={String(agg.qtdParcelas)} />
                <Row l="Pagamentos" v={String(agg.qtdPagamentos)} />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="mb-2 text-sm font-semibold text-white">Ações rápidas</h4>
                <div className="space-y-1">
                  <AcaoRapida icon={Plus} label="Nova Receita" onClick={() => setInfoNova(true)} />
                  <AcaoRapida icon={Receipt} label="Gerar Cobrança" onClick={() => { const r = fasesVisiveis.flatMap((f) => f.requerentes.flatMap((x) => x.receitas)).find((x) => !x.temCobranca); if (r) abrir(r.id); else setInfoNova(true) }} />
                  <AcaoRapida icon={Download} label="Exportar Lista" onClick={() => window.print()} />
                  <AcaoRapida icon={Printer} label="Imprimir" onClick={() => window.print()} />
                </div>
              </div>
              {cambio && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h4 className="mb-2 text-sm font-semibold text-white">Cotação</h4>
                  <p className="text-sm text-white/80">1 {cambio.moeda} = {money(cambio.cotacao, 'BRL')}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">{dt(cambio.data)} · {cambio.estimado ? 'Estimada' : 'Congelada'}</p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      {receitaAberta != null && <ReceitaCobrancaModal receitaId={receitaAberta} onClose={() => setReceitaAberta(null)} onChanged={() => { carregar(); onUpdate?.() }} />}
      {infoNova && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setInfoNova(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 p-6 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-base font-semibold">Receitas são automáticas</h3><button onClick={() => setInfoNova(false)} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button></div>
            <p className="text-sm leading-relaxed text-white/70">As receitas nascem do <b>motor financeiro</b> quando o processo avança de fase (honorários, serviços, documentos). Não há criação manual. Para operar uma receita, abra-a e <b>gere a cobrança</b> definindo forma, condição e parcelas.</p>
            <button onClick={() => setInfoNova(false)} className="mt-4 w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white hover:bg-violet-500">Entendi</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── bloco de um requerente (expansível) ─────────────────────────────────────
function RequerenteBloco({ req, recolhido, onToggle, onAbrir }: { req: RequerenteVM; recolhido: boolean; onToggle: () => void; onAbrir: (id: number) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-300"><User className="h-4.5 w-4.5" /></div>
        <div className="min-w-0">
          {req.papel === 'adicional' && <p className="text-[11px] text-white/40">Requerente adicional</p>}
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-white">{req.nome}</span>
            {req.papel === 'principal' && <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-300">Principal</span>}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-right text-xs">
          <div><p className="text-white/40">Total receitas</p><p className="font-semibold text-white">{money(req.totalReceitas, req.moeda)}</p></div>
          <div><p className="text-white/40">Recebido</p><p className="font-semibold text-emerald-300">{money(req.recebido, req.moeda)}</p></div>
          <div><p className="text-white/40">Saldo</p><p className="font-semibold text-sky-300">{money(req.saldo, req.moeda)}</p></div>
          <div><p className="mb-1 text-white/40">Status</p><Badge s={req.status} /></div>
          <button onClick={onToggle} className="rounded-md p-1 text-white/50 hover:text-white">{recolhido ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}</button>
        </div>
      </div>

      {!recolhido && (
        <div className="border-t border-white/10">
          {/* desktop: tabela; mobile: cards */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wide text-white/45">
                {['Receita', 'Serviço', 'Valor contratual', 'Cobranças', 'Recebido', 'Saldo', 'Vencimento', 'Status', 'Ações'].map((h) => <th key={h} className="px-4 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {req.receitas.map((r) => <ReceitaLinha key={r.id} r={r} onAbrir={onAbrir} />)}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {req.receitas.map((r) => <ReceitaCardMobile key={r.id} r={r} onAbrir={onAbrir} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── linha de receita (desktop) + cobrança expandida ─────────────────────────
function ReceitaLinha({ r, onAbrir }: { r: ReceitaVM; onAbrir: (id: number) => void }) {
  const cob = r.cobrancas[0]
  return (
    <>
      <tr className="border-t border-white/5 align-top">
        <td className="px-4 py-3"><div className="font-medium text-white">{r.descricao}</div><div className="text-[11px] text-white/40">{r.faseLabel}</div></td>
        <td className="px-4 py-3 text-white/70">{r.servico ?? '—'}</td>
        <td className="px-4 py-3 tabular-nums text-white/85">{money(r.valorContratual, r.moeda)}</td>
        <td className="px-4 py-3">
          {r.temCobranca
            ? <><div className="text-white/70">{r.cobrancas.length} cobrança{r.cobrancas.length > 1 ? 's' : ''}</div><button onClick={() => onAbrir(r.id)} className="text-[11px] text-violet-300 hover:underline">Ver detalhes</button></>
            : <button onClick={() => onAbrir(r.id)} className="rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25">Gerar cobrança</button>}
        </td>
        <td className="px-4 py-3 tabular-nums text-emerald-300">{money(r.recebido, r.moeda)}</td>
        <td className="px-4 py-3 tabular-nums text-sky-300">{money(r.saldo, r.moeda)}</td>
        <td className="px-4 py-3 text-white/70">{dt(r.vencimento)}</td>
        <td className="px-4 py-3"><Badge s={r.status} /></td>
        <td className="px-4 py-3"><button onClick={() => onAbrir(r.id)} className="rounded-md border border-white/15 px-3 py-1 text-xs text-white/80 hover:bg-white/10">Abrir</button></td>
      </tr>
      {cob && (
        <tr className="border-t border-white/5 bg-black/20">
          <td colSpan={9} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              <span className="font-semibold text-white">Cobrança {cob.label}</span>
              <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/60">{cob.status}</span>
              <span className="text-white/50">{[cob.condicao, cob.forma, cob.carteira].filter(Boolean).join(' · ') || '—'}</span>
              <span className="text-white/50">Parcela {cob.parcelasPagas}/{cob.nParcelas}</span>
              <span className="text-white/50">Venc. {dt(cob.proximoVencimento)}</span>
              <span className="text-white/50">Valor <b className="text-white/80">{money(cob.valorTotal, r.moeda)}</b></span>
              <span className="text-white/50">Pago <b className="text-emerald-300">{money(cob.pago, r.moeda)}</b></span>
              <span className="text-white/50">Saldo <b className="text-sky-300">{money(cob.saldo, r.moeda)}</b></span>
              <button onClick={() => onAbrir(r.id)} className="ml-auto rounded-md border border-violet-500/40 px-3 py-1 text-violet-300 hover:bg-violet-500/10">Ver cobrança</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── card de receita (mobile) ────────────────────────────────────────────────
function ReceitaCardMobile({ r, onAbrir }: { r: ReceitaVM; onAbrir: (id: number) => void }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-medium text-white">{r.descricao}</div><div className="text-[11px] text-white/40">{r.servico ?? '—'} · {r.faseLabel}</div></div>
        <Badge s={r.status} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div><p className="text-white/40">Contratual</p><p className="tabular-nums text-white/85">{money(r.valorContratual, r.moeda)}</p></div>
        <div><p className="text-white/40">Recebido</p><p className="tabular-nums text-emerald-300">{money(r.recebido, r.moeda)}</p></div>
        <div><p className="text-white/40">Saldo</p><p className="tabular-nums text-sky-300">{money(r.saldo, r.moeda)}</p></div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-white/45">{r.temCobranca ? `${r.cobrancas[0]?.label} · ${r.cobrancas[0]?.parcelasPagas}/${r.cobrancas[0]?.nParcelas}` : 'Sem cobrança'}</span>
        <button onClick={() => onAbrir(r.id)} className={`rounded-md px-3 py-1 text-xs font-medium ${r.temCobranca ? 'border border-white/15 text-white/80' : 'bg-amber-500/15 text-amber-300'}`}>{r.temCobranca ? 'Abrir' : 'Gerar cobrança'}</button>
      </div>
    </div>
  )
}

// ── auxiliares de UI ────────────────────────────────────────────────────────
const CORES: Record<string, string> = { violet: 'from-violet-500/20 text-violet-300', emerald: 'from-emerald-500/20 text-emerald-300', sky: 'from-sky-500/20 text-sky-300', amber: 'from-amber-500/20 text-amber-300' }
function Card({ titulo, valor, sub, icon: Ic, cor }: { titulo: string; valor: string; sub: string; icon: any; cor: string }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-gradient-to-br to-transparent p-4 ${CORES[cor]}`}>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">{titulo}</p>
        <Ic className="h-4 w-4 opacity-70" />
      </div>
      <p className="mt-2 text-xl font-bold text-white">{valor}</p>
      <p className="mt-0.5 text-[11px] text-white/45">{sub}</p>
    </div>
  )
}
function Sel({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <label className="flex items-center gap-2 text-xs text-white/50">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/25">
        {opts.map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}
      </select>
    </label>
  )
}
const Row = ({ l, v, c }: { l: string; v: string; c?: string }) => <div className="flex items-center justify-between py-1 text-sm"><span className="text-white/45">{l}</span><span className={`tabular-nums font-medium ${c ?? 'text-white/85'}`}>{v}</span></div>
function AcaoRapida({ icon: Ic, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"><Ic className="h-4 w-4 text-white/50" /> {label}</button>
}
