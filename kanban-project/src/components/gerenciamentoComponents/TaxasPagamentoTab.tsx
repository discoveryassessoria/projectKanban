'use client'

// src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx
// ============================================================================
// TAXAS DE PAGAMENTO — organizadas por FORMA DE PAGAMENTO. A listagem tem UMA
// linha por forma (Cartão de Crédito, Débito, PIX, Boleto, Transferência,
// Dinheiro, Wise). Bandeira, adquirente e parcelas ficam DENTRO da configuração
// de cada forma. O banco continua normalizado (uma taxa por forma×bandeira com
// grade) e o runtime resolve por forma×bandeira×parcela — isto é só a camada
// agregada de apresentação/edição.
//   Backend: /api/gerenciamento/taxas-pagamento/formas (GET) + /formas/[id] (GET/PUT)
// ============================================================================
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { useApi } from '@/src/lib/dados'
import {
  Percent, Search, X, Check, Loader2, Settings2, CreditCard, Landmark, Banknote, Coins, ArrowLeft,
} from 'lucide-react'
import { OURO, GLASS, INPUT, jf } from './pagamentoUI'

type FormaAgrupada = {
  formaPagamentoId: number; nome: string; code: string | null; type: string | null
  tipoTaxa: 'GRADE' | 'PERCENTUAL' | 'ENCARGOS'
  quantidadeAdquirentes: number; quantidadeBandeiras: number; quantidadeConfiguracoes: number
  parcelasMin: number | null; parcelasMax: number | null; possuiEncargos: boolean; status: boolean
  vigenciaInicio: string | null; vigenciaFim: string | null; versao: number; ultimaAlteracao: string | null
  bandeirasNomes: string[]; adquirentesNomes: string[]
}

const iconForma = (type: string | null) =>
  type?.startsWith('CARTAO') ? CreditCard : type === 'BOLETO' ? Landmark : type === 'DINHEIRO' ? Banknote : Coins

const SEM_FORMAS: FormaAgrupada[] = []

export default function TaxasPagamentoTab() {
  const [busca, setBusca] = useState('')
  const [configId, setConfigId] = useState<number | null>(null)

  // Leitura pela camada oficial. Lista vazia como constante: literal novo por render
  // desestabilizaria a dependência do `useMemo` do filtro logo abaixo.
  const consulta = useApi<{ formas?: FormaAgrupada[] }>('/api/gerenciamento/taxas-pagamento/formas')
  const formas = consulta.dados?.formas ?? SEM_FORMAS
  const loading = consulta.carregando
  const carregar = consulta.recarregar
  const erro = consulta.erro ? consulta.erro.message : null

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return formas
    return formas.filter((x) => x.nome.toLowerCase().includes(q) || (x.code || '').toLowerCase().includes(q))
  }, [formas, busca])

  const resumoLinha = (x: FormaAgrupada) => {
    if (x.tipoTaxa === 'ENCARGOS') return 'Encargos: emissão, liquidação, multa e juros'
    if (x.tipoTaxa === 'GRADE') return `Parcelamento: ${x.parcelasMin ?? 1}x–${x.parcelasMax ?? 12}x`
    if (x.parcelasMax === 1) return 'Pagamento único'
    return 'Taxa única'
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${OURO}22`, color: OURO }}><Percent className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold text-white">Taxas de Pagamento</h2>
            <p className="text-sm text-white/50">Uma linha por forma. Bandeira, adquirente e parcelas ficam dentro da configuração.</p>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar forma…" className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
      ) : erro ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{erro}<button onClick={() => { void carregar() }} className="ml-3 underline hover:text-white">Tentar de novo</button></div>
      ) : filtrados.length === 0 ? (
        <div className={`${GLASS} flex flex-col items-center gap-2 py-16 text-center`}>
          <Percent className="h-10 w-10 text-white/20" />
          <p className="text-white/60">Nenhuma forma com taxa configurada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((x) => {
            const Ic = iconForma(x.type)
            return (
              <div key={x.formaPagamentoId} className={`${GLASS} flex items-center gap-4 p-4 transition hover:border-white/20`}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${OURO}18`, color: OURO }}><Ic className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-white">{x.nome}</span>
                    {!x.status && <span className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[11px] text-white/40">inativa</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
                    {x.adquirentesNomes.length > 0 && <span>Adquirente: {x.adquirentesNomes.join(', ')}</span>}
                    {x.bandeirasNomes.length > 0 && <span>Bandeiras: {x.bandeirasNomes.join(', ')}</span>}
                    <span className="text-white/70">{resumoLinha(x)}</span>
                    <span>{x.quantidadeConfiguracoes} config.</span>
                  </div>
                </div>
                <button onClick={() => setConfigId(x.formaPagamentoId)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#1b1508] transition" style={{ background: OURO }}>
                  <Settings2 className="h-4 w-4" /> Configurar
                </button>
              </div>
            )
          })}
        </div>
      )}

      {configId != null && (
        <FormaConfig formaId={configId} onClose={() => setConfigId(null)} onSalvo={() => { setConfigId(null); carregar() }} />
      )}
    </div>
  )
}

// ── Tela interna de configuração de UMA forma ───────────────────────────────
type Detalhe = {
  forma: { id: number; name: string; type: string | null; ativo: boolean }
  perfil: { calculo: string; mostraAdquirente: boolean; mostraBandeira: boolean; mostraGrade: boolean; mostraFinalidade: boolean }
  adquirentes: { id: number; nome: string }[]
  bandeiras: { id: number; nome: string }[]
  taxas: { id: number; adquirenteId: number | null; bandeiraId: number | null; finalidade: string | null; ativo: boolean; feePercent: number | null; fixedFee: number | null; quemAbsorve: string; grade: { parcela: number; feePercent: number | null }[] }[]
  boleto: { condicaoId: number; multaPercent: number | null; jurosMesPercent: number | null; carenciaDias: number | null } | null
}
const PARCELAS = Array.from({ length: 12 }, (_, i) => i + 1)
const numOuVazio = (v: number | null | undefined) => (v == null ? '' : String(v))

function FormaConfig({ formaId, onClose, onSalvo }: { formaId: number; onClose: () => void; onSalvo: () => void }) {
  const [det, setDet] = useState<Detalhe | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [adqSel, setAdqSel] = useState<number | null>(null)
  // grade: bandeiraId -> { [parcela]: string }  (crédito) / { 1: taxa } (débito)
  // A grade editável é um RASCUNHO sobre o que o servidor devolveu para o adquirente
  // selecionado. Antes um efeito a reconstruía inteira a cada mudança de `det`/`adqSel`
  // — o que apagava, sem aviso, o que o operador tivesse acabado de digitar.
  const [rascunhoGrade, setRascunhoGrade] = useState<{ base: string; grade: Record<number, Record<number, string>> } | null>(null)
  // formas simples / boleto
  const [simples, setSimples] = useState<{ taxaId?: number; feePercent: string; fixedFee: string }>({ feePercent: '', fixedFee: '' })
  const [boleto, setBoleto] = useState<{ emissaoId?: number; liquidacaoId?: number; emissao: string; liquidacao: string; multa: string; juros: string; carencia: string }>({ emissao: '', liquidacao: '', multa: '', juros: '', carencia: '' })

  useEffect(() => {
    jf(`/api/gerenciamento/taxas-pagamento/formas/${formaId}`, { cache: 'no-store' }).then((d: Detalhe) => {
      setDet(d)
      const primeiroAdq = d.taxas.find((t) => t.adquirenteId != null)?.adquirenteId ?? d.adquirentes[0]?.id ?? null
      setAdqSel(primeiroAdq)
      if (d.perfil.calculo === 'BOLETO') {
        const emi = d.taxas.find((t) => t.finalidade === 'EMISSAO'), liq = d.taxas.find((t) => t.finalidade === 'PAGAMENTO')
        setBoleto({ emissaoId: emi?.id, liquidacaoId: liq?.id, emissao: numOuVazio(emi?.fixedFee), liquidacao: numOuVazio(liq?.fixedFee),
          multa: numOuVazio(d.boleto?.multaPercent), juros: numOuVazio(d.boleto?.jurosMesPercent), carencia: numOuVazio(d.boleto?.carenciaDias) })
      } else if (!d.perfil.mostraBandeira) {
        const t = d.taxas[0]
        setSimples({ taxaId: t?.id, feePercent: numOuVazio(t?.feePercent), fixedFee: numOuVazio(t?.fixedFee) })
      }
    }).catch((e) => setErro(e.message))
  }, [formaId])

  // Grade e metadados vindos do servidor para (forma, adquirente). Derivação pura da
  // mesma fonte que o efeito lia — inclusive o desempate: taxa específica do adquirente
  // primeiro, taxa sem adquirente como fallback.
  const gradeDoServidor = useMemo(() => {
    const g: Record<number, Record<number, string>> = {}
    const meta: Record<number, { taxaId?: number; ativo: boolean }> = {}
    if (!det || !det.perfil.mostraBandeira) return { g, meta }
    for (const band of det.bandeiras) {
      const t = det.taxas.find((x) => x.bandeiraId === band.id && (x.adquirenteId ?? null) === (adqSel ?? null))
        ?? det.taxas.find((x) => x.bandeiraId === band.id && x.adquirenteId == null)
      meta[band.id] = { taxaId: t?.id, ativo: t?.ativo ?? true }
      const cells: Record<number, string> = {}
      if (det.perfil.mostraGrade) {
        for (const l of t?.grade ?? []) cells[l.parcela] = numOuVazio(l.feePercent)
      } else {
        cells[1] = numOuVazio(t?.feePercent) // débito: taxa única
      }
      g[band.id] = cells
    }
    return { g, meta }
  }, [det, adqSel])

  // A base identifica de QUE dados o rascunho nasceu: trocar de adquirente (ou receber
  // dados novos) descarta o rascunho, como o efeito fazia — só que sem o render em que
  // a grade antiga ainda estava na tela.
  const baseGrade = JSON.stringify(gradeDoServidor.g)
  const grade = rascunhoGrade?.base === baseGrade ? rascunhoGrade.grade : gradeDoServidor.g
  const gradeMeta = gradeDoServidor.meta

  const setCell = (bandId: number, parcela: number, v: string) =>
    setRascunhoGrade({ base: baseGrade, grade: { ...grade, [bandId]: { ...grade[bandId], [parcela]: v } } })

  async function salvar() {
    if (!det) return
    setSalvando(true); setErro(null)
    try {
      let payload: any = {}
      if (det.perfil.calculo === 'BOLETO') {
        payload = {
          taxas: [
            boleto.emissaoId ? { id: boleto.emissaoId, finalidade: 'EMISSAO', fixedFee: boleto.emissao === '' ? null : Number(boleto.emissao) } : null,
            boleto.liquidacaoId ? { id: boleto.liquidacaoId, finalidade: 'PAGAMENTO', fixedFee: boleto.liquidacao === '' ? null : Number(boleto.liquidacao) } : null,
          ].filter(Boolean),
          boleto: det.boleto ? { condicaoId: det.boleto.condicaoId, multaPercent: boleto.multa === '' ? null : Number(boleto.multa), jurosMesPercent: boleto.juros === '' ? null : Number(boleto.juros), carenciaDias: boleto.carencia === '' ? null : Number(boleto.carencia) } : undefined,
        }
      } else if (!det.perfil.mostraBandeira) {
        payload = { taxas: [{ id: simples.taxaId, feePercent: simples.feePercent === '' ? null : Number(simples.feePercent), fixedFee: simples.fixedFee === '' ? null : Number(simples.fixedFee) }] }
      } else {
        // crédito/débito: uma spec por bandeira que tem ao menos uma célula preenchida.
        const specs: any[] = []
        for (const band of det.bandeiras) {
          const cells = grade[band.id] ?? {}
          const meta = gradeMeta[band.id] ?? { ativo: true }
          if (det.perfil.mostraGrade) {
            const gradeSpec = PARCELAS.filter((p) => cells[p] !== undefined && cells[p] !== '').map((p) => ({ parcela: p, feePercent: Number(cells[p]) }))
            if (!gradeSpec.length && !meta.taxaId) continue // bandeira vazia e sem taxa: ignora
            specs.push({ id: meta.taxaId, adquirenteId: adqSel, bandeiraId: band.id, ativo: meta.ativo, grade: gradeSpec })
          } else {
            const v = cells[1]
            if ((v === undefined || v === '') && !meta.taxaId) continue
            specs.push({ id: meta.taxaId, adquirenteId: adqSel, bandeiraId: band.id, ativo: meta.ativo, feePercent: v === '' || v === undefined ? null : Number(v) })
          }
        }
        payload = { taxas: specs }
      }
      await jf(`/api/gerenciamento/taxas-pagamento/formas/${formaId}`, { method: 'PUT', body: JSON.stringify(payload) })
      onSalvo()
    } catch (e: any) { setErro(e.message || 'Não foi possível salvar.') }
    finally { setSalvando(false) }
  }

  const nInput = 'w-16 rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-center text-[13px] text-white outline-none focus:border-white/30 placeholder:text-white/20'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-zinc-900/95 px-6 py-4">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-white/50 hover:text-white"><ArrowLeft className="h-4 w-4" /></button>
            <h3 className="text-base font-semibold">Configurar taxas · {det?.forma.name ?? '…'}</h3>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {erro && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{erro}</div>}
          {!det ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
          ) : det.perfil.calculo === 'BOLETO' ? (
            <div className={`${GLASS} p-4`}>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/50">Encargos do boleto</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Taxa de emissão (R$)"><input type="number" step="0.01" min={0} className={INPUT} value={boleto.emissao} onChange={(e) => setBoleto({ ...boleto, emissao: e.target.value })} placeholder="5.00" /></Campo>
                <Campo label="Taxa de liquidação (R$)"><input type="number" step="0.01" min={0} className={INPUT} value={boleto.liquidacao} onChange={(e) => setBoleto({ ...boleto, liquidacao: e.target.value })} placeholder="5.00" /></Campo>
                <Campo label="Multa (%)"><input type="number" step="0.01" min={0} className={INPUT} value={boleto.multa} onChange={(e) => setBoleto({ ...boleto, multa: e.target.value })} placeholder="2" /></Campo>
                <Campo label="Juros ao mês (%)"><input type="number" step="0.01" min={0} className={INPUT} value={boleto.juros} onChange={(e) => setBoleto({ ...boleto, juros: e.target.value })} placeholder="1" /></Campo>
                <Campo label="Carência da multa (dias)"><input type="number" min={0} className={INPUT} value={boleto.carencia} onChange={(e) => setBoleto({ ...boleto, carencia: e.target.value })} placeholder="3" /></Campo>
              </div>
              <p className="mt-3 text-[11px] text-white/40">Emissão só na emissão, liquidação só no pagamento; multa após a carência, juros simples pro-rata. Nunca antecipados no cronograma.</p>
            </div>
          ) : !det.perfil.mostraBandeira ? (
            <div className={`${GLASS} p-4`}>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-white/50">Taxa de {det.forma.name}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Campo label="Percentual (%)"><input type="number" step="0.0001" min={0} className={INPUT} value={simples.feePercent} onChange={(e) => setSimples({ ...simples, feePercent: e.target.value })} placeholder="0" /></Campo>
                <Campo label="Valor fixo (opcional)"><input type="number" step="0.01" min={0} className={INPUT} value={simples.fixedFee} onChange={(e) => setSimples({ ...simples, fixedFee: e.target.value })} placeholder="0.00" /></Campo>
              </div>
              <p className="mt-3 text-[11px] text-white/40">0% é uma taxa explícita. Deixe vazio somente se a combinação não deve ser usada.</p>
            </div>
          ) : (
            <>
              {/* adquirente */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-white/60">Adquirente</label>
                <select value={adqSel ?? ''} onChange={(e) => setAdqSel(Number(e.target.value) || null)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white outline-none focus:border-white/25">
                  {det.adquirentes.map((a) => <option key={a.id} value={a.id} className="bg-zinc-900">{a.nome}</option>)}
                </select>
                <span className="text-[11px] text-white/40">A estrutura aceita múltiplas adquirentes; a grade abaixo é da selecionada.</span>
              </div>

              {/* grade bandeiras × parcelas (crédito) OU × taxa única (débito) */}
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-wide text-white/40">
                      <th className="px-3 py-2 text-left font-medium">Bandeira</th>
                      {det.perfil.mostraGrade
                        ? PARCELAS.map((p) => <th key={p} className="px-1 py-2 text-center font-medium">{p}x</th>)
                        : <th className="px-3 py-2 text-center font-medium">Taxa (%)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {det.bandeiras.map((band) => (
                      <tr key={band.id} className="border-b border-white/5 last:border-0">
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-white/80">{band.nome}</td>
                        {det.perfil.mostraGrade
                          ? PARCELAS.map((p) => (
                            <td key={p} className="px-0.5 py-1 text-center">
                              <input type="number" step="0.0001" min={0} className={nInput} value={grade[band.id]?.[p] ?? ''} placeholder="—"
                                onChange={(e) => setCell(band.id, p, e.target.value)} />
                            </td>
                          ))
                          : <td className="px-3 py-1 text-center">
                              <input type="number" step="0.0001" min={0} className={`${nInput} w-24`} value={grade[band.id]?.[1] ?? ''} placeholder="—"
                                onChange={(e) => setCell(band.id, 1, e.target.value)} />
                            </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-white/40">
                Célula <b>vazia</b> = combinação indisponível (não cadastrada). <b>0</b> é uma taxa explícita.
                Ex.: Diners só tem 1x; deixe as demais vazias. Salvamento é transacional.
              </p>
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-white/10 bg-zinc-900/95 px-6 py-3">
          <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
          <button onClick={salvar} disabled={salvando || !det} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-[#1b1508] transition disabled:opacity-50" style={{ background: OURO }}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{salvando ? 'Salvando…' : 'Salvar configuração'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (<div><label className="mb-1 block text-xs text-white/60">{label}</label>{children}</div>)
}
