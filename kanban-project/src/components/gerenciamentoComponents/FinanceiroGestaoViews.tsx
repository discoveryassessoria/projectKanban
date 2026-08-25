"use client"

// src/components/gerenciamentoComponents/FinanceiroGestaoViews.tsx
//
// Duas consultas de GESTÃO financeira (somente leitura) sobre
// /api/gerenciamento/financeiro-gestao. A operação continua no Financeiro Geral —
// aqui é a visão consolidada de quem administra:
//   CreditoTab              → Financeiro › Crédito
//   DocumentosFinanceirosTab→ Financeiro › Documentos Financeiros

import { useCallback, useEffect, useState } from "react"
import { useApi } from "@/src/lib/dados"

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const CARD = "rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur-sm"
const TH = "px-4 py-3 font-medium"
const dinheiro = (v: number, moeda = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(Number(v) || 0)
const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR")

// Uma consulta por visão, com a visão na CHAVE: trocar de visão troca de cache em
// vez de sobrescrever o mesmo estado, e voltar para uma visão já aberta é instantâneo.
function useGestao<T>(visao: string) {
  const consulta = useApi<T>(`/api/gerenciamento/financeiro-gestao?visao=${visao}`)
  return {
    dados: consulta.dados ?? null,
    loading: consulta.carregando,
    erro: consulta.erro ? consulta.erro.message : null,
    load: consulta.recarregar,
  }
}

function Kpi({ valor, label }: { valor: string | number; label: string }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xl font-bold text-white">{valor}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</div>
    </div>
  )
}

function Cabecalho({ titulo, descricao, onReload }: { titulo: string; descricao: string; onReload: () => void }) {
  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{titulo}</h2>
          <p className="mt-1 max-w-3xl text-sm text-white/60">{descricao}</p>
        </div>
        <button onClick={onReload} className="flex-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-white/80 hover:bg-[var(--surface-hover)]">
          Atualizar
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════ CRÉDITO ═══════════════════════════════════════
interface LinhaCredito {
  id: number; pessoa: string | null; obrigacaoId: number | null; moeda: string
  destino: string; status: string; original: number; disponivel: number
  utilizado: number; revogado: number; devolvido: number; criadoEm: string
}
interface DadosCredito {
  totais: { registros: number; original: number; disponivel: number; utilizado: number; revogado: number; devolvido: number; abertos: number }
  creditos: LinhaCredito[]
}

export function CreditoTab() {
  const { dados, loading, erro, load } = useGestao<DadosCredito>("credito")
  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>
  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { void load() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}
      <Cabecalho
        titulo="Crédito"
        descricao="Posição consolidada dos créditos financeiros: quanto foi gerado, quanto ainda está disponível, quanto foi usado, revogado ou devolvido. A movimentação de crédito é feita no Financeiro Geral."
        onReload={load}
      />
      {dados && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi valor={dados.totais.registros} label="Créditos" />
            <Kpi valor={dados.totais.abertos} label="Em aberto" />
            <Kpi valor={dinheiro(dados.totais.original)} label="Gerado" />
            <Kpi valor={dinheiro(dados.totais.disponivel)} label="Disponível" />
            <Kpi valor={dinheiro(dados.totais.utilizado)} label="Utilizado" />
            <Kpi valor={dinheiro(dados.totais.revogado + dados.totais.devolvido)} label="Revogado/devolvido" />
          </div>
          <div className={`overflow-x-auto ${CARD}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border-default)] text-left text-xs text-white/50">
                <tr>
                  <th className={TH}>Criado</th><th className={TH}>Pessoa</th><th className={TH}>Destino</th>
                  <th className={TH}>Gerado</th><th className={TH}>Disponível</th><th className={TH}>Utilizado</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {dados.creditos.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-white/40">Nenhum crédito registrado.</td></tr>
                ) : dados.creditos.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{data(c.criadoEm)}</td>
                    <td className="px-4 py-2.5 text-white">{c.pessoa ?? "—"}</td>
                    <td className="px-4 py-2.5 text-white/60">{c.destino}</td>
                    <td className="px-4 py-2.5 text-white/70">{dinheiro(c.original, c.moeda)}</td>
                    <td className="px-4 py-2.5 text-white">{dinheiro(c.disponivel, c.moeda)}</td>
                    <td className="px-4 py-2.5 text-white/70">{dinheiro(c.utilizado, c.moeda)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${c.status === "ABERTO" ? "bg-green-500/15 text-green-300" : "bg-[var(--surface-primary)] text-white/50"}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════ DOCUMENTOS FINANCEIROS ═══════════════════════════════
interface Recibo { id: number; numero: string; data: string; valorTotal: number; descricao: string; pagadorNome: string | null; processoId: number; pdfUrl: string | null }
interface FaturaL { id: number; descricao: string; valor: number; moeda: string; status: string; dataEmissao: string; dataVencimento: string | null; processoId: number; parcelas: number }
interface DadosDocs {
  totais: { recibos: number; faturas: number }
  porStatus: { status: string; quantidade: number; valor: number }[]
  recibos: Recibo[]
  faturas: FaturaL[]
  contadores: { processoId: number; proximoNumero: number; atualizadoEm: string }[]
}

export function DocumentosFinanceirosTab() {
  const { dados, loading, erro, load } = useGestao<DadosDocs>("documentos")
  const [aba, setAba] = useState<"recibos" | "faturas">("recibos")
  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>
  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { void load() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}
      <Cabecalho
        titulo="Documentos Financeiros"
        descricao="Recibos e faturas emitidos pelo sistema, com a numeração em uso. A emissão continua no processo (Financeiro Geral) — aqui é a conferência consolidada."
        onReload={load}
      />
      {dados && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi valor={dados.totais.recibos} label="Recibos emitidos" />
            <Kpi valor={dados.totais.faturas} label="Faturas emitidas" />
            <Kpi valor={dados.contadores.length} label="Numerações ativas" />
            <Kpi valor={dinheiro(dados.porStatus.reduce((s, x) => s + x.valor, 0))} label="Total faturado" />
          </div>

          {dados.porStatus.length > 0 && (
            <div className={`${CARD} p-5`}>
              <div className="mb-3 text-[11px] uppercase tracking-wide text-white/45">Faturas por situação</div>
              <div className="flex flex-wrap gap-2">
                {dados.porStatus.map((s) => (
                  <span key={s.status} className="rounded-lg border border-[var(--border-default)] bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/75">
                    {s.status}: <span className="text-white">{s.quantidade}</span> · {dinheiro(s.valor)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1 border-b border-[var(--border-default)]">
            {(["recibos", "faturas"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded-t-lg px-3 py-2 text-sm transition ${aba === a ? "bg-[var(--surface-primary)] font-medium text-white" : "text-white/50 hover:text-white/80"}`}>
                {a === "recibos" ? "Recibos" : "Faturas"}
              </button>
            ))}
          </div>

          <div className={`overflow-x-auto ${CARD}`}>
            {aba === "recibos" ? (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--border-default)] text-left text-xs text-white/50">
                  <tr><th className={TH}>Número</th><th className={TH}>Data</th><th className={TH}>Pagador</th><th className={TH}>Descrição</th><th className={TH}>Valor</th><th className={TH}>Processo</th><th className={TH}>PDF</th></tr>
                </thead>
                <tbody>
                  {dados.recibos.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-white/40">Nenhum recibo emitido.</td></tr>
                  ) : dados.recibos.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-4 py-2.5 text-white">{r.numero}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{data(r.data)}</td>
                      <td className="px-4 py-2.5 text-white/70">{r.pagadorNome ?? "—"}</td>
                      <td className="px-4 py-2.5 text-white/60">{r.descricao}</td>
                      <td className="px-4 py-2.5 text-white/80">{dinheiro(r.valorTotal)}</td>
                      <td className="px-4 py-2.5 text-white/60">#{r.processoId}</td>
                      <td className="px-4 py-2.5">
                        {r.pdfUrl
                          ? <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="text-sky-300 underline hover:text-sky-200">abrir</a>
                          : <span className="text-white/30">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--border-default)] text-left text-xs text-white/50">
                  <tr><th className={TH}>Emissão</th><th className={TH}>Descrição</th><th className={TH}>Valor</th><th className={TH}>Parcelas</th><th className={TH}>Vencimento</th><th className={TH}>Situação</th><th className={TH}>Processo</th></tr>
                </thead>
                <tbody>
                  {dados.faturas.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-white/40">Nenhuma fatura emitida.</td></tr>
                  ) : dados.faturas.map((f) => (
                    <tr key={f.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{data(f.dataEmissao)}</td>
                      <td className="px-4 py-2.5 text-white">{f.descricao}</td>
                      <td className="px-4 py-2.5 text-white/80">{dinheiro(f.valor, f.moeda)}</td>
                      <td className="px-4 py-2.5 text-white/60">{f.parcelas}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{f.dataVencimento ? data(f.dataVencimento) : "—"}</td>
                      <td className="px-4 py-2.5"><span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[10px] text-white/70">{f.status}</span></td>
                      <td className="px-4 py-2.5 text-white/60">#{f.processoId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
