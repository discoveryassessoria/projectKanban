// src/app/api/processos/[processoId]/documentos/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// ============================================================
// TIPOS DE RESPOSTA
// ============================================================

type TransmissionState = "TRANSMITE" | "RISCO" | "BLOQUEADA" | "JUDICIAL" | "NA"

interface DocCompact {
  id: number
  tipo: string | null
  tipoShort: string       // "Nasc.", "Cas.", "Óbito", outros
  status: string
  statusShort: string     // "recebido", "não iniciado", "em busca", etc.
  statusClass: string     // "received" | "pending" | "searching" | "requesting" | "waiting" | "returned" | "other"
  isRecebido: boolean
}

interface Impediment {
  label: string
  severity: "crit" | "warn"
  detail?: string
}

interface PersonRow {
  // Identificação
  pessoaId: number
  nome: string
  iniciais: string
  geracao: number | null            // 0 = REQ, 1, 2, 3... | null = outsider/cônjuge
  isDirectLine: boolean
  papel: string                     // "Requerente", "Geração 1", "Cônjuge"

  // Transmissão
  transmissao: {
    state: TransmissionState
    label: string                   // "Transmite", "Transmite com risco", "Transmissão bloqueada"
    detail?: string                 // "Nascimento pendente", etc.
  }

  // Documentos
  docs: DocCompact[]
  received: number
  total: number
  progressPct: number

  // Análise
  impedimentos: Impediment[]
  proximaAcao: {
    label: string
    severity: "info" | "warn" | "crit"
  } | null

  // Aging (dias desde a última movimentação ativa)
  agingDays: number | null
  agingCls: "ok" | "warn" | "crit" | null

  // Última movimentação (label relativo: "há 3d", "há 2h", etc.)
  ultimaMov: string | null
}

interface ProcessoDocumentosResponse {
  stats: {
    total: number
    recebidos: number
    emOperacao: number
    pendentes: number
  }
  linhaPrincipal: PersonRow[]
  conjuges: PersonRow[]
  outros: PersonRow[]
}

// ============================================================
// CONSTANTES & HELPERS
// ============================================================

const STATUS_VALIDADOS = ["RECEBIDO", "ENTREGUE", "APOSTILADO", "TRADUZIDO"]
const STATUS_EM_OPERACAO = [
  "SOLICITADO", "EM_BUSCA", "SOLICITAR",
  "EM_ANALISE", "RETIFICANDO",
  "EM_TRADUCAO", "EM_APOSTILAMENTO",
]

const tipoShort = (tipo: string): string => {
  if (tipo.includes("NASCIMENTO")) return "Nasc."
  if (tipo.includes("CASAMENTO")) return "Cas."
  if (tipo.includes("OBITO")) return "Óbito"
  if (tipo.includes("BATISMO")) return "Bat."
  if (tipo === "CNN") return "CNN"
  if (tipo === "PASSAPORTE_BRASILEIRO") return "Passaporte"
  if (tipo === "PASSAPORTE_ESTRANGEIRO") return "Pass.Est."
  if (tipo === "RG") return "RG"
  if (tipo === "CPF") return "CPF"
  if (tipo === "TRADUCAO_JURAMENTADA") return "Tradução"
  if (tipo === "APOSTILA_HAIA") return "Apostila"
  if (tipo === "CARTA_NATURALIZACAO") return "Naturaliz."
  if (tipo === "PROCURACAO") return "Procuração"
  return tipo.slice(0, 8)
}

const statusShortMap: Record<string, string> = {
  PENDENTE: "não iniciado",
  SOLICITADO: "solicitado",
  EM_BUSCA: "em busca",
  SOLICITAR: "solicitar",
  RECEBIDO: "recebido",
  EM_ANALISE: "em análise",
  RETIFICANDO: "retificando",
  EM_TRADUCAO: "em tradução",
  TRADUZIDO: "traduzido",
  EM_APOSTILAMENTO: "em apostilamento",
  APOSTILADO: "apostilado",
  ENTREGUE: "entregue",
  INVALIDO: "inválido",
  NAO_ENCONTRADO: "não encontrado",
}

const statusToCompactClass = (status: string): string => {
  if (status === "PENDENTE") return "pending"
  if (["RECEBIDO", "ENTREGUE", "APOSTILADO", "TRADUZIDO"].includes(status)) return "received"
  if (["EM_BUSCA"].includes(status)) return "searching"
  if (["SOLICITAR", "SOLICITADO"].includes(status)) return "requesting"
  if (["EM_ANALISE", "RETIFICANDO"].includes(status)) return "waiting"
  if (["INVALIDO", "NAO_ENCONTRADO"].includes(status)) return "returned"
  return "other"
}

const relTime = (date: Date | null): string | null => {
  if (!date) return null
  const ms = Date.now() - date.getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `há ${min}min`
  const hours = Math.floor(ms / 3600000)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(ms / 86400000)
  if (days < 30) return `há ${days}d`
  const months = Math.floor(days / 30)
  return `há ${months}mês`
}

const getIniciais = (nome: string): string => {
  const parts = nome.trim().split(/\s+/).filter((p) => /^[A-Za-zÀ-ú]/.test(p))
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
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

    // -- Carrega processo + pessoas + docs (1 query rica)
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

    const pessoasIds = pessoas.map((p) => p.id)
    const allDocs =
      pessoasIds.length > 0
        ? await prisma.documento.findMany({
            where: { pessoaId: { in: pessoasIds } },
            select: {
              id: true,
              pessoaId: true,
              tipo: true,
              status: true,
              updatedAt: true,
              dataPrazoOperacao: true,
              motivoBloqueio: true,
              responsavelId: true,
              ultimaMovimentacao: true,
            },
          })
        : []

    // Agrupa docs por pessoa
    const docsByPessoa = new Map<number, typeof allDocs>()
    for (const d of allDocs) {
      const arr = docsByPessoa.get(d.pessoaId) ?? []
      arr.push(d)
      docsByPessoa.set(d.pessoaId, arr)
    }

    // -- Constroi cada linha
    const buildRow = (p: typeof pessoas[number]): PersonRow => {
      const nome = `${p.nome}${p.sobrenome ? " " + p.sobrenome : ""}`
      const docs = docsByPessoa.get(p.id) ?? []
      const isDirectLine = p.linhaReta
      const geracao = isDirectLine ? p.numeroLinhagem : null

      // Papel
        let papel = "—"
        if (geracao === 0) papel = "Requerente"
        else if (isDirectLine) papel = geracao != null ? `Geração ${geracao}` : "Linha reta"
        else papel = "Cônjuge"  // sem numeroLinhagem → assumimos que é cônjuge

      // Documentos compactos
      const docsCompact: DocCompact[] = docs.map((d) => ({
        id: d.id,
        tipo: d.tipo,
        tipoShort: tipoShort(d.tipo ?? ""),
        status: d.status,
        statusShort: statusShortMap[d.status] || d.status.toLowerCase(),
        statusClass: statusToCompactClass(d.status),
        isRecebido: STATUS_VALIDADOS.includes(d.status),
      }))

      const received = docsCompact.filter((d) => d.isRecebido).length
      const total = docsCompact.length
      const progressPct = total > 0 ? Math.round((received / total) * 100) : 0

      // -- Transmissão (heurística)
      //
      // Para linha direta: precisa ter nascimento e (se há descendentes ou
      // se for casado) casamento. Óbito é necessário se há descendentes na linha.
      // Para cônjuges (outsiders): sempre NA — não transmitem por si.
      let transmissao: PersonRow["transmissao"] = {
        state: "NA",
        label: "Não transmite (cônjuge)",
      }

      if (isDirectLine) {
        const docNasc = docsCompact.find((d) => d.tipo?.includes("NASCIMENTO"))
        const docCas = docsCompact.find((d) => d.tipo?.includes("CASAMENTO"))
        const docObt = docsCompact.find((d) => d.tipo?.includes("OBITO"))

        const nascRecebida = docNasc?.isRecebido === true
        const nascAusente = !docNasc || docNasc.status === "PENDENTE"
        const casPendente = docCas && docCas.status === "PENDENTE"
        const obtPendente = docObt && docObt.status === "PENDENTE"
        const algumInvalido = docsCompact.some((d) => d.status === "INVALIDO" || d.status === "NAO_ENCONTRADO")

        if (algumInvalido) {
          transmissao = {
            state: "BLOQUEADA",
            label: "Transmissão bloqueada",
            detail: "Documento inválido",
          }
        } else if (nascAusente) {
          transmissao = {
            state: "BLOQUEADA",
            label: "Transmissão bloqueada",
            detail: "Nascimento pendente",
          }
        } else if (casPendente || obtPendente) {
          transmissao = {
            state: "RISCO",
            label: "Transmite com risco",
            detail: casPendente ? "Casamento pendente" : "Óbito pendente",
          }
        } else if (nascRecebida && total > 0) {
          transmissao = {
            state: "TRANSMITE",
            label: "Transmite",
          }
        } else {
          transmissao = {
            state: "RISCO",
            label: "Em andamento",
          }
        }
      }

      // -- Impeditivos
      const impedimentos: Impediment[] = []

      // Bloqueio formal (qualquer doc com motivoBloqueio)
      const blockedDocs = docs.filter((d) => d.motivoBloqueio)
      for (const bd of blockedDocs.slice(0, 2)) {
        impedimentos.push({
          label: `${tipoShort(bd.tipo ?? "").toLowerCase()} bloqueado`,
          severity: "warn",
          detail: bd.motivoBloqueio || undefined,
        })
      }

      // SLA vencido (algum doc com prazo passado)
      const now = new Date()
      const slaCrit = docs.some(
        (d) =>
          d.dataPrazoOperacao &&
          d.dataPrazoOperacao < now &&
          !STATUS_VALIDADOS.includes(d.status)
      )
      if (slaCrit) {
        impedimentos.push({ label: "SLA vencido", severity: "crit" })
      }

      // Documentos faltantes (pra linha direta)
      if (isDirectLine) {
        const docNasc = docsCompact.find((d) => d.tipo?.includes("NASCIMENTO"))
        const docCas = docsCompact.find((d) => d.tipo?.includes("CASAMENTO"))
        const docObt = docsCompact.find((d) => d.tipo?.includes("OBITO"))
        if (docNasc && docNasc.status === "PENDENTE") {
          impedimentos.push({ label: "falta nascimento", severity: "warn" })
        }
        if (docCas && docCas.status === "PENDENTE") {
        impedimentos.push({ label: "falta casamento", severity: "warn" })
        }
        if (docObt && docObt.status === "PENDENTE") {
          // Só conta se houver descendentes
          const temDescendentes = pessoas.some(
            (o) => o.numeroLinhagem != null && o.numeroLinhagem < (geracao ?? 0)
          )
          if (temDescendentes) {
            impedimentos.push({ label: "falta óbito", severity: "warn" })
          }
        }
      }

      // Sem responsável (algum doc em operação sem responsável)
      const docsEmOpSemResp = docs.filter(
        (d) =>
          STATUS_EM_OPERACAO.includes(d.status) && !d.responsavelId
      )
      if (docsEmOpSemResp.length > 0 && impedimentos.length < 3) {
        impedimentos.push({ label: "sem responsável", severity: "warn" })
      }

      // -- Próxima ação
      let proximaAcao: PersonRow["proximaAcao"] = null
      if (impedimentos.length === 0 && received === total && total > 0) {
        proximaAcao = {
          label: "Nenhuma pendência — documentos recebidos",
          severity: "info",
        }
      } else if (transmissao.state === "BLOQUEADA") {
        const docFalta = docsCompact.find(
          (d) =>
            (d.tipo?.includes("NASCIMENTO") || d.tipo?.includes("CASAMENTO")) &&
            d.status === "PENDENTE"
        )
        if (docFalta) {
          proximaAcao = {
            label: `Iniciar operação de ${docFalta.tipoShort.replace(".", "")}`,
            severity: "crit",
          }
        }
      } else if (transmissao.state === "RISCO") {
        const docFalta = docsCompact.find((d) => d.status === "PENDENTE")
        if (docFalta) {
          proximaAcao = {
            label: `Iniciar operação de ${docFalta.tipoShort.replace(".", "")}`,
            severity: "warn",
          }
        }
      } else if (impedimentos.length > 0) {
        proximaAcao = {
          label: impedimentos[0].label,
          severity: impedimentos[0].severity === "crit" ? "crit" : "warn",
        }
      } else if (total === 0) {
        proximaAcao = {
          label: "Sem documentos cadastrados",
          severity: "info",
        }
      }

      // -- Aging (dias do doc mais antigo em operação)
      let agingDays: number | null = null
      let agingCls: PersonRow["agingCls"] = null
      const docsEmOp = docs.filter((d) => STATUS_EM_OPERACAO.includes(d.status))
      if (docsEmOp.length > 0) {
        const oldest = docsEmOp.reduce((acc, d) => {
          const ref = d.ultimaMovimentacao ?? d.updatedAt
          return ref < acc ? ref : acc
        }, new Date())
        agingDays = Math.floor((now.getTime() - oldest.getTime()) / 86400000)
        agingCls = agingDays > 15 ? "crit" : agingDays > 7 ? "warn" : "ok"
      }

      // -- Última movimentação
      let ultimaMov: string | null = null
      if (docs.length > 0) {
        const latest = docs.reduce<Date | null>((acc, d) => {
          const ref = d.ultimaMovimentacao ?? d.updatedAt
          if (!acc || ref > acc) return ref
          return acc
        }, null)
        ultimaMov = relTime(latest)
      }

      return {
        pessoaId: p.id,
        nome,
        iniciais: getIniciais(nome),
        geracao,
        isDirectLine,
        papel,
        transmissao,
        docs: docsCompact,
        received,
        total,
        progressPct,
        impedimentos,
        proximaAcao,
        agingDays,
        agingCls,
        ultimaMov,
      }
    }

    const rows = pessoas.map(buildRow)

    const linhaPrincipal = rows
      .filter((r) => r.isDirectLine)
      .sort((a, b) => (a.geracao ?? 99) - (b.geracao ?? 99))

    const conjuges = rows.filter((r) => !r.isDirectLine && r.papel === "Cônjuge")

    const outros = rows.filter((r) => !r.isDirectLine && r.papel !== "Cônjuge")

    // -- Stats
    const stats = {
      total: allDocs.length,
      recebidos: allDocs.filter((d) => STATUS_VALIDADOS.includes(d.status)).length,
      emOperacao: allDocs.filter((d) => STATUS_EM_OPERACAO.includes(d.status)).length,
      pendentes: allDocs.filter((d) => d.status === "PENDENTE").length,
    }

    const response: ProcessoDocumentosResponse = {
      stats,
      linhaPrincipal,
      conjuges,
      outros,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/documentos]", error)
    return NextResponse.json(
      { error: "Erro ao buscar pasta documental" },
      { status: 500 }
    )
  }
}