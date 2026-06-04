// src/app/api/processos/[processoId]/central-operacional/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

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

interface CentralOperacionalResponse {
  matrix: MatrixResponse
  cards: CardCounts
  queue: QueueRow[]
  queueTitle: string
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
      select: { id: true, arvoreId: true },
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    const pessoas = processo.arvoreId
      ? await prisma.pessoa.findMany({
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
      : []

    const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
      `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`

    const pessoasIds = pessoas.map((p) => p.id)
    const pessoasMap = new Map(pessoas.map((p) => [p.id, p]))
    const pessoasNaLinha = pessoas.filter((p) => p.linhaReta)

    const generationOf = (pessoaId: number): number => {
      const p = pessoasMap.get(pessoaId)
      return p?.numeroLinhagem ?? 99
    }

    // ============================================================
    // 2) Carrega documentos
    // ============================================================
    //
    // ⚠ DEPOIS DE APLICAR a migration descrita em
    //   schema-mudancas-central-operacional.md, troque o select por:
    //
    //   {
    //     id: true, pessoaId: true, tipo: true, status: true, updatedAt: true,
    //     responsavelId: true,
    //     responsavel: { select: { nome: true } },
    //     dataPrazoOperacao: true,
    //     motivoBloqueio: true,
    //     ultimaMovimentacao: true,
    //   }
    //
    //   E mude todos os campos de `schemaCapabilities` para true.
    // ============================================================
    const docsRaw =
    pessoasIds.length > 0
    ? await prisma.documento.findMany({
        where: { pessoaId: { in: pessoasIds } },
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
        },
      })
    : []

    // Atualize estas flags quando a migration rodar
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
    }

    const docs: DocFull[] = docsRaw.map((d: any) => ({
    id: d.id,
    pessoaId: d.pessoaId,
    tipo: d.tipo,
    status: d.status,
    updatedAt: d.updatedAt,
    responsavelId: d.responsavelId,
    responsavelNome: d.responsavel?.nome ?? null,
    dataPrazoOperacao: d.dataPrazoOperacao,
    motivoBloqueio: d.motivoBloqueio,
    ultimaMovimentacao: d.ultimaMovimentacao,
    }))

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
        // inclui PENDENTE: num processo novo os docs ainda não foram solicitados,
        // mas precisam aparecer pro operador começar.
        filtered = docs.filter((d) => isAtivo(d) || isPendente(d))
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

    const totalDocs = docs.length
    const validados = docs.filter((d) => STATUS_VALIDADOS.includes(d.status)).length

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

    const response: CentralOperacionalResponse = {
      matrix,
      cards,
      queue,
      queueTitle,
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