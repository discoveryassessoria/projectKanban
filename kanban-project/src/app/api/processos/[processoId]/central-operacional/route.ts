// src/app/api/processos/[processoId]/central-operacional/route.ts

import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { pessoasAtivasDaArvore } from "@/src/lib/genealogia/vinculo-ativo"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getOrdemFase, getStepsForFase, getFase, phaseKeyToFaseCode, faseCodeToPhaseKey } from "@/src/lib/process-stage/fases-catalog"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { nomeCanonicoDaObrigacao } from "@/src/lib/documentos/nome-canonico-obrigacao"
import { resolveProgressoFaseDocumento } from "@/src/lib/process-stage/resolve-fase-progresso"
import { resolveOperationalProjection, type OperationalProjection } from "@/src/lib/process-stage/operational-projection"
import {
  montarPessoasDoProcesso,
  nomeCompletoPessoa,
  type PessoaDoProcesso,
} from "@/src/lib/process-stage/central-operacional-core"
// CONSULTA OFICIAL da Central: devolve a fase já na hierarquia de execução
// (pessoa → documento → workflow do documento → passos). O agrupamento é feito no
// domínio, por IDs relacionais — a tela não recombina nada por nome.
import { DOCUMENTO_STATUS_LABELS, getPhaseOperationalSummary, TIPO_DOCUMENTO_LABELS } from "@/src/lib/process-stage/estrutura-operacional"
import { resolverInstanciaVigente } from "@/src/lib/process-stage/instancia-vigente-da-fase"
import { materializarExecucaoDaFase } from "@/src/services/materializar-fase"
import type { IndiceOperacional } from "@/src/lib/process-stage/estrutura-operacional-core"
import type { FaseCode } from "@prisma/client"

// ============================================================
// TIPOS DE RESPOSTA
// ============================================================

type QueueId =
  | "all"
  | "pending"
  | "overdue"
  | "critical"
  | "waiting"
  | "blocked"
  | "no-owner"
  | "followup"
  | "stale"
  | "me"

interface MatrixResponse {
  percentage: number
  completed: number
  total: number
  directPeopleCount: number
  missingCount: number
  nameVariationsCount: number
  byPerson: Array<{
    pessoaId: number
    nome: string
    generation: number
    completed: number
    total: number
    percentage: number
  }>
  missing: Array<{
    docId: number
    pessoaId: number
    pessoaNome: string
    docType: string
    status: string
    generation: number
  }>
}

interface CardCounts {
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

interface QueueRow {
  docId: number
  pessoaId: number // P6 — agrupamento por pessoaId (homônimos NÃO colapsam)
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
  // Genealogia V2: necessidade da certidão. Quando não há Documento (docId=0),
  // a UI usa este id para garantir o registro operacional ao abrir a operação.
  necessidadeId?: number | null
  // Responsável atual do passo (para o seletor "Delegar" na linha da fila).
  responsavelId?: number | null
}

// ============================================================
// ✅ NOVO: estado REAL dos passos da fase atual.
// Antes o painel INFERIA os passos/KPIs pelo status do documento (chutava).
// Este bloco carrega a verdade gravada nos WorkflowStep da fase corrente.
// ============================================================
interface FaseStepReal {
  ordem: number
  stepKey: string
  title: string
  // "pendente" = etapa sem NENHUM item aplicável (denominador zero). Distinta de
  // "bloqueada" (tem itens, mas depende de etapa anterior).
  status: "concluida" | "em_andamento" | "bloqueada" | "pendente"
  concluidos: number // docs que concluíram este passo
  total: number       // docs (linha reta) que possuem este passo nesta fase
}

interface FaseProgress {
  faseCode: string | null
  kind: "documento" | "processo"
  steps: FaseStepReal[]
  docsNaFase: number
  counts: {
    solicitados: number
    aguardando: number
    recebidos: number
    conferidos: number
    validados: number
  }
}

// A lista PLANA de tarefas da fase saiu daqui. Ela era um segundo desenho do mesmo
// workflow — agrupado por PASSO, misturando as certidões de todas as pessoas dentro
// de cada passo. Numa fase documental isso descreve o cadastro, não o trabalho: quem
// executa não faz "Solicitar certidão", faz "a certidão de nascimento da Tereza", e
// essa certidão tem a sequência inteira do workflow só dela. O que a rota devolve
// agora é a ESTRUTURA (getPhaseOperationalStructure): as MESMAS instâncias oficiais,
// organizadas na hierarquia em que são executadas. Uma fonte, uma forma.

// Modo operacional da Central (UMA única tela; muda só o modo, nunca o layout):
//  • ACTIVE          — fase operada atual, editável.
//  • PAST_READ_ONLY  — fase passada consultada, dados VIVOS daquela instância/ciclo, só leitura.
//  • REOPENED        — fase passada retornada como ativa (torna-se ACTIVE após o retorno).
export type CentralMode = "ACTIVE" | "PAST_READ_ONLY"

interface CentralOperacionalResponse {
  // Modo + contexto da fase consultada. A UI renderiza SEMPRE o mesmo corpo; PAST_READ_ONLY
  // apenas bloqueia mutações. Dados são reais/vivos da instância consultada — nunca snapshot.
  mode: CentralMode
  phaseContext: { faseCode: string | null; faseMacroKey: string | null; workflowInstanceId: number | null; ciclo: number | null }
  // Projeção operacional OFICIAL da fase (fonte única de progresso/estado). A Central
  // mantém KPIs detalhados, mas o PERCENTUAL da fase vem daqui — idêntico ao Kanban/Header.
  projection: OperationalProjection
  matrix: MatrixResponse
  cards: CardCounts
  queue: QueueRow[]
  queueTitle: string
  // ROSTER OFICIAL das pessoas do processo (vínculo Pessoa.arvoreId = Processo.arvoreId).
  // NÃO derivado da fila: processo sem documento/tarefa continua exibindo as pessoas.
  pessoas: PessoaDoProcesso[]
  // ÍNDICE OPERACIONAL da fase consultada: pessoa → documento, com contadores e
  // status final. A tela principal INDEXA; quem EXECUTA é o modal do documento, e é
  // por isso que passo, SLA, responsável de passo e bloqueio NÃO vêm aqui.
  indice: IndiceOperacional
  // ESTADO DA MATERIALIZAÇÃO da fase ativa. Presente só quando a fase estava sem
  // materialização e a convergência oficial rodou nesta leitura. Quando vem com
  // `estado != "MATERIALIZADO"`, a tela mostra `mensagemAdministrativa` — o motivo
  // REAL de não haver documento/tarefa — em vez de um texto genérico de configuração.
  materializacao: {
    estado: string
    mensagemAdministrativa: string | null
    motivos: Array<{ code: string; message: string }>
    workflowInstanceId: number | null
    ciclo: number | null
    passos: number
  } | null
  faseProgress: FaseProgress
  // LEGADO_INATIVO (desativação Genealogia): quando a fase atual é GENEALOGIA, as
  // métricas documentais antigas (Obrigatórios/validados/percentual, derivadas de
  // Documento + Pessoa.linhaReta + STATUS_VALIDADOS) foram NEUTRALIZADAS. O front
  // usa este flag para exibir estado neutro em vez de apresentar cálculo antigo
  // como verdade de negócio.
  genealogiaReestruturacao: boolean
  mensagemReestruturacao: string | null
  schemaCapabilities: {
    hasResponsavel: boolean
    hasPrazoOperacao: boolean
    hasMotivoBloqueio: boolean
    hasUltimaMovimentacao: boolean
  }
}

// ============================================================
// CONSTANTES
// ============================================================

const STATUS_WAITING_EXTERNAL = ["EM_BUSCA", "SOLICITADO", "SOLICITAR"]
const STATUS_FINALIZADOS = ["RECEBIDO", "ENTREGUE", "INVALIDO", "NAO_ENCONTRADO"]
const STATUS_VALIDADOS = ["RECEBIDO", "ENTREGUE", "APOSTILADO", "TRADUZIDO"]

// Rótulos de tipo documental: fonte única na camada de leitura da Central.
const TIPO_LABELS = TIPO_DOCUMENTO_LABELS

// Rótulos de estado documental: a MESMA tabela da camada de leitura da Central.
// Uma segunda cópia aqui já divergiu antes ("Invalidado" × "Inválido").
const STATUS_LABELS = DOCUMENTO_STATUS_LABELS

// ============================================================
// HANDLER
// ============================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  // Identidade desta leitura: acompanha o erro até o log de runtime, e volta para a
  // tela. Sem ela, "Erro ao buscar Central Operacional" é indistinguível de qualquer
  // outra falha e não dá para achar a ocorrência exata nos logs.
  const correlationId = randomUUID()
  try {
    // Item 1 da auditoria — gate canônico de LEITURA: exige processos.ver
    // (rota GET/consulta; as ações de avanço usam workflow.avancar).
    // Dentro do try: falha no próprio gate (banco fora, sessão corrompida) também
    // vira erro tratado, e não um 500 opaco do framework.
    const erro = await verificarPermissao(request, "processos.ver")
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const queueFilter = (searchParams.get("queue") || "all") as QueueId
    const sortBy = (searchParams.get("sort") || "priority") as
      | "priority"
      | "sla"
      | "lineage"
    const userIdParam = searchParams.get("userId")
    const userId = userIdParam ? parseInt(userIdParam) : null

    // ============================================================
    // 1) Carrega processo e pessoas da árvore
    // ============================================================
    const processo = await prisma.processo.findUnique({
      where: { id },
      select: { id: true, arvoreId: true, faseAtualKey: true },
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    // ============================================================
    // CONTEXTO DE FASE (Central unificada OPERATE|PAST_READ_ONLY)
    // ------------------------------------------------------------
    // Sem ?faseCode ⇒ fase ATIVA (modo ACTIVE). Com ?faseCode de uma fase DIFERENTE da
    // ativa ⇒ consulta essa fase (modo PAST_READ_ONLY) com DADOS VIVOS escopados pela
    // instância/ciclo indicados — MESMO corpo de UI, apenas somente-leitura. Nunca snapshot.
    // ============================================================
    const faseCodeParam = searchParams.get("faseCode")
    const instanceIdParam = searchParams.get("instanceId")
    const cicloParam = searchParams.get("ciclo")
    const workflowInstanceId = instanceIdParam ? parseInt(instanceIdParam) : null
    const cicloConsultado = cicloParam ? parseInt(cicloParam) : null

    const faseAtivaKey = processo.faseAtualKey ?? null
    // fase consultada: a do param (se válida) ou a ativa.
    const faseConsultadaKey =
      (faseCodeParam ? faseCodeToPhaseKey(faseCodeParam) : null) ?? faseAtivaKey
    const isView = faseConsultadaKey != null && faseAtivaKey != null && faseConsultadaKey !== faseAtivaKey
    const mode: CentralMode = isView ? "PAST_READ_ONLY" : "ACTIVE"
    // contexto passado aos resolvers: só quando consultando fase != ativa.
    const faseContexto = isView
      ? { faseMacroKey: faseConsultadaKey!, workflowInstanceId }
      : undefined

    // A fase "corrente" desta resposta é a CONSULTADA (ativa ou passada).
    const faseAtualCode =
      (phaseKeyToFaseCode(faseConsultadaKey) ?? null)

    // ============================================================
    // CONVERGÊNCIA DA FASE ATIVA — "0 documentos" nunca é resposta muda.
    // ------------------------------------------------------------
    // A materialização de uma fase acontece no instante em que a fase é ativada, e
    // planeja os alvos com as entidades que existiam NAQUELE instante. No fluxo real
    // o processo nasce antes da árvore: quando a Genealogia foi ativada, não havia
    // pessoa nenhuma, o plano saiu vazio e a fase ficava ATIVA com zero passos para
    // sempre — sem tarefa, sem documento e sem ninguém dizendo por quê.
    //
    // Aqui a fase ATIVA converge pelo materializador OFICIAL antes da leitura. É
    // idempotente e só roda quando a fase está de fato sem materialização, então não
    // escreve a cada F5. Se ainda assim nada for materializado, o motivo REAL vai na
    // resposta e a tela mostra ele — em vez de inventar "nenhum documento configurado".
    let instanciaVigente = faseConsultadaKey
      ? await resolverInstanciaVigente(id, faseConsultadaKey)
      : null
    let materializacao: {
      estado: string
      mensagemAdministrativa: string | null
      motivos: Array<{ code: string; message: string }>
      workflowInstanceId: number | null
      ciclo: number | null
      passos: number
    } | null = null

    if (!isView && faseConsultadaKey) {
      const passosDaVigente = instanciaVigente
        ? await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: instanciaVigente.id } })
        : 0
      if (!instanciaVigente || passosDaVigente === 0) {
        const rel = await materializarExecucaoDaFase({
          processoId: id,
          faseMacroKey: faseConsultadaKey,
          fonte: "RECONCILIACAO",
          correlationId,
        })
        materializacao = {
          estado: rel.estado,
          mensagemAdministrativa: rel.mensagemAdministrativa,
          motivos: rel.motivos.map((m) => ({ code: m.code, message: m.message })),
          workflowInstanceId: rel.workflowInstanceId,
          ciclo: rel.ciclo,
          passos: rel.passosTotais,
        }
        if (rel.workflowInstanceId != null) {
          instanciaVigente = await resolverInstanciaVigente(id, faseConsultadaKey)
        }
      }
    }

    // pessoas, uniões e documentos não dependem um do outro (todos só precisam do
    // arvoreId) → busca EM PARALELO, economizando round-trips ao banco.
    // PESSOAS: vínculo OFICIAL Pessoa.arvoreId = Processo.arvoreId. Sem filtro por
    // documento, tarefa, necessidade, status ou transmissão — é o cadastro da árvore
    // que define quem existe no processo, e nada mais.
    const [pessoas, unioes, docsRaw] = await Promise.all([
      processo.arvoreId
        ? prisma.pessoa.findMany({
            where: pessoasAtivasDaArvore(processo.arvoreId),
            select: {
              id: true,
              nome: true,
              sobrenome: true,
              sexo: true,
              publicCode: true,
              numeroLinhagem: true,
              requerente: true,
              linhaReta: true,
              paiId: true,
              maeId: true,
            },
          })
        : [],
      processo.arvoreId
        ? prisma.uniao.findMany({
            where: {
              OR: [
                { pessoa1: { arvoreId: processo.arvoreId } },
                { pessoa2: { arvoreId: processo.arvoreId } },
              ],
            },
            select: { id: true, pessoa1Id: true, pessoa2Id: true },
          })
        : [],
      processo.arvoreId
        ? prisma.documento.findMany({
            where: { pessoa: { arvoreId: processo.arvoreId } },
            select: {
              id: true,
              pessoaId: true,
              necessidadeId: true, // p/ Tarefa Transversal na linha do documento (Emissão)
              tipo: true,
              status: true,
              updatedAt: true,
              responsavelId: true,
              responsavel: { select: { nome: true } },
              dataPrazoOperacao: true,
              motivoBloqueio: true,
              ultimaMovimentacao: true,
              // CUTOVER V2: sem leitura de Workflow legado. Passos V2 por-documento
              // (PhaseWorkflowStepInstance com documentoId) alimentam a operação.
            },
          })
        : [],
    ])

    // Nome completo: fonte única no núcleo puro (mesma régua usada pelo roster).
    const nomeCompleto = nomeCompletoPessoa

    const pessoasMap = new Map(pessoas.map((p) => [p.id, p]))
    const pessoasNaLinha = pessoas.filter((p) => p.linhaReta)

    // ============================================================
    // ROSTER OFICIAL DAS PESSOAS DO PROCESSO
    // ------------------------------------------------------------
    // Classificação (linha principal / fora da linhagem / pendente) e posição na
    // linhagem calculadas pelo motor genealógico oficial a partir das relações de
    // filiação reais. Independe de documento, necessidade, tarefa e workflow.
    // ============================================================
    const pessoasDoProcesso = montarPessoasDoProcesso(pessoas, unioes)

    // FONTE OFICIAL ÚNICA de progresso/estado do workflow — a MESMA usada pelo cabeçalho
    // (/api/processos/[id]/phase) e demais consumidores. Nada de cálculo paralelo aqui.
    const prog = await resolveProgressoFaseDocumento(id, faseContexto)
    const workflowsRaw = Array.from(prog.wfPorDoc.values())

    // PROJEÇÃO OPERACIONAL OFICIAL (scope-aware) — o percentual/estado da fase exibido
    // na Central (barra, trilha macro, KPI headline) vem DAQUI, garantindo o MESMO
    // número do Kanban e do Header. Os KPIs detalhados (byPerson, counts, fila) seguem
    // como dado operacional, mas o headline de progresso é a projeção.
    const projection = await resolveOperationalProjection(id, faseContexto)

    // Geração exibida (1 = requerente, 2 = pais, …) derivada do MESMO roster — não de
    // um campo denormalizado que pode estar vazio (numeroLinhagem é null em toda a
    // base atual, o que fazia toda pessoa cair em "99").
    const geracaoPorPessoa = new Map(pessoasDoProcesso.map((p) => [p.pessoaId, p.geracao]))
    const generationOf = (pessoaId: number): number => {
      const g = geracaoPorPessoa.get(pessoaId)
      if (g != null) return g + 1
      return pessoasMap.get(pessoaId)?.numeroLinhagem ?? 99
    }

    // docId -> responsável da ETAPA ativa (fallback quando o doc não tem
    // responsável próprio). Regra robusta (não depende da grafia exata do status):
    //   1º etapa "em execução" (status contém "execu"), com assignee;
    //   senão 1ª etapa não concluída com assignee;
    //   senão 1ª etapa qualquer com assignee.
    const stepOwnerByDoc = prog.stepOwnerPorDoc // fonte oficial (responsável do passo ativo)

    // ============================================================
    // 2) Documentos
    // ============================================================

    const schemaCapabilities = {
      hasResponsavel: true,
      hasPrazoOperacao: true,
      hasMotivoBloqueio: true,
      hasUltimaMovimentacao: true,
    }

    interface DocFull {
      id: number
      pessoaId: number
      necessidadeId?: number | null
      tipo: string
      status: string
      updatedAt: Date
      responsavelId?: number | null
      responsavelNome?: string | null
      dataPrazoOperacao?: Date | null
      motivoBloqueio?: string | null
      ultimaMovimentacao?: Date | null
      workflows?: Array<{ faseCode: string | null; status: string }>
    }

    const docs: DocFull[] = docsRaw.map((d: any) => {
      const stepOwner = stepOwnerByDoc.get(d.id) ?? null
      return {
        id: d.id,
        pessoaId: d.pessoaId,
        necessidadeId: d.necessidadeId ?? null,
        tipo: d.tipo,
        status: d.status,
        updatedAt: d.updatedAt,
        // doc tem prioridade; se não tiver, cai pro responsável da etapa ativa
        responsavelId: d.responsavelId ?? stepOwner?.id ?? null,
        responsavelNome: d.responsavel?.nome ?? stepOwner?.nome ?? null,
        dataPrazoOperacao: d.dataPrazoOperacao,
        motivoBloqueio: d.motivoBloqueio,
        ultimaMovimentacao: d.ultimaMovimentacao,
      }
    })

    // ============================================================
    // 3) Classificadores
    // ============================================================
    const now = new Date()
    const diffDays = (a: Date, b: Date) =>
      Math.floor((a.getTime() - b.getTime()) / 86400000)

    const isFinalizado = (d: DocFull) => STATUS_FINALIZADOS.includes(d.status)
    const isPendente = (d: DocFull) => d.status === "PENDENTE"
    const isAtivo = (d: DocFull) => !isFinalizado(d) && !isPendente(d)
    const isWaitingExternal = (d: DocFull) => STATUS_WAITING_EXTERNAL.includes(d.status)

    const isOverdue = (d: DocFull) =>
      !!d.dataPrazoOperacao && d.dataPrazoOperacao < now && !isFinalizado(d)
    const isCritical = (d: DocFull) =>
      !!d.dataPrazoOperacao &&
      diffDays(now, d.dataPrazoOperacao) > 5 &&
      !isFinalizado(d)
    const isBlocked = (d: DocFull) => !!d.motivoBloqueio
    const isNoOwner = (d: DocFull) =>
      schemaCapabilities.hasResponsavel && !d.responsavelId && isAtivo(d)
    const isStale = (d: DocFull) => {
      const ref = d.ultimaMovimentacao ?? d.updatedAt
      return isAtivo(d) && diffDays(now, ref) >= 3
    }
    const isMine = (d: DocFull) =>
      schemaCapabilities.hasResponsavel &&
      userId != null &&
      d.responsavelId === userId

    // ============================================================
    // 4) Cards
    // ============================================================
    const cards: CardCounts = {
      all: docs.filter(isAtivo).length,
      pending: docs.filter(isPendente).length,
      overdue: docs.filter(isOverdue).length,
      critical: docs.filter(isCritical).length,
      waiting: docs.filter((d) => isAtivo(d) && isWaitingExternal(d)).length,
      blocked: docs.filter(isBlocked).length,
      noOwner: docs.filter(isNoOwner).length,
      followup: 0,
      stale: docs.filter(isStale).length,
    }

    // ============================================================
    // 5) Fila filtrada
    // ============================================================
    let filtered: DocFull[]
    let queueTitle = "Documentos em operação"

    switch (queueFilter) {
      case "pending":
        filtered = docs.filter(isPendente)
        queueTitle = "Pendentes · sem operação iniciada"
        break
      case "overdue":
        filtered = docs.filter(isOverdue)
        queueTitle = "Documentos atrasados"
        break
      case "critical":
        filtered = docs.filter(isCritical)
        queueTitle = "Documentos críticos"
        break
      case "waiting":
        filtered = docs.filter((d) => isAtivo(d) && isWaitingExternal(d))
        queueTitle = "Aguardando cartório"
        break
      case "blocked":
        filtered = docs.filter(isBlocked)
        queueTitle = "Bloqueados"
        break
      case "no-owner":
        filtered = docs.filter(isNoOwner)
        queueTitle = "Sem responsável"
        break
      case "stale":
        filtered = docs.filter(isStale)
        queueTitle = "Sem movimento há ≥3d"
        break
      case "me":
        filtered = docs.filter(isMine)
        queueTitle = "Minhas operações"
        break
      case "followup":
        filtered = []
        queueTitle = "Follow-ups hoje (modelo ainda não implementado)"
        break
      case "all":
      default:
        // A tabela por pessoa da fase usa esta lista, então mostramos TODOS os
        // documentos — inclusive os já recebidos/validados. (Antes só "ativos"
        // → doc Recebido sumia da tabela.)
        filtered = docs
        queueTitle = "Todas as tarefas ativas"
        break
    }

    // ============================================================
    // 6) Ordenação
    // ============================================================
    const priorityScore = (d: DocFull): number => {
      let score = 0
      if (isBlocked(d)) score += 50
      if (isNoOwner(d)) score += 80
      if (d.dataPrazoOperacao) {
        const od = diffDays(now, d.dataPrazoOperacao)
        if (od > 5) score += 200
        else if (od > 0) score += 100
        else if (od > -1) score += 30
      }
      return score
    }

    filtered.sort((a, b) => {
      if (sortBy === "priority") return priorityScore(b) - priorityScore(a)
      if (sortBy === "sla") {
        const aDue = a.dataPrazoOperacao?.getTime() ?? Number.MAX_SAFE_INTEGER
        const bDue = b.dataPrazoOperacao?.getTime() ?? Number.MAX_SAFE_INTEGER
        return aDue - bDue
      }
      return generationOf(a.pessoaId) - generationOf(b.pessoaId)
    })

    // CONCLUSÃO e PRÓXIMA AÇÃO vêm da FONTE OFICIAL (prog) — sem recálculo local.
    const docConcluiuFase = (docId: number): boolean => prog.concluidosPorDoc.has(docId)
    const proximaAcaoDoc = (docId: number): string | null => prog.proximaAcaoPorDoc.get(docId) ?? null

    // ============================================================
    // 7) Linhas da tabela
    // ============================================================
    const queue: QueueRow[] = filtered.map((d) => {
      const pessoa = pessoasMap.get(d.pessoaId)
      const dias = d.dataPrazoOperacao ? diffDays(d.dataPrazoOperacao, now) : null

      // PRÓXIMA AÇÃO derivada do workflow (1ª etapa não concluída), não de texto fixo.
      // Estados excepcionais (crítico/atrasado/bloqueado/sem responsável) continuam
      // prevalecendo; caso contrário, mostra a etapa real (ex.: "Conferir certidão").
      let proximoPasso: string | null = null
      if (isCritical(d)) proximoPasso = "crítico"
      else if (isOverdue(d)) proximoPasso = "atrasado"
      else if (isBlocked(d)) proximoPasso = d.motivoBloqueio ?? null
      else if (isNoOwner(d)) proximoPasso = "sem responsável"
      else proximoPasso = proximaAcaoDoc(d.id) ?? "normal"

      return {
        docId: d.id,
        pessoaId: d.pessoaId,
        necessidadeId: d.necessidadeId ?? null,
        pessoaNome: pessoa ? nomeCompleto(pessoa) : "—",
        docType: d.tipo,
        docTypeLabel: TIPO_LABELS[d.tipo] || d.tipo,
        status: STATUS_LABELS[d.status] || d.status,
        statusRaw: d.status,
        responsavelNome: d.responsavelNome ?? null,
        prazo: d.dataPrazoOperacao?.toISOString() ?? null,
        diasParaPrazo: dias,
        motivoBloqueio: d.motivoBloqueio ?? null,
        ultimaMovimentacao:
          d.ultimaMovimentacao?.toISOString() ?? d.updatedAt.toISOString(),
        isCritical: isCritical(d),
        isOverdue: isOverdue(d),
        isBlocked: isBlocked(d),
        noOwner: isNoOwner(d),
        proximoPasso,
        generation: generationOf(d.pessoaId),
        isLinhaReta: pessoa?.linhaReta ?? false,
      }
    })

    // ============================================================
    // 8) Matriz de completude
    // ============================================================
    const byPersonAgg = new Map<number, { completed: number; total: number; generation: number }>()
    for (const d of docs) {
      const pid = d.pessoaId
      const cur = byPersonAgg.get(pid) ?? {
        completed: 0,
        total: 0,
        generation: generationOf(pid),
      }
      cur.total += 1
      if (docConcluiuFase(d.id)) cur.completed += 1 // conclusão REAL do workflow, não status
      byPersonAgg.set(pid, cur)
    }

    const matrixByPerson = Array.from(byPersonAgg.entries())
      .filter(([pid]) => pessoasMap.get(pid)?.linhaReta)
      .map(([pid, v]) => {
        const p = pessoasMap.get(pid)!
        return {
          pessoaId: pid,
          nome: nomeCompleto(p),
          generation: v.generation,
          completed: v.completed,
          total: v.total,
          percentage: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
        }
      })
      .sort((a, b) => a.generation - b.generation)

    // só a linha reta conta pro progresso da fase (igual ao header e ao gate);
    // docs de apoio seguem na fila operacional, mas não entram no % da fase
    const linhaRetaDocs = docs.filter((d) => pessoasMap.get(d.pessoaId)?.linhaReta)
    const totalDocs = linhaRetaDocs.length

    // FONTE OFICIAL: "concluiu a fase atual" = última etapa obrigatória do Workflow
    // Interno concluída (validar_certidao na Emissão) — NÃO o status mestre do documento
    // (RECEBIDO não conclui). Alinha matrix/barra/macro/header ao faseProgress.
    const concluiuFaseAtual = (d: DocFull): boolean => docConcluiuFase(d.id)

    const validados = prog.done // FONTE OFICIAL (mesma do cabeçalho)

    const missing = docs
      .filter((d) => !concluiuFaseAtual(d))
      .filter((d) => pessoasMap.get(d.pessoaId)?.linhaReta)
      .slice(0, 50)
      .map((d) => {
        const pessoa = pessoasMap.get(d.pessoaId)!
        return {
          docId: d.id,
          pessoaId: d.pessoaId,
          pessoaNome: nomeCompleto(pessoa),
          docType: TIPO_LABELS[d.tipo] || d.tipo,
          status: STATUS_LABELS[d.status] || d.status,
          generation: pessoa.numeroLinhagem ?? 99,
        }
      })

    const matrixLegado: MatrixResponse = {
      percentage: prog.percent,          // FONTE OFICIAL (idêntica ao cabeçalho)
      completed: prog.done,
      total: prog.total,
      directPeopleCount: pessoasNaLinha.length,
      missingCount: Math.max(0, prog.total - prog.done),
      nameVariationsCount: 0,
      byPerson: matrixByPerson,
      missing,
    }

    // ============================================================
    // LEGADO_INATIVO (desativação Genealogia): neutraliza as métricas antigas
    // ------------------------------------------------------------
    // Na fase GENEALOGIA, "Obrigatórios/validados/percentual" derivavam de
    // Documento + Pessoa.linhaReta + STATUS_VALIDADOS (RECEBIDO contado como
    // validado) — cálculo enganoso. Enquanto a arquitetura documental definitiva
    // não for aprovada, ZERAMOS os agregados e sinalizamos reestruturação. A lista
    // de pessoas (byPerson: nomes/geração) permanece como dado estrutural; suas
    // contagens de completude vão a zero para não afirmar validação.
    const genealogiaReestruturacao = faseAtualCode === "GENEALOGIA"
    const mensagemReestruturacao = genealogiaReestruturacao
      ? "A definição documental da Genealogia está em reestruturação. Nenhum progresso automático é calculado nesta etapa."
      : null

    const matrix: MatrixResponse = genealogiaReestruturacao
      ? {
          percentage: 0,
          completed: 0,
          total: 0,
          directPeopleCount: pessoasNaLinha.length,
          missingCount: 0,
          nameVariationsCount: 0,
          byPerson: matrixByPerson.map((p) => ({ ...p, completed: 0, total: 0, percentage: 0 })),
          missing: [],
        }
      : matrixLegado

    // ============================================================
    // 9) Estado REAL dos passos da fase atual — direto da FONTE OFICIAL (prog).
    //    counts/steps/docsNaFase são os MESMOS números do cabeçalho/matrix. Sem 2ª fonte.
    // ============================================================
    const faseProgress: FaseProgress = {
      faseCode: faseAtualCode ?? null,
      kind: faseAtualCode ? getFase(faseAtualCode).kind : "documento",
      steps: prog.faseSteps,
      docsNaFase: prog.docsNaFase,
      counts: prog.counts,
    }

    // ============================================================
    // GENEALOGIA V2 — LIGAÇÃO da Central com a arquitetura nova. Substitui a
    // visualização legada/neutra. Fonte: NecessidadeDocumental de CERTIDÃO +
    // passos localizar_registro (NÃO Documento.status / linhaReta / STATUS_VALIDADOS).
    // Progresso = passos obrigatórios localizar_registro concluídos / aplicáveis.
    // Não altera regras nem motor — só monta a resposta da UI a partir do V2.
    // ============================================================
    let genealogiaV2: { matrix: MatrixResponse; queue: QueueRow[]; faseProgress: FaseProgress } | null = null
    if (faseAtualCode === "GENEALOGIA") {
      const certItens = await itemCatalogosDeCertidao(prisma)
      const necsRaw = await prisma.necessidadeDocumental.findMany({
        where: { processoId: id, supersedePorId: null }, // ignora superseded (reabertura)
        select: { id: true, pessoaId: true, obrigatoriedade: true, status: true, matrizSnapshot: true, itemCatalogoId: true },
      })
      // só CERTIDÕES (natureza estruturada) e não dispensadas
      const necs = necsRaw.filter((n) => certItens.has(n.itemCatalogoId) && n.status !== "DISPENSADA")
      const stepsLR = await prisma.phaseWorkflowStepInstance.findMany({
        // consulta de fase passada ⇒ escopa à instância indicada (dados vivos daquele ciclo).
        // Exclui SUPERSEDIDO/CANCELADO e ordena por ciclo/updatedAt desc → o dedup first-wins
        // pega o passo MAIS RECENTE de cada necessidade (genealogia reaberta não mostra ciclo velho).
        where: { processoId: id, faseMacroKey: "genealogia", stepKey: "localizar_registro", status: { notIn: ["SUPERSEDIDO", "CANCELADO"] }, ...(faseContexto?.workflowInstanceId != null ? { workflowInstanceId: faseContexto.workflowInstanceId } : {}) },
        orderBy: [{ ciclo: "desc" }, { updatedAt: "desc" }],
        select: { id: true, necessidadeId: true, status: true, obrigatorio: true, documentoId: true, prazo: true, responsavelId: true, updatedAt: true, motivo: true },
      })
      // ── A TAREFA CANÔNICA É A RAIZ DA VISÃO OPERACIONAL ──────────────────
      // A Central montava a linha direto do StepInstance, e a tela de Tarefas
      // lia Tarefa: duas telas, duas entidades, nenhuma identidade em comum —
      // não havia como dizer que a linha do Ademir aqui e a linha lá eram o
      // MESMO trabalho. A etapa continua sendo exibida; ela só deixou de ser a
      // raiz. Uma consulta, indexada pela necessidade que originou o trabalho.
      const tarefasDoProcesso = await prisma.tarefa.findMany({
        where: { processoId: id, necessidadeId: { in: necs.map((n) => n.id) } },
        select: {
          id: true, necessidadeId: true, statusTarefa: true, responsavelId: true, equipeKey: true,
          dataPrazo: true, prioridade: true, workflowInstanceId: true, workflowStepInstanceId: true,
          updatedAt: true, concluida: true,
          responsavel: { select: { nome: true } },
        },
      })
      const tarefaPorNecessidade = new Map(
        tarefasDoProcesso.filter((t) => t.necessidadeId != null).map((t) => [t.necessidadeId as number, t]),
      )

      // responsavelId é ref solta a Usuario (sem relation) → resolve o nome em lote
      const respIds = [...new Set(stepsLR.map((s) => s.responsavelId).filter((x): x is number => x != null))]
      const respNomes = respIds.length
        ? new Map((await prisma.usuario.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]))
        : new Map<number, string>()
      const stepByNec = new Map<number, (typeof stepsLR)[number]>()
      for (const s of stepsLR) if (s.necessidadeId != null && !stepByNec.has(s.necessidadeId)) stepByNec.set(s.necessidadeId, s)
      const CONCLUIDO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"])
      const localizado = (necId: number) => { const s = stepByNec.get(necId); return !!s && CONCLUIDO.has(s.status) }
      // NOME DA OBRIGAÇÃO pelo Cadastro Mestre. `requisito` é o texto da regra e
      // não nomeia documento — usá-lo aqui fazia a mesma exigência aparecer com
      // dois nomes ("Certidão de Nascimento" × "Certidão de nascimento - Inteiro
      // Teor") e ser lida como duas obrigações.
      const tiposCad = await prisma.tipoDocumentoCadastro.findMany({ select: { code: true, name: true } })
      const nomeTipoPorCode = new Map(tiposCad.filter((t) => t.code).map((t) => [t.code as string, t.name]))
      const itemNomePorId = new Map(
        (await prisma.itemCatalogo.findMany({ where: { id: { in: [...new Set(necsRaw.map((n) => n.itemCatalogoId))] } }, select: { id: true, name: true } }))
          .map((i) => [i.id, i.name]),
      )
      const requisitoDe = (n: { matrizSnapshot: unknown; itemCatalogoId: number }) => {
        const snap = (n.matrizSnapshot ?? null) as { requisito?: unknown; documentosAceitos?: unknown } | null
        return nomeCanonicoDaObrigacao({
          documentosAceitos: snap?.documentosAceitos,
          requisitoNome: typeof snap?.requisito === "string" ? snap.requisito : null,
          itemCatalogoNome: itemNomePorId.get(n.itemCatalogoId) ?? null,
          nomePorCode: (code) => nomeTipoPorCode.get(code) ?? null,
        }) ?? "Certidão"
      }

      // progresso = passos OBRIGATÓRIOS localizar_registro concluídos / aplicáveis
      const obrig = necs.filter((n) => n.obrigatoriedade === "OBRIGATORIA")
      const totalObrig = obrig.length
      const obrigDone = obrig.filter((n) => localizado(n.id)).length
      const percentage = totalObrig > 0 ? Math.round((obrigDone / totalObrig) * 100) : 0

      const byP = new Map<number, { completed: number; total: number; generation: number }>()
      for (const n of necs) {
        if (n.pessoaId == null) continue
        const cur = byP.get(n.pessoaId) ?? { completed: 0, total: 0, generation: generationOf(n.pessoaId) }
        cur.total += 1
        if (localizado(n.id)) cur.completed += 1
        byP.set(n.pessoaId, cur)
      }
      const byPersonV2 = Array.from(byP.entries())
        .filter(([pid]) => pessoasMap.get(pid)?.linhaReta)
        .map(([pid, v]) => { const p = pessoasMap.get(pid)!; return { pessoaId: pid, nome: nomeCompleto(p), generation: v.generation, completed: v.completed, total: v.total, percentage: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0 } })
        .sort((a, b) => a.generation - b.generation)

      const queueV2: QueueRow[] = necs.map((n) => {
        const s = stepByNec.get(n.id)
        const ok = localizado(n.id)
        const pessoa = n.pessoaId != null ? pessoasMap.get(n.pessoaId) : undefined
        // O que a linha mostra vem da TAREFA quando ela existe; a etapa entra
        // como conteúdo interno. Responsável e prazo NUNCA saem do documento:
        // era essa fonte concorrente que fazia "Daniela" numa tela e "Equipe
        // Documental" na outra descreverem a mesma linha sem se encontrarem.
        const tarefa = n.id != null ? tarefaPorNecessidade.get(n.id) ?? null : null
        const prazoEfetivo = tarefa?.dataPrazo ?? s?.prazo ?? null
        const dias = prazoEfetivo ? diffDays(prazoEfetivo, now) : null
        return {
          // A IDENTIDADE COMPARTILHADA: é por este número que a Central e a
          // tela de Tarefas falam da mesma coisa.
          taskId: tarefa?.id ?? null,
          statusTarefa: tarefa?.statusTarefa ?? null,
          equipeKey: tarefa?.equipeKey ?? null,
          prioridade: tarefa?.prioridade ?? null,
          workflowInstanceId: tarefa?.workflowInstanceId ?? null,
          stepAtualId: tarefa?.workflowStepInstanceId ?? s?.id ?? null,
          docId: s?.documentoId ?? 0,
          pessoaId: n.pessoaId ?? 0,
          pessoaNome: pessoa ? nomeCompleto(pessoa) : "—",
          docType: requisitoDe(n),
          docTypeLabel: requisitoDe(n),
          status: ok ? "Registro localizado" : "A localizar",
          statusRaw: ok ? "LOCALIZADO" : "A_LOCALIZAR",
          responsavelNome: tarefa?.responsavel?.nome
            ?? (s?.responsavelId != null ? respNomes.get(s.responsavelId) ?? null : null),
          responsavelId: tarefa?.responsavelId ?? s?.responsavelId ?? null,
          prazo: prazoEfetivo?.toISOString() ?? null,
          diasParaPrazo: dias,
          motivoBloqueio: null,
          ultimaMovimentacao: (tarefa?.updatedAt ?? s?.updatedAt)?.toISOString() ?? null,
          isCritical: false,
          isOverdue: !ok && dias != null && dias < 0,
          isBlocked: false,
          // "sem dono" é da TAREFA: ela pode estar na fila da equipe, que é um
          // estado legítimo e não um cadastro incompleto.
          noOwner: tarefa != null ? tarefa.responsavelId == null : !s?.responsavelId,
          // NÃO usar "normal" (o front mapeia "normal"→"Solicitar certidão", que é ação da
          // Emissão). Na Genealogia a ação é localizar; localizado → "Concluído".
          proximoPasso: ok ? "Concluído" : "Localizar registro",
          generation: n.pessoaId != null ? generationOf(n.pessoaId) : 99,
          isLinhaReta: pessoa?.linhaReta ?? false,
          necessidadeId: n.id,
        }
      })

      genealogiaV2 = {
        // FONTE ÚNICA: percentual/total/done vêm da projeção canônica (prog) — idênticos ao
        // cabeçalho (/phase). byPerson permanece (detalhe por pessoa da própria fila).
        matrix: { percentage: prog.percent, completed: prog.done, total: prog.total, directPeopleCount: pessoasNaLinha.length, missingCount: Math.max(0, prog.total - prog.done), nameVariationsCount: 0, byPerson: byPersonV2, missing: [] },
        queue: queueV2,
        faseProgress: {
          faseCode: faseAtualCode ?? null, kind: "documento", docsNaFase: necs.length,
          // ESTADO HONESTO DO PASSO: com ZERO requisito aplicável a etapa NÃO está "em
          // andamento" — não há o que andar. Declarar "Em andamento" com denominador
          // zero produzia exatamente o sintoma relatado: uma etapa que se anuncia ativa
          // e não abre nada, porque não existe nenhuma tarefa por trás dela.
          steps: [{
            ordem: 1,
            stepKey: "localizar_registro",
            title: "Localizar registro da certidão",
            status: totalObrig === 0 ? "pendente" : obrigDone >= totalObrig ? "concluida" : "em_andamento",
            concluidos: obrigDone,
            total: totalObrig,
          }],
          counts: { solicitados: 0, aguardando: Math.max(0, totalObrig - obrigDone), recebidos: obrigDone, conferidos: 0, validados: obrigDone },
        },
      }
    }

    // ============================================================
    // 10) ÍNDICE OPERACIONAL DA FASE — a consulta oficial da tela principal.
    // ------------------------------------------------------------
    // A Central Operacional é um ÍNDICE: pessoa → documento → "Abrir detalhes". Quem
    // EXECUTA é o modal do documento, na aba Workflow, que tem a própria consulta.
    // Por isso esta resposta NÃO carrega passo, status de passo, responsável de
    // passo, SLA, prazo, bloqueio nem operação antecipada: um processo com 20
    // instâncias não manda 20 instâncias para uma tela que não pode mostrá-las.
    //
    // O agrupamento continua sendo do domínio, por IDs relacionais oficiais, sobre
    // as MESMAS instâncias de sempre (escopadas por instância na consulta de fase
    // passada, excluindo SUPERSEDIDO/CANCELADO). O roster já lido acima é
    // REAPROVEITADO — a árvore não é relida na mesma requisição.
    // ============================================================
    const { indice } = await getPhaseOperationalSummary(
      {
        processoId: id,
        faseMacroKey: faseConsultadaKey,
        // Escopo por INSTÂNCIA sempre: da fase passada quando informada, senão a
        // VIGENTE da fase ativa. Sem isso, uma fase com dois ciclos (retorno ou
        // movimentação manual) devolvia os dois somados.
        workflowInstanceId: faseContexto?.workflowInstanceId ?? instanciaVigente?.id ?? null,
      },
      { pessoas: pessoasDoProcesso, agora: now },
    )

    // Headline de progresso vem da PROJEÇÃO OFICIAL (mesmo % do Kanban/Header). O
    // detalhamento por pessoa (byPerson) e a lista de faltantes seguem como dado
    // operacional detalhado da Central.
    const matrixBase = genealogiaV2 ? genealogiaV2.matrix : matrix
    const matrixOficial: MatrixResponse = {
      ...matrixBase,
      percentage: projection.progress.percentage,
      completed: projection.metrics.completed,
      total: projection.metrics.required,
      missingCount: Math.max(0, projection.metrics.required - projection.metrics.completed),
    }

    const response: CentralOperacionalResponse = {
      mode,
      phaseContext: {
        faseCode: faseAtualCode,
        faseMacroKey: faseConsultadaKey,
        workflowInstanceId: workflowInstanceId ?? instanciaVigente?.id ?? null,
        ciclo: cicloConsultado ?? instanciaVigente?.ciclo ?? null,
      },
      materializacao,
      projection,
      matrix: matrixOficial,
      cards,
      queue: genealogiaV2 ? genealogiaV2.queue : queue,
      queueTitle,
      pessoas: pessoasDoProcesso,
      indice,
      faseProgress: genealogiaV2 ? genealogiaV2.faseProgress : faseProgress,
      // Genealogia agora tem visualização V2 real — sai o estado neutro de reestruturação.
      genealogiaReestruturacao: genealogiaV2 ? false : genealogiaReestruturacao,
      mensagemReestruturacao: genealogiaV2 ? null : mensagemReestruturacao,
      schemaCapabilities,
    }

    return NextResponse.json(response)
  } catch (error) {
    // AUDITORIA TÉCNICA: um registro estruturado por ocorrência, com a identidade que
    // a tela também exibe. É o que permite achar ESTA falha nos logs de runtime em vez
    // de procurar um texto genérico repetido por toda requisição que já falhou.
    const e = error as { message?: string; code?: string; name?: string }
    console.error(
      "[central-operacional] falha na leitura",
      JSON.stringify({
        correlationId,
        rota: "GET /api/processos/[processoId]/central-operacional",
        url: request.url,
        erro: e?.message ?? String(error),
        codigo: e?.code ?? e?.name ?? null,
        em: new Date().toISOString(),
      }),
    )
    console.error(error)
    return NextResponse.json(
      {
        error: "Não foi possível carregar a Central Operacional.",
        code: e?.code ?? "CENTRAL_OPERACIONAL_FALHOU",
        correlationId,
      },
      { status: 500 },
    )
  }
}