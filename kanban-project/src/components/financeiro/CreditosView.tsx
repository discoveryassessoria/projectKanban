// src/components/financeiro/CreditosView.tsx
// ============================================================================
// CRÉDITOS FINANCEIROS — créditos de excedente disponíveis/utilizados/revogados.
// SOMENTE leitura: read-model /v3/creditos (original=GERACAO, utilizado=UTILIZACAO,
// revogado=ESTORNO, disponível=saldo). Não cria/consome crédito aqui (isso é feito
// no fluxo canônico de pagamento). Composta 100% com o Design System oficial.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { Coins, ExternalLink } from "lucide-react"
import { PageHeader, SectionCard, Thead, Th, Tr, StatusBadge, EmptyState, SearchInput, FilterChip } from "@/src/components/financeiroComponents/ui/kit"

const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }
const brl = (v: number, m = "BRL") => { try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: m || "BRL" }).format(v || 0) } catch { return `${(v || 0).toFixed(2)} ${m}` } }
const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")

interface Cred {
  id: number; pessoa: string | null; obrigacaoId: number | null; origemOcorrenciaId: number | null
  moeda: string; destino: string; status: string; original: number; disponivel: number
  utilizado: number; revogado: number; devolvido: number; criadoEm: string
}
const tone = (s: string): "success" | "neutral" | "danger" | "warning" => s === "ABERTO" ? "success" : s === "UTILIZADO" ? "neutral" : s === "ESTORNADO" ? "danger" : "warning"

export function CreditosView() {
  const [creds, setCreds] = useState<Cred[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState("")
  const [chip, setChip] = useState<"todos" | "disponiveis">("disponiveis")

  useEffect(() => {
    let vivo = true
    fetch("/api/financeiro/v3/creditos", { headers: authHeaders() }).then((r) => r.json()).then((j) => { if (vivo) { setCreds(Array.isArray(j?.creditos) ? j.creditos : []); setLoading(false) } }).catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return creds.filter((c) => {
      if (chip === "disponiveis" && c.disponivel <= 0.005) return false
      if (!q) return true
      return [c.pessoa, c.destino, c.status, `OBR-${c.obrigacaoId}`].filter(Boolean).some((s) => String(s).toLowerCase().includes(q))
    })
  }, [creds, busca, chip])

  const totalDisp = filtrados.reduce((s, c) => s + c.disponivel, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Coins className="h-5 w-5" />}
        title="Créditos Financeiros"
        subtitle="Créditos de excedente por pagador — disponíveis, utilizados e revogados. Somente leitura."
        meta={<span>{loading ? "…" : `${filtrados.length} crédito(s) · ${brl(totalDisp)} disponível`}</span>}
      />
      <SectionCard
        right={
          <div className="flex items-center gap-2">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar pagador, origem, status…" />
            <FilterChip active={chip === "disponiveis"} onClick={() => setChip("disponiveis")}>Com saldo</FilterChip>
            <FilterChip active={chip === "todos"} onClick={() => setChip("todos")}>Todos</FilterChip>
          </div>
        }
      >
        {loading ? (
          <EmptyState compact icon={<Coins className="h-5 w-5" />} title="Carregando créditos…" />
        ) : filtrados.length === 0 ? (
          <EmptyState icon={<Coins className="h-6 w-6" />} title="Nenhum crédito neste filtro." subtitle="Créditos nascem de pagamentos com excedente." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <Thead>
                <Th>Pagador</Th><Th>Origem</Th><Th>Criado</Th><Th align="right">Original</Th><Th align="right">Utilizado</Th><Th align="right">Revogado</Th><Th align="right">Disponível</Th><Th align="center">Status</Th><Th align="center">Origem</Th>
              </Thead>
              <tbody>
                {filtrados.map((c) => (
                  <Tr key={c.id}>
                    <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-primary)" }}>{c.pessoa ?? "—"}</td>
                    <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{c.destino}{c.obrigacaoId ? ` · OBR-${c.obrigacaoId}` : ""}</td>
                    <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{dataBR(c.criadoEm)}</td>
                    <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{brl(c.original, c.moeda)}</td>
                    <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>{c.utilizado > 0.005 ? brl(c.utilizado, c.moeda) : "—"}</td>
                    <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: c.revogado > 0.005 ? "var(--danger)" : "var(--text-muted)" }}>{c.revogado > 0.005 ? brl(c.revogado, c.moeda) : "—"}</td>
                    <td className="py-2.5 px-2 text-sm text-right tabular-nums font-medium" style={{ color: c.disponivel > 0.005 ? "var(--success)" : "var(--text-muted)" }}>{brl(c.disponivel, c.moeda)}</td>
                    <td className="py-2.5 px-2 text-center"><StatusBadge tone={tone(c.status)}>{c.status.toLowerCase()}</StatusBadge></td>
                    <td className="py-2.5 px-2 text-center">{c.obrigacaoId ? <button onClick={() => window.open(`/financeiro/v3/receita/${c.obrigacaoId}`, "_blank")} title="Abrir Receita de origem (canônico)" style={{ color: "var(--accent-primary)" }}><ExternalLink className="h-4 w-4" /></button> : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Créditos são gerados por excedente de pagamento e consumidos/revogados pelo motor canônico (registrar pagamento / estorno). Esta página é de consulta.</p>
    </div>
  )
}
