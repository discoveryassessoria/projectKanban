// TESOURARIA — Financeiro Geral
//
// Fiel ao Golden Master aprovado: KPIs (Saldo Consolidado / Entradas 30d /
// Saídas 30d / Conciliações / Contas Ativas), Conciliação Bancária (largura
// total), Contas Bancárias + Fluxo de Caixa Hoje, Movimentações Recentes +
// Pendências de Conciliação. 100% da linguagem visual vem do kit compartilhado.
//
// Somente frontend: consome os endpoints EXISTENTES /api/financas/tesouraria e
// /api/financas/fluxo (GET). Nenhuma API, rota, schema ou regra é alterada.

"use client"

import { useEffect, useState } from "react"
import {
  Landmark, Wallet, ArrowDownRight, ArrowUpRight, Scale, CreditCard,
  ArrowRightLeft, RefreshCw, BarChart3, Plus, Loader2, MoreVertical, Calendar,
} from "lucide-react"
import {
  PageHeader, PrimaryButton, SecondaryButton, KpiCard, SectionCard, SurfaceCard,
  Thead, Th, Tr, EmptyState, StatusBadge, MetricRow, LinkAction, Chevron,
  fmtBRL,
} from "@/src/components/financeiroComponents/ui/kit"

interface Conta {
  id: number; nome: string; banco: string | null; tipo: string; moeda: string
  saldoNativo: number; saldoBRL: number; projetadoNativo: number; projetadoBRL: number
  cor: string | null; principal: boolean; mock: boolean
}
interface TesourariaData {
  temReais: boolean
  contas: Conta[]
  totalBRL: number; projetadoBRL: number; brlBRL: number; eurNativo: number; usdNativo: number
  contagem: { todas: number; BRL: number; EUR: number; USD: number; conta_corrente: number; reserva: number }
  saldoPorTipo: Record<string, number>
  conciliacao: { nome: string; saldoSistema: number; saldoBanco: number; diferenca: number; pendencias: number }[]
  fx: { EUR: number; USD: number; BRL: number }
  ultimaConciliacao: string
  mock: any
}
interface FluxoResumo {
  saldoAtual: number; entradas30: number; qtdEntradas30: number
  saidas30: number; qtdSaidas30: number; saldoProjetado30: number; net30: number
}

export default function TesourariaTab() {
  const [data, setData] = useState<TesourariaData | null>(null)
  const [fluxo, setFluxo] = useState<FluxoResumo | null>(null)
  const [hoje, setHoje] = useState<{ entradas: number; saidas: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    const auth = { headers: { Authorization: `Bearer ${token}` } }
    Promise.all([
      fetch("/api/financas/tesouraria", auth).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/financas/fluxo", auth).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([tes, flx]) => {
      setData(tes)
      if (flx?.kpis) setFluxo(flx.kpis)
      // "Fluxo de Caixa - Hoje": entradas/saídas do dia corrente na série, se houver.
      if (Array.isArray(flx?.serie)) {
        const key = new Date().toISOString().slice(0, 10)
        const t = flx.serie.find((s: any) => (s.date || "").slice(0, 10) === key)
        setHoje({ entradas: t?.entrada || 0, saidas: t?.saida || 0 })
      }
    }).finally(() => setLoading(false))
  }, [])

  if (loading || !data) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--text-muted)" }} /></div>
  }

  const d = data
  const pendencias = d.conciliacao.reduce((a, c) => a + (c.pendencias || 0), 0)
  const entradas30 = fluxo?.entradas30 ?? 0
  const saidas30 = fluxo?.saidas30 ?? 0
  const qtdEntradas = fluxo?.qtdEntradas30 ?? 0
  const qtdSaidas = fluxo?.qtdSaidas30 ?? 0
  const saldoAnterior = fluxo?.saldoAtual ?? d.totalBRL
  const entradasHoje = hoje?.entradas ?? 0
  const saidasHoje = hoje?.saidas ?? 0
  const saldoProjetado = saldoAnterior + entradasHoje - saidasHoje
  const tipoLabel = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Landmark className="h-5 w-5" />}
        title="Tesouraria"
        subtitle="Gestão centralizada do caixa, bancos e conciliações."
        actions={
          <>
            <SecondaryButton icon={<BarChart3 className="h-3.5 w-3.5" />}>Extrato consolidado</SecondaryButton>
            <SecondaryButton icon={<RefreshCw className="h-3.5 w-3.5" />}>Conciliar agora</SecondaryButton>
            <SecondaryButton icon={<ArrowRightLeft className="h-3.5 w-3.5" />}>Transferência</SecondaryButton>
            <PrimaryButton icon={<Plus className="h-3.5 w-3.5" />}>Cadastrar conta</PrimaryButton>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Saldo Consolidado" value={fmtBRL(d.totalBRL)} sub="Todas as contas" />
        <KpiCard icon={<ArrowDownRight className="h-4 w-4" />} iconTone="success" label="Entradas (30 dias)" value={fmtBRL(entradas30)} sub={`${qtdEntradas} eventos`} />
        <KpiCard icon={<ArrowUpRight className="h-4 w-4" />} iconTone="danger" label="Saídas (30 dias)" value={fmtBRL(saidas30)} sub={`${qtdSaidas} pagamentos`} />
        <KpiCard icon={<Scale className="h-4 w-4" />} label="Conciliações" value={`${pendencias}`} sub="Pendências" />
        <KpiCard icon={<CreditCard className="h-4 w-4" />} label="Contas Ativas" value={`${d.contagem.todas}`} sub="Contas bancárias" />
      </div>

      {/* CONCILIAÇÃO BANCÁRIA — largura total */}
      <SectionCard
        icon={<Scale className="h-4 w-4" />} title="Conciliação Bancária"
        footer={<LinkAction center>Ver todas as conciliações <Chevron className="h-4 w-4" /></LinkAction>}
      >
        {d.conciliacao.length === 0 ? (
          <EmptyState compact icon={<Scale className="h-6 w-6" />} title="Nenhuma conta para conciliar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <Thead>
                <Th>Conta</Th><Th align="right">Saldo Sistema</Th><Th align="right">Saldo Banco</Th>
                <Th align="right">Diferença</Th><Th align="right">Pendências</Th><Th align="right">Ação</Th>
              </Thead>
              <tbody>
                {d.conciliacao.map((c, i) => (
                  <Tr key={i}>
                    <td className="py-2.5 px-2" style={{ color: "var(--text-primary)" }}>{c.nome}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(c.saldoSistema)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(c.saldoBanco)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: c.diferenca === 0 ? "var(--success)" : "var(--warning)" }}>{fmtBRL(c.diferenca)}</td>
                    <td className="py-2.5 px-2 text-right" style={{ color: "var(--text-secondary)" }}>{c.pendencias}</td>
                    <td className="py-2.5 px-2 text-right"><SecondaryButton className="!px-2.5 !py-1 !text-[11px]">Importar extrato</SecondaryButton></td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* CONTAS BANCÁRIAS + FLUXO DE CAIXA HOJE */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
        <SectionCard
          className="lg:col-span-3" icon={<Wallet className="h-4 w-4" />} title="Contas Bancárias"
          footer={<LinkAction center>Ver todas as contas <Chevron className="h-4 w-4" /></LinkAction>}
        >
          {d.contas.length === 0 ? (
            <EmptyState compact icon={<Wallet className="h-6 w-6" />} title="Nenhuma conta cadastrada." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <Thead>
                  <Th>Conta</Th><Th>Banco</Th><Th>Tipo</Th><Th align="right">Saldo Atual</Th><Th>Situação</Th><Th align="right">Ações</Th>
                </Thead>
                <tbody>
                  {d.contas.map((c) => (
                    <Tr key={c.id}>
                      <td className="py-2.5 px-2">
                        <div className="font-medium" style={{ color: "var(--text-primary)" }}>{c.nome}</div>
                        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.moeda}{c.principal ? " · principal" : ""}</div>
                      </td>
                      <td className="py-2.5 px-2" style={{ color: "var(--text-secondary)" }}>{c.banco || "—"}</td>
                      <td className="py-2.5 px-2" style={{ color: "var(--text-secondary)" }}>{tipoLabel(c.tipo)}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(c.saldoBRL)}</td>
                      <td className="py-2.5 px-2"><StatusBadge tone="success">Ativa</StatusBadge></td>
                      <td className="py-2.5 px-2 text-right">
                        <button className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: "var(--text-secondary)" }} aria-label="Ações"><MoreVertical className="h-4 w-4 inline" /></button>
                      </td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          className="lg:col-span-2" icon={<BarChart3 className="h-4 w-4" />} title="Fluxo de Caixa - Hoje"
          footer={<LinkAction center>Ver fluxo completo <Chevron className="h-4 w-4" /></LinkAction>}
        >
          <div className="space-y-3">
            <MetricRow label="Saldo anterior" value={fmtBRL(saldoAnterior)} />
            <MetricRow label="Entradas" value={fmtBRL(entradasHoje)} tone="success" />
            <MetricRow label="Saídas" value={fmtBRL(saidasHoje)} tone="danger" />
            <div className="pt-3 border-t" style={{ borderColor: "var(--border-default)" }}>
              <div className="flex justify-between items-center">
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>Saldo projetado</span>
                <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>{fmtBRL(saldoProjetado)}</span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* MOVIMENTAÇÕES RECENTES + PENDÊNCIAS DE CONCILIAÇÃO */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
        <SectionCard
          className="lg:col-span-3" icon={<BarChart3 className="h-4 w-4" />} title="Movimentações Recentes"
          footer={<LinkAction center>Ver todas as movimentações <Chevron className="h-4 w-4" /></LinkAction>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <Thead>
                <Th>Data</Th><Th>Descrição</Th><Th>Conta</Th><Th>Tipo</Th><Th align="right">Valor</Th><Th align="right">Saldo</Th>
              </Thead>
              <tbody />
            </table>
          </div>
          <EmptyState
            icon={<Calendar className="h-6 w-6" />}
            title="Nenhuma movimentação encontrada."
            subtitle="As movimentações aparecerão aqui assim que forem realizadas."
          />
        </SectionCard>

        <SurfaceCard className="lg:col-span-2" padding="p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Landmark className="h-4 w-4" style={{ color: "var(--text-secondary)" }} /> Pendências de Conciliação
              <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--surface-active)", color: "var(--text-secondary)" }}>{pendencias}</span>
            </div>
            <LinkAction>Ver todas</LinkAction>
          </div>
          <EmptyState
            icon={<Landmark className="h-6 w-6" />}
            title="Nenhuma pendência encontrada."
            subtitle="Todas as movimentações estão conciliadas."
          />
        </SurfaceCard>
      </div>
    </div>
  )
}
