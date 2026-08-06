"use client"

// src/components/gerenciamentoComponents/ConfiguracaoProcessoViews.tsx
//
// CINCO CONSULTAS CONSOLIDADAS da configuração por Tipo de Processo, todas sobre
// o MESMO read-model (/api/gerenciamento/configuracao-processo). São telas de
// LEITURA: a edição continua exclusivamente nas telas donas (Workflow › Fluxos,
// Automações, Regras Documentais, Configurações Financeiras) — nenhuma segunda
// porta de escrita, nenhuma segunda fonte de verdade.
//
//   SLAConfiguracaoTab        → Processos › Configurações › SLA
//   VersoesConfiguracaoTab    → Processos › Configurações › Versões
//   ConfiguracoesGeraisTab    → Processos › Configurações › Configurações Gerais
//   TransicoesTab             → Workflow  › Transições
//   DiagnosticoConfiguracaoTab→ Relatórios e Indicadores › Diagnóstico de Configuração

import { useCallback, useEffect, useMemo, useState } from "react"
import { useApi } from "@/src/lib/dados"

// ─────────────────────────── tipos do read-model ────────────────────────────
interface Passo {
  key: string; label: string; ordem: number; required: boolean
  createsTask: boolean; slaDays: number; versao: number
}
interface Interno { name: string; versao: number; global: boolean; passos: Passo[] }
interface Fase {
  phaseKey: string; label: string; ordem: number; required: boolean; conditional: boolean
  entryRule: string; slaDays: number; showInKanban: boolean; versao: number; interno: Interno | null
}
interface Contagens {
  fases: number; fasesNoKanban: number; fasesComInterno: number; passos: number
  automacoesFinanceiras: number; automacoesEvento: number; automacoesProtocolo: number
  regrasDocumentais: number; configsFinanceiras: number
}
interface Tipo {
  id: number; code: string; name: string
  countryKey: string; countryLabel: string; nationalityLabel: string
  modalityKey: string; modalityLabel: string
  processFamily: string; serviceNature: string
  ativo: boolean; arquivado: boolean
  criadoEm: string; atualizadoEm: string
  macro: { id: number; name: string; ativo: boolean; versao: number } | null
  fases: Fase[]
  contagens: Contagens
}

// ─────────────────────────────── infraestrutura ──────────────────────────────
function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : { "Content-Type": "application/json" }
}

const CARD = "rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm"
const TH = "px-4 py-3 font-medium"
const selectCls = "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20"

const SEM_TIPOS: Tipo[] = []

function useConfiguracaoProcesso() {
  // Uma consulta na camada oficial substitui o trio `useState` + `load` + efeito.
  // Todas as views desta tela usam a MESMA chave, então elas compartilham uma única
  // requisição em vez de cada uma buscar o seu.
  const consulta = useApi<{ tipos?: Tipo[] }>("/api/gerenciamento/configuracao-processo")
  return {
    // Constante, não `?? []`: a lista alimenta dependência de `useMemo` abaixo.
    tipos: consulta.dados?.tipos ?? SEM_TIPOS,
    loading: consulta.carregando,
    erro: consulta.erro ? consulta.erro.message : null,
    reload: consulta.recarregar,
  }
}

/** Casca comum: título, descrição, erro, seletor de tipo e estado vazio. */
function Consulta({
  titulo, descricao, onde, children, seletor = true,
}: {
  titulo: string
  descricao: string
  /** onde a informação é EDITADA (esta tela é só leitura) */
  onde: string
  children: (ctx: { tipos: Tipo[]; tipo: Tipo | null }) => React.ReactNode
  seletor?: boolean
}) {
  const { tipos, loading, erro, reload } = useConfiguracaoProcesso()
  const [tipoId, setTipoId] = useState<number | null>(null)

  const visiveis = useMemo(() => tipos.filter((t) => !t.arquivado), [tipos])
  // O primeiro tipo vem pré-selecionado — comportamento original, agora DERIVADO em
  // vez de escrito por efeito: enquanto o usuário não escolher, vale o primeiro
  // visível. Sem o render extra e sem o instante de tela sem tipo selecionado.
  const tipoIdEfetivo = tipoId ?? visiveis[0]?.id ?? null

  const tipo = useMemo(() => visiveis.find((t) => t.id === tipoIdEfetivo) ?? null, [visiveis, tipoIdEfetivo])

  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  return (
    <div className="space-y-5">
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {erro} <button onClick={() => { void reload() }} className="ml-2 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      <div className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{titulo}</h2>
            <p className="mt-1 max-w-3xl text-sm text-white/60">{descricao}</p>
          </div>
          <span className="flex-none rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/50">
            Somente leitura · edite em {onde}
          </span>
        </div>

        {seletor && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <label className="text-sm text-white/60">Processo:</label>
            <select
              value={tipoIdEfetivo ?? ""}
              onChange={(e) => setTipoId(e.target.value ? Number(e.target.value) : null)}
              className={`${selectCls} min-w-[280px]`}
            >
              {visiveis.length === 0 && <option value="" className="bg-zinc-900">— nenhum tipo de processo —</option>}
              {visiveis.map((t) => (
                <option key={t.id} value={t.id} className="bg-zinc-900">
                  {t.name}{t.ativo ? "" : " · (inativo)"}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {visiveis.length === 0 ? (
        <div className={`${CARD} p-8 text-center text-sm text-white/50`}>
          Nenhum tipo de processo cadastrado. Comece em <span className="text-white/80">Processos › Cadastros › Tipos de Processo</span>.
        </div>
      ) : (
        children({ tipos: visiveis, tipo })
      )}
    </div>
  )
}

function SemFluxo({ nome }: { nome: string }) {
  return (
    <div className={`${CARD} p-8 text-center text-sm text-white/50`}>
      <span className="text-white/80">{nome}</span> ainda não tem Workflow Macro.
      Monte a sequência de fases em <span className="text-white/80">Workflow › Fluxos › Workflow Macro</span>.
    </div>
  )
}

// ═══════════════════════════════════ 1. SLA ═══════════════════════════════════
const ENTRY_LABEL: Record<string, string> = {
  process_created: "criação do processo",
  previous_phase_completed: "conclusão da fase anterior",
  manual: "liberação manual",
}
const entryLabel = (k: string) => ENTRY_LABEL[k] ?? k

export function SLAConfiguracaoTab() {
  return (
    <Consulta
      titulo="SLA"
      descricao="Prazos configurados em cada fase do processo e nos passos do Workflow Interno. O acumulado é a soma dos prazos das fases obrigatórias, na ordem do fluxo."
      onde="Workflow › Fluxos"
    >
      {({ tipo }) => {
        if (!tipo) return null
        if (!tipo.macro || tipo.fases.length === 0) return <SemFluxo nome={tipo.name} />
        let acumulado = 0
        return (
          <div className={`overflow-x-auto ${CARD}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-white/50">
                <tr>
                  <th className={TH}>#</th>
                  <th className={TH}>Fase</th>
                  <th className={TH}>SLA da fase</th>
                  <th className={TH}>Acumulado</th>
                  <th className={TH}>Passos</th>
                  <th className={TH}>Maior SLA de passo</th>
                  <th className={TH}>Regime</th>
                </tr>
              </thead>
              <tbody>
                {tipo.fases.map((f) => {
                  if (f.required) acumulado += f.slaDays
                  const passos = f.interno?.passos ?? []
                  const maiorPasso = passos.reduce((m, p) => Math.max(m, p.slaDays), 0)
                  return (
                    <tr key={f.phaseKey} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-white/50">{f.ordem}</td>
                      <td className="px-4 py-2.5 text-white">{f.label}</td>
                      <td className="px-4 py-2.5 text-white/80">{f.slaDays} d</td>
                      <td className="px-4 py-2.5 text-white/60">{f.required ? `${acumulado} d` : "—"}</td>
                      <td className="px-4 py-2.5 text-white/60">{passos.length || "—"}</td>
                      <td className="px-4 py-2.5 text-white/60">{maiorPasso ? `${maiorPasso} d` : "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {f.required
                            ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">obrigatória</span>
                            : <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/40">opcional</span>}
                          {f.conditional && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">condicional</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-white/[0.03]">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-medium text-white">Prazo total (fases obrigatórias)</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-semibold text-white">{acumulado} d</td>
                  <td className="px-4 py-3 text-white/60">{tipo.contagens.passos}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                </tr>
              </tbody>
            </table>
          </div>
        )
      }}
    </Consulta>
  )
}

// ═════════════════════════════════ 2. VERSÕES ═════════════════════════════════
export function VersoesConfiguracaoTab() {
  return (
    <Consulta
      titulo="Versões"
      descricao="Versão de cada definição de configuração do processo: o Workflow Macro, cada fase e cada Workflow Interno. Processos em andamento continuam operando sobre a definição que usaram."
      onde="Workflow › Fluxos"
    >
      {({ tipo }) => {
        if (!tipo) return null
        if (!tipo.macro) return <SemFluxo nome={tipo.name} />
        return (
          <div className="space-y-4">
            <div className={`${CARD} p-5`}>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/45">Workflow Macro</div>
                  <div className="mt-1 text-white">{tipo.macro.name}</div>
                  <div className="mt-0.5 text-sm text-white/60">versão {tipo.macro.versao} · {tipo.macro.ativo ? "ativo" : "inativo"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/45">Fases</div>
                  <div className="mt-1 text-white">{tipo.contagens.fases}</div>
                  <div className="mt-0.5 text-sm text-white/60">{tipo.contagens.fasesComInterno} com workflow interno</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/45">Última alteração do tipo</div>
                  <div className="mt-1 text-white">{new Date(tipo.atualizadoEm).toLocaleString("pt-BR")}</div>
                </div>
              </div>
            </div>

            <div className={`overflow-x-auto ${CARD}`}>
              <table className="w-full text-sm">
                <thead className="border-b border-white/10 text-left text-xs text-white/50">
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>Fase</th>
                    <th className={TH}>Versão da fase</th>
                    <th className={TH}>Workflow Interno</th>
                    <th className={TH}>Versão do interno</th>
                    <th className={TH}>Passos</th>
                  </tr>
                </thead>
                <tbody>
                  {tipo.fases.map((f) => (
                    <tr key={f.phaseKey} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-white/50">{f.ordem}</td>
                      <td className="px-4 py-2.5 text-white">{f.label}</td>
                      <td className="px-4 py-2.5 text-white/70">v{f.versao}</td>
                      <td className="px-4 py-2.5 text-white/70">
                        {f.interno
                          ? <>{f.interno.name}{f.interno.global && <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">global</span>}</>
                          : <span className="text-white/30">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-white/70">{f.interno ? `v${f.interno.versao}` : "—"}</td>
                      <td className="px-4 py-2.5 text-white/60">{f.interno?.passos.length ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </Consulta>
  )
}

// ═══════════════════════ 3. CONFIGURAÇÕES GERAIS DO PROCESSO ══════════════════
export function ConfiguracoesGeraisProcessoTab() {
  return (
    <Consulta
      titulo="Configurações Gerais"
      descricao="Identidade e estado de cada tipo de processo — país, nacionalidade, modalidade, família, natureza do serviço e situação. É a visão geral do que está configurado e no ar."
      onde="Processos › Cadastros › Tipos de Processo"
      seletor={false}
    >
      {({ tipos }) => (
        <div className={`overflow-x-auto ${CARD}`}>
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-white/50">
              <tr>
                <th className={TH}>Código</th>
                <th className={TH}>Processo</th>
                <th className={TH}>País / Nacionalidade</th>
                <th className={TH}>Modalidade</th>
                <th className={TH}>Família</th>
                <th className={TH}>Natureza</th>
                <th className={TH}>Fluxo</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2.5"><code className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">{t.code}</code></td>
                  <td className="px-4 py-2.5 text-white">{t.name}</td>
                  <td className="px-4 py-2.5 text-white/70">{t.countryLabel} · {t.nationalityLabel}</td>
                  <td className="px-4 py-2.5 text-white/70">{t.modalityLabel}</td>
                  <td className="px-4 py-2.5 text-white/60">{t.processFamily}</td>
                  <td className="px-4 py-2.5 text-white/60">{t.serviceNature}</td>
                  <td className="px-4 py-2.5 text-white/60">
                    {t.macro ? `${t.contagens.fases} fase(s) · v${t.macro.versao}` : <span className="text-amber-300/80">sem workflow</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${t.ativo ? "bg-green-500/15 text-green-300" : "bg-white/10 text-white/50"}`}>
                      {t.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Consulta>
  )
}

// ═══════════════════════════════ 4. TRANSIÇÕES ════════════════════════════════
export function TransicoesTab() {
  return (
    <Consulta
      titulo="Transições"
      descricao="Os caminhos entre as fases do processo: de onde cada fase é alcançada e qual a regra que libera a entrada. As fases vêm do catálogo (Processos › Estrutura › Fases) — o Workflow apenas as encadeia."
      onde="Workflow › Fluxos › Workflow Macro"
    >
      {({ tipo }) => {
        if (!tipo) return null
        if (!tipo.macro || tipo.fases.length === 0) return <SemFluxo nome={tipo.name} />
        return (
          <div className={`overflow-x-auto ${CARD}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-white/50">
                <tr>
                  <th className={TH}>#</th>
                  <th className={TH}>De</th>
                  <th className={TH}>Para</th>
                  <th className={TH}>Regra de entrada</th>
                  <th className={TH}>Natureza</th>
                  <th className={TH}>SLA</th>
                  <th className={TH}>Kanban</th>
                </tr>
              </thead>
              <tbody>
                {tipo.fases.map((f, i) => {
                  const anterior = i === 0 ? null : tipo.fases[i - 1]
                  return (
                    <tr key={f.phaseKey} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-white/50">{f.ordem}</td>
                      <td className="px-4 py-2.5 text-white/70">{anterior ? anterior.label : <span className="text-white/40">início do processo</span>}</td>
                      <td className="px-4 py-2.5 text-white">{f.label}</td>
                      <td className="px-4 py-2.5 text-white/70">{entryLabel(f.entryRule)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {f.required
                            ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">obrigatória</span>
                            : <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/40">opcional</span>}
                          {f.conditional && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">condicional</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-white/60">{f.slaDays} d</td>
                      <td className="px-4 py-2.5 text-white/60">{f.showInKanban ? "sim" : "não"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-white/10 px-4 py-3 text-[12px] text-white/45">
              A condição para CONCLUIR cada fase é do Workflow Interno + motor de bloqueio; esta tela mostra a
              condição para ENTRAR na fase seguinte.
            </div>
          </div>
        )
      }}
    </Consulta>
  )
}

// ════════════════════════ 5. DIAGNÓSTICO DE CONFIGURAÇÃO ══════════════════════
type Severidade = "ok" | "alerta" | "erro"
interface Checagem { nome: string; sev: Severidade; detalhe: string }

function diagnosticar(t: Tipo): Checagem[] {
  const c = t.contagens
  const out: Checagem[] = []
  out.push(t.macro
    ? { nome: "Workflow Macro", sev: "ok", detalhe: `${t.macro.name} · v${t.macro.versao}` }
    : { nome: "Workflow Macro", sev: "erro", detalhe: "não existe — o processo não avança sem sequência de fases" })
  out.push(c.fases > 0
    ? { nome: "Fases no fluxo", sev: "ok", detalhe: `${c.fases} fase(s)` }
    : { nome: "Fases no fluxo", sev: "erro", detalhe: "o fluxo está vazio" })
  out.push(c.fasesNoKanban > 0
    ? { nome: "Colunas do Kanban", sev: "ok", detalhe: `${c.fasesNoKanban} coluna(s) derivada(s)` }
    : { nome: "Colunas do Kanban", sev: "alerta", detalhe: "nenhuma fase marcada para o Kanban" })
  out.push(c.fasesComInterno === c.fases && c.fases > 0
    ? { nome: "Workflow Interno", sev: "ok", detalhe: `todas as ${c.fases} fases têm passos (${c.passos} no total)` }
    : c.fasesComInterno > 0
      ? { nome: "Workflow Interno", sev: "alerta", detalhe: `${c.fasesComInterno} de ${c.fases} fases têm passos definidos` }
      : { nome: "Workflow Interno", sev: "erro", detalhe: "nenhuma fase tem passos — não há tarefa obrigatória" })
  out.push(c.regrasDocumentais > 0
    ? { nome: "Regras documentais", sev: "ok", detalhe: `${c.regrasDocumentais} regra(s)` }
    : { nome: "Regras documentais", sev: "alerta", detalhe: "nenhuma exigência documental configurada" })
  out.push(c.configsFinanceiras > 0
    ? { nome: "Configurações financeiras", sev: "ok", detalhe: `${c.configsFinanceiras} configuração(ões)` }
    : { nome: "Configurações financeiras", sev: "alerta", detalhe: "nenhum comportamento financeiro vinculado a este processo" })
  const auto = c.automacoesFinanceiras + c.automacoesEvento + c.automacoesProtocolo
  out.push(auto > 0
    ? { nome: "Automações por fase", sev: "ok", detalhe: `${c.automacoesFinanceiras} financeira(s) · ${c.automacoesEvento} de evento · ${c.automacoesProtocolo} de protocolo` }
    : { nome: "Automações por fase", sev: "alerta", detalhe: "nenhum efeito automático configurado" })
  out.push(t.ativo
    ? { nome: "Situação", sev: "ok", detalhe: "tipo ativo (aceita novos processos)" }
    : { nome: "Situação", sev: "alerta", detalhe: "tipo inativo — não aparece na criação de processo" })
  return out
}

const SEV_CLS: Record<Severidade, string> = {
  ok: "bg-green-500/15 text-green-300",
  alerta: "bg-amber-500/15 text-amber-300",
  erro: "bg-red-500/15 text-red-300",
}
const SEV_LABEL: Record<Severidade, string> = { ok: "OK", alerta: "Atenção", erro: "Bloqueante" }

export function DiagnosticoConfiguracaoTab() {
  return (
    <Consulta
      titulo="Diagnóstico de Configuração"
      descricao="O que já está configurado e o que falta para o tipo de processo operar. Cada linha aponta a tela dona da correção — nada é corrigido aqui."
      onde="cada módulo indicado na linha"
    >
      {({ tipos, tipo }) => {
        if (!tipo) return null
        const checagens = diagnosticar(tipo)
        const erros = checagens.filter((c) => c.sev === "erro").length
        const alertas = checagens.filter((c) => c.sev === "alerta").length
        const oks = checagens.filter((c) => c.sev === "ok").length
        const bloqueantesGerais = tipos.filter((t) => diagnosticar(t).some((c) => c.sev === "erro")).length
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { v: `${oks}/${checagens.length}`, l: "Checagens OK" },
                { v: String(erros), l: "Bloqueantes" },
                { v: String(alertas), l: "Atenção" },
                { v: String(bloqueantesGerais), l: "Processos com bloqueio" },
              ].map((k) => (
                <div key={k.l} className={`${CARD} p-4`}>
                  <div className="text-2xl font-bold text-white">{k.v}</div>
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">{k.l}</div>
                </div>
              ))}
            </div>

            <div className={`overflow-hidden ${CARD}`}>
              <table className="w-full text-sm">
                <thead className="border-b border-white/10 text-left text-xs text-white/50">
                  <tr>
                    <th className={TH}>Checagem</th>
                    <th className={TH}>Situação</th>
                    <th className={TH}>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {checagens.map((c) => (
                    <tr key={c.nome} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-white">{c.nome}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${SEV_CLS[c.sev]}`}>{SEV_LABEL[c.sev]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-white/70">{c.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }}
    </Consulta>
  )
}
