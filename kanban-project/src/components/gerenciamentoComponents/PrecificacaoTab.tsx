'use client'
// src/components/gerenciamentoComponents/PrecificacaoTab.tsx — LOTE D opção B
import dynamic from 'next/dynamic'
import { Concentradora, type AbaDef } from './_ConcentradoraBase'
const TabelaValoresTab = dynamic(() => import('./TabelaValoresTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const AplicabilidadeEconomicaTab = dynamic(() => import('./AplicabilidadeEconomicaTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const ABAS: AbaDef[] = [
  { key: 'custos', label: 'Custos', Comp: null },
  { key: 'precos_venda', label: 'Preços de Venda', Comp: null },
  { key: 'tabelas', label: 'Tabelas de Valores', Comp: TabelaValoresTab },
  { key: 'regras_preco', label: 'Regras de Preço', Comp: AplicabilidadeEconomicaTab },
  { key: 'vigencia', label: 'Vigência', Comp: null },
  { key: 'historico', label: 'Histórico', Comp: null },
]
export default function PrecificacaoTab() {
  return <Concentradora titulo="Financeiro e Precificação · Precificação" subtitulo="Custos, preços de venda, tabelas de valores e regras — o preço de tudo num lugar só." abas={ABAS} />
}