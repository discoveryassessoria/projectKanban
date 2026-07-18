// src/app/api/processos/[processoId]/central-operacional/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { getOrdemFase, getStepsForFase, getFase, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { resolveProgressoFaseDocumento } from "@/src/lib/process-stage/resolve-fase-progresso"
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
      select: { id: true, arvoreId: true, faseAtualKey: true },
    })

    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    const faseAtualCode =
      (phaseKeyToFaseCode(processo.faseAtualKey) ?? null)

    // pessoas e documentos não dependem um do outro (ambos só precisam do
    // arvoreId) → busca os dois EM PARALELO, economizando um round-trip ao banco.
    const [pessoas, docsRaw] = await Promise.all([
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
    ])

    const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
      `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`

    const pessoasMap = new Map(pessoas.map((p) => [p.id, p]))
    const pessoasNaLinha = pessoas.filter((p) => p.linhaReta)

    // FONTE OFICIAL ÚNICA de progresso/estado do workflow — a MESMA usada pelo cabeçalho
    // (/api/processos/[id]/phase) e demais consumidores. Nada de cálculo paralelo aqui.
    const prog = await resolveProgressoFaseDocumento(id)
    const workflowsRaw = Array.from(prog.wfPorDoc.values())

    const generationOf = (pessoaId: number): number => {
      const p = pessoasMap.get(pessoaId)
      return p?.numeroLinhagem ?? 99
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
        where: { processoId: id },
        select: { id: true, pessoaId: true, obrigatoriedade: true, status: true, matrizSnapshot: true, itemCatalogoId: true },
      })
      // só CERTIDÕES (natureza estruturada) e não dispensadas
      const necs = necsRaw.filter((n) => certItens.has(n.itemCatalogoId) && n.status !== "DISPENSADA")
      const stepsLR = await prisma.phaseWorkflowStepInstance.findMany({
        where: { processoId: id, faseMacroKey: "genealogia", stepKey: "localizar_registro" },
        select: { id: true, necessidadeId: true, status: true, obrigatorio: true, documentoId: true, prazo: true, responsavelId: true, updatedAt: true, motivo: true },
      })
      // responsavelId é ref solta a Usuario (sem relation) → resolve o nome em lote
      const respIds = [...new Set(stepsLR.map((s) => s.responsavelId).filter((x): x is number => x != null))]
      const respNomes = respIds.length
        ? new Map((await prisma.usuario.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]))
        : new Map<number, string>()
      const stepByNec = new Map<number, (typeof stepsLR)[number]>()
      for (const s of stepsLR) if (s.necessidadeId != null && !stepByNec.has(s.necessidadeId)) stepByNec.set(s.necessidadeId, s)
      const CONCLUIDO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO"])
      const localizado = (necId: number) => { const s = stepByNec.get(necId); return !!s && CONCLUIDO.has(s.status) }
      const requisitoDe = (snap: unknown) => (snap && typeof snap === "object" && "requisito" in snap ? String((snap as { requisito: unknown }).requisito) : "Certidão")

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
        const dias = s?.prazo ? diffDays(s.prazo, now) : null
        return {
          docId: s?.documentoId ?? 0,
          pessoaNome: pessoa ? nomeCompleto(pessoa) : "—",
          docType: requisitoDe(n.matrizSnapshot),
          docTypeLabel: requisitoDe(n.matrizSnapshot),
          status: ok ? "Registro localizado" : "A localizar",
          statusRaw: ok ? "LOCALIZADO" : "A_LOCALIZAR",
          responsavelNome: s?.responsavelId != null ? respNomes.get(s.responsavelId) ?? null : null,
          responsavelId: s?.responsavelId ?? null,
          prazo: s?.prazo?.toISOString() ?? null,
          diasParaPrazo: dias,
          motivoBloqueio: null,
          ultimaMovimentacao: s?.updatedAt?.toISOString() ?? null,
          isCritical: false,
          isOverdue: !ok && dias != null && dias < 0,
          isBlocked: false,
          noOwner: !s?.responsavelId,
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
          steps: [{ ordem: 1, stepKey: "localizar_registro", title: "Localizar registro da certidão", status: totalObrig > 0 && obrigDone >= totalObrig ? "concluida" : "em_andamento", concluidos: obrigDone, total: totalObrig }],
          counts: { solicitados: 0, aguardando: Math.max(0, totalObrig - obrigDone), recebidos: obrigDone, conferidos: 0, validados: obrigDone },
        },
      }
    }

    const response: CentralOperacionalResponse = {
      matrix: genealogiaV2 ? genealogiaV2.matrix : matrix,
      cards,
      queue: genealogiaV2 ? genealogiaV2.queue : queue,
      queueTitle,
      faseProgress: genealogiaV2 ? genealogiaV2.faseProgress : faseProgress,
      // Genealogia agora tem visualização V2 real — sai o estado neutro de reestruturação.
      genealogiaReestruturacao: genealogiaV2 ? false : genealogiaReestruturacao,
      mensagemReestruturacao: genealogiaV2 ? null : mensagemReestruturacao,
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