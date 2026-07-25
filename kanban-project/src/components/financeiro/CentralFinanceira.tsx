// src/components/financeiro/CentralFinanceira.tsx
// ============================================================================
// CENTRAL FINANCEIRA — visão geral / inteligência operacional / acesso rápido.
// EXCLUSIVAMENTE leitura + atalhos: NÃO edita distribuição, NÃO tem formulário
// próprio de pagamento/estorno, NÃO duplica tabelas completas, NÃO roda regra
// financeira própria. Todos os números vêm de read-models existentes
// (/v3/resumo, /v3/obrigacoes, /v3/divergencias, /creditos). Os atalhos apenas
// navegam para os fluxos CANÔNICOS. Composta 100% com o Design System oficial
// (financeiroComponents/ui/kit) — nenhum componente visual próprio de tela.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { Wallet, TrendingUp, AlertTriangle, Clock, Landmark, Coins, ArrowRight, Receipt, FileText, RefreshCw } from "lucide-react"
import { PageHeader, KpiCard, SectionCard, Thead, Th, Tr, StatusBadge, EmptyState, PrimaryButton, SecondaryButton, LinkAction, FilterChip } from "@/src/components/financeiroComponents/ui/kit"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0)
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const diasAte = (s?: string | null) => (s ? Math.ceil((new Date(s).getTime() - Date.now()) / 86400000) : null)

interface Obr {
  obrigacaoId: number; codigoOperacional: string | null; descricao: string | null; direcao: string; status: string
  processoId: number | null; moeda: string; valorContratado: number; saldo: number; recebido: number
  vencimento: string | null; requerente: string | null; responsavel: string | null
}

export function CentralFinanceira({ onIrPara }: { onIrPara?: (tab: string) => void }) {
  const [resumo, setResumo] = useState<any>(null)
  const [obrs, setObrs] = useState<Obr[]>([])
  const [divergencias, setDivergencias] = useState<any[]>([])
  const [creditoDisp, setCreditoDisp] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [horizonte, setHorizonte] = useState<7 | 15 | 30>(30)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const [r, o, d, c] = await Promise.all([
        fetch("/api/financeiro/v3/resumo", { headers: authHeaders() }).then((x) => x.json()).catch(() => null),
        fetch("/api/financeiro/v3/obrigacoes", { headers: authHeaders() }).then((x) => x.json()).catch(() => null),
        fetch("/api/financeiro/v3/divergencias", { headers: authHeaders() }).then((x) => x.json()).catch(() => null),
        fetch("/api/financeiro/creditos", { headers: authHeaders() }).then((x) => x.json()).catch(() => null),
      ])
      if (!vivo) return
      setResumo(r?.resumo ?? null)
      setObrs(Array.isArray(o?.obrigacoes) ? o.obrigacoes : Array.isArray(o) ? o : [])
      setDivergencias(Array.isArray(d?.divergencias) ? d.divergencias : Array.isArray(d) ? d : [])
      setCreditoDisp(c?.saldoDisponivel != null ? Number(c.saldoDisponivel) : null)
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [])

  const aReceber = obrs.filter((o) => o.direcao === "A_RECEBER")
  const emAberto = aReceber.filter((o) => o.saldo > 0.005 && o.status !== "CANCELADA")
  const agora = Date.now()
  const vencidas = useMemo(() => emAberto.filter((o) => o.vencimento && new Date(o.vencimento).getTime() < agora).sort((a, b) => new Date(a.vencimento!).getTime() - new Date(b.vencimento!).getTime()), [obrs])
  const vencendo = useMemo(() => emAberto.filter((o) => { const dd = diasAte(o.vencimento); return dd != null && dd >= 0 && dd <= horizonte }).sort((a, b) => new Date(a.vencimento!).getTime() - new Date(b.vencimento!).getTime()), [obrs, horizonte])

  const totalReceber = resumo?.aReceber?.saldo ?? emAberto.reduce((s, o) => s + o.saldo, 0)
  const totalRecebido = resumo?.aReceber?.recebido ?? aReceber.reduce((s, o) => s + o.recebido, 0)
  const totalVencido = vencidas.reduce((s, o) => s + o.saldo, 0)
  const totalPrevisto = vencendo.reduce((s, o) => s + o.saldo, 0)

  const ir = (tab: string) => onIrPara?.(tab)

  const linhaCobranca = (o: Obr, tone: "danger" | "warning") => {
    const dd = diasAte(o.vencimento)
    return (
      <Tr key={o.obrigacaoId} onClick={o.processoId ? () => window.open(`/processos/${o.processoId}`, "_blank") : undefined}>
        <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-primary)" }}>{o.codigoOperacional ?? `OBR-${o.obrigacaoId}`}</td>
        <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{o.requerente ?? o.descricao ?? "—"}</td>
        <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{brl(o.saldo)}</td>
        <td className="py-2.5 px-2 text-sm">{dataBR(o.vencimento)}</td>
        <td className="py-2.5 px-2 text-center"><StatusBadge tone={tone}>{tone === "danger" ? `${Math.abs(dd ?? 0)}d em atraso` : dd === 0 ? "vence hoje" : `em ${dd}d`}</StatusBadge></td>
      </Tr>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Wallet className="h-5 w-5" />}
        title="Central Financeira"
        subtitle="Visão geral, priorização e acesso rápido — leitura consolidada do motor financeiro."
        actions={
          <div className="flex items-center gap-2">
            <SecondaryButton icon={<Receipt className="h-4 w-4" />} onClick={() => ir("cobrancas")}>Cobranças</SecondaryButton>
            <PrimaryButton icon={<ArrowRight className="h-4 w-4" />} onClick={() => ir("receber")}>Receber</PrimaryButton>
          </div>
        }
      />

      {/* KPIs consolidados (read-model — sem regra própria) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Total a receber" value={loading ? "…" : brl(totalReceber)} sub={`${emAberto.length} em aberto`} />
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Total recebido" value={loading ? "…" : brl(totalRecebido)} iconTone="success" />
        <KpiCard icon={<AlertTriangle className="h-4 w-4" />} label="Total vencido" value={loading ? "…" : brl(totalVencido)} sub={`${vencidas.length} cobrança(s)`} iconTone="danger" />
        <KpiCard icon={<Clock className="h-4 w-4" />} label={`A vencer (${horizonte}d)`} value={loading ? "…" : brl(totalPrevisto)} sub={`${vencendo.length} cobrança(s)`} iconTone="warning" />
        <KpiCard icon={<Coins className="h-4 w-4" />} label="Créditos disponíveis" value={creditoDisp == null ? "—" : brl(creditoDisp)} iconTone="info" />
        <KpiCard icon={<Landmark className="h-4 w-4" />} label="Saldo em contas" value="—" sub="ver Tesouraria" footer={<LinkAction onClick={() => ir("tesouraria")}>Abrir Tesouraria</LinkAction>} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Cobranças vencidas */}
        <SectionCard icon={<AlertTriangle className="h-4 w-4" />} title="Cobranças vencidas" right={<LinkAction onClick={() => ir("cobrancas")}>Ver todas</LinkAction>}>
          {loading ? <EmptyState compact icon={<Clock className="h-5 w-5" />} title="Carregando…" /> : vencidas.length === 0 ? (
            <EmptyState compact icon={<AlertTriangle className="h-5 w-5" />} title="Nenhuma cobrança vencida." subtitle="Nada em atraso no momento." />
          ) : (
            <div className="overflow-x-auto"><table className="w-full"><Thead><Th>Código</Th><Th>Cliente</Th><Th align="right">Saldo</Th><Th>Vencimento</Th><Th align="center">Situação</Th></Thead><tbody>{vencidas.slice(0, 8).map((o) => linhaCobranca(o, "danger"))}</tbody></table></div>
          )}
        </SectionCard>

        {/* Cobranças vencendo */}
        <SectionCard icon={<Clock className="h-4 w-4" />} title="Cobranças vencendo" right={<div className="flex items-center gap-1.5">{([7, 15, 30] as const).map((h) => <FilterChip key={h} active={horizonte === h} onClick={() => setHorizonte(h)}>{h}d</FilterChip>)}</div>}>
          {loading ? <EmptyState compact icon={<Clock className="h-5 w-5" />} title="Carregando…" /> : vencendo.length === 0 ? (
            <EmptyState compact icon={<Clock className="h-5 w-5" />} title="Nada vencendo nesse horizonte." subtitle={`Sem cobranças a vencer em ${horizonte} dias.`} />
          ) : (
            <div className="overflow-x-auto"><table className="w-full"><Thead><Th>Código</Th><Th>Cliente</Th><Th align="right">Saldo</Th><Th>Vencimento</Th><Th align="center">Situação</Th></Thead><tbody>{vencendo.slice(0, 8).map((o) => linhaCobranca(o, "warning"))}</tbody></table></div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Divergências (conferência do razão) */}
        <SectionCard icon={<RefreshCw className="h-4 w-4" />} title="Divergências do razão" right={divergencias.length > 0 ? <StatusBadge tone="danger">{divergencias.length}</StatusBadge> : <StatusBadge tone="success">0</StatusBadge>}>
          {loading ? <EmptyState compact icon={<Clock className="h-5 w-5" />} title="Carregando…" /> : divergencias.length === 0 ? (
            <EmptyState compact icon={<RefreshCw className="h-5 w-5" />} title="Razão consistente." subtitle="Projeção e replay batem em todas as obrigações." />
          ) : (
            <div className="overflow-x-auto"><table className="w-full"><Thead><Th>Obrigação</Th><Th align="right">Projeção</Th><Th align="right">Replay</Th><Th align="right">Δ</Th></Thead><tbody>{divergencias.slice(0, 8).map((d: any) => (
              <Tr key={d.obrigacaoId}>
                <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-primary)" }}>{d.codigoOperacional ?? `OBR-${d.obrigacaoId}`}</td>
                <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{brl(Number(d.saldoProjecao ?? 0))}</td>
                <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{brl(Number(d.saldoReplay ?? 0))}</td>
                <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--danger)" }}>{brl(Number(d.delta ?? 0))}</td>
              </Tr>
            ))}</tbody></table></div>
          )}
        </SectionCard>

        {/* Acesso rápido — atalhos que abrem os fluxos CANÔNICOS (sem implementação própria) */}
        <SectionCard icon={<ArrowRight className="h-4 w-4" />} title="Acesso rápido">
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton icon={<Receipt className="h-4 w-4" />} onClick={() => ir("cobrancas")} className="justify-start">Abrir cobranças</SecondaryButton>
            <SecondaryButton icon={<Wallet className="h-4 w-4" />} onClick={() => ir("receber")} className="justify-start">A receber</SecondaryButton>
            <SecondaryButton icon={<Coins className="h-4 w-4" />} onClick={() => ir("pagar")} className="justify-start">A pagar</SecondaryButton>
            <SecondaryButton icon={<Landmark className="h-4 w-4" />} onClick={() => ir("tesouraria")} className="justify-start">Tesouraria</SecondaryButton>
            <SecondaryButton icon={<FileText className="h-4 w-4" />} onClick={() => ir("fluxo")} className="justify-start">Fluxo de caixa</SecondaryButton>
            <SecondaryButton icon={<TrendingUp className="h-4 w-4" />} onClick={() => ir("dre")} className="justify-start">DRE</SecondaryButton>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>Registrar pagamento e estornar são feitos no fluxo canônico, dentro do Financeiro do processo → Receita. Esta Central é somente leitura e navegação.</p>
        </SectionCard>
      </div>
    </div>
  )
}
