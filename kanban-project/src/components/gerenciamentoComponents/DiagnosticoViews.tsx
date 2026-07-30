"use client"

// src/components/gerenciamentoComponents/DiagnosticoViews.tsx
//
// QUATRO LENTES sobre o MESMO read-model (/api/gerenciamento/diagnostico).
// Somente leitura — contam e verificam, não corrigem nada. Cada lente responde a
// uma pergunta diferente (nenhuma repete a outra):
//   DiagnosticoSistemaTab   → o que existe hoje no sistema (inventário + runtime)
//   DiagnosticoExecutivoTab → quão pronto está cada tipo de processo (score)
//   SaudeSistemaTab         → o que está inconsistente e precisa de ação
//   HistoricoExecucoesTab   → o que o motor executou de fato

import { useCallback, useEffect, useState } from "react"
import { useApi } from "@/src/lib/dados"

interface Achado { chave: string; nome: string; valor: number; sev: string; detalhe: string }
interface TipoScore {
  id: number; nome: string; pais: string; ativo: boolean; temWorkflow: boolean
  fases: number; fasesNoKanban: number; fasesComInterno: number
  automacoes: number; regrasDocumentais: number; score: number; bloqueante: boolean
}
interface AdvanceLog {
  id: number; processoId: number; faseAtual: string; fasePretendida: string | null
  resultado: string; motivoCodigo: string | null; forcado: boolean; criadoEm: string
}
interface Artefato {
  id: number; processoId: number; phaseKey: string; event: string; ruleKind: string
  targetTable: string; status: string; descricao: string; criadoEm: string
}
interface Diagnostico {
  geradoEm: string
  sistema: { contagens: Record<string, number>; runtime: Record<string, number> }
  integridade: { achados: Achado[] }
  executivo: { scoreGeral: number; porTipo: TipoScore[] }
  execucoes: { advanceLogs: AdvanceLog[]; artefatos: Artefato[] }
}

function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}
const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
const TH = "px-4 py-3 font-medium"
const SEV: Record<string, string> = {
  ok: "bg-green-500/15 text-green-300",
  alerta: "bg-amber-500/15 text-amber-300",
  erro: "bg-red-500/15 text-red-300",
}
const SEV_LABEL: Record<string, string> = { ok: "OK", alerta: "Atenção", erro: "Crítico" }
const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })

function useDiagnostico() {
  // O hook inteiro virou uma consulta em cache: `dados`, `loading` e `erro`
  // saem da camada oficial, e `load` é a revalidação. A interface devolvida
  // é a MESMA — nenhum consumidor precisou mudar.
  const { dados, carregando: loading, erro: erroApi, recarregar: load } =
    useApi<Diagnostico>("/api/gerenciamento/diagnostico")
  const erro = erroApi ? (erroApi.message || "Não foi possível gerar o diagnóstico.") : null
  return { dados: dados ?? null, loading, erro, load }
}

function Casca({
  titulo, descricao, children,
}: { titulo: string; descricao: string; children: (d: Diagnostico) => React.ReactNode }) {
  const { dados, loading, erro, load } = useDiagnostico()
  if (loading) return <div className="py-24 text-center text-white/50">Apurando…</div>
  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => void load()} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}
      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{titulo}</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">{descricao}</p>
            {dados && <p className="mt-1 text-[11px] text-white/40">Apurado em {fmt(dados.geradoEm)}</p>}
          </div>
          <button onClick={() => void load()} className="flex-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10">
            Reexecutar
          </button>
        </div>
      </div>
      {dados ? children(dados) : null}
    </div>
  )
}

function Kpi({ valor, label, cor }: { valor: string | number; label: string; cor?: string }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-2xl font-bold" style={cor ? { color: cor } : undefined}>{valor}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</div>
    </div>
  )
}

// ══════════════════════════ 1. DIAGNÓSTICO DO SISTEMA ═════════════════════════
const ROTULO_CONTAGEM: [string, string][] = [
  ["tiposProcesso", "Tipos de processo"], ["processos", "Processos"], ["macros", "Fluxos macro"],
  ["internos", "Workflows internos"], ["fasesCatalogo", "Fases no catálogo"], ["servicos", "Serviços"],
  ["tiposDocumento", "Tipos de documento"], ["matrizDocumental", "Regras documentais"],
  ["configsFinanceiras", "Configurações financeiras"], ["precos", "Linhas de preço"],
  ["orgaos", "Órgãos"], ["fornecedores", "Fornecedores"], ["usuarios", "Usuários"], ["perfis", "Perfis"],
  ["automacoesFinanceiras", "Automações financeiras"], ["automacoesEvento", "Automações de evento"],
]

export function DiagnosticoSistemaTab() {
  return (
    <Casca
      titulo="Diagnóstico do Sistema"
      descricao="Inventário do que está cadastrado e o estado do motor neste momento. É a fotografia técnica — a leitura por processo está no Diagnóstico Executivo."
    >
      {(d) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi valor={d.sistema.runtime.instanciasAtivas} label="Instâncias ativas" />
            <Kpi valor={d.sistema.runtime.outboxPendente} label="Eventos na fila" cor={d.sistema.runtime.outboxPendente > 50 ? "#fbbf24" : undefined} />
            <Kpi valor={d.sistema.runtime.outboxErro} label="Eventos com erro" cor={d.sistema.runtime.outboxErro > 0 ? "#f87171" : "#4ade80"} />
            <Kpi valor={`${d.executivo.scoreGeral}%`} label="Prontidão média" />
          </div>
          <div className={`overflow-hidden ${CARD}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-white/50">
                <tr><th className={TH}>Cadastro</th><th className={TH}>Registros</th></tr>
              </thead>
              <tbody>
                {ROTULO_CONTAGEM.map(([k, label]) => (
                  <tr key={k} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white">{label}</td>
                    <td className="px-4 py-2.5 text-white/70">{d.sistema.contagens[k] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Casca>
  )
}

// ═════════════════════════ 2. DIAGNÓSTICO EXECUTIVO ═══════════════════════════
export function DiagnosticoExecutivoTab() {
  return (
    <Casca
      titulo="Diagnóstico Executivo"
      descricao="Quão pronto está cada tipo de processo para operar. O score considera fluxo, fases, kanban, workflow interno, regras documentais e automações."
    >
      {(d) => {
        const t = d.executivo.porTipo
        const prontos = t.filter((x) => x.score === 100).length
        const bloqueados = t.filter((x) => x.bloqueante).length
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi valor={`${d.executivo.scoreGeral}%`} label="Score geral" />
              <Kpi valor={`${prontos}/${t.length}`} label="Processos prontos" cor="#4ade80" />
              <Kpi valor={bloqueados} label="Bloqueados" cor={bloqueados > 0 ? "#f87171" : "#4ade80"} />
              <Kpi valor={t.filter((x) => x.ativo).length} label="Ativos" />
            </div>
            <div className={`overflow-x-auto ${CARD}`}>
              <table className="w-full text-sm">
                <thead className="border-b border-white/10 text-left text-xs text-white/50">
                  <tr>
                    <th className={TH}>Processo</th><th className={TH}>País</th><th className={TH}>Fluxo</th>
                    <th className={TH}>Fases</th><th className={TH}>Kanban</th><th className={TH}>Interno</th>
                    <th className={TH}>Docs</th><th className={TH}>Autom.</th><th className={TH}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {t.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-xs text-white/40">Nenhum tipo de processo cadastrado.</td></tr>
                  ) : t.map((x) => (
                    <tr key={x.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-white">{x.nome}</td>
                      <td className="px-4 py-2.5 text-white/60">{x.pais}</td>
                      <td className="px-4 py-2.5">{x.temWorkflow ? <span className="text-white/70">sim</span> : <span className="text-red-300/80">não</span>}</td>
                      <td className="px-4 py-2.5 text-white/70">{x.fases}</td>
                      <td className="px-4 py-2.5 text-white/70">{x.fasesNoKanban}</td>
                      <td className="px-4 py-2.5 text-white/70">{x.fasesComInterno}/{x.fases}</td>
                      <td className="px-4 py-2.5 text-white/70">{x.regrasDocumentais}</td>
                      <td className="px-4 py-2.5 text-white/70">{x.automacoes}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${x.score === 100 ? SEV.ok : x.bloqueante ? SEV.erro : SEV.alerta}`}>{x.score}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </Casca>
  )
}

// ═══════════════════════════ 3. SAÚDE DO SISTEMA ══════════════════════════════
export function SaudeSistemaTab() {
  return (
    <Casca
      titulo="Saúde do Sistema"
      descricao="Verificações de consistência entre os cadastros e o motor. Cada achado aponta um risco concreto — e onde ele é resolvido."
    >
      {(d) => {
        const a = d.integridade.achados
        const criticos = a.filter((x) => x.sev === "erro").length
        const alertas = a.filter((x) => x.sev === "alerta").length
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi valor={`${a.filter((x) => x.sev === "ok").length}/${a.length}`} label="Verificações OK" />
              <Kpi valor={criticos} label="Críticos" cor={criticos > 0 ? "#f87171" : "#4ade80"} />
              <Kpi valor={alertas} label="Alertas" cor={alertas > 0 ? "#fbbf24" : "#4ade80"} />
              <Kpi valor={criticos === 0 && alertas === 0 ? "Saudável" : criticos > 0 ? "Requer ação" : "Observar"} label="Situação" />
            </div>
            <div className={`overflow-hidden ${CARD}`}>
              <table className="w-full text-sm">
                <thead className="border-b border-white/10 text-left text-xs text-white/50">
                  <tr><th className={TH}>Verificação</th><th className={TH}>Situação</th><th className={TH}>Ocorrências</th><th className={TH}>O que significa</th></tr>
                </thead>
                <tbody>
                  {a.map((x) => (
                    <tr key={x.chave} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-white">{x.nome}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] ${SEV[x.sev] ?? SEV.ok}`}>{SEV_LABEL[x.sev] ?? x.sev}</span></td>
                      <td className="px-4 py-2.5 text-white/70">{x.valor}</td>
                      <td className="px-4 py-2.5 text-white/60">{x.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </Casca>
  )
}

// ═══════════════════════ 4. HISTÓRICO DE EXECUÇÕES ════════════════════════════
export function HistoricoExecucoesTab() {
  return (
    <Casca
      titulo="Histórico de Execuções"
      descricao="O que o motor executou de fato: avanços de fase decididos e artefatos gerados pelas automações. Registro de execução — não altera nada."
    >
      {(d) => (
        <div className="space-y-4">
          <div className={`overflow-x-auto ${CARD}`}>
            <div className="border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-wide text-white/45">Avanços de fase (60 mais recentes)</div>
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-white/50">
                <tr><th className={TH}>Quando</th><th className={TH}>Processo</th><th className={TH}>De</th><th className={TH}>Para</th><th className={TH}>Resultado</th><th className={TH}>Motivo</th></tr>
              </thead>
              <tbody>
                {d.execucoes.advanceLogs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-white/40">Nenhum avanço registrado.</td></tr>
                ) : d.execucoes.advanceLogs.map((l) => (
                  <tr key={l.id} className="border-b border-white/5 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{fmt(l.criadoEm)}</td>
                    <td className="px-4 py-2.5 text-white/70">#{l.processoId}</td>
                    <td className="px-4 py-2.5 text-white/70">{l.faseAtual}</td>
                    <td className="px-4 py-2.5 text-white">{l.fasePretendida ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${l.resultado === "PERMITIDO" ? SEV.ok : SEV.alerta}`}>{l.resultado}</span>
                      {l.forcado && <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">forçado</span>}
                    </td>
                    <td className="px-4 py-2.5 text-white/60">{l.motivoCodigo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={`overflow-x-auto ${CARD}`}>
            <div className="border-b border-white/10 px-4 py-3 text-[11px] uppercase tracking-wide text-white/45">Artefatos gerados pelas automações (60 mais recentes)</div>
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-white/50">
                <tr><th className={TH}>Quando</th><th className={TH}>Processo</th><th className={TH}>Fase</th><th className={TH}>Evento</th><th className={TH}>Tipo</th><th className={TH}>Alvo</th><th className={TH}>Status</th></tr>
              </thead>
              <tbody>
                {d.execucoes.artefatos.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-white/40">Nenhum artefato gerado.</td></tr>
                ) : d.execucoes.artefatos.map((a) => (
                  <tr key={a.id} className="border-b border-white/5 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-white/60">{fmt(a.criadoEm)}</td>
                    <td className="px-4 py-2.5 text-white/70">#{a.processoId}</td>
                    <td className="px-4 py-2.5 text-white/70">{a.phaseKey}</td>
                    <td className="px-4 py-2.5 text-white/60">{a.event}</td>
                    <td className="px-4 py-2.5 text-white">{a.ruleKind}</td>
                    <td className="px-4 py-2.5 text-white/60">{a.targetTable}</td>
                    <td className="px-4 py-2.5"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Casca>
  )
}
