'use client'
// src/components/gerenciamentoComponents/ComercialTab.tsx — LOTE D opção B
import dynamic from 'next/dynamic'
import { Concentradora, type AbaDef } from './_ConcentradoraBase'
const CondicoesPagamentoTab = dynamic(() => import('./CondicoesPagamentoTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const RegrasDescontoTab = dynamic(() => import('./RegrasDescontoTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const RegrasComissaoTab = dynamic(() => import('./RegrasComissaoTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const ABAS: AbaDef[] = [
  { key: 'condicoes', label: 'Condições de Pagamento', Comp: CondicoesPagamentoTab },
  { key: 'descontos', label: 'Descontos', Comp: RegrasDescontoTab },
  { key: 'comissoes', label: 'Comissões', Comp: RegrasComissaoTab },
]
export default function ComercialTab() {
  return <Concentradora titulo="Financeiro e Precificação · Comercial" subtitulo="Condições de pagamento, descontos e comissões." abas={ABAS} />
}