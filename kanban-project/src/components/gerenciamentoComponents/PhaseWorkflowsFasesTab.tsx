"use client"

import { useEffect, useState, useCallback } from "react"
import ConfiguracaoDoPassoModal, { type PassoConfiguravel } from "./ConfiguracaoDoPassoModal"
import PublicarWorkflowModal from "./PublicarWorkflowModal"

// Rótulo da CARDINALIDADE do passo (quantas instâncias, presas a qual entidade).
// Nada a ver com "global (compartilhado)", que é o compartilhamento do WORKFLOW.
/**
 * QUEM MULTIPLICA TAREFA É A UNIDADE DE TRABALHO.
 *
 * A cardinalidade dos passos diz sobre QUANTAS coisas o workflow se repete: por
 * documento, por pessoa, por necessidade, ou uma vez só na fase. Cinco etapas
 * com cardinalidade "por documento" são cinco etapas de UMA tarefa por
 * documento — e não cinco tarefas.
 */
const UNIDADE_LABEL: Record<string, string> = {
  POR_DOCUMENTO: "documento",
  POR_NECESSIDADE: "registro/certidão",
  POR_PESSOA: "pessoa",
  UNICO: "processo",
  "": "unidade de trabalho",
}
function unidadeDoWorkflow(passos: Array<{ cardinalidade?: string | null }>): string {
  const usadas = [...new Set(passos.map((p) => p.cardinalidade || "").filter(Boolean))]
  return usadas.length === 1 ? usadas[0] : ""
}

const CARDINALIDADE_LABEL: Record<string, string> = {
  "": "conforme a fase",
  PROCESSO: "1 por fase",
  PESSOA: "por pessoa",
  NECESSIDADE: "por certidão",
  DOCUMENTO: "por documento",
}

// ============================================================
// Tipos
// ============================================================
interface Step {
  id?: number
  /** Configuração cadastrada do passo — o que era array dentro do executor. */
  executorKey?: string | null
  dependeDe?: string[] | null
  acoes?: Array<{ key?: string; label: string; descricao?: string | null; effectKey: string; ordem?: number; requerCampos?: string[]; ativo?: boolean }>
  campos?: Array<{ key?: string; label: string; tipo: string; obrigatorio?: boolean; opcoes?: unknown; ajuda?: string | null; ordem?: number; ativo?: boolean }>
  checkItens?: Array<{ key?: string; label: string; descricao?: string | null; obrigatorio?: boolean; ordem?: number; ativo?: boolean }>
  // A LEITURA devolve o canal aninhado (junta o vínculo com o catálogo); a EDIÇÃO
  // manda a chave. As duas formas convivem aqui porque este tipo descreve as duas
  // pontas; quem normaliza é o modal, ao abrir.
  canais?: Array<{ canalKey?: string; canal?: { key: string; label?: string }; ordem?: number; ativo?: boolean; exigeProtocolo?: boolean | null; exigeAnexo?: boolean | null; exigeRastreio?: boolean | null; exigeObservacao?: boolean | null }>
  requisitos?: Array<{ key?: string; label: string; descricao?: string | null; tipo: string; alvoKey?: string | null; minimo?: number; obrigatorio?: boolean; acaoKey?: string | null; evidenciaTipoId?: number | null; mimesPermitidos?: string[] | null; momento?: string; ordem?: number; ativo?: boolean }>
  /// A REGRA DE CONCLUSÃO cadastrada. `ACAO_DO_PASSO` = o que sempre valeu.
  regraDeConclusao?: string
  /// AS SUBTAREFAS — o que acontece dentro do passo, com os filhos delas.
  subtarefas?: Array<Record<string, unknown>>
  key: string
  label: string
  description?: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  /** Cardinalidade persistida. Vazio = herda o escopo operacional da fase. */
  cardinalidade?: string | null
  owner?: string | null
  priority?: string
  slaDays?: number
  completionRule?: string | null
  checklist?: unknown
}
interface Workflow {
  id: number
  wfUid: string
  templateId: number | null
  tipoProcessoId: number | null
  phaseKey: string
  name: string
  active: boolean
  versao?: number
  /** Preenchido = a definição viva difere da última publicação. */
  rascunhoAlteradoEm?: string | null
  passos: Step[]
  // CONTRATO DE EXECUÇÃO — o que o workflow declara operar. Antes isso era
  // conhecimento do motor (escopo canônico da fase); agora é do cadastro.
  escopoExecucao?: string | null
  exigeDocumento?: boolean
  exigePessoa?: boolean
  familiaDocumental?: { id: number; code: string; name: string } | null
  perfis?: Array<{ id: number; code: string; name: string; escopoInstanciacao: string }>
}
interface Fase { phaseKey: string; label: string; order: number }
interface TipoProcesso { id: number; name: string; fases: Fase[] }
interface ModeloPasso { name: string }
interface Modelo {
  id: number
  name: string
  description?: string | null
  category?: string | null
  recommendedPhases?: string[] | null
  usedByCount: number
  passos: ModeloPasso[]
}
interface Data {
  tiposProcesso: TipoProcesso[]
  workflows: Workflow[]
  modelosWorkflow: Modelo[]
}

// ============================================================
// Helpers
// ============================================================
function slug(s: string) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}
function authHeaders(): HeadersInit {
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` }
           : { "Content-Type": "application/json" }
}

const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-white/60"

// ícones compactos
const ICopy = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>)
const IUp = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>)
const IDown = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>)
const ITrash = () => (<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>)

// ============================================================
// Componente
// ============================================================
export default function PhaseWorkflowsFasesTab() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)         // apply/criar/excluir (bloqueia botões)
  const [savingId, setSavingId] = useState<number | null>(null)  // passo gravando em 2º plano
  const [flash, setFlash] = useState("")

  const [ptId, setPtId] = useState<string>("")
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]) // vazio = todas

  const [applyFor, setApplyFor] = useState<{ phaseKey: string; label: string } | null>(null)
  const [applySel, setApplySel] = useState<number | null>(null)
  const [replaceAsk, setReplaceAsk] = useState<{ templateId: number; phaseKey: string; label: string } | null>(null)

  const [configModal, setConfigModal] = useState<{ wf: Workflow; step: Step } | null>(null)
  const [problemas, setProblemas] = useState<Array<{ codigo: string; stepKey: string | null; mensagem: string }>>([])
  const [publicarWf, setPublicarWf] = useState<Workflow | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gerenciamento/workflows-fase", { headers: authHeaders() })
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const showFlash = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2500) }

  // patch local (sem recarregar tudo)
  const upsertWorkflowLocal = (w: Workflow) => setData(d => {
    if (!d) return d
    const i = d.workflows.findIndex(x => x.id === w.id)
    const workflows = d.workflows.slice()
    if (i < 0) workflows.push(w); else workflows[i] = w
    return { ...d, workflows }
  })
  const removeWorkflowLocal = (id: number) => setData(d =>
    d ? { ...d, workflows: d.workflows.filter(x => x.id !== id) } : d)

  const proc = data?.tiposProcesso.find(t => String(t.id) === ptId) || null
  const ptNum = ptId ? Number(ptId) : null
  const fasesOrdenadas = proc ? proc.fases.slice().sort((a, b) => a.order - b.order) : []

  // resolução: específico do processo → senão global (tipoProcessoId null)
  function workflowForPhase(phaseKey: string): Workflow | null {
    const list = data?.workflows || []
    return list.find(w => w.phaseKey === phaseKey && w.tipoProcessoId === ptNum)
        || list.find(w => w.phaseKey === phaseKey && w.tipoProcessoId === null)
        || null
  }

  const togglePhase = (pk: string) =>
    setPhaseFilter(f => f.includes(pk) ? f.filter(x => x !== pk) : [...f, pk])

  const fasesVisiveis = phaseFilter.length === 0 ? fasesOrdenadas : fasesOrdenadas.filter(p => phaseFilter.includes(p.phaseKey))

  // ---------- ações de workflow ----------
  async function criarVazio(phaseKey: string, label: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/gerenciamento/workflows-fase", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ criar: true, phaseKey, phaseLabel: label, tipoProcessoId: ptNum }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.workflow) { upsertWorkflowLocal(j.workflow); showFlash("Workflow interno criado.") }
      else showFlash(j.error || "Erro ao criar.")
    } finally { setBusy(false) }
  }

  async function aplicar(templateId: number, phaseKey: string, label: string, mode?: "replace") {
    setBusy(true)
    try {
      const res = await fetch("/api/gerenciamento/workflows-fase", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ aplicar: true, templateId, phaseKey, tipoProcessoId: ptNum, mode }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.needsChoice) { setApplyFor(null); setReplaceAsk({ templateId, phaseKey, label }); return }
      if (res.ok && j.workflow) { upsertWorkflowLocal(j.workflow); setApplyFor(null); setReplaceAsk(null); showFlash("Modelo aplicado.") }
      else showFlash(j.error || "Erro ao aplicar.")
    } finally { setBusy(false) }
  }

  async function excluirWorkflow(wf: Workflow) {
    const aviso = wf.tipoProcessoId === null
      ? "Este é o workflow GLOBAL (padrão de todos os processos). Excluir?"
      : "Excluir este Workflow Interno?"
    if (!confirm(aviso)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${wf.id}`, { method: "DELETE", headers: authHeaders() })
      if (res.ok) { removeWorkflowLocal(wf.id); showFlash("Workflow excluído.") }
      else showFlash("Erro ao excluir.")
    } finally { setBusy(false) }
  }

  // ---------- passos (OTIMISTA: muda na hora, grava em 2º plano) ----------
  async function putSteps(wf: Workflow, steps: Step[]): Promise<Workflow | null> {
    const otimista: Workflow = { ...wf, passos: steps.map((s, i) => ({ ...s, ordem: i + 1 })) }
    upsertWorkflowLocal(otimista)          // UI atualiza imediatamente
    setSavingId(wf.id)
    try {
      const res = await fetch(`/api/gerenciamento/workflows-fase/${wf.id}`, {
        method: "PUT", headers: authHeaders(), body: JSON.stringify({ steps }),
      })
      const j = await res.json().catch(() => ({}))
      // TROCA PELO REAL (ids, ordem, chaves geradas pelo servidor) e DEVOLVE. Quem
      // acabou de criar um passo precisa do passo como ele ficou no banco para abrir
      // o configurador nele — reabrir a partir do otimista abriria um passo sem id.
      if (res.ok && j.workflow) { setProblemas([]); upsertWorkflowLocal(j.workflow); return j.workflow as Workflow }
      else if (Array.isArray(j.problemas)) {
        // A PUBLICAÇÃO FOI RECUSADA e o servidor disse por quê. A tela mostra o motivo
        // no lugar onde ele se conserta, em vez de um "erro ao salvar" genérico —
        // e recarrega, porque a transação inteira foi desfeita no servidor.
        setProblemas(j.problemas)
        showFlash("A configuração não pôde ser publicada — veja os motivos no passo.")
        await load()
      }
      else { showFlash(j.error || "Erro ao salvar — recarregando."); await load() }
    } catch {
      showFlash("Erro de conexão — recarregando."); await load()
    } finally { setSavingId(null) }
    return null
  }

  /**
   * CRIAR UM PASSO É CRIAR E ABRIR O CONFIGURADOR — não preencher um formulário curto.
   *
   * Existia um modal "Adicionar/Editar passo" com sete atributos. Ele era um SEGUNDO
   * editor da mesma entidade: nome, cardinalidade, SLA e condição de conclusão podiam
   * ser mudados ali e também no configurador completo, e o modal curto não alcançava o
   * resto (regra de conclusão em vocabulário fechado, subtarefas, campos, ações,
   * checklist, requisitos, evidências, dependências, executor, reabertura). Duas
   * telas para uma entidade fazem o administrador ter de saber por qual delas entrar
   * para achar o que procura.
   *
   * Agora o passo nasce com o mínimo que o servidor exige — um nome e uma chave — e o
   * configurador abre nele. Todo atributo se edita num lugar só.
   */
  async function criarPasso(wf: Workflow) {
    let k = "novo_passo"; let n = 2
    while (wf.passos.some((s) => s.key === k)) { k = `novo_passo_${n}`; n++ }
    const novo: Step = {
      key: k, label: "Novo passo", ordem: wf.passos.length + 1,
      createsTask: true, required: true, cardinalidade: null,
      owner: "", slaDays: 0, completionRule: "", priority: "medium",
    }
    const salvo = await putSteps(wf, [...wf.passos, novo])
    if (!salvo) return
    // ABRE NO PASSO COMO ELE FICOU NO BANCO — mesma entidade, mesmo id, mesma versão.
    const criado = salvo.passos.find((s) => s.key === k)
    if (criado) setConfigModal({ wf: salvo, step: criado })
  }
  function dupStep(wf: Workflow, st: Step) {
    let k = st.key + "_copia"; let n = 2
    while (wf.passos.some(s => s.key === k)) { k = st.key + "_copia_" + n; n++ }
    const copy: Step = { ...st, id: undefined, key: k, label: st.label + " (cópia)" }
    const idx = wf.passos.findIndex(s => s.key === st.key)
    const steps = [...wf.passos]; steps.splice(idx + 1, 0, copy)
    putSteps(wf, steps)
  }
  function moveStep(wf: Workflow, st: Step, dir: -1 | 1) {
    const arr = wf.passos.slice().sort((a, b) => a.ordem - b.ordem)
    const i = arr.findIndex(s => s.key === st.key); const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    putSteps(wf, arr)
  }
  function removeStep(wf: Workflow, st: Step) {
    if (!confirm(`Remover o passo "${st.label}"?`)) return
    putSteps(wf, wf.passos.filter(s => s.key !== st.key))
  }

  // ---------- render ----------
  if (loading) return <div className="py-24 text-center text-white/50">Carregando…</div>

  const modelos = data?.modelosWorkflow || []
  const modelosOrdenados = applyFor
    ? modelos.slice().sort((a, b) => {
        const ra = (a.recommendedPhases || []).includes(applyFor.phaseKey) ? 0 : 1
        const rb = (b.recommendedPhases || []).includes(applyFor.phaseKey) ? 0 : 1
        return ra - rb || a.name.localeCompare(b.name)
      })
    : []

  return (
    <div className="space-y-5">
      {/* aviso — escopo desta área */}
      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Aqui você define os <strong>PASSOS</strong> e a <strong>CONDIÇÃO DE CONCLUSÃO</strong> da fase. Quando todos os requisitos obrigatórios forem atendidos e não houver bloqueios, o sistema conclui a fase e segue a <strong>ORDEM</strong> do Workflow Macro. Esta área <strong>NÃO</strong> escolhe a próxima fase.
      </div>

      {flash && (
        <div className="rounded-xl border border-green-400/30 bg-green-500/15 px-4 py-3 text-sm text-green-200">{flash}</div>
      )}

      {/* cabeçalho */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Workflows Internos das Fases</h2>
        <p className="mt-1 text-sm text-white/60">
          Os workflows internos definem os passos <strong>dentro</strong> de cada fase. Escolha o Processo para ver os workflows aplicados por fase. Para criar ou editar modelos reutilizáveis, use a biblioteca <span className="text-blue-300">“Modelos de Workflow Interno”</span>.
        </p>

        <div className="mt-4 max-w-md">
          <label className={labelCls}>Processo de Nacionalidade</label>
          <select value={ptId} onChange={e => { setPtId(e.target.value); setPhaseFilter([]) }} className={inputCls}>
            <option value="" className="bg-zinc-900">— Selecione um processo —</option>
            {data?.tiposProcesso.map(t => (
              <option key={t.id} value={t.id} className="bg-zinc-900">{t.name}</option>
            ))}
          </select>
        </div>

        {/* filtro multi-fase */}
        {proc && fasesOrdenadas.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button onClick={() => setPhaseFilter([])}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${phaseFilter.length === 0 ? "bg-blue-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
              Todas as fases
            </button>
            <span className="text-white/20">|</span>
            {fasesOrdenadas.map(p => {
              const on = phaseFilter.includes(p.phaseKey)
              return (
                <button key={p.phaseKey} onClick={() => togglePhase(p.phaseKey)}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${on ? "bg-blue-600 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}>
                  {on ? "✓ " : ""}{p.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* corpo */}
      {!proc && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">
          Escolha um Processo de Nacionalidade para ver os workflows internos de cada fase.
        </div>
      )}
      {proc && fasesOrdenadas.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/50">
          Este processo ainda não possui fases no Workflow Macro.
        </div>
      )}

      {proc && fasesVisiveis.map(p => {
        const wf = workflowForPhase(p.phaseKey)
        return (
          <div key={p.phaseKey} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            {/* header do card */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">[{p.order}] {p.label}</span>
                  {wf && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${wf.tipoProcessoId === null ? "bg-white/10 text-white/60" : "bg-sky-500/15 text-sky-300"}`}>
                      {wf.tipoProcessoId === null ? "global (compartilhado)" : "deste processo"}
                    </span>
                  )}
                  {wf?.templateId != null && (
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">de modelo</span>
                  )}
                  {wf && savingId === wf.id && (
                    <span className="text-[10px] text-white/40">· salvando…</span>
                  )}
                </div>
                {/* O RESUMO DIZIA "5 passo(s) · 5 gera(m) tarefa", e isso descrevia
                    uma arquitetura que não existe mais: cinco etapas do mesmo
                    documento são UMA tarefa, não cinco. Quem multiplica tarefas é a
                    UNIDADE DE TRABALHO (a cardinalidade — por documento, por pessoa,
                    por processo), nunca a quantidade de passos. */}
                {wf
                  ? <div className="mt-0.5 text-xs text-green-300/80">
                      {wf.passos.length} etapa(s) · 1 tarefa por {UNIDADE_LABEL[unidadeDoWorkflow(wf.passos)] ?? "unidade de trabalho"}
                    </div>
                  : <div className="mt-0.5 text-xs text-white/40">Sem workflow interno configurado.</div>}

                {/* CONTRATO DE EXECUÇÃO — herdado pelo workflow inteiro, por isso
                    fica no cabeçalho e não se repete em cada passo. Só leitura:
                    quem declara é o cadastro, e o passo mostra só o que é dele. */}
                {wf?.escopoExecucao && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300">
                      {wf.escopoExecucao === "DOCUMENTO" ? "documental" : `execução por ${wf.escopoExecucao.toLowerCase()}`}
                    </span>
                    {wf.perfis?.[0] && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">perfil: {wf.perfis[0].name}</span>
                    )}
                    {wf.familiaDocumental && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">família: {wf.familiaDocumental.name}</span>
                    )}
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                      {CARDINALIDADE_LABEL[wf.escopoExecucao] ?? wf.escopoExecucao}
                    </span>
                    {wf.exigeDocumento && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">exige documento</span>}
                    {wf.exigePessoa && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">exige pessoa</span>}
                    {wf.versao != null && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/50">v{wf.versao}</span>}
                    {wf.rascunhoAlteradoEm && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300" title="Há alterações salvas que ainda não valem para os processos.">
                        rascunho não publicado
                      </span>
                    )}
                  </div>
                )}
              </div>
              {wf && (
                <div className="flex flex-none flex-wrap justify-end gap-1.5">
                  <button onClick={() => void criarPasso(wf)} className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500">+ Passo</button>
                  {/* PUBLICAR É UM ATO SEPARADO DE SALVAR. Enquanto não se clica aqui,
                      o que os processos leem continua sendo a versão anterior. */}
                  <button onClick={() => setPublicarWf(wf)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${wf.rascunhoAlteradoEm ? "bg-emerald-600 text-white hover:bg-emerald-500" : "border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"}`}>
                    Publicar…
                  </button>
                  <button onClick={() => excluirWorkflow(wf)} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10">Excluir</button>
                </div>
              )}
            </div>

            {/* passos ou vazio */}
            {!wf ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => criarVazio(p.phaseKey, p.label)} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">+ Criar workflow interno</button>
              </div>
            ) : wf.passos.length === 0 ? (
              <div className="mt-3 text-xs text-white/40">Nenhum passo ainda. Use “+ Passo” ou aplique um modelo.</div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {wf.passos.slice().sort((a, b) => a.ordem - b.ordem).map((st, idx, arr) => (
                  <div key={st.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white">{idx + 1}. {st.label}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {/* O badge dizia "gera tarefa" em cada passo — leitura do
                            modelo antigo step→tarefa. O passo não gera tarefa: ele
                            é uma ETAPA da tarefa da unidade de trabalho. O que a
                            flag realmente diz é que a etapa é trabalho humano que
                            entra no roteiro de execução. */}
                        {/* O RESUMO SEGUE O MESMO MODELO MENTAL DO CONFIGURADOR:
                            primeiro o que o passo É, depois o que ele CONTÉM. Antes
                            eram nove selos misturando as duas coisas. */}
                        {st.required
                          ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">obrigatório</span>
                          : <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/50">opcional</span>}
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">{CARDINALIDADE_LABEL[st.cardinalidade || ""] ?? st.cardinalidade}</span>
                        {!!st.slaDays && st.slaDays > 0 && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">prazo {st.slaDays}d</span>}
                        {st.owner && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/60">{st.owner}</span>}
                        {!st.createsTask && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/50" title="Não entra no roteiro de trabalho do operador.">sem trabalho operacional</span>}
                        {(() => {
                          const partes = [
                            (st.subtarefas?.length ?? 0) > 0 ? `${st.subtarefas!.length} subtarefa${st.subtarefas!.length > 1 ? "s" : ""}` : null,
                            (st.campos?.length ?? 0) > 0 ? `${st.campos!.length} campo${st.campos!.length > 1 ? "s" : ""}` : null,
                            (st.checkItens?.length ?? 0) > 0 ? `checklist ${st.checkItens!.length}` : null,
                            (st.acoes?.length ?? 0) > 0 ? `${st.acoes!.length} resultado${st.acoes!.length > 1 ? "s" : ""}` : null,
                            (st.dependeDe?.length ?? 0) > 0 ? `depende de ${st.dependeDe!.length}` : null,
                          ].filter(Boolean)
                          return partes.length > 0
                            ? <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">{partes.join(" · ")}</span>
                            : <span className="rounded bg-white/5 px-1.5 py-0.5 text-white/35">sem configuração ainda</span>
                        })()}
                        {problemas.some((pr) => pr.stepKey === st.key) && <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-red-300">publicação recusada</span>}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-0.5 text-white/50">
                      <button title="Configurar tudo o que acontece dentro deste passo" aria-label="Configurar"
                        onClick={() => setConfigModal({ wf, step: st })}
                        className="rounded px-2 py-1 text-[11px] text-blue-300 hover:bg-blue-500/10 hover:text-blue-200">Configurar</button>
                      {/* O LÁPIS SAIU. Ele abria um segundo editor da MESMA entidade,
                          com sete atributos que o configurador já edita — e sem
                          alcançar o resto do passo. Deixá-lo abrindo o configurador
                          seria a mesma duplicidade sem o segundo modal: dois botões
                          vizinhos para a mesma coisa. "Configurar" é a porta única. */}
                      <button title="Duplicar" aria-label="Duplicar" onClick={() => dupStep(wf, st)} className="rounded p-1 hover:bg-white/10 hover:text-white"><ICopy /></button>
                      <button title="Subir" aria-label="Subir" disabled={idx === 0} onClick={() => moveStep(wf, st, -1)} className="rounded p-1 hover:bg-white/10 hover:text-white disabled:opacity-30"><IUp /></button>
                      <button title="Descer" aria-label="Descer" disabled={idx === arr.length - 1} onClick={() => moveStep(wf, st, 1)} className="rounded p-1 hover:bg-white/10 hover:text-white disabled:opacity-30"><IDown /></button>
                      <button title="Remover" aria-label="Remover" onClick={() => removeStep(wf, st)} className="rounded p-1 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"><ITrash /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* CONFIGURAÇÃO DO PASSO — campos, ações, checklist e dependências */}
      {configModal && (
        <ConfiguracaoDoPassoModal
          passo={configModal.step as PassoConfiguravel}
          irmaos={configModal.wf.passos.map((s) => ({ key: s.key, label: s.label }))}
          phaseKey={configModal.wf.phaseKey}
          faseLabel={configModal.wf.name}
          problemas={problemas}
          onFechar={() => setConfigModal(null)}
          onSalvar={async (novo) => {
            const wf = configModal.wf
            const steps = wf.passos.map((s) => (s.key === configModal.step.key ? { ...s, ...novo } : s))
            await putSteps(wf, steps as Step[])
            setConfigModal(null)
          }}
        />
      )}

      {/* PUBLICAÇÃO — a prévia do que muda, antes de mudar */}
      {publicarWf && (
        <PublicarWorkflowModal
          workflowId={publicarWf.id}
          authHeaders={authHeaders}
          onFechar={() => setPublicarWf(null)}
          onPublicado={async (_v, mensagem) => {
            setPublicarWf(null)
            showFlash(mensagem)
            await load()
          }}
        />
      )}

      {/* MODAL — aplicar modelo */}
      {applyFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setApplyFor(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-white/10 px-6 py-4">
              <h3 className="font-semibold text-white">Aplicar modelo de workflow</h3>
              <p className="mt-0.5 text-xs text-white/50">Fase: {applyFor.label} · os passos do modelo serão copiados para esta fase.</p>
            </div>
            <div className="space-y-1.5 px-6 py-4">
              {modelosOrdenados.length === 0 && <div className="text-sm text-white/50">Nenhum modelo na biblioteca.</div>}
              {modelosOrdenados.map(m => {
                const rec = (m.recommendedPhases || []).includes(applyFor.phaseKey)
                return (
                  <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${applySel === m.id ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                    <input type="radio" name="modelo" checked={applySel === m.id} onChange={() => setApplySel(m.id)} className="mt-1" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{m.name}</span>
                        {rec && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] text-green-300">recomendado</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-white/50">{m.passos.length} passo(s){m.description ? " · " + m.description : ""}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button onClick={() => setApplyFor(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={!applySel || busy} onClick={() => applySel && aplicar(applySel, applyFor.phaseKey, applyFor.label)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Aplicar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — confirmar substituição */}
      {replaceAsk && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setReplaceAsk(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-white">Substituir os passos?</h3>
            <p className="mt-2 text-sm text-white/60">A fase <strong>{replaceAsk.label}</strong> já tem um workflow interno neste processo. Aplicar o modelo vai <strong>substituir os passos atuais</strong> pelos do modelo.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setReplaceAsk(null)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancelar</button>
              <button disabled={busy} onClick={() => aplicar(replaceAsk.templateId, replaceAsk.phaseKey, replaceAsk.label, "replace")} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">Substituir passos</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}