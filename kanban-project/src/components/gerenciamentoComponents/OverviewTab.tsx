// CRIAR EM: src/components/gerenciamentoComponents/OverviewTab.tsx
//
// Painel Geral do Gerenciamento — cards de contagem REAIS do banco
// (usuários, perfis, contas, categorias, fornecedores, centros, status),
// KPI strip, alertas de configuração e última alteração. Busca /api/gerenciamento/overview.

"use client"

import { useEffect, useState } from "react"
import { Users, Shield, Landmark, Tag, Truck, Target, Columns3, AlertTriangle, Loader2 } from "lucide-react"

interface OverviewData {
  cards: { usuarios: number; perfis: number; categorias: number; contas: number; fornecedores: number; centros: number; statusCols: number }
  strip: { label: string; value: number | string; real: boolean; isText?: boolean }[]
  alertas: string[]
  ultimaAcao: { acao: string; entidade: string; em: string } | null
}

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/gerenciamento/overview", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>

  const d = data
  const cards = [
    { icon: <Users className="h-4 w-4" />, label: "Usuários", value: d.cards.usuarios },
    { icon: <Shield className="h-4 w-4" />, label: "Perfis", value: d.cards.perfis },
    { icon: <Landmark className="h-4 w-4" />, label: "Contas bancárias", value: d.cards.contas },
    { icon: <Tag className="h-4 w-4" />, label: "Categorias", value: d.cards.categorias },
    { icon: <Truck className="h-4 w-4" />, label: "Fornecedores", value: d.cards.fornecedores },
    { icon: <Target className="h-4 w-4" />, label: "Centros de custo", value: d.cards.centros },
    { icon: <Columns3 className="h-4 w-4" />, label: "Colunas de status", value: d.cards.statusCols },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white">Painel Geral</h2>
        <div className="text-xs text-white/60 mt-1">Visão geral dos cadastros e configurações do sistema.</div>
      </div>

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {d.strip.map((k, i) => (
          <div key={i} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-2.5 text-center">
            <div className={`font-bold text-white ${k.isText ? "text-[13px]" : "text-lg"}`}>{k.value}</div>
            <div className="text-[10px] text-white/50 mt-0.5 leading-tight">{k.label}</div>
          </div>
        ))}
      </div>

      {/* CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <div key={i} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white/70">{c.icon}</div>
            <div>
              <div className="text-2xl font-bold text-white leading-none">{c.value}</div>
              <div className="text-[11px] text-white/50 mt-1">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ALERTAS */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 border-l-2 border-l-amber-400">
        <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> Alertas de configuração
        </div>
        {d.alertas.length === 0 ? (
          <div className="text-sm text-green-400">✓ Nenhum alerta. Tudo configurado.</div>
        ) : (
          <div className="space-y-1">
            {d.alertas.map((a, i) => (
              <div key={i} className="text-[12.5px] text-white/80 py-1 border-t border-white/5 first:border-0">⚠ {a}</div>
            ))}
          </div>
        )}
      </div>

      {/* ÚLTIMA AÇÃO */}
      {d.ultimaAcao && (
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-2">Última alteração</div>
          <div className="text-sm text-white/80">
            <strong className="text-white">{d.ultimaAcao.acao}</strong> · {d.ultimaAcao.entidade}
            <span className="text-white/40 ml-2">{new Date(d.ultimaAcao.em).toLocaleString("pt-BR")}</span>
          </div>
        </div>
      )}
    </div>
  )
}