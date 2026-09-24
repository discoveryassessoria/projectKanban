// src/lib/process-stage/pasta-documental-universo.ts
// ============================================================================
// UNIVERSO de documentos candidatos a uma "pasta" de fase final (Tradução
// Juramentada, Apostilamento) — pessoa → documentos, com aptidão calculada a
// partir de dado real (nunca inventado).
//
// FONTE ÚNICA: `Documento` da LINHA RETA da árvore do processo. Regra do
// usuário (24/09/2026): certidão necessária nasce única e exclusivamente pela
// Árvore Genealógica — nunca anexada por fora (ver remoção de
// `POST /api/processos/[id]/analise/documentos`, mandato do mesmo dia). Este
// módulo não cria documento nenhum: só lê o que já existe.
//
// Reusado por `/api/processos/[id]/traducao` e `/api/processos/[id]/apostilamento`
// — mesma pergunta ("quais documentos deste processo podem entrar nesta
// pasta, e por quê"), respondida uma vez só.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { StatusDocumento, TipoDocumento } from "@prisma/client"
import { estadoOperacionalDosDocumentos } from "@/lib/operacional/documento-estado"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"

// Documentos "em mãos", prontos para entrar numa pasta de fase final.
// Apostilamento aceita também o que já passou pela Tradução (TRADUZIDO/
// EM_APOSTILAMENTO/APOSTILADO) — cada fase final tem sua própria régua.
export const READY_STATUSES_POR_FASE = {
  traducao: ["RECEBIDO", "EM_TRADUCAO", "TRADUZIDO"] as StatusDocumento[],
  apostilamento: ["RECEBIDO", "TRADUZIDO", "EM_APOSTILAMENTO", "APOSTILADO"] as StatusDocumento[],
}

// Tipos que são SAÍDA do processo, nunca fonte para traduzir/apostilar.
export const SKIP_TIPOS: TipoDocumento[] = ["TRADUCAO_JURAMENTADA", "APOSTILA_HAIA"]

export const TIPO_DOC_LABEL: Record<string, string> = {
  CERTIDAO_NASCIMENTO: "Certidão de Nascimento",
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: "Certidão de Nascimento (Inteiro Teor)",
  CERTIDAO_CASAMENTO: "Certidão de Casamento",
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: "Certidão de Casamento (Inteiro Teor)",
  CERTIDAO_OBITO: "Certidão de Óbito",
  CERTIDAO_OBITO_INTEIRO_TEOR: "Certidão de Óbito (Inteiro Teor)",
  CERTIDAO_BATISMO: "Certidão de Batismo",
  CNN: "Certidão de Não Naturalização (CNN)",
  CARTA_NATURALIZACAO: "Carta de Naturalização",
  RG: "RG",
  CPF: "CPF",
  CNH: "CNH",
  PASSAPORTE_BRASILEIRO: "Passaporte Brasileiro",
  TITULO_ELEITOR: "Título de Eleitor",
  RESERVISTA: "Certificado de Reservista",
  PASSAPORTE_ESTRANGEIRO: "Passaporte Estrangeiro",
  CERTIDAO_CIDADANIA_ESTRANGEIRA: "Certidão de Cidadania Estrangeira",
  COMPROVANTE_RESIDENCIA: "Comprovante de Residência",
  FOTO_3X4: "Foto 3x4",
  PROCURACAO: "Procuração",
  ARVORE_GENEALOGICA_DOC: "Árvore Genealógica",
  OUTRO: "Outro documento",
}

const TIPOS_CIVIS = new Set<string>([
  "CERTIDAO_NASCIMENTO", "CERTIDAO_NASCIMENTO_INTEIRO_TEOR",
  "CERTIDAO_CASAMENTO", "CERTIDAO_CASAMENTO_INTEIRO_TEOR",
  "CERTIDAO_OBITO", "CERTIDAO_OBITO_INTEIRO_TEOR", "CERTIDAO_BATISMO",
])

export function categoriaDoTipo(tipo: string | null): string {
  if (tipo && TIPOS_CIVIS.has(tipo)) return "Civil"
  return "Outro"
}

export function nomeCompleto(p: { nome: string; sobrenome: string | null }): string {
  return p.sobrenome ? `${p.nome} ${p.sobrenome}` : p.nome
}

export interface DocumentoDoUniverso {
  documentoId: number
  pessoaId: number
  tipo: string | null
  tipoLabel: string
  categoria: string
  apto: boolean
  origemLabel: string
  motivoNaoApto: string | null
}

export interface PessoaDoUniverso {
  pessoaId: number
  nome: string
  documentos: DocumentoDoUniverso[]
}

export interface UniversoPastaDocumental {
  pessoas: PessoaDoUniverso[]
  totalDocumentos: number
  totalAptos: number
}

/**
 * Monta o universo — TODO documento candidato (apto ou não), agrupado por
 * pessoa. Quem decide o que fazer com "não apto" (mostrar bloqueado, impedir
 * seleção) é a tela; aqui só se calcula o fato, a partir de `Documento` +
 * `Tarefa` reais.
 */
export async function montarUniversoDaPastaDocumental(
  processo: { id: number; arvoreId: number | null },
  fase: "traducao" | "apostilamento" = "traducao",
): Promise<UniversoPastaDocumental> {
  if (!processo.arvoreId) return { pessoas: [], totalDocumentos: 0, totalAptos: 0 }
  const readyStatuses = READY_STATUSES_POR_FASE[fase]

  const docs = await prisma.documento.findMany({
    where: {
      tipo: { notIn: SKIP_TIPOS },
      pessoa: { arvoreId: processo.arvoreId, linhaReta: true },
    },
    select: {
      id: true, tipo: true, status: true, traduzido: true,
      pessoaId: true,
      pessoa: { select: { id: true, nome: true, sobrenome: true } },
    },
    orderBy: { id: "asc" },
  })

  const estados = await estadoOperacionalDosDocumentos(docs.map((d) => d.id))

  const porPessoa = new Map<number, PessoaDoUniverso>()
  let totalAptos = 0

  for (const d of docs) {
    const apto = readyStatuses.includes(d.status)
    if (apto) totalAptos++

    let origemLabel: string
    let motivoNaoApto: string | null = null
    if (apto) {
      origemLabel = fase === "apostilamento" && d.traduzido ? "Tradução juramentada validada" : "Documento validado"
    } else {
      const estado = estados.get(d.id)
      if (estado?.tarefaViva) {
        const faseLabel = labelDaFasePorPhaseKey(estado.tarefaViva.faseMacroKey) ?? estado.tarefaViva.faseMacroKey ?? "outra etapa"
        origemLabel = `Aguardando: ${faseLabel}`
        motivoNaoApto = `Documento ainda em ${faseLabel.toLowerCase()}`
      } else {
        origemLabel = "Aguardando validação"
        motivoNaoApto = "Documento ainda não foi validado"
      }
    }

    const item: DocumentoDoUniverso = {
      documentoId: d.id, pessoaId: d.pessoaId, tipo: d.tipo,
      tipoLabel: d.tipo ? (TIPO_DOC_LABEL[d.tipo] ?? d.tipo) : "Documento",
      categoria: categoriaDoTipo(d.tipo),
      apto, origemLabel, motivoNaoApto,
    }

    let pessoa = porPessoa.get(d.pessoaId)
    if (!pessoa) {
      pessoa = { pessoaId: d.pessoaId, nome: nomeCompleto(d.pessoa), documentos: [] }
      porPessoa.set(d.pessoaId, pessoa)
    }
    pessoa.documentos.push(item)
  }

  return {
    pessoas: [...porPessoa.values()],
    totalDocumentos: docs.length,
    totalAptos,
  }
}
