'use client'
// src/components/gerenciamentoComponents/IntegracaoFinanceiraTab.tsx — LOTE D opção B
import dynamic from 'next/dynamic'
import { Concentradora, type AbaDef } from './_ConcentradoraBase'
const AplicabilidadeEconomicaTab = dynamic(() => import('./AplicabilidadeEconomicaTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const ABAS: AbaDef[] = [
  { key: 'regras_economicas', label: 'Regras Econômicas', Comp: AplicabilidadeEconomicaTab },
  { key: 'disparo', label: 'Regras de Disparo Financeiro', Comp: null },
  { key: 'proc_fin', label: 'Processo → Financeiro Geral', Comp: null },
  { key: 'a_pagar', label: 'Contas a Pagar', Comp: null },
  { key: 'a_receber', label: 'Contas a Receber', Comp: null },
  { key: 'reconciliacao', label: 'Reconciliação', Comp: null },
]
export default function IntegracaoFinanceiraTab() {
  return <Concentradora titulo="Financeiro e Precificação · Integração Financeira" subtitulo="Regras econômicas, disparos, contas a pagar/receber e reconciliação." abas={ABAS} />
}