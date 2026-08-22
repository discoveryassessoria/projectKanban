"use client"
// src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx
//
// ONDE O ADMINISTRADOR CONFIGURA TUDO O QUE ACONTECE DENTRO DE UM PASSO.
//
// ─── O PROBLEMA QUE ESTA TELA RESOLVE ──────────────────────────────────────
// A configuração de um passo estava espalhada: campos aqui, canais num menu de
// Workflow, o que acontece dentro dele em lugar nenhum — porque "solicitar via
// fornecedor", "registrar protocolo" e "aguardar retorno" eram trechos de um
// componente React. Para montar um passo, o administrador precisava saber em quais
// telas procurar, e três das coisas que ele queria configurar não tinham tela.
//
// Aqui está tudo: geral, subtarefas, campos, ações, checklist, requisitos, evidências,
// dependências, condições, responsável/SLA, executor, reabertura e publicação.
//
// ─── O QUE ELA NÃO TRAZ PARA DENTRO ────────────────────────────────────────
// O que pertence a outro domínio é REFERENCIADO, não copiado. Os canais são do
// fornecedor (Órgãos e Organizações); o passo declara "use os canais do fornecedor
// relacionado" e o runtime resolve pelo órgão daquele documento. Duplicar o cadastro
// do fornecedor aqui seria recriar, do lado do workflow, a segunda lista que este
// trabalho desfez.
//
// A tela também NÃO decide se a configuração é válida: ela mostra o que o servidor
// recusou. A validação mora na publicação, que tem a configuração inteira.

import { useEffect, useState } from "react"
import EditorDePecasDoPasso, { type PecasDoPasso, type Efeito } from "./EditorDePecasDoPasso"
import {
  chaveDe, FONTES_DE_CANAIS, MODOS_DE_EXECUCAO, REGRAS_DE_RESPONSAVEL, REGRAS_DE_CONCLUSAO,
  type AcaoCfg, type CampoCfg, type ItemCfg, type RequisitoCfg, type SubtarefaCfg, type OpcaoCfg,
} from "./tiposDoCadastroDoPasso"

export type { AcaoCfg, CampoCfg, ItemCfg, RequisitoCfg, SubtarefaCfg, OpcaoCfg }

export interface PassoConfiguravel {
  id?: number
  key: string
  label: string
  description?: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  cardinalidade?: string | null
  owner?: string | null
  priority?: string
  slaDays?: number
  completionRule?: string | null
  regraDeConclusao?: string
  executorKey?: string | null
  dependeDe?: string[] | null
  reaberturaPermitida?: boolean
  reaberturaEstrategia?: string
  reaberturaExigeJustificativa?: boolean
  reaberturaPermissao?: string | null
  acoes?: AcaoCfg[]
  campos?: CampoCfg[]
  checkItens?: ItemCfg[]
  requisitos?: RequisitoCfg[]
  subtarefas?: SubtarefaCfg[]
  /// Canais herdados do modelo anterior (o passo listava canais). Continuam sendo
  /// lidos para não reinterpretar execução publicada; configuração nova declara a
  /// fonte na SUBTAREFA.
  canais?: Array<{ canalKey?: string; canal?: { key: string; label?: string }; ordem?: number; ativo?: boolean }>
}

interface Executor {
  key: string; label: string; campos: string[]; efeitos: string[]
  acoesCadastradas: boolean; checklistCadastrado: boolean
  suportaCanais?: boolean; suportaEvidencia?: boolean; suportaEsperaExterna?: boolean; suportaCondicoes?: boolean
}
interface Catalogo {
  efeitos: Efeito[]; executores: Executor[]; tiposDeCampo: string[]
  canais: Array<{ key: string; label: string }>
}

const ABAS = [
  "geral", "subtarefas", "campos", "acoes", "checklist", "requisitos", "evidencias",
  "dependencias", "responsavel", "executor", "reabertura",
] as const
type Aba = (typeof ABAS)[number]
const TITULO: Record<Aba, string> = {
  geral: "Geral", subtarefas: "Subtarefas", campos: "Campos", acoes: "Ações/Resultados",
  checklist: "Checklist", requisitos: "Requisitos", evidencias: "Evidências",
  dependencias: "Dependências", responsavel: "Responsável", executor: "Executor",
  reabertura: "Reabertura",
}

const inp = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-blue-400/50"
const lbl = "mb-1 block text-[11px] uppercase tracking-wide text-white/40"
const card = "rounded-lg border border-white/10 bg-white/5 p-3"

export default function ConfiguracaoDoPassoModal({
  passo, irmaos, phaseKey, faseLabel, onFechar, onSalvar, problemas,
}: {
  passo: PassoConfiguravel
  /** Os outros passos do mesmo workflow — as dependências só podem apontar para eles. */
  irmaos: Array<{ key: string; label: string }>
  phaseKey: string
  faseLabel: string
  onFechar: () => void
  onSalvar: (p: PassoConfiguravel) => Promise<void> | void
  problemas?: Array<{ codigo: string; stepKey: string | null; mensagem: string }>
}) {
  const [aba, setAba] = useState<Aba>("geral")
  const [cat, setCat] = useState<Catalogo | null>(null)
  const [subAberta, setSubAberta] = useState<number | null>(null)
  const [abaDaSub, setAbaDaSub] = useState<"geral" | "campos" | "acoes" | "checklist" | "requisitos" | "evidencias">("geral")
  const [f, setF] = useState<PassoConfiguravel>({
    ...passo,
    dependeDe: passo.dependeDe ?? [],
    regraDeConclusao: passo.regraDeConclusao ?? "ACAO_DO_PASSO",
    reaberturaPermitida: passo.reaberturaPermitida !== false,
    reaberturaEstrategia: passo.reaberturaEstrategia ?? "ESCOLHA_MANUAL",
    reaberturaExigeJustificativa: passo.reaberturaExigeJustificativa !== false,
    reaberturaPermissao: passo.reaberturaPermissao ?? null,
    acoes: passo.acoes ?? [],
    campos: passo.campos ?? [],
    checkItens: passo.checkItens ?? [],
    requisitos: passo.requisitos ?? [],
    subtarefas: (passo.subtarefas ?? []).map((st) => ({
      ...st,
      dependeDe: st.dependeDe ?? [],
      acoes: st.acoes ?? [], campos: st.campos ?? [],
      checkItens: st.checkItens ?? [], requisitos: st.requisitos ?? [],
    })),
  })
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("token") : null
    fetch(`/api/gerenciamento/catalogo-execucao?phaseKey=${encodeURIComponent(phaseKey)}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCat(d))
      .catch(() => setCat(null))
  }, [phaseKey])

  const executorAtual = f.executorKey ?? ""
  const exec = cat?.executores.find((e) => e.key === executorAtual) ?? null
  const efeitosOfertados = (cat?.efeitos ?? []).filter((e) =>
    e.permitidoNestaFase && (!exec || exec.efeitos.includes(e.key)))
  const tiposOfertados = exec ? exec.campos : (cat?.tiposDeCampo ?? [])

  const set = <K extends keyof PassoConfiguravel>(k: K, v: PassoConfiguravel[K]) => setF((x) => ({ ...x, [k]: v }))
  const subs = f.subtarefas ?? []
  const setSub = (i: number, patch: Partial<SubtarefaCfg>) =>
    setF((x) => ({ ...x, subtarefas: (x.subtarefas ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)) }))

  async function salvar() {
    setSalvando(true)
    try { await onSalvar(f) } finally { setSalvando(false) }
  }

  const meus = (problemas ?? []).filter((p) => p.stepKey === f.key || p.stepKey === null)
  const pecasDoPasso: PecasDoPasso = {
    acoes: f.acoes ?? [], campos: f.campos ?? [],
    checkItens: f.checkItens ?? [], requisitos: f.requisitos ?? [],
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onFechar}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/10 px-6 py-4">
          <h3 className="font-semibold text-white">Configurar “{f.label}”</h3>
          <p className="mt-0.5 text-xs text-white/50">
            Fase: {faseLabel} · chave <code className="text-white/70">{f.key}</code> · tudo o que acontece dentro
            deste passo se configura aqui. Salvar guarda um rascunho; nada muda para os processos em andamento
            até você publicar.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-white/10 px-4 pt-3">
          {ABAS.map((a) => (
            <button key={a} onClick={() => setAba(a)}
              className={`rounded-t-lg px-3 py-2 text-xs ${aba === a ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>
              {TITULO[a]}
              {a === "subtarefas" && subs.length > 0 && <span className="ml-1.5 text-white/40">{subs.length}</span>}
              {a === "campos" && (f.campos?.length ?? 0) > 0 && <span className="ml-1.5 text-white/40">{f.campos!.length}</span>}
              {a === "acoes" && (f.acoes?.length ?? 0) > 0 && <span className="ml-1.5 text-white/40">{f.acoes!.length}</span>}
              {a === "checklist" && (f.checkItens?.length ?? 0) > 0 && <span className="ml-1.5 text-white/40">{f.checkItens!.length}</span>}
              {a === "requisitos" && (f.requisitos?.filter((r) => r.tipo !== "EVIDENCIA_ANEXADA").length ?? 0) > 0 &&
                <span className="ml-1.5 text-white/40">{f.requisitos!.filter((r) => r.tipo !== "EVIDENCIA_ANEXADA").length}</span>}
              {a === "evidencias" && (f.requisitos?.filter((r) => r.tipo === "EVIDENCIA_ANEXADA").length ?? 0) > 0 &&
                <span className="ml-1.5 text-white/40">{f.requisitos!.filter((r) => r.tipo === "EVIDENCIA_ANEXADA").length}</span>}
            </button>
          ))}
        </div>

        {meus.length > 0 && (
          <div className="mx-6 mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3">
            <div className="text-xs font-medium text-red-200">A publicação foi recusada:</div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-200/80">
              {meus.map((p, i) => <li key={i}>· {p.mensagem}</li>)}
            </ul>
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-auto px-6 py-4">
          {/* ───────────────────────────── GERAL ───────────────────────────── */}
          {aba === "geral" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Nome</label>
                  <input className={inp} value={f.label} onChange={(e) => set("label", e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Chave (não editável)</label>
                  <input className={`${inp} opacity-50`} value={f.key} disabled
                    title="É o que as execuções gravaram. Trocar desligaria o histórico do passo que o produziu." />
                </div>
              </div>
              <div>
                <label className={lbl}>Descrição</label>
                <input className={inp} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Cardinalidade</label>
                  <select className={inp} value={f.cardinalidade ?? ""} onChange={(e) => set("cardinalidade", e.target.value || null)}>
                    <option value="">(herda o escopo da fase)</option>
                    <option value="PROCESSO">Uma por processo</option>
                    <option value="PESSOA">Uma por pessoa</option>
                    <option value="NECESSIDADE">Uma por registro a localizar</option>
                    <option value="DOCUMENTO">Uma por documento</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Prioridade</label>
                  <select className={inp} value={f.priority ?? "medium"} onChange={(e) => set("priority", e.target.value)}>
                    <option value="low">baixa</option><option value="medium">média</option><option value="high">alta</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Peso / SLA (dias)</label>
                  <input className={inp} type="number" min={0} value={f.slaDays ?? 0} onChange={(e) => set("slaDays", Number(e.target.value) || 0)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input type="checkbox" checked={f.createsTask} onChange={(e) => set("createsTask", e.target.checked)} /> Etapa executável
                </label>
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input type="checkbox" checked={f.required} onChange={(e) => set("required", e.target.checked)} /> Obrigatória
                </label>
              </div>
              <div className={card}>
                <label className={lbl}>Condição de conclusão</label>
                <select className={inp} value={f.regraDeConclusao ?? "ACAO_DO_PASSO"} onChange={(e) => set("regraDeConclusao", e.target.value)}>
                  {REGRAS_DE_CONCLUSAO.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-white/40">
                  {REGRAS_DE_CONCLUSAO.find((r) => r.key === (f.regraDeConclusao ?? "ACAO_DO_PASSO"))?.ajuda}
                </p>
                {f.regraDeConclusao !== "ACAO_DO_PASSO" && subs.length === 0 && (
                  <p className="mt-2 text-[11px] text-amber-300/70">
                    Esta regra olha para subtarefas e este passo não tem nenhuma — ele nunca concluiria. A publicação recusa.
                  </p>
                )}
                <input className={`${inp} mt-2`} placeholder="Observação para o operador (texto livre, não interpretado)"
                  value={f.completionRule ?? ""} onChange={(e) => set("completionRule", e.target.value)} />
              </div>
            </>
          )}

          {/* ─────────────────────────── SUBTAREFAS ─────────────────────────── */}
          {aba === "subtarefas" && (
            <>
              <p className="text-xs text-white/50">
                O que acontece DENTRO deste passo. Cada subtarefa tem identidade própria, estado próprio,
                execução própria e histórico próprio — e pode depender das irmãs.
              </p>
              {exec && exec.suportaCondicoes === false && (
                <p className="text-[11px] text-amber-300/70">
                  O executor “{exec.label}” não interpreta condições; as subtarefas ficam cadastradas, mas ele não as usa.
                </p>
              )}

              {subs.map((st, i) => (
                <div key={i} className={card}>
                  <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
                    <div>
                      <label className={lbl}>Nome da subtarefa</label>
                      <input className={inp} value={st.label}
                        onChange={(e) => setSub(i, { label: e.target.value, key: st.key ?? chaveDe(e.target.value) })} />
                    </div>
                    <button onClick={() => setSubAberta(subAberta === i ? null : i)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-blue-300 hover:bg-blue-500/10">
                      {subAberta === i ? "Fechar" : "Configurar"}
                    </button>
                    <button onClick={() => setF((x) => ({ ...x, subtarefas: (x.subtarefas ?? []).filter((_, j) => j !== i) }))}
                      className="rounded-lg border border-white/10 px-2 py-2 text-xs text-red-300 hover:bg-red-500/10">Remover</button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <code className="text-white/35">{st.key ?? chaveDe(st.label)}</code>
                    {st.obrigatoria !== false && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">obrigatória</span>}
                    {st.repetivel && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">repetível{st.maxOcorrencias ? ` ≤${st.maxOcorrencias}` : ""}</span>}
                    {(st.dependeDe?.length ?? 0) > 0 && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">depende de {st.dependeDe!.length}</span>}
                    {st.fonteDeCanais && st.fonteDeCanais !== "NENHUMA" && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">canais do fornecedor</span>}
                    {(st.acoes?.length ?? 0) > 0 && <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">{st.acoes!.length} ações</span>}
                    {(st.campos?.length ?? 0) > 0 && <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">{st.campos!.length} campos</span>}
                  </div>

                  {subAberta === i && (
                    <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="flex flex-wrap gap-1 border-b border-white/10 pb-2">
                        {(["geral", "campos", "acoes", "checklist", "requisitos", "evidencias"] as const).map((v) => (
                          <button key={v} onClick={() => setAbaDaSub(v)}
                            className={`rounded-t-lg px-2.5 py-1 text-[11px] ${abaDaSub === v ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}>
                            {v === "geral" ? "Geral" : v === "acoes" ? "Ações" : v === "evidencias" ? "Evidências" : v[0].toUpperCase() + v.slice(1)}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 space-y-3">
                        {abaDaSub === "geral" && (
                          <>
                            <div>
                              <label className={lbl}>Descrição</label>
                              <input className={inp} value={st.descricao ?? ""} onChange={(e) => setSub(i, { descricao: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={lbl}>Modo de execução</label>
                                <select className={inp} value={st.modoExecucao ?? "MANUAL"} onChange={(e) => setSub(i, { modoExecucao: e.target.value })}>
                                  {MODOS_DE_EXECUCAO.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>SLA próprio (dias, vazio = herda)</label>
                                <input className={inp} type="number" min={0} value={st.slaDays ?? ""}
                                  onChange={(e) => setSub(i, { slaDays: Number(e.target.value) || null })} />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                              <label className="flex items-center gap-2 text-xs text-white/60">
                                <input type="checkbox" checked={st.obrigatoria !== false} onChange={(e) => setSub(i, { obrigatoria: e.target.checked })} />
                                Obrigatória para o passo concluir
                              </label>
                              <label className="flex items-center gap-2 text-xs text-white/60">
                                <input type="checkbox" checked={!!st.repetivel}
                                  onChange={(e) => setSub(i, { repetivel: e.target.checked, maxOcorrencias: e.target.checked ? st.maxOcorrencias ?? null : null })} />
                                Pode acontecer mais de uma vez
                              </label>
                              {st.repetivel && (
                                <label className="flex items-center gap-2 text-xs text-white/60">
                                  no máximo
                                  <input className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                                    type="number" min={1} value={st.maxOcorrencias ?? ""}
                                    onChange={(e) => setSub(i, { maxOcorrencias: Number(e.target.value) || null })} />
                                  vezes
                                </label>
                              )}
                              <label className="flex items-center gap-2 text-xs text-white/60">
                                <input type="checkbox" checked={st.ativo !== false} onChange={(e) => setSub(i, { ativo: e.target.checked })} />
                                Ativa
                              </label>
                            </div>

                            <div>
                              <label className={lbl}>Depende de (subtarefas deste passo)</label>
                              {subs.filter((_, j) => j !== i).length === 0 && (
                                <p className="text-[11px] text-white/35">Não há outra subtarefa para depender.</p>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {subs.filter((_, j) => j !== i).map((outra) => {
                                  const chave = outra.key ?? chaveDe(outra.label)
                                  const marcada = (st.dependeDe ?? []).includes(chave)
                                  return (
                                    <label key={chave} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                                      <input type="checkbox" checked={marcada}
                                        onChange={(e) => setSub(i, {
                                          dependeDe: e.target.checked
                                            ? [...(st.dependeDe ?? []), chave]
                                            : (st.dependeDe ?? []).filter((k) => k !== chave),
                                        })} />
                                      {outra.label}
                                    </label>
                                  )
                                })}
                              </div>
                              <p className="mt-1 text-[11px] text-white/35">
                                Ordem não é dependência: duas subtarefas podem depender da mesma sem depender uma da outra.
                              </p>
                            </div>

                            <div className={card}>
                              <label className={lbl}>De onde vêm os canais</label>
                              <select className={inp} value={st.fonteDeCanais ?? "NENHUMA"} onChange={(e) => setSub(i, { fonteDeCanais: e.target.value })}>
                                {FONTES_DE_CANAIS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                              </select>
                              <p className="mt-1 text-[11px] text-white/40">
                                {FONTES_DE_CANAIS.find((x) => x.key === (st.fonteDeCanais ?? "NENHUMA"))?.ajuda}
                              </p>
                              {st.fonteDeCanais === "TIPOS_PERMITIDOS" && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {(cat?.canais ?? []).map((c) => {
                                    const marcado = (st.tiposDeCanal ?? []).includes(c.key)
                                    return (
                                      <label key={c.key} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                                        <input type="checkbox" checked={marcado}
                                          onChange={(e) => setSub(i, {
                                            tiposDeCanal: e.target.checked
                                              ? [...(st.tiposDeCanal ?? []), c.key]
                                              : (st.tiposDeCanal ?? []).filter((k) => k !== c.key),
                                          })} />
                                        {c.label}
                                      </label>
                                    )
                                  })}
                                  {(st.tiposDeCanal ?? []).length === 0 && (
                                    <p className="text-[11px] text-amber-300/70">Nenhum tipo marcado — não sobraria canal nenhum. A publicação recusa.</p>
                                  )}
                                </div>
                              )}
                              {st.fonteDeCanais !== "NENHUMA" && (
                                <p className="mt-2 text-[11px] text-white/35">
                                  Quais canais aparecem depende do órgão do documento — cadastre-os em
                                  Órgãos e Organizações → Canais de atendimento. O workflow não copia essa lista.
                                </p>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className={lbl}>Responsável</label>
                                <select className={inp} value={st.responsavelRegra ?? "HERDA"} onChange={(e) => setSub(i, { responsavelRegra: e.target.value })}>
                                  {REGRAS_DE_RESPONSAVEL.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className={lbl}>Executor (vazio = o do passo)</label>
                                <select className={inp} value={st.executorKey ?? ""} onChange={(e) => setSub(i, { executorKey: e.target.value || null })}>
                                  <option value="">(o do passo)</option>
                                  {(cat?.executores ?? []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                                </select>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-4">
                              <label className="flex items-center gap-2 text-xs text-white/60">
                                <input type="checkbox" checked={st.reaberturaPermitida !== false}
                                  onChange={(e) => setSub(i, { reaberturaPermitida: e.target.checked })} />
                                Pode ser reaberta
                              </label>
                              <label className="flex items-center gap-2 text-xs text-white/60">
                                <input type="checkbox" checked={st.reaberturaExigeJustificativa !== false}
                                  onChange={(e) => setSub(i, { reaberturaExigeJustificativa: e.target.checked })} />
                                Reabrir exige justificativa
                              </label>
                            </div>
                          </>
                        )}

                        {abaDaSub !== "geral" && (
                          <EditorDePecasDoPasso
                            aba={abaDaSub}
                            pecas={{
                              acoes: st.acoes ?? [], campos: st.campos ?? [],
                              checkItens: st.checkItens ?? [], requisitos: st.requisitos ?? [],
                            }}
                            aoMudar={(patch) => setSub(i, patch)}
                            efeitosOfertados={efeitosOfertados}
                            tiposDeCampo={tiposOfertados}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <button
                onClick={() => setF((x) => ({
                  ...x,
                  subtarefas: [...(x.subtarefas ?? []), {
                    label: "Nova subtarefa", obrigatoria: true, ativo: true, modoExecucao: "MANUAL",
                    responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA",
                    dependeDe: [], acoes: [], campos: [], checkItens: [], requisitos: [],
                  }],
                }))}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">+ Subtarefa</button>

              {subs.length > 0 && f.regraDeConclusao === "ACAO_DO_PASSO" && (
                <p className="text-[11px] text-white/40">
                  Este passo tem subtarefas e conclui pela ação do passo — elas não travam a conclusão. Para que travem,
                  mude a condição de conclusão na aba Geral.
                </p>
              )}
            </>
          )}

          {/* ─────────── AS PEÇAS DO PASSO (mesmo editor da subtarefa) ─────────── */}
          {(aba === "campos" || aba === "acoes" || aba === "checklist" || aba === "requisitos" || aba === "evidencias") && (
            <EditorDePecasDoPasso
              aba={aba}
              pecas={pecasDoPasso}
              aoMudar={(patch) => setF((x) => ({ ...x, ...patch }))}
              efeitosOfertados={efeitosOfertados}
              tiposDeCampo={tiposOfertados}
              avisoDoExecutor={exec && !exec.checklistCadastrado && aba === "checklist"
                ? `O executor “${exec.label}” não desenha checklist; os itens ficam cadastrados mas não aparecem nele.`
                : null}
            />
          )}

          {/* ────────────────────────── DEPENDÊNCIAS ────────────────────────── */}
          {aba === "dependencias" && (
            <>
              <p className="text-xs text-white/50">
                De quais PASSOS este depende. Ordem não é dependência: dois passos podem depender do mesmo
                sem depender um do outro — e reabrir alcança quem depende, não quem vem depois.
              </p>
              {irmaos.filter((s) => s.key !== f.key).length === 0 && (
                <p className="text-[11px] text-white/35">Não há outro passo neste workflow.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {irmaos.filter((s) => s.key !== f.key).map((s) => {
                  const marcada = (f.dependeDe ?? []).includes(s.key)
                  return (
                    <label key={s.key} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70">
                      <input type="checkbox" checked={marcada}
                        onChange={(e) => set("dependeDe", e.target.checked
                          ? [...(f.dependeDe ?? []), s.key]
                          : (f.dependeDe ?? []).filter((k) => k !== s.key))} />
                      {s.label}
                    </label>
                  )
                })}
              </div>
            </>
          )}

          {/* ────────────────────── RESPONSÁVEL / SLA ────────────────────── */}
          {aba === "responsavel" && (
            <>
              <div>
                <label className={lbl}>Responsável padrão</label>
                <input className={inp} value={f.owner ?? ""} placeholder="equipe, papel ou pessoa"
                  onChange={(e) => set("owner", e.target.value || null)} />
                <p className="mt-1 text-[11px] text-white/40">
                  Quem recebe a etapa quando ninguém a assume. Cada subtarefa pode herdar isto, apontar outra
                  pessoa ou usar a regra de elegibilidade — configurado dentro dela.
                </p>
              </div>
              {/* O SLA MORA NA ABA GERAL, e só lá.
                  Ele estava aqui também, e um atributo com dois campos na mesma tela é a
                  mesma duplicidade que o editor curto tinha com o configurador: o
                  administrador muda num, olha no outro e vê valor diferente até salvar. */}
              <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] text-white/45">
                O prazo do passo está em <b>Geral › Peso / SLA</b>: {f.slaDays ?? 0} dia(s). Ele vale para as
                subtarefas que não declaram o seu. É prazo interno — não se confunde com a previsão que o órgão dá,
                que fica registrada na execução.
              </p>
            </>
          )}

          {/* ────────────────────────── EXECUTOR ────────────────────────── */}
          {aba === "executor" && (
            <>
              <div>
                <label className={lbl}>Executor</label>
                <select className={inp} value={f.executorKey ?? ""} onChange={(e) => set("executorKey", e.target.value || null)}>
                  <option value="">(resolvido pela chave do passo)</option>
                  {(cat?.executores ?? []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
              {exec && (
                <div className={card}>
                  <div className="text-xs font-medium text-white/80">O que “{exec.label}” sabe fazer</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    {([
                      ["acoesCadastradas", "ações cadastradas"], ["checklistCadastrado", "checklist"],
                      ["suportaCanais", "canais"], ["suportaEvidencia", "evidência"],
                      ["suportaEsperaExterna", "espera externa"], ["suportaCondicoes", "condições"],
                    ] as Array<[keyof Executor, string]>).map(([k, rotulo]) => (
                      <span key={String(k)} className={`rounded px-1.5 py-0.5 ${exec[k] ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/40"}`}>
                        {exec[k] ? "✓" : "✕"} {rotulo}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-white/40">
                    Executor é capacidade técnica. Ele não decide subtarefa, ação, resultado, canal nem checklist —
                    recebe a configuração. Publicar uma configuração que ele não sabe desenhar é recusado.
                  </p>
                  <div className="mt-2 text-[11px] text-white/40">
                    Efeitos que ele dispara nesta fase: {efeitosOfertados.length === 0
                      ? <span className="text-amber-300/70">nenhum — a fase não declarou competência compatível.</span>
                      : efeitosOfertados.map((e) => e.label).join(", ")}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ────────────────────────── REABERTURA ────────────────────────── */}
          {aba === "reabertura" && (
            <>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={f.reaberturaPermitida !== false} onChange={(e) => set("reaberturaPermitida", e.target.checked)} />
                Esta etapa pode ser reaberta
              </label>
              <div>
                <label className={lbl}>O que a tela propõe por padrão</label>
                <select className={inp} value={f.reaberturaEstrategia ?? "ESCOLHA_MANUAL"} onChange={(e) => set("reaberturaEstrategia", e.target.value)}>
                  <option value="ESCOLHA_MANUAL">Perguntar (não propõe nada)</option>
                  <option value="SOMENTE_ESTA">Somente esta</option>
                  <option value="ESTA_E_DEPENDENTES">Esta e as que dependem dela</option>
                </select>
                <p className="mt-1 text-[11px] text-white/40">
                  &quot;As que dependem dela&quot; vem do grafo cadastrado na aba Dependências — nunca da ordem da lista.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={f.reaberturaExigeJustificativa !== false} onChange={(e) => set("reaberturaExigeJustificativa", e.target.checked)} />
                Reabrir exige justificativa
              </label>
              <div>
                <label className={lbl}>Permissão exigida (vazio = a permissão geral)</label>
                <input className={inp} value={f.reaberturaPermissao ?? ""} onChange={(e) => set("reaberturaPermissao", e.target.value || null)} />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
          <button onClick={onFechar} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10">Cancelar</button>
          <button onClick={salvar} disabled={salvando}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {salvando ? "Salvando…" : "Salvar rascunho"}
          </button>
        </div>
      </div>
    </div>
  )
}
