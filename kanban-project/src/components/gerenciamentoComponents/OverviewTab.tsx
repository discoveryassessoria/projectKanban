// src/components/gerenciamentoComponents/OverviewTab.tsx
//
// Painel Geral do Gerenciamento — cards de contagem REAIS do banco
// (usuários, perfis, contas, fornecedores, configurações financeiras, status),
// KPI strip, alertas de configuração e última alteração. Busca /api/gerenciamento/overview.
//
// Um número, um lugar: o strip só renderiza o que NÃO é card (a API marca as
// contagens duplicadas com `duplicadoEmCards`). Backend antigo, sem a marca,
// continua renderizando tudo — comportamento anterior preservado.
// Os rótulos vêm de lib/gerenciamento/overview-projecao (fonte única).

"use client"

import { useEffect, useState } from "react"
import { Users, Shield, Landmark, Tag, Truck, Target, Columns3, AlertTriangle, Loader2 } from "lucide-react"
import { ROTULOS_CONTAGEM, type ItemStrip } from "@/lib/gerenciamento/overview-projecao"

interface RegistroAuditoria { acao: string; entidade: string; em: string }

interface OverviewData {
  cards: { usuarios: number; perfis: number; contas: number; fornecedores: number; configsFinanceiras: number; statusCols: number }
  strip: ItemStrip[]
  alertas: string[]
  /** alteração de configuração, sem eventos de acesso. Ausente em backend antigo. */
  ultimaAlteracao?: RegistroAuditoria | null
  /** DEPRECADO: último log sem filtro (pode ser LOGIN). Só usado como fallback. */
  ultimaAcao?: RegistroAuditoria | null
}

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    fetch("/api/gerenciamento/overview", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => setData(d)).catch(e => console.error(e)).finally(() => setLoading(false))
  }, [])

  if (loading || !data) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" /></div>

  const d = data
  const cards = [
    { icon: <Users className="h-4 w-4" />, label: ROTULOS_CONTAGEM.usuarios, value: d.cards.usuarios },
    { icon: <Shield className="h-4 w-4" />, label: ROTULOS_CONTAGEM.perfis, value: d.cards.perfis },
    { icon: <Landmark className="h-4 w-4" />, label: ROTULOS_CONTAGEM.contas, value: d.cards.contas },
    { icon: <Truck className="h-4 w-4" />, label: ROTULOS_CONTAGEM.fornecedores, value: d.cards.fornecedores },
    { icon: <Tag className="h-4 w-4" />, label: ROTULOS_CONTAGEM.configsFinanceiras, value: d.cards.configsFinanceiras },
    { icon: <Columns3 className="h-4 w-4" />, label: ROTULOS_CONTAGEM.statusCols, value: d.cards.statusCols },
  ]

  // strip = só o que não é card. Sem a marca (backend antigo), mantém tudo.
  const strip = (d.strip ?? []).filter((k) => !k.duplicadoEmCards)

  // `ultimaAlteracao` ausente = backend antigo → cai no campo depreciado.
  // Ausente é diferente de null: null significa "não houve alteração ainda".
  const ultima = d.ultimaAlteracao !== undefined ? d.ultimaAlteracao : d.ultimaAcao ?? null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-white">Painel Geral</h2>
        <div className="text-xs text-white/60 mt-1">Visão geral dos cadastros e configurações do sistema.</div>
      </div>

      {/* KPI STRIP — apenas indicadores que não são cards */}
      {strip.length > 0 && (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {strip.map((k, i) => (
          <div key={i} className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-lg p-2.5 text-center">
            <div className={`font-bold text-white ${k.isText ? "text-[13px]" : "text-lg"}`}>{k.value}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-tight">{k.label}</div>
          </div>
        ))}
      </div>
      )}

      {/* CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <div key={i} className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[var(--surface-primary)] flex items-center justify-center text-white/70">{c.icon}</div>
            <div>
              <div className="text-2xl font-bold text-white leading-none">{c.value}</div>
              <div className="text-[11px] text-[var(--text-secondary)] mt-1">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ALERTAS */}
      <div className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4 border-l-2 border-l-amber-400">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> Alertas de configuração
        </div>
        {d.alertas.length === 0 ? (
          <div className="text-sm text-green-700">✓ Nenhum alerta. Tudo configurado.</div>
        ) : (
          <div className="space-y-1">
            {d.alertas.map((a, i) => (
              <div key={i} className="text-[12.5px] text-white/80 py-1 border-t border-[var(--border-subtle)] first:border-0">⚠ {a}</div>
            ))}
          </div>
        )}
      </div>

      {/* ÚLTIMA ALTERAÇÃO (não conta acesso/login) */}
      {ultima && (
        <div className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Última alteração</div>
          <div className="text-sm text-white/80">
            <strong className="text-white">{ultima.acao}</strong> · {ultima.entidade}
            <span className="text-[var(--text-muted)] ml-2">{new Date(ultima.em).toLocaleString("pt-BR")}</span>
          </div>
        </div>
      )}
    </div>
  )
}