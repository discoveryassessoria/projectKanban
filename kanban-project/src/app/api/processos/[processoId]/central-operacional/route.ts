// src/app/api/processos/[processoId]/central-operacional/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getOrdemFase, getStepsForFase, getFase, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
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
  status: "concluida" | "em_andamento" | "bloqueada"
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

interface CentralOperacionalResponse {
  matrix: MatrixResponse
  cards: CardCounts
  queue: QueueRow[]
  queueTitle: string
  faseProgress: FaseProgress
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

const TIPO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (IT)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (IT)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (IT)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
  CNN: "CNN",
  CARTA_NATURALIZACAO: "Carta de Naturalização",
  RG: "RG",
  CPF: "CPF",
  CNH: "CNH",
  PASSAPORTE_BRASILEIRO: "Passaporte BR",
  TITULO_ELEITOR: "Título de Eleitor",
  RESERVISTA: "Reservista",
  PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
  CERTIDAO_CIDADANIA_ESTRANGEIRA: "Certidão de Cidadania",
  COMPROVANTE_RESIDENCIA: "Comprovante de Residência",
  TRADUCAO_JURAMENTADA: "Tradução Juramentada",
  APOSTILA_HAIA: "Apostila de Haia",
  FOTO_3X4: "Foto 3x4",
  PROCURACAO: "Procuração",
  ARVORE_GENEALOGICA_DOC: "Árvore Genealógica",
  OUTRO: "Outro",
}

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Pendente",
  SOLICITADO: "Solicitado",
  EM_BUSCA: "Em busca",
  SOLICITAR: "Solicitar",
  RECEBIDO: "Recebido",
  EM_ANALISE: "Em análise",
  RETIFICANDO: "Retificando",
  EM_TRADUCAO: "Em tradução",
  TRADUZIDO: "Traduzido",
  EM_APOSTILAMENTO: "Em apostilamento",
  APOSTILADO: "Apostilado",
  ENTREGUE: "Entregue",
  INVALIDO: "Inválido",
  NAO_ENCONTRADO: "Não encontrado",
}

// ============================================================
// HANDLER
// ============================================================

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> }
) {
  // Item 1 da auditoria — gate canônico de LEITURA: exige processos.ver
  // (rota GET/consulta; as ações de avanço usam workflow.avancar).
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro

  try {
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
      select: { id: true, arvoreId: true, faseAtualKey: true, status: { select: { faseCode: true } } },
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    const faseAtualCode =
      (phaseKeyToFaseCode(processo.faseAtualKey) ?? processo.status?.faseCode ?? null)

    // pessoas e documentos não dependem um do outro (ambos só precisam do
    // arvoreId) → busca os dois EM PARALELO, economizando um round-trip ao banco.
    const [pessoas, docsRaw, workflowsRaw] = await Promise.all([
      processo.arvoreId
        ? prisma.pessoa.findMany({
            where: { arvoreId: processo.arvoreId },
            select: {
              id: true,
              nome: true,
              sobrenome: true,
              numeroLinhagem: true,
              requerente: true,
              linhaReta: true,
            },
          })
        : [],
      processo.arvoreId
        ? prisma.documento.findMany({
            where: { pessoa: { arvoreId: processo.arvoreId } },
            select: {
              id: true,
              pessoaId: true,
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
      // CUTOVER V2: workflowsRaw legado eliminado. O dono do documento vem do
      // mestre (Documento.responsavelId). TODO: enriquecer com o responsável do
      // passo ATIVO via PhaseWorkflowStepInstance (responsavelId é ref solta a Usuario).
      [] as Array<{ documentoId: number; faseCode: string | null; steps: Array<{ ordem: number; stepKey: string; status: string; assigneeId: number | null; assignee: { nome: string } | null }> }>,
    ])

    const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
      `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`

    const pessoasMap = new Map(pessoas.map((p) => [p.id, p]))
    const pessoasNaLinha = pessoas.filter((p) => p.linhaReta)

    const generationOf = (pessoaId: number): number => {
      const p = pessoasMap.get(pessoaId)
      return p?.numeroLinhagem ?? 99
    }

    // docId -> responsável da ETAPA ativa (fallback quando o doc não tem
    // responsável próprio). Regra robusta (não depende da grafia exata do status):
    //   1º etapa "em execução" (status contém "execu"), com assignee;
    //   senão 1ª etapa não concluída com assignee;
    //   senão 1ª etapa qualquer com assignee.
    const stepOwnerByDoc = new Map<number, { id: number; nome: string }>()
    for (const wf of workflowsRaw as any[]) {
      const comResp = wf.steps.filter((s: any) => s.assigneeId && s.assignee?.nome)
      if (comResp.length === 0) continue
      const emExec = comResp.find((s: any) => /execu/i.test(s.status))
      const naoConcluida = comResp.find((s: any) => !/conclu|finaliz/i.test(s.status))
      const escolhida = emExec ?? naoConcluida ?? comResp[0]
      if (escolhida && !stepOwnerByDoc.has(wf.documentoId)) {
        stepOwnerByDoc.set(wf.documentoId, { id: escolhida.assigneeId, nome: escolhida.assignee.nome })
      }
    }

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

    // ============================================================
    // 7) Linhas da tabela
    // ============================================================
    const queue: QueueRow[] = filtered.map((d) => {
      const pessoa = pessoasMap.get(d.pessoaId)
      const dias = d.dataPrazoOperacao ? diffDays(d.dataPrazoOperacao, now) : null

      let proximoPasso: string | null = null
      if (isCritical(d)) proximoPasso = "crítico"
      else if (isOverdue(d)) proximoPasso = "atrasado"
      else if (isBlocked(d)) proximoPasso = d.motivoBloqueio ?? null
      else if (isNoOwner(d)) proximoPasso = "sem responsável"
      else if (isPendente(d)) proximoPasso = "aguarda decisão do operador"
      else proximoPasso = "normal"

      return {
        docId: d.id,
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
      if (STATUS_VALIDADOS.includes(d.status)) cur.completed += 1
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

    // CUTOVER V2: "concluiu a fase atual" deriva do STATUS mestre do documento
    // (não lê mais Workflow legado). Status validado = documento passou da fase.
    const concluiuFaseAtual = (d: DocFull): boolean => STATUS_VALIDADOS.includes(d.status)

    const validados = linhaRetaDocs.filter(concluiuFaseAtual).length

    const missing = docs
      .filter((d) => !STATUS_VALIDADOS.includes(d.status))
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

    const matrix: MatrixResponse = {
      percentage: totalDocs > 0 ? Math.round((validados / totalDocs) * 100) : 0,
      completed: validados,
      total: totalDocs,
      directPeopleCount: pessoasNaLinha.length,
      missingCount: totalDocs - validados,
      nameVariationsCount: 0,
      byPerson: matrixByPerson,
      missing,
    }

    // ============================================================
    // 9) ✅ NOVO: Estado REAL dos passos da fase atual
    // ------------------------------------------------------------
    // Fonte: WorkflowStep.status (a verdade já gravada). Quando um passo é
    // concluído na tela, a rota de conclusão chama o stepCompletionResolver e,
    // se passou, grava status = concluída. Então aqui NÃO reavaliamos o portão
    // (isso seria uma 2ª fonte de verdade + N consultas por polling): apenas
    // LEMOS o que já está gravado.
    //
    // Conta só os documentos da LINHA RETA — mesma régua da matriz e do KPI
    // "Obrigatórios". (Docs de apoio continuam aparecendo na fila/tabela, mas
    // não entram nas contagens da fase.)
    // ============================================================
    const stepConcluido = (status: string) => /conclu|finaliz/i.test(status)

    const docIdsLinhaReta = new Set(
      docs.filter((d) => pessoasMap.get(d.pessoaId)?.linhaReta).map((d) => d.id),
    )

    const wfsDaFase = (workflowsRaw as any[]).filter(
      (wf) => wf.faseCode === faseAtualCode && docIdsLinhaReta.has(wf.documentoId),
    )
    const docsNaFase = wfsDaFase.length

    // concluídos / total por stepKey (agregado entre os docs da fase)
    const concluidosPorKey = new Map<string, number>()
    const totalPorKey = new Map<string, number>()
    for (const wf of wfsDaFase) {
      for (const s of wf.steps as any[]) {
        totalPorKey.set(s.stepKey, (totalPorKey.get(s.stepKey) ?? 0) + 1)
        if (stepConcluido(s.status)) {
          concluidosPorKey.set(s.stepKey, (concluidosPorKey.get(s.stepKey) ?? 0) + 1)
        }
      }
    }

    // Monta os passos na ORDEM do catálogo, marcando concluída/em_andamento/bloqueada.
    // "em_andamento" = 1º passo que ainda não foi concluído por TODOS os docs (a frente).
    const stepsCatalogo = faseAtualCode ? getStepsForFase(faseAtualCode) : []
    let frontierAchada = false
    const faseStepsReais: FaseStepReal[] = stepsCatalogo.map((sc) => {
      const concl = concluidosPorKey.get(sc.stepKey) ?? 0
      const tot = totalPorKey.get(sc.stepKey) ?? 0
      const todosConcluiram = tot > 0 && concl >= tot
      let status: "concluida" | "em_andamento" | "bloqueada"
      if (todosConcluiram) status = "concluida"
      else if (!frontierAchada) {
        frontierAchada = true
        status = "em_andamento"
      } else status = "bloqueada"
      return { ordem: sc.ordem, stepKey: sc.stepKey, title: sc.title, status, concluidos: concl, total: tot }
    })

    const contarKey = (k: string) => concluidosPorKey.get(k) ?? 0
    const faseProgress: FaseProgress = {
      faseCode: faseAtualCode ?? null,
      kind: faseAtualCode ? getFase(faseAtualCode).kind : "documento",
      steps: faseStepsReais,
      docsNaFase,
      counts: {
        solicitados: contarKey("solicitar_certidao"),
        // "aguardando" = solicitou mas ainda não recebeu
        aguardando: Math.max(0, contarKey("solicitar_certidao") - contarKey("receber_certidao")),
        recebidos: contarKey("receber_certidao"),
        conferidos: contarKey("conferir_certidao"),
        validados: contarKey("validar_certidao"),
      },
    }

    const response: CentralOperacionalResponse = {
      matrix,
      cards,
      queue,
      queueTitle,
      faseProgress,
      schemaCapabilities,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/central-operacional]", error)
    return NextResponse.json(
      { error: "Erro ao buscar Central Operacional" },
      { status: 500 }
    )
  }
}