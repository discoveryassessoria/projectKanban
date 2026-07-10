'use client'
// src/components/gerenciamentoComponents/FornecedoresConcentradoraTab.tsx — LOTE D opção B
import dynamic from 'next/dynamic'
import { Concentradora, type AbaDef } from './_ConcentradoraBase'
const FornecedoresTab = dynamic(() => import('./FornecedoresTab'), { ssr: false, loading: () => <div className="py-10 text-center text-white/40">Carregando…</div> })
const ABAS: AbaDef[] = [
  { key: 'fornecedores', label: 'Fornecedores', Comp: FornecedoresTab },
  { key: 'precos_fornecedor', label: 'Preços por Fornecedor', Comp: null },
  { key: 'contratos', label: 'Contratos', Comp: null },
]
export default function FornecedoresConcentradoraTab() {
  return <Concentradora titulo="Financeiro e Precificação · Fornecedores" subtitulo="Fornecedores, seus preços e contratos." abas={ABAS} />
}