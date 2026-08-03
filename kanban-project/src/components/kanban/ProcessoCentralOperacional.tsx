// src/components/kanban/ProcessoCentralOperacional.tsx

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useApi } from "@/src/lib/dados"
import { useJsonLocalStorage } from "@/src/lib/cliente"
import { Loader2, Eye, ArrowLeft } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { useAmbiente } from "@/src/contexts/ambiente-context"
import type { ProcessoWithStatus, Processo, OperationalProjection } from "@/src/types/kanban"
import { DocumentoOperationalDrawer } from "./DocumentoOperationalDrawer"
import { InitOperationModal } from "./InitOperationModal"
import { WorkflowMacroTrilha, ResumoDoProcesso, PROCESS_PHASES } from "./WorkflowMacroTrilha"
import { PainelDaFase, type FasePersonRow, type FaseKpi, type FaseTarefaRow } from "./PainelDaFase"
import { ProcessoAnalise } from "./ProcessoAnalise"
import { ProcessoTraducao } from "./ProcessoTraducao"
import { ProcessoFaseGenerica } from "./ProcessoFaseGenerica"
import { ProcessoApostilamento } from "./ProcessoApostilamento"
import { ProcessoFaseFinal } from "./ProcessoFaseFinal"
import { ProcessoRetificacao } from "./ProcessoRetificacao"
import { ProcessoEmissaoRetificada } from "./ProcessoEmissaoRetificada"
import { RetornarFaseButton } from "./RetornarFaseButton"
import { OperacaoAntecipadaModal } from "./OperacaoAntecipadaModal"
import { TarefaTransversalModal } from "./TarefaTransversalModal"
import type { FaseCode } from "@prisma/client"

// Metadados de uma fase materializada (espelho de /api/processos/[id]/phases).
// Operação Antecipada vinculada a uma necessidade (exibida inline no documento).
export interface OpAntecipada {
  id: number
  publicCode: string | null
  necessidadeId: number | null
  status: string
  operationType: string
  targetOperationId: number | null
  originPhaseCode: string | null
  targetPhaseCode: string | null
  objetivo: string | null
  resultadoObtido: string | null
  targetTipoDocumentoId?: number | null
  responsavel?: { id: number; nome: string | null } | null
  operacao: { statusRaw: string; statusLabel: string; concluida: boolean; uiRef: { kind: string; id: number | null; necessidadeId?: number | null } }
  aguardandoAvaliacao: boolean
  vinculavel: boolean
  encerrada: boolean
}

export interface PhaseMeta {
  phaseKey: string
  faseCode: FaseCode | null
  label: string
  ordem: number
  state: "ACTIVE" | "COMPLETED" | "FUTURE"
  materialized: boolean
  workflowInstanceId: number | null
  ciclo: number | null
  status: string | null
}
import { FASES, phaseKeyToFaseCode, faseCodeToPhaseKey } from "@/src/lib/process-stage/fases-catalog"

// Mapa label → phaseKey (a trilha emite o LABEL exato do catálogo).
const LABEL_TO_PHASEKEY: Record<string, string> = Object.fromEntries(
  Object.values(FASES).map((f) => [f.label, f.phaseKey]),
)

// ============================================================
// TIPOS (espelho do endpoint)
// ============================================================

interface MatrixByPerson {
  pessoaId: number
  nome: string
  generation: number
  completed: number
  total: number
  percentage: number
}

interface MatrixMissing {
  docId: number
  pessoaId: number
  pessoaNome: string
  docType: string
  status: string
  generation: number
}

// ROSTER OFICIAL de pessoas do processo — espelho de central-operacional-core.
// Vem do vínculo Pessoa.arvoreId = Processo.arvoreId; NÃO é derivado da fila.
interface PessoaDoProcessoUI {
  pessoaId: number
  publicCode: string | null
  nome: string
  iniciais: string
  requerente: boolean
  linhaReta: boolean
  classificacao: "LINHA_PRINCIPAL" | "FORA_DA_LINHAGEM" | "PENDENTE_CLASSIFICACAO"
  geracao: number | null
  posicao: string
  pendencia: string | null
}

// ✅ NOVO: espelho do bloco faseProgress da rota (estado REAL dos passos).
interface FaseProgress {
  faseCode: string | null
  kind: "documento" | "processo"
  steps: Array<{
    ordem: number
    stepKey: string
    title: string
    status: "concluida" | "em_andamento" | "bloqueada" | "pendente"
    concluidos: number
    total: number
  }>
  docsNaFase: number
  counts: {
    solicitados: number
    aguardando: number
    recebidos: number
    conferidos: number
    validados: number
  }
}

interface CentralOpData {
  // Modo + contexto da fase consultada (Central unificada). ausente ⇒ ACTIVE (retrocompat).
  mode?: "ACTIVE" | "PAST_READ_ONLY"
  phaseContext?: { faseCode: string | null; faseMacroKey: string | null; workflowInstanceId: number | null; ciclo: number | null }
  // Projeção operacional oficial (fonte única do percentual/estado da fase).
  projection?: OperationalProjection | null
  matrix: {
    percentage: number
    completed: number
    total: number
    directPeopleCount: number
    missingCount: number
    nameVariationsCount: number
    byPerson: MatrixByPerson[]
    missing: MatrixMissing[]
  }
  cards: {
    all: number
    pending: number
    overdue: number
    critical: number
    waiting: number
    blocked: number
    noOwner: number
    followup: number
    stale: number
  }
  queue: Array<{
    docId: number
    pessoaId?: number
    pessoaNome: string
    docType: string
    docTypeLabel: string
    status: string
    statusRaw: string
    responsavelNome: string | null
    prazo: string | null
    diasParaPrazo: number | null
    motivoBloqueio: string | null
    ultimaMovimentacao: string | null
    isCritical: boolean
    isOverdue: boolean
    isBlocked: boolean
    noOwner: boolean
    proximoPasso: string | null
    generation: number
    isLinhaReta: boolean
    necessidadeId?: number | null
    responsavelId?: number | null
  }>
  queueTitle: string
  // Pessoas do processo (fonte oficial) e tarefas da fase (passos materializados).
  pessoas?: PessoaDoProcessoUI[]
  tarefas?: FaseTarefaRow[]
  faseProgress?: FaseProgress // ✅ NOVO (opcional: fallback cobre ausência)
  // LEGADO_INATIVO (desativação Genealogia): flag+mensagem de reestruturação.
  genealogiaReestruturacao?: boolean
  mensagemReestruturacao?: string | null
  schemaCapabilities: {
    hasResponsavel: boolean
    hasPrazoOperacao: boolean
    hasMotivoBloqueio: boolean
    hasUltimaMovimentacao: boolean
  }
}

interface ProcessoCentralOperacionalProps {
  processo: ProcessoWithStatus | Processo
  /** Chamado quando a fase ATIVA do processo muda aqui (ex.: retorno de fase),
   *  para o container (modal) invalidar Header/Drawer/Kanban. */
  onProcessoMudou?: () => void
}

// ============================================================
// Mapeia o data da rota central-operacional -> props do PainelDaFase
// ============================================================

function statusParaCls(statusLabel: string): string {
  const s = statusLabel.toLowerCase()
  // Genealogia V2: "Registro localizado" = concluído (verde, conta no progresso).
  if (s.includes("recebid") || s.includes("entregue") || s.includes("validad") || s.includes("localizado")) return "recebido"
  if (s.includes("a localizar")) return "pendente"
  if (s.includes("solicit")) return "solicitado"
  if (s.includes("busca")) return "em_busca"
  if (s.includes("invál") || s.includes("inval") || s.includes("não enc") || s.includes("nao enc")) return "bloqueado"
  if (s.includes("pendente")) return "pendente"
  return "pendente"
}

function abreviar(tipo: string): string {
  if (tipo.includes("NASCIMENTO")) return "Nasc."
  if (tipo.includes("CASAMENTO")) return "Cas."
  if (tipo.includes("OBITO")) return "Óbito"
  return "Doc."
}

function mapearPainel(data: CentralOpData, faseNome: string) {
  const queue = data.queue
  const matrix = data.matrix
  const fp = data.faseProgress

  const total = matrix.total
  const validados = matrix.completed
  const divergentes = queue.filter((q) => ["INVALIDO", "NAO_ENCONTRADO"].includes(q.statusRaw)).length

  // ============================================================
  // KPIs da fase (o workflow em si é renderizado pelo PainelDaFase)
  // ============================================================
  let kpis: FaseKpi[]

  if (fp && fp.steps.length > 0) {
    // ✅ CAMINHO REAL: números e passos vêm do estado gravado nos WorkflowSteps
    // (fp), não mais do status do documento. Aqui é que "0 Recebidos com doc
    // recebido" e o "passo ativo errado" são corrigidos.
    const c = fp.counts
    // O progresso da fase sai da PRÓPRIA lista de tarefas quando a fase opera por
    // alvo (Genealogia = registros a localizar): contador e lista têm a mesma fonte,
    // então não podem divergir. Sem tarefas, cai nos contadores por passo.
    const tarefasFase = data.tarefas ?? []
    const porAlvo = tarefasFase.length > 0 && tarefasFase.every((t) => t.necessidadeId != null || t.documentoId != null)
    if (porAlvo) {
      const localizados = tarefasFase.filter((t) => t.balde === "CONCLUIDA").length
      const divergentesAlvo = tarefasFase.filter((t) => t.statusRaw === "BLOQUEADO" || t.statusRaw === "FALHOU").length
      kpis = [
        { label: "Registros a localizar", value: tarefasFase.length },
        { label: "Localizados", value: localizados, tone: "ok" },
        { label: "Pendentes", value: tarefasFase.length - localizados - divergentesAlvo, tone: "busca" },
        { label: "Divergentes", value: divergentesAlvo, tone: "late" },
      ]
    } else {
    kpis = [
      { label: "Obrigatórios", value: total },
      { label: "Validados", value: c.validados, tone: "ok" },
      { label: "Solicitados", value: c.solicitados, tone: "busca" },
      { label: "Aguardando", value: c.aguardando, tone: "busca" },
      { label: "Recebidos", value: c.recebidos },
      { label: "Conferidos", value: c.conferidos },
      { label: "Divergentes", value: divergentes, tone: "late" },
    ]
    }
  } else {
    // FALLBACK — só entra se a rota ainda não devolveu faseProgress (ex.: janela
    // de deploy). Mantém o comportamento antigo (inferido do status do doc) pra
    // nunca ficar pior do que estava. No fluxo normal, o caminho real acima é o
    // que roda.
    const solicitados = queue.filter((q) => q.statusRaw === "SOLICITADO").length
    const aguardando = queue.filter((q) => q.statusRaw === "EM_BUSCA").length
    kpis = [
      { label: "Obrigatórios", value: total },
      { label: "Validados", value: validados, tone: "ok" },
      { label: "Solicitados", value: solicitados, tone: "busca" },
      { label: "Aguardando", value: aguardando, tone: "busca" },
      { label: "Recebidos", value: validados },
      { label: "Conferidos", value: 0 },
      { label: "Divergentes", value: divergentes, tone: "late" },
    ]
    // A esteira de passos inferida do status do documento saiu junto com o resumo em
    // linha: quem desenha o workflow agora é o próprio workflow materializado.
  }

  // ============================================================
  // TABELA POR PESSOA
  // ------------------------------------------------------------
  // A lista de pessoas é SEMEADA pelo roster oficial do processo (data.pessoas), não
  // pela fila. Era exatamente o contrário que produzia "0 pessoa(s)": sem documento
  // obrigatório configurado a fila vem vazia, e com ela sumiam TODAS as pessoas da
  // árvore. Agora a fila só ENRIQUECE linhas que já existem — documento e tarefa são
  // conteúdo da linha, nunca condição para ela existir.
  //
  // Fallback (roster ausente, ex.: janela de deploy com back antigo): deriva da fila
  // como antes, para não ficar pior do que estava.
  const porPessoa = new Map<string | number, FasePersonRow>()
  const roster = data.pessoas ?? []

  const linhaDoRoster = (r: PessoaDoProcessoUI): FasePersonRow => ({
    pessoaId: r.pessoaId,
    publicCode: r.publicCode,
    nome: r.nome,
    iniciais: r.iniciais,
    papel: r.requerente ? "Requerente" : r.posicao,
    geracao: r.geracao != null ? `G${r.geracao + 1}` : "—",
    isLinha: r.classificacao === "LINHA_PRINCIPAL",
    pendencia: r.pendencia,
    transmissao:
      r.classificacao === "LINHA_PRINCIPAL"
        ? { state: "OK", label: "Na linha de transmissão", sub: r.posicao }
        : r.classificacao === "FORA_DA_LINHAGEM"
          ? { state: "FORA", label: "Fora da linha", sub: "Sem impacto na transmissão" }
          : { state: "BLOQUEADA", label: "Classificação pendente", sub: r.pendencia ?? undefined },
    docsResumo: [],
    validados: 0,
    total: 0,
    responsavel: null,
    proximaAcao: null,
    docs: [],
  })

  for (const r of roster) porPessoa.set(r.pessoaId, linhaDoRoster(r))

  for (const q of queue) {
    const key: string | number = q.pessoaId != null && q.pessoaId > 0 ? q.pessoaId : q.pessoaNome
    if (!porPessoa.has(key)) {
      // Item sem pessoa no roster (ou roster ausente): a linha é criada a partir da
      // fila. Nenhum item operacional fica invisível por falta de cadastro.
      const iniciais = q.pessoaNome.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()
      const isLinha = q.isLinhaReta
      porPessoa.set(key, {
        pessoaId: q.pessoaId ?? q.docId,
        publicCode: null,
        nome: q.pessoaNome,
        iniciais,
        papel: isLinha ? "Linha reta" : "Apoio",
        geracao: isLinha ? `G${q.generation}` : "—",
        isLinha,
        pendencia: null,
        transmissao: isLinha
          ? { state: "OK", label: "Na linha de transmissão", sub: undefined }
          : { state: "FORA", label: "Fora da linha", sub: "Sem impacto na transmissão" },
        docsResumo: [],
        validados: 0,
        total: 0,
        responsavel: null,
        proximaAcao: null,
        docs: [],
      })
    }
    const row = porPessoa.get(key)!
    const cls = statusParaCls(q.status)
    row.docsResumo.push({ abbr: abreviar(q.docType), statusLabel: q.status, statusCls: cls })
    row.total += 1
    if (cls === "recebido") row.validados += 1
    row.responsavel = row.responsavel ?? q.responsavelNome
    row.proximaAcao =
      row.proximaAcao ??
      (q.noOwner
        ? { txt: "Solicitar certidão", cls: "crit", semResp: true, sub: "Aguardando solicitação" }
        : { txt: q.proximoPasso === "normal" ? "Solicitar certidão" : (q.proximoPasso || "—"), sub: "Aguardando solicitação" })
    row.docs.push({
      id: q.docId,
      necessidadeId: q.necessidadeId ?? null,
      responsavelId: q.responsavelId ?? null,
      tipoLabel: q.docTypeLabel,
      subtitulo: "Inteiro teor",
      statusLabel: q.status.toUpperCase(),
      statusCls: cls,
      responsavel: q.responsavelNome,
      sla: q.diasParaPrazo != null ? `${q.diasParaPrazo} dias` : null,
      proximaAcao: q.proximoPasso === "normal" ? "Solicitar certidão" : q.proximoPasso,
      emissaoConcluida: cls === "recebido",
    })
  }

  // Classificação exibida = a do roster. Sem roster, cai no flag da fila (isLinha).
  const classePorPessoa = new Map(roster.map((r) => [r.pessoaId, r.classificacao]))
  const todas = Array.from(porPessoa.values())
  const classeDe = (p: FasePersonRow) =>
    classePorPessoa.get(p.pessoaId) ?? (p.isLinha ? "LINHA_PRINCIPAL" : "FORA_DA_LINHAGEM")
  const linhaPrincipal = todas.filter((p) => classeDe(p) === "LINHA_PRINCIPAL")
  const foraDaLinha = todas.filter((p) => classeDe(p) === "FORA_DA_LINHAGEM")
  const pendenteClassificacao = todas.filter((p) => classeDe(p) === "PENDENTE_CLASSIFICACAO")

  const pct = matrix.percentage
  // "Faltam 0 documentos" não é informação — é um contador falando sozinho. Com
  // denominador zero a fase não tem documento configurado, e é ISSO que o operador
  // precisa ler: o trabalho não começou porque não há o que exigir, e o caminho
  // para resolver é a Matriz Documental, não esta tela.
  const progressoTexto =
    total === 0
      ? `Nenhum documento obrigatório configurado para a ${faseNome}. Defina as regras em Gerenciamento › Documentos e Protocolos › Matriz Documental.`
      : validados >= total
        ? `${faseNome} concluída — todos os documentos validados.`
        : `Solicite, receba, confira e valide cada certidão. Falta${total - validados === 1 ? "" : "m"} ${total - validados} documento${total - validados === 1 ? "" : "s"} para concluir a ${faseNome}.`

  return { kpis, linhaPrincipal, foraDaLinha, pendenteClassificacao, pct, validados, total, progressoTexto }
}

const FASE_META: Record<string, { sub: string; tabs: string[] }> = {
  "Genealogia": { sub: "Crie a árvore, defina a linha reta e localize os documentos obrigatórios.", tabs: ["Resumo", "Árvore", "Linha reta", "Documentos gerados", "Busca documental", "Histórico"] },
  "Emissão documental": { sub: "Solicite, receba, confira e valide as certidões nos cartórios.", tabs: ["Resumo", "Documentos", "Solicitações", "Recebimentos", "Validações", "Histórico"] },
  "Análise Documental": { sub: "Compare a árvore com os documentos, avalie divergências e decida o caminho.", tabs: ["Resumo", "Divergências", "Documentos comparados", "IA & Revisão", "Decisões", "Pareceres", "Histórico"] },
  "Retificação de registros": { sub: "Execute a retificação judicial ou administrativa dos registros divergentes.", tabs: ["Resumo", "Pacotes de retificação", "Judicial / Administrativo", "Anexos", "Decisões", "Histórico"] },
  "Emissão documental retificada": { sub: "Emita novamente apenas os documentos impactados pela retificação.", tabs: ["Resumo", "Averbações", "Certidões retificadas", "Solicitações", "Validações", "Histórico"] },
  "Tradução juramentada": { sub: "Traduza a pasta documental por tradutor juramentado e valide as traduções.", tabs: ["Resumo", "Documentos", "Traduções", "Validações", "IA & Revisão", "Decisões", "Histórico"] },
  "Apostilamento": { sub: "Apostile (Haia) os documentos finais e valide a pasta apostilada.", tabs: ["Resumo", "Pasta de apostilamento", "Documentos apostilados", "Conferência", "Validações", "Histórico"] },
  "Aguardando protocolo": { sub: "Reúna o dossiê final e protocole o pedido no órgão de destino.", tabs: ["Resumo", "Pasta final", "Previsão", "Movimentações", "Protocolo", "Histórico"] },
  "Protocolado": { sub: "Acompanhe o pedido protocolado e registre a decisão do órgão.", tabs: ["Resumo", "Dados do protocolo", "Exigências", "Movimentações", "Decisões", "Histórico"] },
  "Finalizado": { sub: "Confirme o reconhecimento, entregue ao cliente e arquive o processo.", tabs: ["Resumo", "Resultado final", "Entregáveis", "Auditoria", "Arquivos finais", "Histórico"] },
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

const SEM_PHASES: PhaseMeta[] = []
const SEM_OPERACOES: OpAntecipada[] = []

export function ProcessoCentralOperacional({
  processo,
  onProcessoMudou,
}: ProcessoCentralOperacionalProps) {
  const { pode } = usePermissoes()

  // Ambiente visual: abrir/estar num processo é a FONTE mais confiável do país.
  // Mantém o país ao navegar entre as abas do processo (Central/Documentos/Árvore/
  // Financeiro do Processo). Só decora o fundo — não altera layout/dados.
  const { entrarNoProcesso } = useAmbiente()
  useEffect(() => {
    const p = processo as { id: number; pais?: string | null; codigo?: string | null; nome?: string | null; faseAtualKey?: string | null }
    entrarNoProcesso({ processoId: p.id, pais: p.pais ?? null, codigo: p.codigo ?? null, familia: p.nome ?? null, fase: p.faseAtualKey ?? null })
  }, [processo, entrarNoProcesso])
  // Central da fase ATIVA, pela camada oficial. O usuário entra na chave porque a fila
  // é priorizada para ele.
  const userIdAtual = useJsonLocalStorage<{ id?: number }>("user")?.id ?? null
  const chaveAtiva = (() => {
    const params = new URLSearchParams({ queue: "all", sort: "priority" })
    if (userIdAtual) params.set("userId", String(userIdAtual))
    return `/api/processos/${processo.id}/central-operacional?${params.toString()}`
  })()
  const centralReq = useApi<CentralOpData>(chaveAtiva)
  // A projeção otimista ("Atualizando…") é escrita no cache, não num estado paralelo.
  const data = centralReq.dados ?? null
  const loading = centralReq.carregando
  const refreshing = centralReq.revalidando && !centralReq.carregando
  const [erroLocal, setErro] = useState<string | null>(null)
  // O erro mostra O QUE ACONTECEU, não um rótulo genérico: a camada oficial já traz a
  // mensagem do servidor (ou "não respondeu no prazo" / "falha de rede"). Um "Erro ao
  // carregar" sem fato nenhum obriga a abrir o DevTools para saber se foi 403, 500 ou
  // rede — e é indistinguível de tela travada.
  const erro = erroLocal ?? (centralReq.erro
    ? (centralReq.erro.status === 404
        ? "Endpoint /api/processos/[id]/central-operacional ainda não existe."
        : `${centralReq.erro.message}${centralReq.erro.status > 0 ? ` (HTTP ${centralReq.erro.status})` : ""}`)
    : null)
  const setData = useCallback((proximos: CentralOpData | null | ((anteriores: CentralOpData | null) => CentralOpData | null)) => {
    const valor = typeof proximos === 'function' ? proximos(data) : proximos
    void centralReq.recarregar(valor ?? undefined)
  }, [data, centralReq])
  // `carregar(silencioso)` continua existindo para os ~10 pontos que o chamam depois de
  // escrever; a distinção entre carga inicial e refresh agora vem da própria consulta.
  const carregar = useCallback((_modoSilencioso = false) => { void centralReq.recarregar() }, [centralReq])

  const [drawerDocId, setDrawerDocId] = useState<number | null>(null)
  const [initModalDocId, setInitModalDocId] = useState<number | null>(null)
  const [abrindoOperacao, setAbrindoOperacao] = useState(false)
  const [erroOperacao, setErroOperacao] = useState<string | null>(null)

  // NAVEGAÇÃO ENTRE FASES (OPERATE|VIEW). activePhaseKey = fase OPERADA (do processo);
  // selectedPhaseKey = fase CONSULTADA (clique na trilha). Independentes: consultar
  // NUNCA altera a fase ativa. selectedPhaseKey=null ⇒ segue a ativa (modo OPERATE).
  // Leitura pura das fases materializadas — NUNCA materializa. Falha degrada a trilha
  // para não-clicável, como antes (por isso o erro é ignorado aqui).
  const phasesReq = useApi<{ phases?: PhaseMeta[] }>(`/api/processos/${processo.id}/phases`)
  const phases = phasesReq.dados?.phases ?? SEM_PHASES
  const carregarFases = () => { void phasesReq.recarregar() }
  const [selectedPhaseKey, setSelectedPhaseKey] = useState<string | null>(null)

  // CENTRAL UNIFICADA (OPERATE|PAST_READ_ONLY): ao consultar uma fase PASSADA, a MESMA
  // Central carrega os DADOS VIVOS daquela fase (instância/ciclo) num fetch paralelo. O
  // corpo renderiza `viewData ?? data` — mesmo layout, só leitura. `data` (fase ATIVA)
  // segue intacto para a trilha/resumo. Nunca snapshot; sempre dados reais da instância.

  // Operação Antecipada: contexto (necessidade) para o modal de criação + lista por necessidade.
  const [novaOperacaoCtx, setNovaOperacaoCtx] = useState<{ necessidadeId?: number | null; pessoaId?: number | null; label?: string } | null>(null)
  // Tarefa Transversal (funcionalidade oficial e SEPARADA da Operação Antecipada).
  const [novaTransversalCtx, setNovaTransversalCtx] = useState<{ necessidadeId?: number | null; pessoaId?: number | null; label?: string } | null>(null)
  const operacoesReq = useApi<{ operacoes?: OpAntecipada[] }>(`/api/processos/${processo.id}/operacoes-antecipadas`)
  const operacoes = operacoesReq.dados?.operacoes ?? SEM_OPERACOES
  const carregarOperacoes = useCallback(async () => { await operacoesReq.recarregar() }, [operacoesReq])
  // Banner "executada antecipadamente para atender…" exibido na tela oficial (drawer) reusada.
  const [bannerAntecipada, setBannerAntecipada] = useState<string | null>(null)

  // TROCA DE CONTEXTO NO AVANÇO DE FASE: quando a fase da Central muda (avanço/retorno),
  // qualquer drawer aberto está exibindo o contexto da fase ANTIGA (ex.: o passo
  // localizar_registro da Genealogia). Fecha tudo — a Central já re-renderiza com a
  // fase nova e o drawer reabre no contexto da fase atual. Sem estado residual.
  const faseCodeRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const fc = data?.faseProgress?.faseCode
    if (fc === undefined) return // ainda carregando
    if (faseCodeRef.current !== undefined && faseCodeRef.current !== fc) {
      setDrawerDocId(null)
      setInitModalDocId(null)
      setAbrindoOperacao(false)
      setErroOperacao(null)
    }
    faseCodeRef.current = fc
  }, [data?.faseProgress?.faseCode])

  // Abre a operação. Se já há Documento (docId>0) abre direto; se for uma
  // necessidade da Genealogia V2 ainda sem Documento (docId=0), garante o
  // registro operacional no back e abre com o id real — em vez de abrir o
  // drawer com id inválido (backdrop vazio, tela travada). O loading SEMPRE
  // termina (finally) e o erro é sempre visível/fechável (nunca backdrop órfão).
  const abrirOperacao = useCallback(
    async (docId: number, necessidadeId?: number | null) => {
      if (docId && docId > 0) { setDrawerDocId(docId); return }
      if (!necessidadeId) { setErroOperacao("Operação sem documento associado. Recarregue a fase e tente novamente."); return }
      setAbrindoOperacao(true)
      setErroOperacao(null)
      // Timeout defensivo: o loading SEMPRE termina, mesmo se o servidor pendurar.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      try {
        const res = await fetch(`/api/processos/${processo.id}/genealogia/operacao`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // MESMA autenticação usada por toda a app (Bearer authToken). Sem isso
            // o endpoint responde 401 para o usuário logado e a operação nunca abre.
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({ necessidadeId }),
          signal: ctrl.signal,
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json?.documentoId) {
          setErroOperacao(json?.error || `Não foi possível abrir a operação (HTTP ${res.status}).`)
          return
        }
        setDrawerDocId(json.documentoId)
      } catch (e) {
        setErroOperacao(
          (e as Error)?.name === "AbortError"
            ? "A abertura da operação excedeu 15 segundos. Tente novamente."
            : "Falha de rede ao abrir a operação."
        )
      } finally {
        clearTimeout(timer)
        setAbrindoOperacao(false)
      }
    },
    [processo.id]
  )

  // ABRIR TAREFA — ponto único de entrada da lista de tarefas da fase.
  // Uma tarefa é um passo materializado (PhaseWorkflowStepInstance). Abrir significa
  // abrir a tela OFICIAL da operação daquele item, dentro da própria Central:
  //   • documentoId presente  → drawer da operação do documento;
  //   • só necessidadeId      → materializa o registro operacional e abre o drawer
  //                             (é o caminho de "Localizar registro da certidão").
  // Nenhuma condição de documento obrigatório, de progresso da fase ou de quantidade
  // de tarefas participa desta decisão. Sem redirecionamento para rota legada.
  const abrirTarefa = useCallback((t: FaseTarefaRow) => {
    // Sem executor configurado para o tipo/escopo do passo: erro ADMINISTRATIVO
    // explícito. A tarefa segue visível na lista — o que falta é cadastro.
    if (!t.executor) { setErroOperacao(t.erroAdministrativo ?? "Sem executor configurado para este passo."); return }
    setBannerAntecipada(null)
    void abrirOperacao(t.documentoId ?? 0, t.necessidadeId)
  }, [abrirOperacao])

  // Lista de funcionários para os seletores "Delegar" (carrega uma vez).
  const [usuarios, setUsuarios] = useState<Array<{ id: number; nome: string; publicCode?: string | null }>>([])
  useEffect(() => {
    fetch("/api/usuarios", { headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` } })
      .then((r) => r.json())
      .then((d) => setUsuarios((d.usuarios || d || []).map((u: { id: number; nome: string; publicCode?: string | null }) => ({ id: u.id, nome: u.nome, publicCode: u.publicCode ?? null }))))
      .catch(() => {})
  }, [])

  // Delega o passo localizar_registro de uma necessidade (fila) SEM abrir a operação
  // nem criar Documento. Grava o responsável direto no passo.
  const getUserId = (): number | null => {
    try {
      const stored = localStorage.getItem("user")
      if (stored) {
        const u = JSON.parse(stored)
        return u.id ?? null
      }
    } catch {}
    return null
  }

  const delegar = useCallback(
    async (necessidadeId: number, responsavelId: number | null) => {
      try {
        const res = await fetch(`/api/processos/${processo.id}/genealogia/delegar`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("authToken")}`,
          },
          body: JSON.stringify({ necessidadeId, responsavelId }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setErroOperacao(j?.error || `Não foi possível delegar (HTTP ${res.status}).`)
          return
        }
        carregar(true)
      } catch {
        setErroOperacao("Falha de rede ao delegar.")
      }
    },
    // `carregar` entra de verdade: a memoização anterior declarava só `processo.id` e
    // fechava sobre um `carregar` mais antigo.
    [processo.id, carregar]
  )



  const operacoesPorNec = new Map<number, OpAntecipada[]>()
  for (const o of operacoes) {
    if (o.necessidadeId == null) continue
    const arr = operacoesPorNec.get(o.necessidadeId) ?? []
    arr.push(o); operacoesPorNec.set(o.necessidadeId, arr)
  }

  const avaliarOperacao = useCallback(async (id: number, resultado: "SIM" | "PARCIAL" | "NAO" | "CANCELAR", resultadoObtido: string, resultadoDados?: Record<string, unknown>) => {
    await fetch(`/api/operacoes-antecipadas/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` }, body: JSON.stringify({ resultado, resultadoObtido: resultadoObtido || null, resultadoDados: resultadoDados ?? null }) })
    await carregarOperacoes(); carregar(true)
  }, [carregarOperacoes, carregar])

  // "Abrir operação" da antecipada: reusa a MESMA tela oficial (drawer) + banner de contexto.
  const abrirOperacaoAntecipada = useCallback((op: OpAntecipada) => {
    setBannerAntecipada(op.objetivo ? `Executada antecipadamente para atender: ${op.objetivo}` : "Operação executada antecipadamente")
    void abrirOperacao(op.operacao.uiRef.id ?? 0, op.necessidadeId)
  }, [abrirOperacao])

  // Fase PASSADA consultada: dados VIVOS daquela fase (instância/ciclo), na MESMA rota
  // da Central. Antes isto tinha AbortController e checagens de `signal.aborted` em
  // quatro pontos, para que a resposta de uma fase nunca vazasse para outra. Com a fase
  // na CHAVE, o vazamento é impossível por construção: a resposta de uma chave não é
  // aplicada em outra. O guard inteiro saiu.
  const chaveView = (() => {
    if (!selectedPhaseKey) return null
    const faseCode = phaseKeyToFaseCode(selectedPhaseKey)
    if (!faseCode) return null
    const meta = phases.find((p) => p.phaseKey === selectedPhaseKey)
    const params = new URLSearchParams({ queue: "all", sort: "priority", faseCode })
    if (userIdAtual) params.set("userId", String(userIdAtual))
    if (meta?.workflowInstanceId != null) params.set("instanceId", String(meta.workflowInstanceId))
    if (meta?.ciclo != null) params.set("ciclo", String(meta.ciclo))
    return `/api/processos/${processo.id}/central-operacional?${params.toString()}`
  })()
  const viewReq = useApi<CentralOpData>(chaveView)
  const viewData = chaveView ? (viewReq.dados ?? null) : null
  const viewLoading = Boolean(chaveView) && viewReq.carregando
  const viewErro = chaveView && viewReq.erro ? "Não foi possível carregar os dados desta fase." : null

  // Otimista: marca o doc recém-mexido como "Atualizando…" na fila enquanto
  // a Central recarrega em 2º plano — evita a sensação de "concluí e nada mudou".
  const marcarAtualizando = useCallback((docId: number | null) => {
    if (docId == null) return
    setData((prev) =>
      prev
        ? {
            ...prev,
            queue: prev.queue.map((q) =>
              q.docId === docId ? { ...q, proximoPasso: "Atualizando…" } : q,
            ),
          }
        : prev,
    )
  }, [setData])

  // NÃO existe efeito de carga aqui: a consulta busca sozinha ao montar e ao
  // trocar de chave. Um `useEffect(() => carregar(), [carregar])` só reabastecia
  // o ciclo — era ele, somado à identidade instável do resultado, que prendia a
  // aba no spinner.

  // ── ESTADO 1: carregando ────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/40" />
      </div>
    )
  }

  // ── ESTADO 2: erro — sempre com saída, nunca um beco sem ação ───────────
  if (erro && !data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-4 py-3 text-sm text-[#d2a948]">
          <div>⚠ {erro}</div>
          <button
            onClick={() => { setErro(null); carregar() }}
            className="mt-2 rounded-md border border-[#d2a948]/40 px-3 py-1 text-xs transition hover:bg-[#d2a948]/15"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // ── ESTADO 3: vazio — a consulta terminou e não há operação materializada ──
  // Antes isto caía num `return null` mudo: a aba ficava em branco e era lida
  // como travamento. Sem workflow, sem fase, sem documento ou sem tarefa, o
  // carregamento TERMINA e a tela diz o que está acontecendo.
  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
          <div className="text-white/80">Nenhuma operação materializada para este processo.</div>
          <div className="mt-1 text-xs text-white/45">
            A Central aparece quando o processo tem fase e workflow ativos.
          </div>
          <button
            onClick={() => carregar()}
            className="mt-3 rounded-md border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  // ====== CÁLCULOS (ordem importa: declarar ANTES de usar) ======
  // FONTE DA FASE = a resposta FRESCA da rota (data.faseProgress.faseCode), que lê
  // processo.faseAtualKey do banco a cada fetch. O prop `processo` é estático e NÃO
  // reflete o avanço — usá-lo mantinha a Central presa na Genealogia após avançar.
  // Fallback ao prop só cobre o 1º render antes de `data` chegar.
  // FASE ATIVA (trilha + resumo) — SEMPRE de `data`. Consultar fase passada NUNCA altera.
  const faseCodeAtiva = (data?.faseProgress?.faseCode ?? undefined) as FaseCode | undefined
  const faseKeyAtiva =
    faseCodeAtiva ??
    phaseKeyToFaseCode((processo as { faseAtualKey?: string | null }).faseAtualKey) ??
    undefined
  const faseAtivaNome = (faseKeyAtiva ? FASES[faseKeyAtiva]?.label : undefined) ?? "Genealogia"
  const idxAtual = PROCESS_PHASES.indexOf(faseAtivaNome as (typeof PROCESS_PHASES)[number])
  const fasesConcluidas = idxAtual > 0 ? PROCESS_PHASES.slice(0, idxAtual) : []
  // Percentual da fase ATIVA = projeção oficial (mesmo % do Kanban/Header). Fases
  // concluídas = 100, futuras = 0. Nenhum recálculo local.
  const pctFaseAtual = data.projection?.progress.percentage ?? data.matrix?.percentage ?? 0
  const progressoPorFase: Record<string, number> = {}
  PROCESS_PHASES.forEach((ph, i) => {
    if (i < idxAtual) progressoPorFase[ph] = 100
    else if (i === idxAtual) progressoPorFase[ph] = pctFaseAtual
    else progressoPorFase[ph] = 0
  })
  const activePhaseKey = faseKeyAtiva ? faseCodeToPhaseKey(faseKeyAtiva) : null

  // FASE CONSULTADA (corpo) — `viewData` (passada) ou `data` (ativa). MESMO layout;
  // PAST_READ_ONLY só bloqueia mutações. Dados VIVOS da instância/ciclo (nunca snapshot).
  // isView = INTENÇÃO (fase selecionada ≠ ativa), NÃO "viewData chegou". Assim, durante o
  // loading/erro do fetch da fase passada a Central JÁ está em modo consulta (readOnly +
  // spinner/erro) — nunca expõe o painel EDITÁVEL da fase ativa por engano.
  const isView = !!selectedPhaseKey && selectedPhaseKey !== activePhaseKey
  const bodyData = (isView ? viewData : data) ?? data
  const readOnly = isView || bodyData.mode === "PAST_READ_ONLY"
  const faseCodeData = (bodyData?.faseProgress?.faseCode ?? undefined) as FaseCode | undefined
  const faseKey =
    faseCodeData ??
    (selectedPhaseKey ? phaseKeyToFaseCode(selectedPhaseKey) ?? undefined : undefined) ??
    faseKeyAtiva ??
    undefined
  const faseAtualNome =
    (faseKey ? FASES[faseKey]?.label : undefined) ??
    "Genealogia"

  const painel = mapearPainel(bodyData, faseAtualNome)
  const meta = FASE_META[faseAtualNome] || { sub: "", tabs: ["Resumo"] }

  // Detecta a fase de Análise Documental (tolerante a acento/caixa)
  const ehAnalise = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("analise documental")

  const ehTraducao = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("traducao juramentada")

  const ehApostilamento = faseAtualNome
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .includes("apostilamento")

  const ehFaseFinal = ["aguardando protocolo", "protocolado", "finalizado"].some((nome) =>
    faseAtualNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(nome)
  )

  // Fases por-processo (checklist + avançar). Mapeia nome → faseCode (tolerante a acento/caixa).
  const FASE_CODE_POR_NOME: Record<string, FaseCode> = {
    "retificacao de registros": "RETIFICACAO_REGISTROS",
    "emissao documental retificada": "EMISSAO_DOCUMENTAL_RETIFICADA",
    "traducao juramentada": "TRADUCAO_JURAMENTADA",
    "apostilamento": "APOSTILAMENTO",
    "aguardando protocolo": "AGUARDANDO_PROTOCOLO",
    "protocolado": "PROTOCOLADO",
    "finalizado": "FINALIZADO",
  }
  const faseNorm = faseAtualNome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  const faseCodeGenerica: FaseCode | undefined = FASE_CODE_POR_NOME[faseNorm]
  const ehRetificacao = faseNorm.includes("retificacao de registros")
  const ehEmissaoRetificada = faseNorm.includes("emissao documental retificada")

  // ====== TRILHA: realce da fase selecionada + metadados do modo consulta ======
  // (activePhaseKey/isView/readOnly j\u00e1 declarados acima). selectedKey = fase real\u00e7ada.
  const selectedKey = selectedPhaseKey ?? activePhaseKey
  const selectedFaseCode = selectedKey ? phaseKeyToFaseCode(selectedKey) : null
  const selectedLabel = selectedFaseCode ? FASES[selectedFaseCode].label : undefined
  const selectedPhaseMeta: PhaseMeta | null =
    (isView && selectedKey)
      ? (phases.find((p) => p.phaseKey === selectedKey) ?? {
          // Fallback quando a rota /phases ainda n\u00e3o respondeu: metadados m\u00ednimos.
          phaseKey: selectedKey, faseCode: selectedFaseCode, label: selectedLabel ?? selectedKey,
          ordem: selectedFaseCode ? FASES[selectedFaseCode].ordem : 0,
          state: (selectedFaseCode && faseKeyAtiva && FASES[selectedFaseCode].ordem < FASES[faseKeyAtiva].ordem
            ? "COMPLETED" : "FUTURE") as PhaseMeta["state"],
          materialized: false, workflowInstanceId: null, ciclo: null, status: null,
        })
      : null

  const onSelectPhase = (label: string) => {
    const pk = LABEL_TO_PHASEKEY[label]
    if (!pk) return
    // Selecionar a fase ativa volta para OPERATE; qualquer outra entra em consulta (VIEW).
    setSelectedPhaseKey(pk === activePhaseKey ? null : pk)
  }

  return (
    <div className="h-full overflow-y-auto bg-[#15191f]">
      <div className="px-6 py-5">

        {/* ===== TOPO: Trilha de fases + Resumo do processo (lado a lado) ===== */}
        <div className="flex flex-col gap-4 mb-4">
          <div className="min-w-0">
            <WorkflowMacroTrilha
              currentPhase={faseAtivaNome}
              completedPhases={fasesConcluidas}
              phaseProgress={progressoPorFase}
              selectedPhase={selectedLabel}
              onSelectPhase={onSelectPhase}
            />
          </div>
          <ResumoDoProcesso
            currentPhase={faseAtivaNome}
            completedPhases={fasesConcluidas}
            phaseProgress={progressoPorFase}
          />
        </div>

        {/* Botões "Nova tarefa transversal" / "Nova operação antecipada" removidos da barra
            da Central Operacional (a pedido). A operação antecipada segue acessível por
            necessidade/pessoa dentro do painel da fase. */}


        {/* ===== Cabeçalho do MODO CONSULTA (fase passada) — MESMA casca, só leitura ===== */}
        {isView && (
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1 rounded-full bg-[#d2a948]/15 text-[#d2a948]">
                <Eye className="w-3.5 h-3.5" /> Somente leitura
              </span>
              <span className="text-[13px] font-semibold text-white/80">
                {selectedPhaseMeta?.state === "FUTURE" ? "Fase futura · ainda não iniciada"
                  : `Fase concluída${selectedPhaseMeta?.ciclo ? ` · Ciclo ${selectedPhaseMeta.ciclo}` : ""}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedPhaseKey(null)}
                className="inline-flex items-center gap-1.5 border-[1.5px] border-white/10 bg-[#1b2027] text-white/80 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg hover:border-white/20 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Voltar à fase ativa
              </button>
              {pode("workflow.retornarFase") && selectedPhaseMeta?.state === "COMPLETED" && selectedKey && (
                <RetornarFaseButton
                  processoId={processo.id}
                  faseKey={selectedKey}
                  faseLabel={selectedLabel ?? selectedKey}
                  onRetornou={() => {
                    setSelectedPhaseKey(null)
                    carregar(true)
                    carregarFases()
                    onProcessoMudou?.()
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* CONSULTA (fase passada): sempre o corpo GENÉRICO da Central com dados VIVOS e
            ESCOPADOS da instância (bodyData). Os painéis bespoke por-fase buscam a fase
            ATIVA (não escopam) — por isso só aparecem no modo ACTIVE, garantindo que
            NENHUM dado da fase ativa vaze na consulta de fase passada. */}
        {isView && !viewData ? (
          // Consultando fase passada e os dados ainda NÃO chegaram (loading/erro): mostra
          // spinner/erro — NUNCA o corpo, que cairia nos dados da fase ativa.
          viewErro
            ? <div className="bg-[#d2a948]/12 border border-[#d2a948]/30 rounded-lg px-4 py-3 text-sm text-[#d2a948]">⚠ {viewErro}</div>
            : <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !isView && ehAnalise ? (
          <ProcessoAnalise processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehTraducao ? (
          <ProcessoTraducao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehApostilamento ? (
          <ProcessoApostilamento processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehRetificacao ? (
          <ProcessoRetificacao processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehEmissaoRetificada ? (
          <ProcessoEmissaoRetificada processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && ehFaseFinal ? (
          <ProcessoFaseFinal processoId={processo.id} onConcluido={() => carregar(true)} />
        ) : !isView && faseCodeGenerica ? (
          <ProcessoFaseGenerica processoId={processo.id} faseCode={faseCodeGenerica} onConcluido={() => carregar(true)} />
        ) : (
        <>
        {/* ===== Header da Central ===== */}
        <div className="mb-4">
          <h3 className="text-lg font-bold text-white/95 tracking-tight">Central Operacional</h3>
          <p className="text-xs text-white/55 mt-0.5">
            Fila de produção documental · todas as tarefas ativas do processo
          </p>
        </div>

        {/* ===== Central Operacional (largura cheia, sem sidebar) ===== */}
        <div className="min-w-0">
          <PainelDaFase
            faseNome={faseAtualNome}
            faseSub={bodyData.genealogiaReestruturacao ? "" : meta.sub}
            faseTabs={meta.tabs}
            kpis={painel.kpis}
            progressoPct={painel.pct}
            progressoConcluidos={painel.validados}
            progressoTotal={painel.total}
            progressoTexto={painel.progressoTexto}
            linhaPrincipal={painel.linhaPrincipal}
            foraDaLinha={painel.foraDaLinha}
            pendenteClassificacao={painel.pendenteClassificacao}
            tarefas={bodyData.tarefas ?? []}
            onAbrirTarefa={readOnly ? undefined : abrirTarefa}
            readOnly={readOnly}
            usuarios={usuarios}
            onNovaOperacao={readOnly ? undefined : (necessidadeId, pessoaIdNec, label) => setNovaOperacaoCtx({ necessidadeId, pessoaId: pessoaIdNec, label })}
            modoReestruturacao={!!bodyData.genealogiaReestruturacao}
            avisoReestruturacao={bodyData.mensagemReestruturacao ?? undefined}
          />

          {abrindoOperacao && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
              <div className="rounded-md bg-[#1b2027] px-4 py-2 text-sm text-white/80 shadow">Abrindo operação…</div>
            </div>
          )}

          {erroOperacao && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30" onClick={() => setErroOperacao(null)}>
              <div className="max-w-sm rounded-lg bg-[#1b2027] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="text-sm font-semibold text-white/95 mb-1">Não foi possível abrir a operação</div>
                <div className="text-sm text-white/68 mb-4">{erroOperacao}</div>
                <div className="flex justify-end">
                  <button onClick={() => setErroOperacao(null)} className="px-3 py-1.5 text-sm font-medium rounded-md bg-[#252c35] hover:bg-[#252c35] text-white/95">Fechar</button>
                </div>
              </div>
            </div>
          )}

          <DocumentoOperationalDrawer
            // key inclui a FASE ATUAL + doc: ao trocar de fase (ou documento) o drawer
            // é DESMONTADO e REMONTADO — zera estado interno (doc/workflow/aba/loading),
            // sem herdar nada da fase anterior.
            key={`${faseCodeData ?? "?"}-${drawerDocId ?? "none"}`}
            documentoId={drawerDocId}
            isOpen={drawerDocId !== null}
            bannerAntecipada={bannerAntecipada}
            onClose={() => { setDrawerDocId(null); setBannerAntecipada(null) }}
            onSave={() => {
              marcarAtualizando(drawerDocId)
              carregarOperacoes()
              carregar(true)
            }}
          />

          <InitOperationModal
            documentoId={initModalDocId}
            isOpen={initModalDocId !== null}
            onClose={() => setInitModalDocId(null)}
            onSuccess={() => {
              setInitModalDocId(null)
              carregar(true)
            }}
          />
        </div>
        </>
        )}

        {novaOperacaoCtx && (
          <OperacaoAntecipadaModal
            processoId={processo.id}
            necessidadeId={novaOperacaoCtx.necessidadeId}
            necessidadeLabel={novaOperacaoCtx.label}
            pessoaId={novaOperacaoCtx.pessoaId}
            faseAtivaCode={faseKeyAtiva ? String(faseKeyAtiva) : null}
            usuarios={usuarios}
            onClose={() => setNovaOperacaoCtx(null)}
            onCreated={() => { setNovaOperacaoCtx(null); carregarOperacoes(); carregar(true) }}
          />
        )}

        {novaTransversalCtx && (
          <TarefaTransversalModal
            processoId={processo.id}
            necessidadeId={novaTransversalCtx.necessidadeId}
            necessidadeLabel={novaTransversalCtx.label}
            pessoaId={novaTransversalCtx.pessoaId}
            usuarios={usuarios}
            onClose={() => setNovaTransversalCtx(null)}
            onCreated={() => { setNovaTransversalCtx(null); carregar(true) }}
          />
        )}
      </div>
    </div>
  )
}