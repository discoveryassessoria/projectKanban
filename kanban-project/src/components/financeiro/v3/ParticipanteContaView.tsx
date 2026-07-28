// src/components/financeiro/v3/ParticipanteContaView.tsx
// ============================================================================
// CONTA FINANCEIRA INDIVIDUAL DO PARTICIPANTE (Financeiro V3). Overlay lateral
// (drawer) que consolida TUDO de UMA obrigação-filha (um requerente): Resumo
// financeiro (contratado/recebido/saldo/a vencer/vencido + aging), Parcelas,
// Cobranças, Pagamentos, Timeline individual, Documentos, Observações, Histórico.
// Ações já no contexto do participante (nada de re-selecionar): "Registrar
// pagamento" (RegistrarPagamentoModal com esta obrigação) e "Estornar" (EstornoModal
// sobre um pagamento). Consome /conta e /timeline (individual). Só leitura + ações.
// ============================================================================
"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import RegistrarPagamentoModal from "@/src/components/financeiro/v3/RegistrarPagamentoModal"
import EstornoModal from "@/src/components/financeiro/v3/EstornoModal"
import {
  X, Loader2, Plus, Wallet, CreditCard, FileCheck, Clock, StickyNote, Receipt,
  RotateCcw, Download, ArrowDownCircle, UserPlus, Send,
} from "lucide-react"
import { authHeaders } from "@/src/lib/financeiro/http"
import { fmtBrl as brl } from "@/src/lib/financeiro/formato"
import { fmtMoeda as money } from "@/src/lib/financeiro/formato"

const dataBR = (s?: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—")
const horaBR = (s?: string | null) => (s ? new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "")
const iniciais = (n?: string | null) => (n ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"
const fmtTamanho = (b?: number | null) => { if (b == null) return null; if (b < 1024) return `${b} B`; if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`; return `${(b / (1024 * 1024)).toFixed(1)} MB` }

const statusTom = (s?: string | null) => { const S = (s ?? "").toUpperCase(); if (S.includes("QUITAD") || S === "PAGA") return "var(--success)"; if (S.includes("VENCID")) return "var(--danger)"; if (S.includes("PARCIAL")) return "var(--info)"; if (S === "CANCELADA") return null; return "var(--accent-primary)" }
const statusCls = (s?: string | null) => { const t = statusTom(s); return t ? `text-[${t}]` : "text-[var(--text-muted)]" }
const statusBg = (s?: string | null): React.CSSProperties => { const t = statusTom(s); return t ? { background: `color-mix(in srgb, ${t} 15%, transparent)` } : { background: "var(--surface-hover)" } }
const parcelaLabel = (s?: string | null) => (s === "A_VENCER" ? "A VENCER" : (s ?? "—"))

interface Conta {
  obrigacaoId: number; pessoaId: number | null; nome: string; papel: string
  resumo: { valorContratadoBrl: number; recebidoBrl: number; saldoBrl: number; aVencerBrl: number; vencidoBrl: number; statusAging: string; cotacao: number | null; moeda: string; valorBase: number }
  parcelas: any[]; cobrancas: any[]; pagamentos: any[]; documentos: any[]; observacoes: string | null; historico: any[]
}
interface EventoTimeline { id: string; escopo: string; data: string; tipo: string; titulo: string; descricao: string; fonte: string; obrigacaoId: number | null; ator: string | null }

type Aba = "resumo" | "parcelas" | "cobrancas" | "pagamentos" | "timeline" | "documentos" | "observacoes" | "historico"

export default function ParticipanteContaView({ obrigacaoId, nome, onClose, onRecarregar }: {
  obrigacaoId: number; nome: string; onClose: () => void; onRecarregar?: () => void
}) {
  const [conta, setConta] = useState<Conta | null>(null)
  const [timeline, setTimeline] = useState<EventoTimeline[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>("resumo")
  const [pagarOpen, setPagarOpen] = useState(false)
  const [estornoAlvo, setEstornoAlvo] = useState<any>(null)

  const carregar = useCallback(() => {
    fetch(`/api/financeiro/v3/participante/${obrigacaoId}/conta`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok && j.disponivel && j.conta) { setConta(j.conta); setErro(null) } else setErro("Conta do participante indisponível.") })
      .catch(() => setErro("Falha ao carregar a conta."))
    fetch(`/api/financeiro/v3/participante/${obrigacaoId}/timeline`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok && j.disponivel && Array.isArray(j.eventos)) setTimeline(j.eventos) })
      .catch(() => {})
  }, [obrigacaoId])

  const recarregarTudo = useCallback(() => { carregar(); onRecarregar?.() }, [carregar, onRecarregar])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    const orig = document.body.style.overflow; document.body.style.overflow = "hidden"
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onEsc)
    return () => { document.body.style.overflow = orig; document.removeEventListener("keydown", onEsc) }
  }, [onClose])

  if (typeof document === "undefined") return null

  const r = conta?.resumo
  const moeda = r?.moeda ?? "BRL"
  const parcelas = conta?.parcelas ?? []
  const cobrancas = conta?.cobrancas ?? []
  const pagamentos = conta?.pagamentos ?? []
  const documentos = conta?.documentos ?? []
  const historico = conta?.historico ?? []

  const abas: [Aba, string, any, number][] = [
    ["resumo", "Resumo", Receipt, 0],
    ["parcelas", "Parcelas", CreditCard, parcelas.length],
    ["cobrancas", "Cobranças", Send, cobrancas.length],
    ["pagamentos", "Pagamentos", Wallet, pagamentos.length],
    ["timeline", "Timeline", Clock, timeline.length],
    ["documentos", "Documentos", FileCheck, documentos.length],
    ["observacoes", "Observações", StickyNote, 0],
    ["historico", "Histórico", Clock, historico.length],
  ]

  return createPortal(
    <>
      <div className="fixed inset-0 flex justify-end bg-[var(--app-overlay)]" style={{ zIndex: LAYER.aboveProcessDrawer }} onClick={onClose}>
        <div className="flex h-full w-full max-w-[760px] flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--shadow-surface)]" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)]">{iniciais(conta?.nome ?? nome)}</span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{conta?.nome ?? nome}</h3>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>{conta?.papel ?? "Participante"}</span>
                  {r && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusCls(r.statusAging)}`} style={statusBg(r.statusAging)}>{r.statusAging}</span>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
          </div>

          {/* Ações no contexto do participante */}
          <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-5 py-3">
            <button onClick={() => setPagarOpen(true)} disabled={!conta} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> Registrar pagamento</button>
            <button onClick={() => setAba("pagamentos")} disabled={!pagamentos.length} title={pagamentos.length ? "Estornar um pagamento na aba Pagamentos" : "Sem pagamentos para estornar"} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-primary)] px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-4 w-4" /> Estornar</button>
          </div>

          {/* Abas */}
          <div className="flex items-center gap-5 overflow-x-auto border-b border-[var(--border-default)] px-5">
            {abas.map(([id, label, Icon, badge]) => (
              <button key={id} onClick={() => setAba(id)} className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2.5 pt-2 text-sm ${aba === id ? "border-[var(--accent-primary)] font-medium text-[var(--accent-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>
                <Icon className="h-4 w-4" /> {label}{badge ? <span className="ml-0.5 rounded-full bg-[var(--surface-hover)] px-1.5 text-[10px] text-[var(--text-secondary)]">{badge}</span> : null}
              </button>
            ))}
          </div>

          {/* Corpo */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {erro ? (
              <div className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm text-[var(--danger)]" style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{erro}</div>
            ) : !conta ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> carregando…</div>
            ) : (
              <>
                {/* RESUMO */}
                {aba === "resumo" && r && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <ResumoCard rotulo="Contratado" valor={brl(r.valorContratadoBrl)} />
                      <ResumoCard rotulo="Recebido" valor={brl(r.recebidoBrl)} cor="text-[var(--success)]" />
                      <ResumoCard rotulo="Saldo" valor={brl(r.saldoBrl)} cor="text-[var(--info)]" />
                      <ResumoCard rotulo="A vencer" valor={brl(r.aVencerBrl)} cor="text-[var(--accent-primary)]" />
                      <ResumoCard rotulo="Vencido" valor={brl(r.vencidoBrl)} cor="text-[var(--danger)]" />
                      <ResumoCard rotulo="Aging" valor={r.statusAging} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[var(--radius-sm)] bg-[var(--surface-secondary)] px-4 py-3 text-sm">
                      <div><span className="text-[var(--text-muted)]">Valor-base:</span> <span className="font-medium text-[var(--text-primary)]">{money(r.valorBase, moeda)}</span></div>
                      <div><span className="text-[var(--text-muted)]">Câmbio:</span> <span className="font-medium text-[var(--text-primary)]">{r.cotacao != null ? brl(r.cotacao) : "—"}</span></div>
                      <div><span className="text-[var(--text-muted)]">Moeda:</span> <span className="font-medium text-[var(--text-primary)]">{moeda}</span></div>
                    </div>
                  </div>
                )}

                {/* PARCELAS */}
                {aba === "parcelas" && (
                  parcelas.length === 0 ? <Vazio texto="Sem parcelas para este participante." /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                          <th className="pb-2 font-medium">Parcela</th><th className="pb-2 font-medium">Vencimento</th><th className="pb-2 font-medium">Valor</th><th className="pb-2 font-medium">Recebido</th><th className="pb-2 font-medium">Restante</th><th className="pb-2 font-medium">Status</th>
                        </tr></thead>
                        <tbody>{parcelas.map((p: any, i: number) => (
                          <tr key={p.id ?? i} className="border-b border-[var(--border-default)]">
                            <td className="whitespace-nowrap py-2.5 font-medium text-[var(--text-primary)]">{p.numero}/{p.totalParcelas}</td>
                            <td className="whitespace-nowrap py-2.5 text-[var(--text-secondary)]">{dataBR(p.vencimento)}{p.status === "VENCIDA" && p.diasAtraso ? <div className="text-xs text-[var(--danger)]">{p.diasAtraso} dias de atraso</div> : null}</td>
                            <td className="whitespace-nowrap py-2.5 text-[var(--text-primary)]">{brl(p.valorBrl)}</td>
                            <td className={`whitespace-nowrap py-2.5 ${p.recebidoBrl > 0 ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>{brl(p.recebidoBrl)}</td>
                            <td className="whitespace-nowrap py-2.5 text-[var(--info)]">{brl(p.saldoBrl)}</td>
                            <td className="py-2.5"><span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(p.status)}`} style={statusBg(p.status)}>{parcelaLabel(p.status)}</span></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )
                )}

                {/* COBRANÇAS */}
                {aba === "cobrancas" && (
                  cobrancas.length === 0 ? <Vazio texto="Nenhuma cobrança para este participante." /> : (
                    <div className="space-y-2">{cobrancas.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--text-primary)]">{money(c.valorTotal, c.moeda ?? moeda)}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">{c.enviadaEm ? `Enviada em ${dataBR(c.enviadaEm)}` : "Não enviada"}</div>
                        </div>
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${statusCls(c.status)}`} style={statusBg(c.status)}>{c.status}</span>
                      </div>
                    ))}</div>
                  )
                )}

                {/* PAGAMENTOS */}
                {aba === "pagamentos" && (
                  pagamentos.length === 0 ? <Vazio texto="Nenhum pagamento registrado." /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                          <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Valor</th><th className="pb-2 font-medium">Forma</th><th className="pb-2 font-medium">Referência</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Ações</th>
                        </tr></thead>
                        <tbody>{pagamentos.map((p: any) => {
                          const estorno = String(p.status ?? "").toUpperCase().includes("ESTORN") || Number(p.valor) < 0
                          return (
                            <tr key={p.id} className="border-b border-[var(--border-default)]">
                              <td className="whitespace-nowrap py-2.5 text-[var(--text-secondary)]">{dataBR(p.data)}</td>
                              <td className={`whitespace-nowrap py-2.5 font-medium ${estorno ? "text-[var(--danger)]" : "text-[var(--text-primary)]"}`}>{money(p.valor, moeda)}</td>
                              <td className="py-2.5 text-[var(--text-secondary)]">{p.formaLabel ?? "—"}</td>
                              <td className="py-2.5 text-[var(--text-secondary)]">{p.referencia ?? "—"}</td>
                              <td className="py-2.5"><span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: estorno ? "var(--danger)" : "var(--success)" }} />{p.status}</span></td>
                              <td className="py-2.5">
                                {estorno ? <span className="text-xs text-[var(--text-muted)]">—</span> : (
                                  <button onClick={() => setEstornoAlvo(p)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-1.5 text-xs font-medium text-[var(--danger)] hover:border-[var(--border-strong)]"><RotateCcw className="h-3.5 w-3.5" /> Estornar</button>
                                )}
                              </td>
                            </tr>
                          )
                        })}</tbody>
                      </table>
                    </div>
                  )
                )}

                {/* TIMELINE INDIVIDUAL */}
                {aba === "timeline" && (
                  timeline.length === 0 ? <Vazio texto="Sem eventos na timeline deste participante." /> : (
                    <div>{timeline.map((ev, i) => {
                      const Icon = ev.tipo?.startsWith("PAGAMENTO") ? ArrowDownCircle : ev.tipo === "ESTORNO" ? RotateCcw : ev.tipo === "COBRANCA_ENVIADA" ? Send : ev.tipo === "VENCIMENTO" ? Clock : Receipt
                      const cor = ev.tipo?.startsWith("PAGAMENTO") ? "text-[var(--success)]" : ev.tipo === "ESTORNO" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"
                      const ultimo = i === timeline.length - 1
                      return (
                        <div key={ev.id} className="flex gap-4">
                          <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-[var(--text-muted)]">{dataBR(ev.data)}<br />{horaBR(ev.data)}</div>
                          <div className="flex flex-col items-center"><div className={`flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-hover)] ${cor}`}><Icon className="h-4 w-4" /></div>{!ultimo && <div className="w-px flex-1 bg-[var(--border-default)]" />}</div>
                          <div className={`flex-1 ${ultimo ? "" : "pb-6"}`}>
                            <div className="flex items-start justify-between gap-2"><div className="font-medium text-[var(--text-primary)]">{ev.titulo}</div>{ev.ator && <span className="shrink-0 text-xs text-[var(--info)]">{ev.ator}</span>}</div>
                            <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{ev.descricao}</div>
                          </div>
                        </div>
                      )
                    })}</div>
                  )
                )}

                {/* DOCUMENTOS */}
                {aba === "documentos" && (
                  documentos.length === 0 ? <Vazio texto="Nenhum documento vinculado." /> : (
                    <div className="space-y-2">{documentos.map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-hover)] text-[var(--text-secondary)]"><FileCheck className="h-4 w-4" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[var(--text-primary)]">{doc.nome}</div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">{[doc.tipo, fmtTamanho(doc.tamanho), `Anexado em ${dataBR(doc.criadoEm)}`].filter(Boolean).join(" · ")}</div>
                        </div>
                        <a href={doc.url} target="_blank" rel="noreferrer" download className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)]"><Download className="h-4 w-4" /> Baixar</a>
                      </div>
                    ))}</div>
                  )
                )}

                {/* OBSERVAÇÕES */}
                {aba === "observacoes" && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-4">
                    <div className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{conta.observacoes ?? "—"}</div>
                    <div className="mt-2 text-xs text-[var(--text-muted)]">Notas internas</div>
                  </div>
                )}

                {/* HISTÓRICO */}
                {aba === "historico" && (
                  historico.length === 0 ? <Vazio texto="Sem histórico registrado." /> : (
                    <div>{historico.map((h: any, i: number) => {
                      const Icon = h.tipo === "OBRIGACAO_CRIADA" ? UserPlus : (String(h.tipo).startsWith("PAGAMENTO") ? ArrowDownCircle : Receipt)
                      const ultimo = i === historico.length - 1
                      return (
                        <div key={h.id ?? i} className="flex gap-4">
                          <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-[var(--text-muted)]">{dataBR(h.data)}<br />{horaBR(h.data)}</div>
                          <div className="flex flex-col items-center"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--text-secondary)]"><Icon className="h-4 w-4" /></div>{!ultimo && <div className="w-px flex-1 bg-[var(--border-default)]" />}</div>
                          <div className={`flex-1 ${ultimo ? "" : "pb-6"}`}>
                            <div className="flex items-start justify-between gap-2"><div className="font-medium text-[var(--text-primary)]">{h.titulo}</div>{h.ator && <span className="shrink-0 text-xs text-[var(--info)]">{h.ator}</span>}</div>
                            <div className="mt-0.5 text-sm text-[var(--text-secondary)]">{h.descricao}</div>
                          </div>
                        </div>
                      )
                    })}</div>
                  )
                )}
              </>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] px-5 py-4">
            <button onClick={onClose} className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--border-strong)]">Fechar</button>
            <button onClick={() => setPagarOpen(true)} disabled={!conta} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> Registrar pagamento</button>
          </div>
        </div>
      </div>

      {pagarOpen && conta && (
        <RegistrarPagamentoModal
          obrigacaoId={conta.obrigacaoId}
          moeda={moeda}
          saldo={conta.resumo.saldoBrl}
          natureza="RECEITA"
          onClose={() => setPagarOpen(false)}
          onDone={() => { setPagarOpen(false); recarregarTudo() }}
        />
      )}
      {estornoAlvo && conta && (
        <EstornoModal
          obrigacaoId={conta.obrigacaoId}
          moeda={moeda}
          pagamento={{ id: estornoAlvo.id, valor: Math.abs(Number(estornoAlvo.valor) || 0), data: estornoAlvo.data, formaLabel: estornoAlvo.formaLabel, referencia: estornoAlvo.referencia }}
          onClose={() => setEstornoAlvo(null)}
          onDone={() => { setEstornoAlvo(null); recarregarTudo() }}
        />
      )}
    </>,
    document.body,
  )
}

function ResumoCard({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3">
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{rotulo}</div>
      <div className={`mt-1 text-base font-semibold ${cor ?? "text-[var(--text-primary)]"}`}>{valor}</div>
    </div>
  )
}
function Vazio({ texto }: { texto: string }) {
  return <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">{texto}</div>
}
