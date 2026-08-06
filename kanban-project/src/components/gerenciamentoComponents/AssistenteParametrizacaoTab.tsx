// src/components/gerenciamentoComponents/AssistenteParametrizacaoTab.tsx
// ============================================================================
// ASSISTENTE DE PARAMETRIZAÇÃO — orquestra, não substitui.
//
// Cada etapa que edita cadastro EMBUTE a tela oficial correspondente. Não é um
// link que leva embora nem um formulário paralelo: é o mesmo componente que o
// Gerenciamento renderiza, falando com os mesmos endpoints. Reimplementar os
// formulários aqui criaria duas regras de validação para o mesmo cadastro, e
// elas divergiriam no primeiro campo novo.
//
// O que este arquivo tem de próprio é a CONDUÇÃO: qual etapa vem depois, o que
// falta em cada uma, o que impede publicar. Tudo isso vem do servidor — a tela
// não calcula status nem decide se pode publicar.
// ============================================================================
"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { useApi } from "@/src/lib/dados"
import { authHeaders } from "@/src/lib/financeiro/http"
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, Loader2, PlayCircle, RefreshCw, Rocket } from "lucide-react"

// As telas oficiais, carregadas sob demanda. São as MESMAS do Gerenciamento.
const RegrasDocumentaisTab = dynamic(() => import("./RegrasDocumentaisTab"), { ssr: false })
const AplicabilidadeEconomicaTab = dynamic(() => import("./AplicabilidadeEconomicaTab"), { ssr: false })
const TabelaValoresTab = dynamic(() => import("./TabelaValoresTab"), { ssr: false })
const FornecedoresTab = dynamic(() => import("./FornecedoresTab"), { ssr: false })
const ProdutosServicosTab = dynamic(() => import("./ProdutosServicosTab"), { ssr: false })
const MoedasTab = dynamic(() => import("./MoedasTab"), { ssr: false })

type StatusEtapa = "NAO_INICIADA" | "EM_PREENCHIMENTO" | "PENDENTE" | "COMPLETA" | "PUBLICAVEL" | "PUBLICADA" | "BLOQUEADA"
interface Pendencia { tipo: string; mensagem: string; onde: string; bloqueia: boolean; phaseKey: string | null }
interface Etapa {
  etapa: string; titulo: string; status: StatusEtapa
  completos: number; pendentes: number; acao: string | null; telaKey: string | null; pendencias: Pendencia[]
}
interface Estado {
  escopo: { tipoProcessoId: number; tipoProcessoNome: string; pais: string; phaseKey: string | null; fases: { phaseKey: string; label: string; ordem: number; obrigatoria: boolean }[] }
  etapas: Etapa[]
  progresso: { etapaAtual: string; etapasConcluidas: string[]; publicadoEm: string | null } | null
  publicavel: boolean
}
interface TipoProcesso { id: number; name: string; countryLabel: string }

const COR: Record<StatusEtapa, string> = {
  NAO_INICIADA: "var(--text-muted)", EM_PREENCHIMENTO: "var(--info)", PENDENTE: "var(--warning)",
  COMPLETA: "var(--success)", PUBLICAVEL: "var(--info)", PUBLICADA: "var(--success)", BLOQUEADA: "var(--danger)",
}
const ROTULO: Record<StatusEtapa, string> = {
  NAO_INICIADA: "não iniciada", EM_PREENCHIMENTO: "em preenchimento", PENDENTE: "pendente",
  COMPLETA: "completa", PUBLICAVEL: "publicável", PUBLICADA: "publicada", BLOQUEADA: "bloqueada",
}

/** A tela oficial de cada etapa. Chave estrutural → componente, sem duplicar nada. */
function TelaDaEtapa({ etapa }: { etapa: string }) {
  switch (etapa) {
    case "matriz": return <RegrasDocumentaisTab />
    case "servicos": return <ProdutosServicosTab />
    case "fornecedores": return <FornecedoresTab />
    case "aplicabilidade": case "politicas": return <AplicabilidadeEconomicaTab />
    case "custos": case "receitas": return <TabelaValoresTab />
    case "moedas": return <MoedasTab />
    default: return null
  }
}

/** Resumo administrativo do que a conclusão fez. Números, não adjetivos. */
function RelatorioFinal({ r }: { r: any }) {
  const bloco = (titulo: string, itens: [string, number | string][]) => (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{titulo}</p>
      {itens.map(([k, v]) => (
        <div key={k} className="flex justify-between text-sm"><span className="text-[var(--text-secondary)]">{k}</span><span className="tabular-nums text-[var(--text-primary)]">{v}</span></div>
      ))}
    </div>
  )
  const s = r.resumo
  return (
    <div className="mt-5 border-t border-[var(--border-default)] pt-4">
      <p className="mb-3 text-sm font-semibold" style={{ color: r.concluiu ? "var(--success)" : "var(--warning)" }}>
        {r.concluiu ? "Parametrização concluída" : "Concluída com etapa(s) em erro"} · {r.duracaoMs}ms
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {bloco("Documentos", [["criados", s.documentos.criados], ["atualizados", s.documentos.atualizados], ["ignorados", s.documentos.ignorados], ["com erro", s.documentos.erros]])}
        {bloco("Workflows", [["criados", s.workflows.criados], ["reutilizados", s.workflows.reutilizados], ["ignorados", s.workflows.ignorados]])}
        {bloco("Tarefas", [["criadas", s.tasks.criadas], ["reutilizadas", s.tasks.reutilizadas]])}
        {bloco("Financeiro", [["custos", s.financeiro.custosGerados], ["receitas", s.financeiro.receitasGeradas]])}
        {bloco("Planilha", [["linhas", s.planilha.linhas], ["colunas de serviço", s.planilha.colunas], ["total BRL", s.planilha.totalBrl]])}
        {bloco("Reconciliação", [["encontradas", s.reconciliacao.encontradas], ["corrigidas", s.reconciliacao.corrigidas], ["restantes", s.reconciliacao.restantes]])}
        {bloco("Parametrização", [["matrizes publicadas", s.parametrizacao.matrizesPublicadas], ["componentes ativos", s.parametrizacao.componentesAtivos]])}
      </div>
      {r.pendencias?.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-semibold text-[var(--text-primary)]">Pendências restantes</p>
          <ul className="space-y-1">
            {r.pendencias.map((p: any, i: number) => (
              <li key={i} className="text-sm">
                <span style={{ color: p.bloqueia ? "var(--danger)" : "var(--warning)" }}>{p.bloqueia ? "⛔" : "⚠"}</span>{" "}
                <span className="text-[var(--text-primary)]">{p.mensagem}</span>
                <span className="block pl-5 text-[11px] text-[var(--text-muted)]">
                  {p.phaseKey ? `fase ${p.phaseKey} · ` : ""}ação: preencher em {p.onde}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function AssistenteParametrizacaoTab() {
  const tiposReq = useApi<{ tipos?: TipoProcesso[] } | TipoProcesso[]>("/api/gerenciamento/tipos-processo")
  const tipos: TipoProcesso[] = Array.isArray(tiposReq.dados) ? tiposReq.dados : (tiposReq.dados?.tipos ?? [])
  const [tipoId, setTipoId] = useState<number | null>(null)
  const [phaseKey, setPhaseKey] = useState<string>("")
  // A etapa em vigor é DERIVADA: o que o usuário escolheu nesta sessão vence; sem
  // escolha, vale a etapa salva no progresso; sem progresso, o começo. Sincronizar
  // por efeito faria render em cascata e sobrescreveria a escolha do usuário toda
  // vez que o estado recarregasse.
  const [etapaEscolhida, setEtapaEscolhida] = useState<string | null>(null)

  const url = tipoId ? `/api/gerenciamento/parametrizacao?tipoProcessoId=${tipoId}${phaseKey ? `&phaseKey=${phaseKey}` : ""}` : null
  const estadoReq = useApi<Estado>(url ?? "")
  const estado = tipoId ? estadoReq.dados : null

  const [simulando, setSimulando] = useState(false)
  const [simulacao, setSimulacao] = useState<any | null>(null)
  const [publicando, setPublicando] = useState(false)
  const [resultadoPub, setResultadoPub] = useState<any | null>(null)
  // Conclusão: as etapas chegam UMA A UMA pelo stream, para o progresso ser real
  // em vez de um spinner que não diz se está andando.
  const [concluindo, setConcluindo] = useState(false)
  const [etapasExec, setEtapasExec] = useState<any[]>([])
  const [relatorio, setRelatorio] = useState<any | null>(null)

  // Progresso é marcador de lugar — salvo ao trocar de etapa, nunca conteúdo.
  const salvarProgresso = useCallback(async (etapa: string) => {
    if (!tipoId) return
    await fetch("/api/gerenciamento/parametrizacao", {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ tipoProcessoId: tipoId, phaseKey: phaseKey || null, etapaAtual: etapa }),
    }).catch(() => {})
  }, [tipoId, phaseKey])

  const etapaAtiva = etapaEscolhida ?? estado?.progresso?.etapaAtual ?? "escopo"
  const irPara = (etapa: string) => { setEtapaEscolhida(etapa); void salvarProgresso(etapa) }

  const simular = async () => {
    if (!tipoId) return
    setSimulando(true); setSimulacao(null)
    try {
      const r = await fetch(`/api/gerenciamento/parametrizacao/simular?tipoProcessoId=${tipoId}${phaseKey ? `&phaseKey=${phaseKey}` : ""}`, { headers: authHeaders() })
      setSimulacao(await r.json())
    } finally { setSimulando(false) }
  }

  const publicar = async () => {
    if (!tipoId) return
    setPublicando(true); setResultadoPub(null)
    try {
      const r = await fetch("/api/gerenciamento/parametrizacao/publicar", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tipoProcessoId: tipoId, phaseKey: phaseKey || null }),
      })
      setResultadoPub(await r.json())
      void estadoReq.recarregar()
    } finally { setPublicando(false) }
  }

  const concluir = async () => {
    if (!tipoId) return
    setConcluindo(true); setEtapasExec([]); setRelatorio(null)
    try {
      const resp = await fetch("/api/gerenciamento/parametrizacao/concluir", {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tipoProcessoId: tipoId, phaseKey: phaseKey || null }),
      })
      const reader = resp.body?.getReader()
      if (!reader) return
      const dec = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const linhas = buffer.split("\n")
        buffer = linhas.pop() ?? ""
        for (const l of linhas) {
          if (!l.trim()) continue
          const ev = JSON.parse(l)
          if (ev.relatorio) setRelatorio(ev.relatorio)
          else if (ev.erroFatal) setEtapasExec((x) => [...x, { etapa: "erro", titulo: "Falha", status: "ERRO", detalhe: ev.erroFatal, mensagens: [] }])
          else setEtapasExec((x) => [...x, ev])
        }
      }
      void estadoReq.recarregar()
    } finally { setConcluindo(false) }
  }

  const etapa = estado?.etapas.find((e) => e.etapa === etapaAtiva) ?? null
  const idx = estado?.etapas.findIndex((e) => e.etapa === etapaAtiva) ?? -1

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Assistente de Parametrização</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Conduz o cadastro documental, operacional e econômico. Cada etapa abre a tela oficial —
          o que você preencher aqui é salvo no cadastro de sempre.
        </p>
      </div>

      {/* ── ESCOPO ───────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--text-secondary)]">Tipo de processo</span>
          <select value={tipoId ?? ""} onChange={(e) => { setTipoId(Number(e.target.value) || null); setPhaseKey(""); setEtapaEscolhida(null); setSimulacao(null); setResultadoPub(null) }}
            className="min-w-[260px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[var(--text-primary)]">
            <option value="">Selecione…</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}{t.countryLabel ? ` · ${t.countryLabel}` : ""}</option>)}
          </select>
        </label>
        {estado && (
          <label className="text-sm">
            <span className="mb-1 block text-[var(--text-secondary)]">Fase (opcional)</span>
            <select value={phaseKey} onChange={(e) => { setPhaseKey(e.target.value); setSimulacao(null) }}
              className="min-w-[240px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[var(--text-primary)]">
              <option value="">Todas as fases aplicáveis</option>
              {estado.escopo.fases.map((f) => <option key={f.phaseKey} value={f.phaseKey}>{f.ordem}. {f.label}{f.obrigatoria ? " *" : ""}</option>)}
            </select>
          </label>
        )}
        {tipoId && (
          <button onClick={() => void estadoReq.recarregar()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </button>
        )}
      </div>

      {!tipoId && <p className="text-sm text-[var(--text-muted)]">Escolha um tipo de processo para começar. A primeira configuração é controlada — um escopo por vez.</p>}
      {tipoId && estadoReq.carregando && !estado && <div className="py-10 text-center text-sm text-[var(--text-muted)]"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}
      {tipoId && estadoReq.erro && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-6 text-center">
          <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar o estado da parametrização.</p>
          <button onClick={() => void estadoReq.recarregar()} className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-1.5 text-sm">Tentar novamente</button>
        </div>
      )}

      {estado && (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* ── TRILHA DAS ETAPAS ─────────────────────────────────────────── */}
          <nav className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-2">
            {estado.etapas.map((e, i) => {
              const ativo = e.etapa === etapaAtiva
              return (
                <button key={e.etapa} onClick={() => irPara(e.etapa)}
                  className={`flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm ${ativo ? "bg-[var(--surface-active)]" : "hover:bg-[var(--surface-hover)]"}`}>
                  <span className="mt-0.5 shrink-0" style={{ color: COR[e.status] }}>
                    {e.status === "COMPLETA" || e.status === "PUBLICADA" ? <CheckCircle2 className="h-4 w-4" />
                      : e.status === "BLOQUEADA" ? <AlertTriangle className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[var(--text-primary)]">{i + 1}. {e.titulo}</span>
                    <span className="block text-[11px]" style={{ color: COR[e.status] }}>
                      {ROTULO[e.status]}{e.pendentes > 0 ? ` · ${e.pendentes} pendente(s)` : ""}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          {/* ── ETAPA ATIVA ───────────────────────────────────────────────── */}
          <section className="min-w-0">
            {etapa && (
              <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[var(--text-primary)]">{etapa.titulo}</h2>
                  <span className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: `color-mix(in srgb, ${COR[etapa.status]} 16%, transparent)`, color: COR[etapa.status] }}>
                    {ROTULO[etapa.status]}
                  </span>
                </div>
                {etapa.acao && <p className="mt-1 text-sm text-[var(--text-secondary)]">{etapa.acao}</p>}
                {etapa.pendencias.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {etapa.pendencias.map((p, i) => (
                      <li key={i} className="text-sm">
                        <span style={{ color: p.bloqueia ? "var(--danger)" : "var(--warning)" }}>{p.bloqueia ? "⛔" : "⚠"}</span>{" "}
                        <span className="text-[var(--text-primary)]">{p.mensagem}</span>
                        <span className="block pl-5 text-[11px] text-[var(--text-muted)]">↳ {p.onde}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* SIMULAÇÃO — motor real, sem escrita */}
            {etapaAtiva === "simulacao" && (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                <button onClick={simular} disabled={simulando}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:opacity-40">
                  {simulando ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Simular
                </button>
                <p className="mt-2 text-xs text-[var(--text-muted)]">Usa os mesmos resolvedores do runtime. Nada é gravado.</p>
                {simulacao && (
                  <div className="mt-4 text-sm">
                    {simulacao.processoCodigo && <p className="text-[var(--text-secondary)]">Processo de amostra: <strong>{simulacao.processoCodigo}</strong></p>}
                    {simulacao.motivos?.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[var(--text-muted)]">
                        {simulacao.motivos.map((m: any, i: number) => <li key={i}>· {m.motivo}{m.detalhe ? ` — ${m.detalhe}` : ""}</li>)}
                      </ul>
                    )}
                    {simulacao.linhas?.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="text-left text-[11px] uppercase text-[var(--text-muted)]">
                            {["Pessoa", "Documento", "Componente", "Fase", "Custo", "Receita", "Regra"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}
                          </tr></thead>
                          <tbody>{simulacao.linhas.map((l: any, i: number) => (
                            <tr key={i} className="border-t border-[var(--border-default)]">
                              <td className="px-3 py-2 text-[var(--text-primary)]">{l.pessoaNome}</td>
                              <td className="px-3 text-[var(--text-secondary)]">#{l.documentoId}</td>
                              <td className="px-3 text-[var(--text-secondary)]">{l.componente}</td>
                              <td className="px-3 text-[var(--text-muted)]">{l.phaseKey}</td>
                              <td className="px-3 tabular-nums">{l.custo ? `${l.custo.moeda} ${l.custo.valor}` : <span className="text-[var(--warning)]">{l.custoImpedimento ?? "—"}</span>}</td>
                              <td className="px-3 tabular-nums">{l.receita ? `${l.receita.moeda} ${l.receita.valor}` : <span className="text-[var(--warning)]">{l.receitaImpedimento ?? "—"}</span>}</td>
                              <td className="px-3 text-[11px] text-[var(--text-muted)]">#{l.regraId}</td>
                            </tr>
                          ))}</tbody>
                          <tfoot><tr className="border-t-2 border-[var(--border-strong)]">
                            <td colSpan={4} className="px-3 py-2 font-semibold text-[var(--text-primary)]">Previsto</td>
                            <td className="px-3 tabular-nums font-medium">{simulacao.totalCustoPrevisto}</td>
                            <td className="px-3 tabular-nums font-medium">{simulacao.totalReceitaPrevista}</td>
                            <td className="px-3 tabular-nums font-bold">margem {simulacao.margemPrevista}</td>
                          </tr></tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PUBLICAÇÃO — coordenada, tudo ou nada */}
            {etapaAtiva === "publicacao" && (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  Publicar liga as regras e ativa os componentes numa transação só. Se qualquer item crítico falhar, nada é publicado.
                </p>
                <button onClick={publicar} disabled={publicando || !estado.publicavel}
                  title={estado.publicavel ? undefined : "Resolva as pendências bloqueantes primeiro"}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">
                  {publicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Publicar parametrização
                </button>
                {resultadoPub && (
                  <div className="mt-4 text-sm">
                    {resultadoPub.ok
                      ? <p className="text-[var(--success)]">Publicado: {resultadoPub.regrasPublicadas?.length ?? 0} regra(s), {resultadoPub.componentesAtivados?.length ?? 0} componente(s) ativado(s).</p>
                      : <>
                          <p className="text-[var(--danger)]">{resultadoPub.error}</p>
                          <ul className="mt-2 space-y-1">
                            {(resultadoPub.impedimentos ?? []).map((i: any, k: number) => (
                              <li key={k} className="text-[var(--text-secondary)]">⛔ {i.mensagem}<span className="block pl-5 text-[11px] text-[var(--text-muted)]">↳ {i.onde}</span></li>
                            ))}
                          </ul>
                        </>}
                  </div>
                )}
              </div>
            )}

            {/* CONCLUSÃO — um botão, o ciclo inteiro, sem terminal */}
            {etapaAtiva === "validacao" && (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  Valida, publica, materializa, reconcilia, atualiza projeções e confere Financeiro,
                  Planilha e guards — nesta ordem, chamando os serviços canônicos. Rodar de novo converge; não duplica.
                </p>
                <button onClick={concluir} disabled={concluindo}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-primary)] px-3.5 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:opacity-40">
                  {concluindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Concluir Parametrização
                </button>

                {etapasExec.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {etapasExec.map((e, i) => (
                      <li key={i} className="text-sm">
                        <span style={{ color: e.status === "OK" ? "var(--success)" : e.status === "ERRO" ? "var(--danger)" : "var(--text-muted)" }}>
                          {e.status === "OK" ? "✓" : e.status === "ERRO" ? "✕" : "○"}
                        </span>{" "}
                        <span className="text-[var(--text-primary)]">{e.titulo}</span>
                        <span className="text-[var(--text-muted)]"> — {e.detalhe}</span>
                        {typeof e.duracaoMs === "number" && <span className="text-[11px] text-[var(--text-muted)]"> ({e.duracaoMs}ms)</span>}
                        {e.mensagens?.length > 0 && (
                          <ul className="mt-1 space-y-0.5 pl-5">
                            {e.mensagens.slice(0, 8).map((m: string, k: number) => <li key={k} className="text-[11px] text-[var(--text-muted)]">· {m}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                    {concluindo && <li className="text-sm text-[var(--text-muted)]"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> executando…</li>}
                  </ul>
                )}

                {relatorio && <RelatorioFinal r={relatorio} />}
              </div>
            )}

            {/* ETAPAS DE CADASTRO — a TELA OFICIAL, embutida */}
            {etapa?.telaKey && (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)]">
                <TelaDaEtapa etapa={etapaAtiva} />
              </div>
            )}

            {/* navegação */}
            <div className="mt-4 flex items-center justify-between">
              <button disabled={idx <= 0} onClick={() => irPara(estado.etapas[idx - 1].etapa)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text-secondary)] disabled:opacity-30">
                <ArrowLeft className="h-4 w-4" /> Anterior
              </button>
              <button disabled={idx < 0 || idx >= estado.etapas.length - 1} onClick={() => irPara(estado.etapas[idx + 1].etapa)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text-secondary)] disabled:opacity-30">
                Próxima <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
