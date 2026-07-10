'use client'
// src/components/gerenciamentoComponents/EstruturaFinanceiraTab.tsx
// LOTE D · Opção B — TELA CONCENTRADORA "Estrutura Financeira".
// REUSA os componentes existentes como ABAS internas (não recria, não duplica).
// Persiste a aba ativa na URL (?tab=...). Nenhuma dessas abas vira item lateral.
import { useState, useEffect, useCallback, Suspense } from 'react'
import dynamic from 'next/dynamic'

const CarregandoAba = () => <div className="py-10 text-center text-white/40">Carregando…</div>

// Reuso dos componentes JÁ EXISTENTES (mesmo import que o page.tsx usa)
const MoedasTab = dynamic(() => import('./MoedasTab'), { ssr: false, loading: CarregandoAba })
const CambioTab = dynamic(() => import('./CambioTab'), { ssr: false, loading: CarregandoAba })
const BancosTab = dynamic(() => import('./BancosTab'), { ssr: false, loading: CarregandoAba })
const ContasTab = dynamic(() => import('./ContasTab'), { ssr: false, loading: CarregandoAba })
const CarteirasTab = dynamic(() => import('./CarteirasTab'), { ssr: false, loading: CarregandoAba })
const PlanoContasTab = dynamic(() => import('./PlanoContasTab'), { ssr: false, loading: CarregandoAba })
const CategoriasTab = dynamic(() => import('./CategoriasTab'), { ssr: false, loading: CarregandoAba })
const CentrosCustoTab = dynamic(() => import('./CentrosCustoTab'), { ssr: false, loading: CarregandoAba })

// ordem = spec do Marco (Estrutura Financeira)
const ABAS: { key: string; label: string; Comp: React.ComponentType }[] = [
  { key: 'moedas', label: 'Moedas', Comp: MoedasTab },
  { key: 'cambio', label: 'Câmbio', Comp: CambioTab },
  { key: 'bancos', label: 'Bancos', Comp: BancosTab },
  { key: 'contas', label: 'Contas', Comp: ContasTab },
  { key: 'carteiras', label: 'Carteiras', Comp: CarteirasTab },
  { key: 'plano', label: 'Plano de Contas', Comp: PlanoContasTab },
  { key: 'categorias', label: 'Categorias', Comp: CategoriasTab },
  { key: 'centros', label: 'Centros de Custo', Comp: CentrosCustoTab },
]

// helpers de URL — persistem ?tab= sem depender de router (evita Suspense do useSearchParams)
function lerTabDaURL(): string {
  if (typeof window === 'undefined') return ABAS[0].key
  const p = new URLSearchParams(window.location.search).get('tab')
  return ABAS.some(a => a.key === p) ? (p as string) : ABAS[0].key
}
function escreverTabNaURL(key: string) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('tab', key)
  window.history.replaceState({}, '', url.toString())
}

export default function EstruturaFinanceiraTab() {
  const [aba, setAba] = useState<string>(ABAS[0].key)
  useEffect(() => { setAba(lerTabDaURL()) }, [])
  const trocar = useCallback((key: string) => { setAba(key); escreverTabNaURL(key) }, [])

  const Atual = ABAS.find(a => a.key === aba)?.Comp || ABAS[0].Comp

  return (
    <div className="text-white">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Financeiro e Precificação · Estrutura Financeira</h2>
        <p className="text-sm text-white/50">Moedas, câmbio, bancos, contas e a estrutura contábil — tudo num lugar só.</p>
      </div>

      {/* Abas internas (não aparecem na lateral) */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-white/10">
        {ABAS.map(a => (
          <button key={a.key} onClick={() => trocar(a.key)}
            className={`rounded-t-lg px-3 py-2 text-sm transition ${aba === a.key ? 'bg-white/10 font-medium text-white' : 'text-white/50 hover:text-white/80'}`}>
            {a.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<CarregandoAba />}>
        <Atual />
      </Suspense>
    </div>
  )
}