'use client'
// src/components/gerenciamentoComponents/PagamentosTab.tsx — LOTE D opção B
import dynamic from 'next/dynamic'
import { Concentradora, type AbaDef } from './_ConcentradoraBase'
const FormasPagamentoTab = dynamic(() => import('./FormasPagamentoTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const TaxasPagamentoTab = dynamic(() => import('./TaxasPagamentoTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const ImpostosTab = dynamic(() => import('./ImpostosTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const ABAS: AbaDef[] = [
  { key: 'formas', label: 'Formas de Pagamento', Comp: FormasPagamentoTab },
  { key: 'taxas', label: 'Taxas de Pagamento', Comp: TaxasPagamentoTab },
  { key: 'parcelamento', label: 'Parcelamento', Comp: null },
  { key: 'antecipacao', label: 'Antecipação', Comp: null },
  { key: 'impostos', label: 'Impostos e Taxas', Comp: ImpostosTab },
]
export default function PagamentosTab() {
  return <Concentradora titulo="Financeiro e Precificação · Pagamentos" subtitulo="Formas, taxas, parcelamento, antecipação e impostos." abas={ABAS} />
}