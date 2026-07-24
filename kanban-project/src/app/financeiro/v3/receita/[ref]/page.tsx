// src/app/financeiro/v3/receita/[ref]/page.tsx
// ============================================================================
// TELA OFICIAL — RECEITA (Financeiro V3). Reprodução fiel da especificação visual.
// Dados EXCLUSIVAMENTE do Motor V3 (Ledger/projeções) via /api/financeiro/v3/receita.
// ============================================================================
"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, ExternalLink, MoreVertical, Copy, FileText, Bell, ChevronDown, ChevronUp,
  Receipt, CreditCard, Wallet, FileCheck, Clock, Search, SlidersHorizontal, Calendar,
  Plus, Pencil, ChevronLeft, ChevronRight, UserPlus, ArrowDownCircle,
} from "lucide-react"

const fmt = (v: number, m = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: m }).format(v || 0)
const dataBR = (s?: string | null) => s ? new Date(s).toLocaleDateString("pt-BR") : "—"
const authHeaders = (): Record<string, string> => { const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null; return t ? { Authorization: `Bearer ${t}` } : {} }

export default function ReceitaV3Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params)
  const router = useRouter()
  const [d, setD] = useState<any>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tab, setTab] = useState("pagamentos")

  useEffect(() => {
    fetch(`/api/financeiro/v3/receita/${encodeURIComponent(ref)}`, { headers: authHeaders() })
      .then(async (r) => { const j = await r.json(); if (r.ok && j.disponivel) setD(j.receita); else setErro(j.fallbackLegado ? "Financeiro V3 indisponível." : "Receita não encontrada.") })
      .catch(() => setErro("Falha ao carregar."))
  }, [ref])

  if (erro) return <div className="min-h-screen bg-black/20 p-8 text-sm text-white/55">{erro}</div>
  if (!d) return <div className="min-h-screen bg-black/20 p-8 text-sm text-white/40">carregando…</div>

  return (
    <div className="min-h-screen bg-black/20 text-white/80">
      <div className="mx-auto max-w-[1400px] px-8 py-6">
        {/* ── Top bar ── */}
        <div className="flex items-start justify-between">
          <div>
            <button onClick={() => router.back()} className="mb-3 flex items-center gap-2 text-sm text-white/55 hover:text-white/80"><ArrowLeft className="h-4 w-4" /> Voltar para Receitas</button>
            <div className="flex items-center gap-3">
              <h1 className="text-[28px] font-bold leading-none text-white">Receita</h1>
              <span className="rounded-md bg-[#d2a948]/15 px-2.5 py-1 text-xs font-semibold tracking-wide text-[#d2a948]">{d.statusLabel}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[13px] text-white/40">
              <Receipt className="h-3.5 w-3.5" /> Financeiro <span className="text-white/30">›</span> Receitas <span className="text-white/30">›</span>
              <span className="text-white/55">{d.descricao ?? d.codigo}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-4">
            <div className="flex items-center gap-4">
              <div className="relative"><Bell className="h-5 w-5 text-white/55" /><span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#7dd3fc] text-[10px] font-bold text-white">3</span></div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">U</div>
                <div className="leading-tight"><div className="text-sm font-medium text-white/80">Usuário</div><div className="text-xs text-white/40">Administrador</div></div>
                <ChevronDown className="h-4 w-4 text-white/40" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a href={`/financeiro/v3/processo-preview?processoId=${d.processo.id ?? ""}`} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm text-white/80 hover:border-white/25">Ver movimentações <ExternalLink className="h-3.5 w-3.5" /></a>
              <button className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm text-white/80 hover:border-white/25">Mais ações <MoreVertical className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>

        {/* ── Info card ── */}
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-6">
            <Info rotulo="Receita"><span className="inline-flex items-center gap-1.5 font-medium text-white/95">{d.codigo}<Copy className="h-3.5 w-3.5 text-white/40" /></span></Info>
            <Info rotulo="Descrição"><span className="text-white/80">{d.descricao ?? "—"}</span></Info>
            <Info rotulo="Processo"><div className="text-white/80">{d.processo.codigo ?? "—"}{d.processo.nome ? ` – ${d.processo.nome}` : ""}</div>{d.processo.id && <a href={`/financeiro/v3/processo-preview?processoId=${d.processo.id}`} className="inline-flex items-center gap-1 text-xs text-[#7dd3fc] hover:underline">Abrir processo <ExternalLink className="h-3 w-3" /></a>}</Info>
            <Info rotulo="Responsável">{d.responsavel ? <span className="inline-flex items-center gap-2 text-white/80">{d.responsavel.nome}<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300">{d.responsavel.papel}</span></span> : "—"}</Info>
            <Info rotulo="Serviço"><span className="text-white/80">{d.servico ?? "—"}</span></Info>
            <Info rotulo="Forma de cobrança"><span className="text-white/80">{d.formaCobranca ?? "—"}</span></Info>
          </div>
          <div className="my-4 border-t border-white/10" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-6">
            <Info rotulo="Valor contratado"><span className="text-lg font-semibold text-white/95">{fmt(d.valorContratado, d.moeda)}</span></Info>
            <Info rotulo="Recebido"><span className="text-lg font-semibold text-[#4ade80]">{fmt(d.recebido, d.moeda)}</span></Info>
            <Info rotulo="Saldo"><span className="text-lg font-semibold text-[#7dd3fc]">{fmt(d.saldo, d.moeda)}</span></Info>
            <Info rotulo="Vencimento"><span className="text-white/80">{dataBR(d.vencimento)}</span></Info>
            <Info rotulo="Status"><span className="inline-block rounded bg-[#d2a948]/15 px-2 py-0.5 text-xs font-semibold text-[#d2a948]">{d.statusLabel}</span></Info>
            <Info rotulo="Criado em"><span className="text-white/70">{dataBR(d.criadoEm)} às {d.criadoEm ? new Date(d.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}</span><span className="text-xs text-white/40">por {d.criadoPor}</span></Info>
          </div>
        </div>

        {/* ── Abas ── */}
        <div className="mt-5 flex items-center gap-7 border-b border-white/10">
          {[["resumo", "Resumo", Receipt, 0], ["cobrancas", "Cobranças", CreditCard, 1], ["pagamentos", "Pagamentos", Wallet, 0], ["documentos", "Documentos", FileCheck, 1], ["timeline", "Timeline", Clock, 0]].map(([id, label, Icon, badge]: any) => (
            <button key={id} onClick={() => setTab(id)} className={`-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-sm ${tab === id ? "border-[#d2a948] font-medium text-[#d2a948]" : "border-transparent text-white/55 hover:text-white/80"}`}>
              <Icon className="h-4 w-4" /> {label}{badge ? <span className="ml-1 rounded-full bg-white/[0.06] px-1.5 text-[11px] text-white/70">{badge}</span> : null}
            </button>
          ))}
        </div>

        {/* ── Conteúdo (main + right) ── */}
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {/* Pagamentos */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-white">Pagamentos</h2><span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-white/70">{d.pagamentos.length}</span></div>
                <button className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-500"><Plus className="h-4 w-4" /> Registrar pagamento</button>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /><input placeholder="Buscar pagamentos..." className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-white/30" /></div>
                <button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70"><SlidersHorizontal className="h-4 w-4" /> Filtros</button>
                <button className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70"><Calendar className="h-4 w-4" /> Período <ChevronDown className="h-3.5 w-3.5" /></button>
              </div>
              <table className="mt-4 w-full text-sm">
                <thead><tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="pb-2 font-medium">Data</th><th className="pb-2 font-medium">Valor</th><th className="pb-2 font-medium">Forma</th><th className="pb-2 font-medium">Conta recebida</th><th className="pb-2 font-medium">Referência</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Ações</th>
                </tr></thead>
                <tbody>{d.pagamentos.map((p: any) => (
                  <tr key={p.id} className="border-b border-white/10">
                    <td className="py-3.5 text-white/70">{dataBR(p.data)}</td>
                    <td className="font-medium text-white/95">{fmt(p.valor, d.moeda)}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-white/70"><span className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.06] text-[10px]">{(p.formaLabel ?? "?").slice(0, 1)}</span>{p.formaLabel ?? "—"}</span></td>
                    <td><div className="text-white/70">{p.banco ?? "—"}</div>{(p.agencia || p.conta) && <div className="text-xs text-white/40">Ag: {p.agencia ?? "—"} Cc: {p.conta ?? "—"}</div>}</td>
                    <td className="text-white/55">{p.referencia ?? "—"}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-[#4ade80]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{p.status}</span></td>
                    <td><div className="flex items-center gap-2 text-white/40"><Pencil className="h-4 w-4 hover:text-white/70" /><FileText className="h-4 w-4 hover:text-white/70" /><MoreVertical className="h-4 w-4 hover:text-white/70" /></div></td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="mt-4 flex items-center justify-between text-sm text-white/40">
                <span>Mostrando {d.pagamentos.length} de {d.pagamentos.length} pagamentos</span>
                <div className="flex items-center gap-1"><button className="rounded border border-white/10 p-1.5 text-white/40"><ChevronLeft className="h-4 w-4" /></button><span className="rounded border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs text-white/80">1</span><button className="rounded border border-white/10 p-1.5 text-white/40"><ChevronRight className="h-4 w-4" /></button></div>
              </div>
            </div>

            {/* Histórico de movimentações */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Histórico de movimentações</h2>
                <button className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70">Ver timeline completa <ExternalLink className="h-3 w-3" /></button>
              </div>
              <div className="mt-4">{d.historico.map((h: any, i: number) => {
                const Icon = h.tipo === "OBRIGACAO_CRIADA" ? UserPlus : (h.tipo.startsWith("PAGAMENTO") ? ArrowDownCircle : Receipt)
                const cor = h.tipo === "OBRIGACAO_CRIADA" ? "text-violet-400" : (h.tipo.startsWith("PAGAMENTO") ? "text-[#4ade80]" : "text-white/55")
                const ultimo = i === d.historico.length - 1
                return (
                  <div key={h.id} className="flex gap-4">
                    <div className="w-16 shrink-0 pt-0.5 text-right text-[11px] leading-tight text-white/40">{dataBR(h.data)}<br />{new Date(h.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="flex flex-col items-center"><div className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] ${cor}`}><Icon className="h-4 w-4" /></div>{!ultimo && <div className="w-px flex-1 bg-white/[0.06]" />}</div>
                    <div className={`flex-1 ${ultimo ? "" : "pb-6"}`}>
                      <div className="flex items-start justify-between"><div className="font-medium text-white/95">{h.titulo}</div><span className="text-xs text-[#7dd3fc]">{h.ator}</span></div>
                      <div className="mt-0.5 text-sm text-white/55">{h.descricao}</div>
                    </div>
                  </div>
                )
              })}</div>
            </div>
          </div>

          {/* ── Painel direito ── */}
          <div className="space-y-4">
            <Painel titulo="Resumo financeiro" aberto>
              <Linha k="Valor contratado" v={fmt(d.resumo.contratado, d.moeda)} />
              <Linha k="Total recebido" v={fmt(d.resumo.recebido, d.moeda)} cor="text-[#4ade80]" />
              <Linha k="Saldo" v={fmt(d.resumo.saldo, d.moeda)} cor="text-[#7dd3fc]" />
              <Linha k="Descontos" v={fmt(d.resumo.descontos, d.moeda)} />
              <Linha k="Ajustes" v={fmt(d.resumo.ajustes, d.moeda)} />
              <div className="my-2 border-t border-white/10" />
              <div className="flex items-center justify-between"><span className="text-sm text-white/70">Valor líquido</span><span className="text-lg font-semibold text-white">{fmt(d.resumo.liquido, d.moeda)}</span></div>
            </Painel>
            <Painel titulo="Distribuição econômica" aberto>
              {d.distribuicao.map((x: any, i: number) => (
                <div key={i} className="py-1.5"><div className="flex items-center justify-between"><span className="text-sm text-white/80">{x.nome}</span><span className="text-sm text-white/70">{x.percentual.toFixed(2)}%</span></div><div className="text-right text-xs text-white/40">{fmt(x.valor, d.moeda)}</div></div>
              ))}
              <div className="my-2 border-t border-white/10" />
              <div className="flex items-center justify-between"><span className="text-sm text-white/70">Total</span><span className="text-sm text-white/70">{Math.round(d.distribuicaoTotal.percentual)}%</span></div>
              <div className="text-right text-base font-semibold text-white">{fmt(d.distribuicaoTotal.valor, d.moeda)}</div>
            </Painel>
            <Painel titulo={`Responsáveis (${d.responsaveis.length})`} />
            <Painel titulo={`Pagadores (${d.pagadores.length})`} />
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4"><div className="text-sm font-medium text-white/70">Observação</div><div className="mt-1 text-sm text-white/40">{d.observacao ?? "—"}</div></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div className="py-1"><div className="mb-1 text-xs text-white/40">{rotulo}</div><div className="text-sm">{children}</div></div>
}
function Linha({ k, v, cor }: { k: string; v: string; cor?: string }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-white/55">{k}</span><span className={cor ?? "text-white/80"}>{v}</span></div>
}
function Painel({ titulo, children, aberto }: { titulo: string; children?: React.ReactNode; aberto?: boolean }) {
  const [open, setOpen] = useState(!!aberto)
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between"><span className="text-sm font-semibold text-white/80">{titulo}</span>{open ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}</button>
      {open && children && <div className="mt-3">{children}</div>}
    </div>
  )
}
