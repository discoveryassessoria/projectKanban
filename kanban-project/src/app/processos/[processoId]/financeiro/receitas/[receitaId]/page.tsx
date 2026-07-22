'use client'

// Dossiê da Receita — PÁGINA CENTRAL (rota própria, sem modal/drawer).
// Receita → Cobrança → Parcelas → Pagamentos → Comunicação → Anexos → Histórico
// → Auditoria, numa única página com o shell principal do Discovery.
// Agregador: GET /api/financeiro/receitas/[id]/dossie. Operações (gerar cobrança,
// registrar pagamento) reusam o ReceitaCobrancaModal como MODAL DE AÇÃO.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, FileText, Pencil, Receipt, ChevronDown, Database, TrendingUp, PieChart, CalendarClock,
  Wallet, CheckCircle2, Circle, Upload, Loader2, Printer, Download, XCircle, Send, FileCheck, Ban, AlertTriangle,
} from 'lucide-react'
import { HeaderBar } from '@/src/components/header-bar'
import { usePermissoes } from '@/src/hooks/use-permissoes'
import { ReceitaCobrancaModal } from '@/src/components/financeiro/ReceitaCobrancaModal'
import type { StatusFinanceiro } from '@/lib/financeiro/receitas-processo-view'

const money = (v: number | null | undefined, m = 'BRL') => { try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: m }).format(v || 0) } catch { return `${m} ${(v || 0).toFixed(2)}` } }
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—')
const dth = (v?: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

const ST: Record<StatusFinanceiro, { label: string; cls: string; dot: string }> = {
  SEM_COBRANCA: { label: 'Sem cobrança', cls: 'bg-white/10 text-white/60 border-white/15', dot: 'text-white/40' },
  A_VENCER: { label: 'A vencer', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'text-amber-400' },
  PARCIAL: { label: 'Parcialmente recebido', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', dot: 'text-sky-400' },
  RECEBIDO: { label: 'Recebido', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'text-emerald-400' },
  VENCIDO: { label: 'Vencido', cls: 'bg-red-500/15 text-red-300 border-red-500/30', dot: 'text-red-400' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-white/10 text-white/40 border-white/15', dot: 'text-white/30' },
  ESTORNADO: { label: 'Estornado', cls: 'bg-white/10 text-white/40 border-white/15', dot: 'text-white/30' },
}
const CARD = 'rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm'
const ABAS = ['Parcelas', 'Pagamentos', 'Histórico', 'Comunicações', 'Anexos', 'Auditoria'] as const

async function jf(url: string) {
  const t = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const r = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((d as any)?.error || `Erro ${r.status}`)
  return d
}

export default function DossieReceitaPage() {
  const router = useRouter()
  const params = useParams<{ processoId: string; receitaId: string }>()
  const processoId = Number(params.processoId)
  const receitaId = Number(params.receitaId)
  const { pode, carregando } = usePermissoes()
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState<any>({ nome: 'Usuário' })
  const [processos, setProcessos] = useState<any[]>([])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<(typeof ABAS)[number]>('Parcelas')
  const [modal, setModal] = useState(false)
  const [maisAcoes, setMaisAcoes] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined') { const u = localStorage.getItem('user'); if (u) try { setUser(JSON.parse(u)) } catch {} }
    fetch('/api/processos').then((r) => (r.ok ? r.json() : null)).then((d) => setProcessos(d?.processos || [])).catch(() => {})
  }, [])
  // `pode` do hook muda de identidade a cada render — NÃO colocar nas deps
  // (senão os effects re-disparam em loop e a tela pisca). Lemos dentro.
  useEffect(() => { if (mounted && !carregando && !pode('financeiro.ver')) router.push('/') }, [mounted, carregando, router]) // eslint-disable-line react-hooks/exhaustive-deps

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try { setData(await jf(`/api/financeiro/receitas/${receitaId}/dossie?processoId=${processoId}`)) }
    catch (e: any) { setErro(e.message || 'Não foi possível carregar.') }
    finally { setLoading(false) }
  }, [receitaId, processoId])
  useEffect(() => { if (mounted && !carregando) carregar() }, [mounted, carregando, carregar]) // eslint-disable-line react-hooks/exhaustive-deps

  const voltar = () => router.push(`/kanban?processoId=${processoId}&tab=faturas`)
  const handleLogout = () => { localStorage.removeItem('authToken'); localStorage.removeItem('user'); router.push('/login') }

  if (!mounted || carregando || !pode('financeiro.ver')) {
    return <div className="relative min-h-screen text-white"><div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center" /><div className="min-h-screen bg-black/50 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-white/60" /></div></div>
  }

  const r = data?.receita
  const dados = data?.dados
  const cob = data?.cobranca
  const acoes = data?.acoes ?? {}
  const alertas = data?.alertas ?? []
  const moeda = r?.moeda ?? 'BRL'
  const status: StatusFinanceiro = r?.status ?? 'SEM_COBRANCA'

  return (
    <div className="relative min-h-screen overflow-x-hidden text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 scale-105 blur-[6px] bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black/85" />
      <HeaderBar title="Receitas" subtitle={dados?.processo?.nome ?? 'Financeiro do processo'} userName={user.nome} userRole={user.tipo === 'admin' ? 'Administrador' : user.tipo || 'Usuário'} userEmail={user.email || ''} projetos={[]} processos={processos} arvores={[]} onLogout={handleLogout} />

      <main className="relative mx-auto w-[92%] max-w-[1400px] py-5">
        {/* cabeçalho do dossiê */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <nav className="mb-1 flex items-center gap-1.5 text-xs text-white/40">
              <span>Processos</span><span>›</span><span>{dados?.processo?.nome ?? '…'}</span><span>›</span><span>Financeiro</span><span>›</span><button onClick={voltar} className="hover:text-white/70">Receitas</button><span>›</span><span className="text-white/70">Dossiê da receita</span>
            </nav>
            <button onClick={voltar} className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10"><ArrowLeft className="h-4 w-4" /> Voltar para receitas</button>
            <h1 className="text-2xl font-bold">Dossiê da receita</h1>
            <p className="mt-0.5 text-sm text-white/50">Visualize e gerencie todos os detalhes desta receita, cobrança, parcelas e pagamentos.</p>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={!acoes.editarReceita} onClick={() => setModal(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-40"><Pencil className="h-4 w-4" /> Editar receita</button>
            {acoes.gerarCobranca && <button onClick={() => setModal(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#D2A948] px-4 py-2 text-sm font-semibold text-[#1b1508] transition hover:brightness-110"><Receipt className="h-4 w-4" /> Gerar cobrança</button>}
            <div className="relative">
              <button onClick={() => setMaisAcoes((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500">Mais ações <ChevronDown className="h-4 w-4" /></button>
              {maisAcoes && (
                <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-white/10 bg-zinc-900 py-1 shadow-xl">
                  <MaisItem label="Ver histórico" onClick={() => { setAba('Histórico'); setMaisAcoes(false) }} />
                  {acoes.cancelarReceita && <MaisItem label="Cancelar receita" danger onClick={() => { setModal(true); setMaisAcoes(false) }} />}
                  {acoes.reabrir && <MaisItem label="Reabrir" onClick={() => { setModal(true); setMaisAcoes(false) }} />}
                  <MaisItem label="Exportar" onClick={() => { window.print(); setMaisAcoes(false) }} />
                  <MaisItem label="Imprimir" onClick={() => { window.print(); setMaisAcoes(false) }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
        ) : erro ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erro} <button onClick={carregar} className="ml-2 underline">Tentar de novo</button></div>
        ) : r && (
          <>
            {/* identificação */}
            <div className={`${CARD} mb-4 flex flex-wrap items-center gap-4 p-4`}>
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-300"><FileText className="h-6 w-6" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">{r.descricao}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/50">
                  <span className="text-white/80">{dados?.requerente}</span>
                  {dados?.papel && <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-300">{dados.papel === 'principal' ? 'Principal' : 'Adicional'}</span>}
                  <span>Receita {r.codigo}</span>
                  <span className="rounded-md border border-white/15 px-2 py-0.5">{dados?.fase}</span>
                </div>
              </div>
              <div className="text-right"><span className={`inline-block rounded-md border px-2.5 py-1 text-xs font-medium ${ST[status].cls}`}>{ST[status].label.toUpperCase()}</span><p className="mt-1 text-[11px] text-white/40">Situação atual</p></div>
            </div>

            {/* alertas */}
            {alertas.length > 0 && (
              <div className="mb-4 space-y-2">
                {alertas.map((a: any, i: number) => (
                  <div key={i} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${a.nivel === 'erro' ? 'border-red-500/30 bg-red-500/10 text-red-200' : a.nivel === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-white/70'}`}><AlertTriangle className="h-4 w-4 shrink-0" /> {a.texto}</div>
                ))}
              </div>
            )}

            {/* 5 indicadores */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <Ind t="Valor contratado" v={money(r.valorContratual, moeda)} icon={Database} />
              <Ind t="Recebido" v={money(r.recebido, moeda)} sub={`${r.pctRecebido}% do total`} icon={TrendingUp} cor="text-emerald-300" />
              <Ind t="Saldo a receber" v={money(r.saldo, moeda)} sub={`${Math.round((100 - r.pctRecebido) * 10) / 10}% do total`} icon={PieChart} cor="text-sky-300" />
              <Ind t="Vencimento mais próximo" v={dt(r.proximoVencimento)} sub={r.proximoVencimento ? '' : 'Sem cobrança'} icon={CalendarClock} />
              <Ind t="Status" v={ST[status].label} sub={status === 'SEM_COBRANCA' ? 'Aguardando cobrança' : ''} icon={FileText} />
            </div>

            {/* colunas */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
              <div className="min-w-0 space-y-4">
                {/* dados + linha do tempo */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className={`${CARD} p-4`}>
                    <h3 className="mb-3 text-sm font-semibold">Dados da receita</h3>
                    <Dl l="Serviço" v={dados?.servico} /><Dl l="Regra financeira" v={dados?.regraFinanceira} /><Dl l="Fase" v={dados?.fase} /><Dl l="Requerente" v={dados?.requerente} />
                    <Dl l="Moeda" v={dados?.moeda} /><Dl l="Cotação utilizada" v={dados?.cotacao ? `${Number(dados.cotacao).toFixed(4)} (${dt(dados.cotacaoData)})` : '—'} />
                    <Dl l="Centro de custo" v={dados?.centroCusto ?? '—'} /><Dl l="Criado em" v={dth(dados?.criadoEm)} /><Dl l="Criado por" v={dados?.criadoPor} />
                    <Dl l="Origem" v={dados?.origemReceita} /><Dl l="Observações" v={dados?.observacoes ?? '—'} />
                  </div>
                  <div className={`${CARD} p-4`}>
                    <h3 className="mb-3 text-sm font-semibold">Linha do tempo</h3>
                    <Timeline eventos={data.timeline} temCobranca={!!cob} status={status} />
                  </div>
                </div>

                {/* cobrança */}
                <div className={`${CARD} p-4`}>
                  <h3 className="mb-3 text-sm font-semibold">Cobrança</h3>
                  {!cob ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                      <FileText className="h-10 w-10 text-white/20" />
                      <p className="font-semibold">Esta receita ainda não possui cobrança.</p>
                      <p className="max-w-md text-sm text-white/50">Após gerar uma cobrança, serão exibidos forma de pagamento, condição, carteira, parcelas, pagamentos e histórico financeiro.</p>
                      <div className="my-1 flex flex-wrap justify-center gap-3 text-xs text-white/45">{['Forma de pagamento', 'Condição', 'Parcelas', 'Pagamentos', 'Histórico'].map((x) => <span key={x} className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/60" />{x}</span>)}</div>
                      {acoes.gerarCobranca && <button onClick={() => setModal(true)} className="mt-2 rounded-lg bg-[#D2A948] px-5 py-2 text-sm font-semibold text-[#1b1508] hover:brightness-110">Gerar cobrança</button>}
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="font-semibold">Cobrança {cob.label}</span>
                        <span className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/60">{cob.status}</span>
                        <span className="text-xs text-white/50">{[cob.condicao, cob.forma, cob.carteira].filter(Boolean).join(' · ') || '—'}</span>
                        <button onClick={() => setModal(true)} className="ml-auto rounded-md border border-violet-500/40 px-3 py-1 text-xs text-violet-300 hover:bg-violet-500/10">Abrir cobrança</button>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                        <Kv l="Moeda" v={cob.moeda} /><Kv l="Valor base" v={money(cob.valorBase, cob.moeda)} /><Kv l="Taxa" v={money(cob.valorTaxa, cob.moeda)} />
                        <Kv l="Repassado" v={money(cob.valorRepassado, cob.moeda)} /><Kv l="Absorvido" v={money(cob.valorAbsorvido, cob.moeda)} /><Kv l="Total cobrado" v={money(cob.valorTotal, cob.moeda)} b />
                        <Kv l="Líquido previsto" v={money(cob.valorLiquido, cob.moeda)} /><Kv l="Parcelas" v={`${cob.parcelasPagas}/${cob.nParcelas}`} /><Kv l="Próx. venc." v={dt(cob.proximoVencimento)} />
                        <Kv l="Pago" v={money(cob.pago, cob.moeda)} /><Kv l="Saldo" v={money(cob.saldo, cob.moeda)} />
                        {cob.cotacao && cob.moedaOrigem !== 'BRL' && <Kv l="Cotação" v={`${Number(cob.cotacao).toFixed(4)} ${cob.congeladaEm ? '(congelada)' : '(estimada)'}`} />}
                      </div>
                      {Array.isArray(cob.memoria) && cob.memoria.length > 0 && (
                        <details className="mt-3 text-[11px] text-white/50"><summary className="cursor-pointer text-white/60">Memória de cálculo</summary><div className="mt-1 space-y-0.5 rounded-lg border border-white/10 bg-black/20 p-2">{cob.memoria.map((m: string, i: number) => <div key={i}>{m}</div>)}</div></details>
                      )}
                    </div>
                  )}
                </div>

                {/* abas operacionais */}
                <div className={`${CARD}`}>
                  <div className="flex flex-wrap gap-1 overflow-x-auto border-b border-white/10 px-3 pt-2">
                    {ABAS.map((a) => <button key={a} onClick={() => setAba(a)} className={`whitespace-nowrap rounded-t-lg px-3 py-2 text-sm transition ${aba === a ? 'border-b-2 border-violet-400 text-white' : 'text-white/50 hover:text-white'}`}>{a}</button>)}
                  </div>
                  <div className="p-4">
                    <AbaConteudo aba={aba} cob={cob} moeda={moeda} data={data} onModal={() => setModal(true)} acoes={acoes} />
                  </div>
                </div>
              </div>

              {/* lateral */}
              <aside className="space-y-4">
                <div className={`${CARD} p-4`}>
                  <h3 className="mb-2 text-sm font-semibold">Ações rápidas</h3>
                  <div className="space-y-1.5">
                    <QA label="Gerar cobrança" icon={Receipt} on={acoes.gerarCobranca} primary onClick={() => setModal(true)} />
                    <QA label="Registrar pagamento" icon={Wallet} on={acoes.registrarPagamento} onClick={() => setModal(true)} />
                    <QA label="Enviar cobrança" icon={Send} on={acoes.enviarCobranca} onClick={() => setModal(true)} />
                    <QA label="Emitir recibo" icon={FileCheck} on={acoes.emitirRecibo} onClick={() => window.print()} />
                    <QA label="Emitir nota fiscal" icon={FileText} on={acoes.emitirNotaFiscal} onClick={() => window.print()} />
                    <QA label="Cancelar receita" icon={Ban} on={acoes.cancelarReceita} danger onClick={() => setModal(true)} />
                  </div>
                </div>
                <div className={`${CARD} p-4`}>
                  <h3 className="mb-2 text-sm font-semibold">Anexos</h3>
                  <Anexos anexos={data.anexos} />
                </div>
                <div className={`${CARD} p-4`}>
                  <h3 className="mb-2 text-sm font-semibold">Relacionamentos</h3>
                  <Rel l="Processo" v={data.relacionamentos?.processo?.nome} onClick={voltar} />
                  <Rel l="Fase" v={data.relacionamentos?.fase} />
                  <Rel l="Requerente" v={data.relacionamentos?.requerente} />
                  <Rel l="Serviço" v={data.relacionamentos?.servico} />
                  <Rel l="Regra financeira" v={data.relacionamentos?.regraFinanceira} />
                  {data.relacionamentos?.documento && <Rel l="Documento" v={data.relacionamentos.documento.tipo} />}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>

      {modal && r && <ReceitaCobrancaModal receitaId={receitaId} onClose={() => setModal(false)} onChanged={() => { carregar() }} />}
    </div>
  )
}

// ── subcomponentes ──────────────────────────────────────────────────────────
function Ind({ t, v, sub, icon: Ic, cor }: { t: string; v: string; sub?: string; icon: any; cor?: string }) {
  return <div className={`${CARD} p-3`}><div className="flex items-start justify-between"><p className="text-[11px] uppercase tracking-wide text-white/45">{t}</p><Ic className="h-4 w-4 text-white/30" /></div><p className={`mt-1.5 text-lg font-bold ${cor ?? 'text-white'}`}>{v}</p>{sub && <p className="text-[11px] text-white/40">{sub}</p>}</div>
}
function Dl({ l, v }: { l: string; v?: string | null }) { return <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-white/45">{l}</span><span className="truncate text-right text-white/85">{v ?? '—'}</span></div> }
function Kv({ l, v, b }: { l: string; v: string; b?: boolean }) { return <div className="flex justify-between gap-2 py-0.5"><span className="text-white/45">{l}</span><span className={`tabular-nums ${b ? 'font-bold text-white' : 'text-white/85'}`}>{v}</span></div> }
function MaisItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) { return <button onClick={onClick} className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-white/10 ${danger ? 'text-red-300' : 'text-white/80'}`}>{label}</button> }
function Rel({ l, v, onClick }: { l: string; v?: string | null; onClick?: () => void }) { return <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-white/45">{l}</span>{onClick && v ? <button onClick={onClick} className="truncate text-right text-violet-300 hover:underline">{v}</button> : <span className="truncate text-right text-white/85">{v ?? '—'}</span>}</div> }
function QA({ label, icon: Ic, on, onClick, primary, danger }: { label: string; icon: any; on: boolean; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return <button disabled={!on} onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition disabled:opacity-35 ${primary && on ? 'bg-[#D2A948] font-semibold text-[#1b1508] hover:brightness-110' : danger ? 'border border-red-500/25 text-red-300 hover:bg-red-500/10' : 'border border-white/10 text-white/80 hover:bg-white/10'}`}><Ic className="h-4 w-4 opacity-70" /> {label}</button>
}
function Timeline({ eventos, temCobranca, status }: { eventos: any[]; temCobranca: boolean; status: StatusFinanceiro }) {
  const reais = (eventos ?? []).slice().reverse()
  const etapas = ['Cobrança criada', 'Cobrança enviada', 'Visualizado pelo cliente', 'Pagamento recebido', 'Baixa financeira']
  return (
    <div className="space-y-3">
      {reais.map((e, i) => (
        <div key={i} className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" /><div><p className="text-sm text-white/90">{rotuloEvento(e.tipo, e.descricao)}</p><p className="text-[11px] text-white/40">{dth(e.em)}{e.usuario ? ` por ${e.usuario}` : ''}</p></div></div>
      ))}
      {reais.length === 0 && <div className="flex gap-2.5"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" /><div><p className="text-sm text-white/90">Receita criada</p></div></div>}
      {/* etapas esperadas (desativadas) */}
      {!temCobranca && etapas.map((s) => <div key={s} className="flex gap-2.5 opacity-40"><Circle className="mt-0.5 h-4 w-4 shrink-0 text-white/30" /><p className="text-sm text-white/50">{s}</p></div>)}
    </div>
  )
}
function rotuloEvento(tipo: string, descricao?: string | null): string {
  const map: Record<string, string> = { CRIACAO: 'Receita criada', RECEBIMENTO: 'Pagamento recebido', PAGAMENTO: 'Pagamento registrado', CANCELAMENTO: 'Receita cancelada', ESTORNO_RECEBIMENTO: 'Estorno de recebimento', EDICAO: 'Alteração', EDICAO_RECEBIMENTO: 'Recebimento editado' }
  return descricao || map[tipo] || tipo
}
function Anexos({ anexos }: { anexos: any[] }) {
  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-white/15 bg-white/[0.02] py-6 text-center text-white/40 transition hover:border-white/25">
        <Upload className="h-5 w-5" /><span className="text-xs">Arraste arquivos ou clique para anexar</span><span className="text-[10px] text-white/30">PDF, JPG, PNG até 10MB</span>
        <input type="file" className="hidden" disabled />
      </label>
      {anexos?.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {anexos.map((a: any) => (
            <a key={a.parcelaId} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/5"><FileCheck className="h-3.5 w-3.5 text-emerald-400" /><span className="truncate">{a.nome || `Comprovante parcela ${a.numero}`}</span></a>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-white/35">Comprovantes são anexados ao registrar o pagamento de cada parcela.</p>
    </div>
  )
}
function AbaConteudo({ aba, cob, moeda, data, onModal, acoes }: { aba: string; cob: any; moeda: string; data: any; onModal: () => void; acoes: any }) {
  const vazio = (msg: string) => <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-white/45"><FileText className="h-8 w-8 text-white/15" />{msg}</div>
  if (aba === 'Parcelas') {
    if (!cob) return vazio('Ainda não há parcelas porque não existe cobrança vinculada a esta receita. Após gerar a cobrança, as parcelas aparecerão aqui.')
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-white/45">{['#', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Status'].map((h) => <th key={h} className="px-3 py-1.5">{h}</th>)}</tr></thead>
          <tbody>{cob.parcelas.map((p: any) => <tr key={p.id} className="border-t border-white/5"><td className="px-3 py-1.5">{p.numero}{p.entrada ? ' · entrada' : ''}</td><td className="px-3 py-1.5 text-white/70">{dt(p.vencimento)}</td><td className="px-3 py-1.5 tabular-nums">{money(p.valor, moeda)}</td><td className="px-3 py-1.5 tabular-nums text-emerald-300">{p.pago ? money(p.valor, moeda) : money(0, moeda)}</td><td className="px-3 py-1.5 tabular-nums text-sky-300">{p.pago ? money(0, moeda) : money(p.valor, moeda)}</td><td className="px-3 py-1.5">{p.pago ? <span className="text-emerald-400">Paga</span> : <span className="text-white/50">Pendente</span>}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-xs text-white/45">{cob.parcelasPagas}/{cob.nParcelas} paga(s) · Total {money(cob.valorTotal, moeda)} · Soma {money(cob.parcelas.reduce((s: number, p: any) => s + p.valor, 0), moeda)}</p>
      </div>
    )
  }
  if (aba === 'Pagamentos') {
    const pagas = cob?.parcelas?.filter((p: any) => p.pago) ?? []
    if (!cob) return vazio('Sem cobrança — não é possível registrar pagamentos.')
    if (pagas.length === 0) return <div className="py-8 text-center text-sm text-white/45">Nenhum pagamento registrado. {acoes.registrarPagamento && <button onClick={onModal} className="text-violet-300 hover:underline">Registrar pagamento</button>}</div>
    return <div className="space-y-1.5">{pagas.map((p: any) => <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm"><span className="text-white/70">Parcela {p.numero}</span><span className="tabular-nums text-emerald-300">{money(p.valor, moeda)}</span></div>)}</div>
  }
  if (aba === 'Histórico') {
    const evs = data.timeline ?? []
    return evs.length === 0 ? vazio('Sem histórico ainda.') : <div className="space-y-1.5">{evs.map((e: any, i: number) => <div key={i} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm"><span className="text-white/80">{rotuloEvento(e.tipo, e.descricao)}</span><span className="text-[11px] text-white/40">{dth(e.em)}</span></div>)}</div>
  }
  if (aba === 'Comunicações') return vazio('Nenhuma comunicação registrada. Os canais aparecerão aqui quando cobranças forem enviadas.')
  if (aba === 'Anexos') return <Anexos anexos={data.anexos} />
  if (aba === 'Auditoria') {
    const h = data.historico ?? []
    return h.length === 0 ? vazio('Sem registros de auditoria.') : <div className="space-y-1.5">{h.map((a: any) => <div key={a.id} className="rounded-lg border border-white/10 px-3 py-2 text-sm"><div className="flex items-center justify-between"><span className="text-white/80">{a.acao} · {a.descricao ?? ''}</span><span className="text-[11px] text-white/40">{dth(a.criadoEm)}</span></div>{a.usuario?.nome && <span className="text-[11px] text-white/40">por {a.usuario.nome}</span>}</div>)}</div>
  }
  return null
}
