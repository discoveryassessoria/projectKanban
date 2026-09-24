// src/lib/process-stage/fase-documental-pasta.ts
// ============================================================================
// CÁLCULO ÚNICO da "pasta" de uma fase DOCUMENTO-escopada de enviar-a-terceiro
// (Tradução Juramentada, Apostilamento) como UMA linha do tempo compartilhada
// — reusado pela leitura (GET) e pela ação de avançar (POST avancar), pra não
// ter duas contas da mesma coisa. Mandato 24/09/2026.
//
// "Na pasta" = a subtarefa "preparar_documentos" (a 1ª das 4 da Biblioteca)
// já foi concluída para aquele documento — nunca uma tabela própria.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { subtarefasDaEtapa } from "@/src/services/subtarefas-da-etapa"
import { garantirOperacaoDocumentoV2 } from "@/src/services/documento-operacao"

export const READY_STATUSES_POR_FASE: Record<string, string[]> = {
  traducao_juramentada: ["RECEBIDO", "EM_TRADUCAO", "TRADUZIDO"],
  apostilamento: ["RECEBIDO", "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO"],
}
const SKIP_TIPOS = ["TRADUCAO_JURAMENTADA", "APOSTILA_HAIA"]

export const ORDEM_SUBTAREFAS = ["preparar_documentos", "enviar_documentos", "receber_documentos", "conferir_validar_documentos"] as const
export type SubtarefaKey = (typeof ORDEM_SUBTAREFAS)[number]

function nomeCompleto(p: { nome: string; sobrenome: string | null }): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}

export interface LinhaDoc {
  necessidadeId: number
  documentoId: number | null
  stepInstanceId: number | null
  tipoLabel: string
  situacao: "falta" | "nao_apto" | "apto"
  motivo: string | null
  apto: boolean
  naPasta: boolean
  etapaAtualKey: string | null
  etapaAtualLabel: string | null
  proximaSubtarefaDisponivel: boolean
}

export interface PessoaComDocs {
  pessoaId: number
  nome: string
  documentos: LinhaDoc[]
}

export interface EstadoDaPasta {
  etapaAtualKey: string | null
  podeAvancar: boolean
  concluida: boolean
  dessincronizada: boolean
  /** Documentos NA PASTA que estão pendentes exatamente na `etapaAtualKey` — os únicos que o avançar em lote toca. */
  documentosParaAvancar: LinhaDoc[]
}

export async function montarPastaDocumental(
  processoId: number, arvoreId: number, stepKey: "traducao_juramentada" | "apostilamento",
): Promise<{ pessoas: PessoaComDocs[]; estado: EstadoDaPasta }> {
  const readyStatuses = READY_STATUSES_POR_FASE[stepKey]

  const necessidades = await prisma.necessidadeDocumental.findMany({
    where: { status: { not: "DISPENSADA" }, pessoa: { arvoreId, linhaReta: true } },
    select: {
      id: true, pessoaId: true,
      pessoa: { select: { id: true, nome: true, sobrenome: true } },
      itemCatalogo: { select: { name: true, natureza: true } },
      documentos: { where: { tipo: { notIn: SKIP_TIPOS as never } }, select: { id: true, tipo: true, status: true }, orderBy: { id: "desc" }, take: 1 },
    },
  })

  const porPessoa = new Map<number, PessoaComDocs>()
  for (const n of necessidades) {
    if (n.itemCatalogo.natureza !== "DOCUMENTO") continue
    const doc = n.documentos[0] ?? null
    let linha: LinhaDoc
    if (!doc) {
      linha = {
        necessidadeId: n.id, documentoId: null, stepInstanceId: null, tipoLabel: n.itemCatalogo.name,
        situacao: "falta", motivo: "Documento ainda não foi emitido", apto: false, naPasta: false,
        etapaAtualKey: null, etapaAtualLabel: null, proximaSubtarefaDisponivel: false,
      }
    } else if (!readyStatuses.includes(doc.status)) {
      linha = {
        necessidadeId: n.id, documentoId: doc.id, stepInstanceId: null, tipoLabel: n.itemCatalogo.name,
        situacao: "nao_apto", motivo: "Documento ainda não está pronto para esta fase", apto: false, naPasta: false,
        etapaAtualKey: null, etapaAtualLabel: null, proximaSubtarefaDisponivel: false,
      }
    } else {
      const wf = await garantirOperacaoDocumentoV2(doc.id)
      // `currentStepId` fica NULL quando o passo já CONCLUIU (nada mais é "a
      // etapa atual da visita") — não significa "nunca foi preparado". Sem
      // este fallback, um documento que já terminou as 4 subtarefas saía da
      // pasta sozinho (achado real 24/09/2026, provado no teste da linha do
      // tempo). Busca o passo direto pelo documento — inclui terminal.
      const stepInstanceId = wf.workflow?.currentStepId
        ?? (wf.workflow?.workflowInstanceId
          ? (await prisma.phaseWorkflowStepInstance.findFirst({
              where: { workflowInstanceId: wf.workflow.workflowInstanceId, documentoId: doc.id },
              orderBy: { id: "desc" }, select: { id: true },
            }))?.id ?? null
          : null)
      const subs = stepInstanceId ? await subtarefasDaEtapa({ stepInstanceId }).catch(() => []) : []
      const porChave = new Map(subs.map((s) => [s.key, s]))
      const preparada = porChave.get("preparar_documentos")?.concluida === true
      const proxima = ORDEM_SUBTAREFAS.find((k) => !porChave.get(k)?.concluida) ?? null
      linha = {
        necessidadeId: n.id, documentoId: doc.id, stepInstanceId, tipoLabel: n.itemCatalogo.name,
        situacao: "apto", motivo: null, apto: true, naPasta: preparada,
        etapaAtualKey: proxima, etapaAtualLabel: proxima ? (porChave.get(proxima)?.label ?? proxima) : null,
        proximaSubtarefaDisponivel: proxima ? (porChave.get(proxima)?.disponivel ?? false) : false,
      }
    }
    let pessoa = porPessoa.get(n.pessoaId!)
    if (!pessoa) { pessoa = { pessoaId: n.pessoaId!, nome: nomeCompleto(n.pessoa!), documentos: [] }; porPessoa.set(n.pessoaId!, pessoa) }
    pessoa.documentos.push(linha)
  }

  const naPastaLinhas = [...porPessoa.values()].flatMap((p) => p.documentos).filter((d) => d.naPasta)
  let etapaAtualKey: string | null = null
  let podeAvancar = false
  let concluida = false
  let dessincronizada = false
  let documentosParaAvancar: LinhaDoc[] = []

  if (naPastaLinhas.length > 0) {
    const pendentes = naPastaLinhas.filter((d) => d.etapaAtualKey !== null)
    if (pendentes.length === 0) {
      concluida = true
    } else {
      const chaves = new Set(pendentes.map((d) => d.etapaAtualKey))
      if (chaves.size === 1) {
        etapaAtualKey = [...chaves][0]
        documentosParaAvancar = pendentes
        podeAvancar = pendentes.every((d) => d.proximaSubtarefaDisponivel)
      } else {
        dessincronizada = true
      }
    }
  }

  return {
    pessoas: [...porPessoa.values()],
    estado: { etapaAtualKey, podeAvancar, concluida, dessincronizada, documentosParaAvancar },
  }
}
