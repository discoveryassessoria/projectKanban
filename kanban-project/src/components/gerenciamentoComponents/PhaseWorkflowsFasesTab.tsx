"use client"

import { useEffect, useState, useCallback } from "react"
import ConfiguracaoDoPassoModal, { type PassoConfiguravel } from "./ConfiguracaoDoPassoModal"
import PublicarWorkflowModal from "./PublicarWorkflowModal"
import { CARDINALIDADES } from "./tiposDoCadastroDoPasso"

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
  /// TAREFA SELECIONADA DA BIBLIOTECA (mandato "separação Biblioteca ×
  /// Workflow Interno", 22/09/2026). Preenchido = este passo NÃO tem
  /// conteúdo próprio — os campos acima (acoes/campos/subtarefas/etc.) ficam
  /// vazios de propósito; o conteúdo de verdade é `conteudoDaBiblioteca`,
  /// resolvido pelo servidor a partir da versão pinada do Modelo.
  bibliotecaModeloId?: number | null
  bibliotecaModeloVersao?: number | null
  bibliotecaModeloInfo?: { id: number; chave: string; nome: string; versaoPublicada: number | null; status: string } | null
  conteudoDaBiblioteca?: {
    subtarefas?: Array<Record<string, unknown>>
    campos?: Array<Record<string, unknown>>
    checkItens?: Array<Record<string, unknown>>
    acoes?: Array<Record<string, unknown>>
    requisitos?: Array<Record<string, unknown>>
  } | null
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
interface Data {
  tiposProcesso: TipoProcesso[]
  workflows: Workflow[]
}
interface ModeloDaBiblioteca {
  id: number
  chave: string
  nome: string
  descricao: string | null
  status: "RASCUNHO" | "PUBLICADO" | "INATIVO"
  versaoPublicada: number | null
  passo: { _count: { subtarefas: number } } | null
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

const inputCls = "w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]"

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

  // SELECIONAR TAREFA DA BIBLIOTECA (mandato "separação Biblioteca × Workflow
  // Interno", 22/09/2026) — substitui o antigo "+ Passo em branco".
  const [selecionando, setSelecionando] = useState<Workflow | null>(null)
  const [modelosDaBiblioteca, setModelosDaBiblioteca] = useState<ModeloDaBiblioteca[] | null>(null)
  const [resumoStep, setResumoStep] = useState<{ wf: Workflow; step: Step } | null>(null)

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
   * SELECIONAR TAREFA DA BIBLIOTECA (mandato "separação Biblioteca × Workflow
   * Interno", 22/09/2026) — substitui o antigo "+ Passo", que criava um passo
   * em branco autorado direto na fase.
   *
   * O passo desta fase NUNCA mais nasce com conteúdo próprio: nasce como
   * SELEÇÃO de um Modelo PUBLICADO da Biblioteca, pinada na versão publicada
   * no instante da seleção (nunca "a mais recente" implícita — trocar de
   * versão é reselecionar, uma decisão própria). O conteúdo (subtarefas,
   * campos, ações, checklist, requisitos, regra de conclusão) mora só na
   * Biblioteca; este passo guarda apenas identidade (`key`) e posição
   * (`ordem`/`dependeDe`) dentro DESTA fase — nunca uma cópia editável.
   */
  async function abrirSeletorDaBiblioteca(wf: Workflow) {
    setSelecionando(wf)
    if (modelosDaBiblioteca == null) {
      try {
        const res = await fetch("/api/gerenciamento/biblioteca-tarefas/modelos", { headers: authHeaders() })
        const j = await res.json().catch(() => ({}))
        setModelosDaBiblioteca(res.ok ? (j.modelos ?? []) : [])
      } catch { setModelosDaBiblioteca([]) }
    }
  }
  async function selecionarDaBiblioteca(wf: Workflow, modelo: ModeloDaBiblioteca) {
    if (modelo.status !== "PUBLICADO" || modelo.versaoPublicada == null) return
    let k = modelo.chave, n = 2
    while (wf.passos.some((s) => s.key === k)) { k = `${modelo.chave}_${n}`; n++ }
    const novo: Step = {
      key: k, label: modelo.nome, ordem: wf.passos.length + 1,
      createsTask: true, required: true, cardinalidade: null,
      bibliotecaModeloId: modelo.id, bibliotecaModeloVersao: modelo.versaoPublicada,
    }
    setSelecionando(null)
    await putSteps(wf, [...wf.passos, novo])
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
    // QUEM DEPENDE DESTE PASSO precisa perder a referência JUNTO — senão o
    // servidor recusa a gravação inteira (DEPENDENCIA_INEXISTENTE, em
    // validacao-de-publicacao.ts) porque um `dependeDe` sobrevivente apontaria
    // para uma chave que não existe mais. Sem isto, o clique "removia" o passo
    // só na tela: o save falhava, `load()` trazia o estado real de volta do
    // servidor, e o passo reaparecia — parecendo que excluir não fazia nada.
    const dependentes = wf.passos.filter(s => s.key !== st.key && s.dependeDe?.includes(st.key))
    const aviso = dependentes.length
      ? `\n\n${dependentes.length} outro(s) passo(s) dependiam dele (${dependentes.map(s => s.label).join(", ")}) — essa dependência também será removida.`
      : ""
    if (!confirm(`Remover o passo "${st.label}"?${aviso}`)) return
    const restantes = wf.passos
      .filter(s => s.key !== st.key)
      .map(s => s.dependeDe?.includes(st.key) ? { ...s, dependeDe: s.dependeDe!.filter(k => k !== st.key) } : s)
    putSteps(wf, restantes)
  }

  // ---------- render ----------
  if (loading) return <div className="py-24 text-center text-[var(--text-secondary)]">Carregando…</div>

  return (
    <div className="space-y-5">
      {/* aviso — escopo desta área */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-amber-800">
        Aqui você define os <strong>PASSOS</strong> e a <strong>CONDIÇÃO DE CONCLUSÃO</strong> da fase. Quando todos os requisitos obrigatórios forem atendidos e não houver bloqueios, o sistema conclui a fase e segue a <strong>ORDEM</strong> do Workflow Macro. Esta área <strong>NÃO</strong> escolhe a próxima fase.
      </div>

      {flash && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-green-800">{flash}</div>
      )}

      {/* cabeçalho */}
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-white">Workflows Internos das Fases</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Os workflows internos definem os passos <strong>dentro</strong> de cada fase. Escolha o Processo para ver os workflows aplicados por fase. Para criar ou editar modelos reutilizáveis, use a biblioteca <span className="text-[var(--text-secondary)]">“Modelos de Workflow Interno”</span>.
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
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${phaseFilter.length === 0 ? "bg-[var(--text-muted)] text-white" : "bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
              Todas as fases
            </button>
            <span className="text-[var(--text-muted)]">|</span>
            {fasesOrdenadas.map(p => {
              const on = phaseFilter.includes(p.phaseKey)
              return (
                <button key={p.phaseKey} onClick={() => togglePhase(p.phaseKey)}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${on ? "bg-[var(--text-muted)] text-white" : "bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
                  {on ? "✓ " : ""}{p.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* corpo */}
      {!proc && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center text-sm text-[var(--text-secondary)]">
          Escolha um Processo de Nacionalidade para ver os workflows internos de cada fase.
        </div>
      )}
      {proc && fasesOrdenadas.length === 0 && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-8 text-center text-sm text-[var(--text-secondary)]">
          Este processo ainda não possui fases no Workflow Macro.
        </div>
      )}

      {proc && fasesVisiveis.map(p => {
        const wf = workflowForPhase(p.phaseKey)
        return (
          <div key={p.phaseKey} className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 backdrop-blur-sm">
            {/* header do card */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">[{p.order}] {p.label}</span>
                  {wf && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${wf.tipoProcessoId === null ? "bg-[var(--surface-primary)] text-[var(--text-secondary)]" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>
                      {wf.tipoProcessoId === null ? "global (compartilhado)" : "deste processo"}
                    </span>
                  )}
                  {wf?.templateId != null && (
                    <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">de modelo</span>
                  )}
                  {wf && savingId === wf.id && (
                    <span className="text-[10px] text-[var(--text-muted)]">· salvando…</span>
                  )}
                </div>
                {/* O RESUMO DIZIA "5 passo(s) · 5 gera(m) tarefa", e isso descrevia
                    uma arquitetura que não existe mais: cinco etapas do mesmo
                    documento são UMA tarefa, não cinco. Quem multiplica tarefas é a
                    UNIDADE DE TRABALHO (a cardinalidade — por documento, por pessoa,
                    por processo), nunca a quantidade de passos. */}
                {wf
                  ? <div className="mt-0.5 text-xs text-green-800/80">
                      {wf.passos.length} etapa(s) · 1 tarefa por {UNIDADE_LABEL[unidadeDoWorkflow(wf.passos)] ?? "unidade de trabalho"}
                    </div>
                  : <div className="mt-0.5 text-xs text-[var(--text-muted)]">Sem workflow interno configurado.</div>}

                {/* CONTRATO DE EXECUÇÃO — herdado pelo workflow inteiro, por isso
                    fica no cabeçalho e não se repete em cada passo. Só leitura:
                    quem declara é o cadastro, e o passo mostra só o que é dele. */}
                {wf?.escopoExecucao && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                      {wf.escopoExecucao === "DOCUMENTO" ? "documental" : `execução por ${wf.escopoExecucao.toLowerCase()}`}
                    </span>
                    {wf.perfis?.[0] && (
                      <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[var(--text-secondary)]">perfil: {wf.perfis[0].name}</span>
                    )}
                    {wf.familiaDocumental && (
                      <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-white/70">família: {wf.familiaDocumental.name}</span>
                    )}
                    <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-white/70">
                      {CARDINALIDADE_LABEL[wf.escopoExecucao] ?? wf.escopoExecucao}
                    </span>
                    {wf.exigeDocumento && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-green-800">exige documento</span>}
                    {wf.exigePessoa && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-green-800">exige pessoa</span>}
                    {wf.versao != null && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">v{wf.versao}</span>}
                    {wf.rascunhoAlteradoEm && (
                      <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-amber-800" title="Há alterações salvas que ainda não valem para os processos.">
                        rascunho não publicado
                      </span>
                    )}
                  </div>
                )}
              </div>
              {wf && (
                <div className="flex flex-none flex-wrap justify-end gap-1.5">
                  <button onClick={() => void abrirSeletorDaBiblioteca(wf)} className="rounded-lg bg-[var(--action-primary)] px-2.5 py-1 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)]">Selecionar tarefa da Biblioteca</button>
                  {/* PUBLICAR É UM ATO SEPARADO DE SALVAR. Enquanto não se clica aqui,
                      o que os processos leem continua sendo a versão anterior. */}
                  <button onClick={() => setPublicarWf(wf)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${wf.rascunhoAlteradoEm ? "bg-green-700 text-[var(--color-pure)] hover:bg-green-600" : "border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
                    Publicar…
                  </button>
                  <button onClick={() => excluirWorkflow(wf)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-xs text-red-700 hover:bg-[var(--surface-secondary)]">Excluir</button>
                </div>
              )}
            </div>

            {/* passos ou vazio */}
            {!wf ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => criarVazio(p.phaseKey, p.label)} disabled={busy} className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">+ Criar workflow interno</button>
              </div>
            ) : wf.passos.length === 0 ? (
              <div className="mt-3 text-xs text-[var(--text-muted)]">Nenhuma tarefa ainda. Use "Selecionar tarefa da Biblioteca".</div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {wf.passos.slice().sort((a, b) => a.ordem - b.ordem).map((st, idx, arr) => (
                  <div key={st.key} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white">
                        {idx + 1}. {st.label}
                        {st.bibliotecaModeloId != null && (
                          <span className="ml-1.5 rounded bg-[var(--action-primary)]/20 px-1.5 py-0.5 align-middle text-[10px] font-medium text-[var(--action-primary)]" title="Conteúdo mantido na Biblioteca de Tarefas — este passo é só a seleção.">
                            Biblioteca{st.bibliotecaModeloInfo ? ` · ${st.bibliotecaModeloInfo.chave} v${st.bibliotecaModeloVersao}` : ""}
                          </span>
                        )}
                      </div>
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
                          ? <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-amber-800">obrigatório</span>
                          : <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">opcional</span>}
                        <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[var(--text-secondary)]">{CARDINALIDADE_LABEL[st.cardinalidade || ""] ?? st.cardinalidade}</span>
                        {!!st.slaDays && st.slaDays > 0 && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">prazo {st.slaDays}d</span>}
                        {st.owner && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">{st.owner}</span>}
                        {!st.createsTask && <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]" title="Não entra no roteiro de trabalho do operador.">sem trabalho operacional</span>}
                        {(() => {
                          // CONTEÚDO EFETIVO: de `conteudoDaBiblioteca` quando o passo é
                          // uma seleção; dos campos do próprio passo quando é autorado
                          // localmente à moda antiga (compatibilidade).
                          const fonte = st.bibliotecaModeloId != null ? st.conteudoDaBiblioteca : st
                          const subtarefas = fonte?.subtarefas?.length ?? 0
                          const campos = fonte?.campos?.length ?? 0
                          const checkItens = fonte?.checkItens?.length ?? 0
                          const acoes = fonte?.acoes?.length ?? 0
                          const partes = [
                            subtarefas > 0 ? `${subtarefas} subtarefa${subtarefas > 1 ? "s" : ""}` : null,
                            campos > 0 ? `${campos} campo${campos > 1 ? "s" : ""}` : null,
                            checkItens > 0 ? `checklist ${checkItens}` : null,
                            acoes > 0 ? `${acoes} resultado${acoes > 1 ? "s" : ""}` : null,
                            (st.dependeDe?.length ?? 0) > 0 ? `depende de ${st.dependeDe!.length}` : null,
                          ].filter(Boolean)
                          return partes.length > 0
                            ? <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[var(--text-secondary)]">{partes.join(" · ")}</span>
                            : <span className="rounded bg-[var(--surface-primary)] px-1.5 py-0.5 text-[var(--text-muted)]">sem configuração ainda</span>
                        })()}
                        {problemas.some((pr) => pr.stepKey === st.key) && <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-red-700">publicação recusada</span>}
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-0.5 text-[var(--text-secondary)]">
                      {st.bibliotecaModeloId != null ? (
                        <button title="Ver resumo e a dependência desta tarefa na fase — o conteúdo se edita na Biblioteca" aria-label="Resumo"
                          onClick={() => setResumoStep({ wf, step: st })}
                          className="rounded px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)]">Resumo</button>
                      ) : (
                        <button title="Configurar tudo o que acontece dentro deste passo" aria-label="Configurar"
                          onClick={() => setConfigModal({ wf, step: st })}
                          className="rounded px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-secondary)]">Configurar</button>
                      )}
                      {/* O LÁPIS SAIU. Ele abria um segundo editor da MESMA entidade,
                          com sete atributos que o configurador já edita — e sem
                          alcançar o resto do passo. Deixá-lo abrindo o configurador
                          seria a mesma duplicidade sem o segundo modal: dois botões
                          vizinhos para a mesma coisa. "Configurar" é a porta única. */}
                      <button title="Duplicar" aria-label="Duplicar" onClick={() => dupStep(wf, st)} className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-white"><ICopy /></button>
                      <button title="Subir" aria-label="Subir" disabled={idx === 0} onClick={() => moveStep(wf, st, -1)} className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-white disabled:opacity-30"><IUp /></button>
                      <button title="Descer" aria-label="Descer" disabled={idx === arr.length - 1} onClick={() => moveStep(wf, st, 1)} className="rounded p-1 hover:bg-[var(--surface-hover)] hover:text-white disabled:opacity-30"><IDown /></button>
                      <button title="Remover" aria-label="Remover" onClick={() => removeStep(wf, st)} className="rounded p-1 text-red-700/70 hover:bg-[var(--surface-secondary)] hover:text-red-700"><ITrash /></button>
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

      {/* MODAL — selecionar tarefa da Biblioteca (mandato 22/09/2026) */}
      {selecionando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={() => setSelecionando(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="font-semibold text-white">Selecionar tarefa da Biblioteca</h3>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Fase: {selecionando.name} · o conteúdo continua mantido na Biblioteca de Tarefas — este passo só passa a apontar para ele, na versão publicada agora.
              </p>
            </div>
            <div className="space-y-1.5 px-6 py-4">
              {modelosDaBiblioteca == null && <div className="text-sm text-[var(--text-secondary)]">Carregando…</div>}
              {modelosDaBiblioteca != null && modelosDaBiblioteca.filter((m) => m.status === "PUBLICADO").length === 0 && (
                <div className="text-sm text-[var(--text-secondary)]">Nenhum modelo publicado na Biblioteca de Tarefas ainda.</div>
              )}
              {modelosDaBiblioteca?.filter((m) => m.status === "PUBLICADO").map((m) => (
                <button key={m.id} onClick={() => void selecionarDaBiblioteca(selecionando, m)} disabled={busy}
                  className="flex w-full items-start gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-left hover:bg-[var(--surface-hover)] disabled:opacity-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{m.nome}</span>
                      <span className="rounded bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">v{m.versaoPublicada}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {m.chave} · {m.passo?._count.subtarefas ?? 0} subtarefa(s){m.descricao ? " · " + m.descricao : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setSelecionando(null)} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/80 hover:bg-[var(--surface-hover)]">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — resumo de uma tarefa selecionada da Biblioteca (leitura + dependência da fase) */}
      {resumoStep && (
        <ResumoDaTarefaDaBiblioteca
          wf={resumoStep.wf} step={resumoStep.step}
          onFechar={() => setResumoStep(null)}
          onSalvarVinculo={async (dependeDe, cardinalidade) => {
            const wf = resumoStep.wf
            const steps = wf.passos.map((s) => (s.key === resumoStep.step.key ? { ...s, dependeDe, cardinalidade } : s))
            await putSteps(wf, steps)
            setResumoStep(null)
          }}
        />
      )}

    </div>
  )
}

/**
 * RESUMO DE UMA TAREFA SELECIONADA DA BIBLIOTECA — leitura do conteúdo
 * (resolvido pelo servidor) + a ÚNICA configuração que continua sendo desta
 * fase: de qual(is) outro(s) passo(s) da MESMA fase esta tarefa depende. Não
 * é um editor de conteúdo — não duplica nenhum campo que a Biblioteca já
 * mantém (mandato "separação Biblioteca × Workflow Interno", 22/09/2026).
 */
function ResumoDaTarefaDaBiblioteca({
  wf, step, onFechar, onSalvarVinculo,
}: {
  wf: Workflow
  step: Step
  onFechar: () => void
  onSalvarVinculo: (dependeDe: string[], cardinalidade: string | null) => Promise<void>
}) {
  const [dependeDe, setDependeDe] = useState<string[]>(step.dependeDe ?? [])
  // ESCOPO DO VÍNCULO (mandato "separação Biblioteca × Workflow Interno",
  // 23/09/2026) — o modelo da Biblioteca não declara onde se aplica; cada
  // fase que o seleciona decide isso aqui, na própria seleção. Persistido em
  // `PhaseInternalWorkflowStep.cardinalidade`, o mesmo campo dos passos
  // autorados localmente — só que agora só editável no vínculo, nunca no
  // modelo. Vínculos existentes preservam o valor que já tinham.
  const [cardinalidade, setCardinalidade] = useState<string>(step.cardinalidade ?? "")
  const [salvando, setSalvando] = useState(false)
  const irmaos = wf.passos.filter((s) => s.key !== step.key)
  const c = step.conteudoDaBiblioteca

  function alternar(key: string) {
    setDependeDe((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm" onClick={onFechar}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[var(--border-default)] px-6 py-4">
          <h3 className="font-semibold text-white">{step.label}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Modelo <code className="text-white/80">{step.bibliotecaModeloInfo?.chave ?? "—"}</code> · v{step.bibliotecaModeloVersao} da Biblioteca de Tarefas — o conteúdo abaixo é só leitura.
          </p>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div>
            <div className={labelCls}>Subtarefas ({c?.subtarefas?.length ?? 0})</div>
            {(c?.subtarefas?.length ?? 0) === 0
              ? <div className="text-xs text-[var(--text-muted)]">nenhuma</div>
              : (
                <ol className="list-decimal space-y-0.5 pl-4 text-sm text-white/80">
                  {c!.subtarefas!.map((s, i) => <li key={i}>{String((s as { label?: string }).label ?? "")}</li>)}
                </ol>
              )}
          </div>
          <div>
            <div className={labelCls}>Onde esta tarefa se aplica nesta fase</div>
            <select className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--border-default)]"
              value={cardinalidade} onChange={(e) => setCardinalidade(e.target.value)}>
              {CARDINALIDADES.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {CARDINALIDADES.find((opt) => opt.key === cardinalidade)?.ajuda}
            </p>
          </div>
          <div>
            <div className={labelCls}>Depende de (nesta fase)</div>
            {irmaos.length === 0
              ? <div className="text-xs text-[var(--text-muted)]">esta fase não tem outro passo ainda</div>
              : (
                <div className="space-y-1">
                  {irmaos.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 text-sm text-white/80">
                      <input type="checkbox" checked={dependeDe.includes(s.key)} onChange={() => alternar(s.key)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              )}
          </div>
          <a href="/administrator?screen=bibliotecatarefas" className="inline-block text-xs text-[var(--action-primary)] hover:underline">
            Editar o conteúdo na Biblioteca de Tarefas →
          </a>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
          <button onClick={onFechar} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white/80 hover:bg-[var(--surface-hover)]">Fechar</button>
          <button disabled={salvando} onClick={async () => { setSalvando(true); await onSalvarVinculo(dependeDe, cardinalidade || null); setSalvando(false) }}
            className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] hover:bg-[var(--action-primary)] disabled:opacity-50">
            Salvar vínculo
          </button>
        </div>
      </div>
    </div>
  )
}