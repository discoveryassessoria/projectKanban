"use client"

// src/components/gerenciamentoComponents/DashboardsTab.tsx
// RELATÓRIOS E INDICADORES › DASHBOARDS.
// Índice das composições visuais que EXISTEM no sistema, com números reais e link
// que abre a tela de verdade. Não recria gráfico nem duplica painel: cada card
// leva para o dashboard dono do assunto.
// Dados: /api/gerenciamento/diagnostico (mesmo read-model dos diagnósticos).

import { useCallback, useEffect, useState } from "react"
import { LayoutDashboard, Columns3, DollarSign, GitBranch, Coins, Users2 } from "lucide-react"

interface Diagnostico {
  sistema: { contagens: Record<string, number>; runtime: Record<string, number> }
  executivo: { scoreGeral: number; porTipo: { id: number }[] }
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"

export default function DashboardsTab() {
  const [d, setD] = useState<Diagnostico | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const MSG = "Não foi possível carregar os indicadores."
  // BUSCA (só rede) × APLICAÇÃO (só estado).
  const buscar = useCallback(async (sinal?: AbortSignal) => {
    const res = await fetch("/api/gerenciamento/diagnostico", { headers: authHeaders(), cache: "no-store", signal: sinal })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || MSG)
    return j as Diagnostico
  }, [])
  const aplicar = useCallback((j: Diagnostico) => { setD(j) }, [])
  useEffect(() => {
    const ac = new AbortController()
    buscar(ac.signal)
      .then((j) => { if (!ac.signal.aborted) aplicar(j) })
      .catch((e: any) => { if (!ac.signal.aborted) setErro(e?.message || MSG) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [buscar, aplicar])
  const load = useCallback(async () => {
    setLoading(true); setErro(null)
    try { aplicar(await buscar()) }
    catch (e: any) { setErro(e?.message || MSG) } finally { setLoading(false) }
  }, [buscar, aplicar])

  const c = d?.sistema.contagens ?? {}
  const r = d?.sistema.runtime ?? {}

  const paineis = [
    {
      chave: "home", nome: "Centro Operacional", href: "/",
      Icon: LayoutDashboard,
      descricao: "Filas de trabalho executável do dia, com drill-down por pendência.",
      metricas: [{ label: "Processos", valor: c.processos ?? 0 }, { label: "Instâncias ativas", valor: r.instanciasAtivas ?? 0 }],
    },
    {
      chave: "kanban", nome: "Kanban de Processos", href: "/kanban",
      Icon: Columns3,
      descricao: "Quadro por fase, derivado da sequência configurada em cada fluxo.",
      metricas: [{ label: "Tipos de processo", valor: c.tiposProcesso ?? 0 }, { label: "Fluxos macro", valor: c.macros ?? 0 }],
    },
    {
      chave: "financeiro", nome: "Financeiro Geral", href: "/financeiro",
      Icon: DollarSign,
      descricao: "Receitas, custos, cobranças, tesouraria e posição consolidada.",
      metricas: [{ label: "Configurações financeiras", valor: c.configsFinanceiras ?? 0 }, { label: "Linhas de preço", valor: c.precos ?? 0 }],
    },
    {
      chave: "dashboard", nome: "Dashboard Executivo", href: "/dashboard",
      Icon: GitBranch,
      descricao: "Visão gerencial de andamento e produtividade.",
      metricas: [{ label: "Prontidão média", valor: `${d?.executivo.scoreGeral ?? 0}%` }, { label: "Processos configurados", valor: d?.executivo.porTipo.length ?? 0 }],
    },
    {
      chave: "cambio", nome: "Câmbio", href: "/cambio",
      Icon: Coins,
      descricao: "Cotação vigente e histórico usados pelo Financeiro.",
      metricas: [{ label: "Moedas", valor: c.servicos !== undefined ? (c.precos ?? 0) : 0, oculto: true }],
    },
    {
      chave: "genealogia", nome: "Genealogia", href: "/genealogy",
      Icon: Users2,
      descricao: "Árvore familiar e necessidades documentais por pessoa.",
      metricas: [{ label: "Tipos de documento", valor: c.tiposDocumento ?? 0 }, { label: "Regras documentais", valor: c.matrizDocumental ?? 0 }],
    },
  ]

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={load} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <h2 className="text-lg font-semibold text-white">Dashboards</h2>
        <p className="mt-1 max-w-3xl text-sm text-white/60">
          As composições visuais do sistema, com os números reais de configuração por trás de cada uma. Clique para
          abrir o painel — o Gerenciamento não recria gráficos, aponta para o dono do assunto.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {paineis.map((p) => (
          <a
            key={p.chave}
            href={p.href}
            className="group flex flex-col rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <div className="mb-3 flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] text-white/85">
              <p.Icon className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">{p.nome}</h3>
            <p className="mt-1 flex-1 text-[13px] leading-snug text-white/55">{p.descricao}</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 pt-3">
              {p.metricas.filter((m) => !("oculto" in m && m.oculto)).map((m) => (
                <div key={m.label}>
                  <div className="text-lg font-bold text-white">{m.valor}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-white/45">{m.label}</div>
                </div>
              ))}
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
