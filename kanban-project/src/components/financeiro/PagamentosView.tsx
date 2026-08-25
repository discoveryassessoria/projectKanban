// src/components/financeiro/PagamentosView.tsx
// ============================================================================
// PAGAMENTOS — consulta/investigação de pagamentos registrados. SOMENTE leitura +
// navegação: não edita pagamento confirmado (correção = estorno canônico). As ações
// (abrir detalhe / iniciar estorno) navegam para o fluxo CANÔNICO (detalhe da Receita
// no processo). Read-model /v3/pagamentos. Composta 100% com o Design System oficial.
// ============================================================================
"use client"

import { useEffect, useMemo, useState } from "react"
import { Receipt, ExternalLink, Paperclip, RotateCcw } from "lucide-react"
import { PageHeader, SectionCard, Thead, Th, Tr, StatusBadge, EmptyState, SearchInput, FilterChip, LinkAction } from "@/src/components/financeiroComponents/ui/kit"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtMoeda as brl } from "@/src/lib/financeiro/formato"

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")

interface Pag {
  id: number; data: string; valor: number; moeda: string; forma: string | null; conta: string | null
  referencia: string | null; temComprovante: boolean; comprovanteUrl: string | null; status: string
  estornado: number; saldoEstornavel: number; codigo: string; obrigacaoId: number; processoId: number | null
  responsavel: string | null
}

export function PagamentosView() {
  const [pags, setPags] = useState<Pag[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState("")
  const [chip, setChip] = useState<"todos" | "comprovante" | "estornados">("todos")

  useEffect(() => {
    let vivo = true
    fetch("/api/financeiro/v3/pagamentos", { headers: authHeaders() }).then((r) => r.json()).then((j) => { if (vivo) { setPags(Array.isArray(j?.pagamentos) ? j.pagamentos : []); setLoading(false) } }).catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return pags.filter((p) => {
      if (chip === "comprovante" && !p.temComprovante) return false
      if (chip === "estornados" && p.estornado <= 0.005) return false
      if (!q) return true
      return [p.codigo, p.forma, p.conta, p.referencia, p.responsavel].filter(Boolean).some((s) => String(s).toLowerCase().includes(q))
    })
  }, [pags, busca, chip])

  const abrirDetalhe = (p: Pag) => window.open(`/financeiro/v3/receita/${p.obrigacaoId}`, "_blank")

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Receipt className="h-5 w-5" />}
        title="Pagamentos"
        subtitle="Consulta e investigação de pagamentos registrados. Correções são feitas por estorno canônico."
        meta={<span>{loading ? "…" : `${filtrados.length} pagamento(s)`}</span>}
      />

      <SectionCard
        right={
          <div className="flex items-center gap-2">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar código, forma, conta, referência…" />
            <FilterChip active={chip === "todos"} onClick={() => setChip("todos")}>Todos</FilterChip>
            <FilterChip active={chip === "comprovante"} onClick={() => setChip("comprovante")}>Com comprovante</FilterChip>
            <FilterChip active={chip === "estornados"} onClick={() => setChip("estornados")}>Estornados</FilterChip>
          </div>
        }
      >
        {loading ? (
          <EmptyState compact icon={<Receipt className="h-5 w-5" />} title="Carregando pagamentos…" />
        ) : filtrados.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Nenhum pagamento neste filtro." subtitle="Ajuste a busca ou os filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <Thead>
                <Th>Data</Th><Th>Pagamento</Th><Th align="right">Valor</Th><Th>Forma</Th><Th>Conta</Th><Th>Referência</Th><Th align="center">Comprov.</Th><Th align="center">Status</Th><Th>Responsável</Th><Th align="center">Ações</Th>
              </Thead>
              <tbody>
                {filtrados.map((p) => {
                  const estornadoTot = p.estornado > 0.005
                  return (
                    <Tr key={p.id}>
                      <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{dataBR(p.data)}</td>
                      <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-primary)" }}>{p.codigo}</td>
                      <td className="py-2.5 px-2 text-sm text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{brl(p.valor, p.moeda)}{estornadoTot && <div className="text-[11px]" style={{ color: "var(--danger)" }}>−{brl(p.estornado, p.moeda)} estornado</div>}</td>
                      <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{p.forma ?? "—"}</td>
                      <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{p.conta ?? "—"}</td>
                      <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{p.referencia ?? "—"}</td>
                      <td className="py-2.5 px-2 text-center">{p.temComprovante ? (p.comprovanteUrl ? <a href={p.comprovanteUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Ver comprovante" style={{ color: "var(--accent-text)" }}><Paperclip className="inline h-4 w-4" /></a> : <Paperclip className="inline h-4 w-4" style={{ color: "var(--success)" }} />) : <span style={{ color: "var(--text-muted)" }}>—</span>}</td>
                      <td className="py-2.5 px-2 text-center"><StatusBadge tone={estornadoTot ? (p.saldoEstornavel <= 0.005 ? "danger" : "warning") : "success"}>{estornadoTot ? (p.saldoEstornavel <= 0.005 ? "estornado" : "parcial") : "confirmado"}</StatusBadge></td>
                      <td className="py-2.5 px-2 text-sm" style={{ color: "var(--text-secondary)" }}>{p.responsavel ?? "—"}</td>
                      <td className="py-2.5 px-2 text-center">
                        <div className="inline-flex items-center gap-2">
                          <button onClick={() => abrirDetalhe(p)} title="Abrir Receita (fluxo canônico)" style={{ color: "var(--accent-text)" }}><ExternalLink className="h-4 w-4" /></button>
                          <button onClick={() => abrirDetalhe(p)} title="Estornar no fluxo canônico (detalhe da Receita → Pagamentos)" style={{ color: "var(--info)" }} disabled={p.saldoEstornavel <= 0.005}><RotateCcw className="h-4 w-4" style={{ opacity: p.saldoEstornavel <= 0.005 ? 0.35 : 1 }} /></button>
                        </div>
                      </td>
                    </Tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Registrar pagamento, estornar, gerar recibo e anexar comprovante são feitos no <LinkAction onClick={() => {}}>detalhe canônico da Receita</LinkAction> (Financeiro do processo). Esta página é de consulta e navegação.</p>
    </div>
  )
}
