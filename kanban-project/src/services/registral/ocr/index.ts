// src/services/registral/ocr/index.ts
//
// ORQUESTRADOR DA TRANSCRIÇÃO — liga o OCR ao Documento.
//
// Fluxo, e nada além disso:
//   1. o documento já tem transcrição? então não faz nada (idempotente);
//   2. baixa o arquivo pela URL que o Sistema Documental guarda;
//   3. tenta os provedores por prioridade — camada de texto primeiro (não custa
//      nada e resolve certidão digital), OCR externo depois (custa e precisa de
//      credencial);
//   4. grava a transcrição NO DOCUMENTO, que é onde ela pertence;
//   5. publica o evento de reconciliação.
//
// O motor registral não é chamado daqui: ele lê a transcrição depois. Manter essa
// separação é o que permite trocar o OCR sem tocar no motor, e reprocessar o
// motor sem repetir o OCR.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { auditar, logRegistral } from "../auditoria"
import { notificarDocumentoAlterado } from "../gancho-documental"
import { provedorPdfCamadaTexto } from "./pdf-camada-texto"
import { provedorOcrExterno } from "./http-externo"
import type { ProvedorTranscricao, ResultadoTranscricao } from "./tipos"
import { textoUtil } from "./tipos"

type DB = typeof prisma | Prisma.TransactionClient

/** Provedores registrados, na ordem em que são tentados. */
export const PROVEDORES: ProvedorTranscricao[] = [provedorPdfCamadaTexto, provedorOcrExterno].sort(
  (a, b) => a.prioridade - b.prioridade,
)

/** Teto de download — certidão não passa disso, e evita puxar arquivo gigante. */
const MAX_BYTES = 25 * 1024 * 1024

export interface ResultadoOperacao {
  documentoId: number
  transcrito: boolean
  /** true quando já havia transcrição e nada foi refeito. */
  jaTinha: boolean
  provedor: string | null
  caracteres: number
  motivo: string | null
  /** O que cada provedor respondeu — é o que explica um documento sem transcrição. */
  tentativas: Array<{ provedor: string; ok: boolean; motivo: string | null }>
}

/**
 * Transcreve um ARQUIVO — sem Documento, sem banco.
 *
 * Existe para a IMPORTAÇÃO poder analisar a certidão ANTES de gravá-la: só se
 * sabe de quem é o documento depois de ler, e `Documento.pessoaId` é obrigatório.
 * Criar o registro antes da leitura obrigaria a pendurá-lo numa pessoa provisória
 * — documento no dossiê errado, ainda que por um instante, é exatamente o tipo de
 * coisa que um sistema registral não pode fazer.
 */
export async function transcreverArquivo(arquivo: {
  nome: string | null
  mimeType: string | null
  conteudo: Uint8Array
  /** Só para log e para o payload do provedor externo. */
  referencia?: number
}): Promise<{ resultado: ResultadoTranscricao | null; tentativas: ResultadoOperacao["tentativas"] }> {
  const tentativas: ResultadoOperacao["tentativas"] = []
  const entrada = {
    documentoId: arquivo.referencia ?? 0,
    url: "",
    nome: arquivo.nome,
    mimeType: arquivo.mimeType,
    conteudo: arquivo.conteudo,
  }

  for (const provedor of PROVEDORES) {
    if (!provedor.suporta({ mimeType: arquivo.mimeType, nome: arquivo.nome })) continue
    const disp = provedor.disponivel()
    if (!disp.ok) {
      tentativas.push({ provedor: provedor.nome, ok: false, motivo: disp.motivo })
      continue
    }
    const r = await provedor.transcrever(entrada)
    tentativas.push({ provedor: provedor.nome, ok: r.ok, motivo: r.motivo })
    if (r.ok && r.paginas.length) return { resultado: r, tentativas }
  }
  return { resultado: null, tentativas }
}

/** Baixa um arquivo pela URL, com o mesmo teto de tamanho da transcrição. */
export async function baixarArquivo(
  url: string,
): Promise<{ ok: true; conteudo: Uint8Array } | { ok: false; motivo: string }> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, motivo: `Não foi possível baixar o arquivo (HTTP ${res.status}).` }
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) {
      return {
        ok: false,
        motivo: `Arquivo maior que o limite de transcrição (${Math.round(buffer.byteLength / 1024 / 1024)} MB).`,
      }
    }
    return { ok: true, conteudo: new Uint8Array(buffer) }
  } catch (e) {
    return { ok: false, motivo: `Falha ao baixar o arquivo: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * Garante a transcrição de UM documento.
 * `forcar` refaz mesmo se já houver texto (usado no reprocessamento explícito).
 */
export async function transcreverDocumento(
  documentoId: number,
  opcoes: { forcar?: boolean; usuarioId?: number | null } = {},
  db: DB = prisma,
): Promise<ResultadoOperacao> {
  const base: ResultadoOperacao = {
    documentoId,
    transcrito: false,
    jaTinha: false,
    provedor: null,
    caracteres: 0,
    motivo: null,
    tentativas: [],
  }

  const doc = await db.documento.findUnique({
    where: { id: documentoId },
    select: {
      id: true,
      arquivo_url: true,
      arquivo_nome: true,
      arquivo_mime_type: true,
      transcricaoTexto: true,
      transcricaoPaginas: true,
    },
  })
  if (!doc) return { ...base, motivo: "Documento não encontrado." }

  const jaTem = !!doc.transcricaoTexto?.trim() || (Array.isArray(doc.transcricaoPaginas) && doc.transcricaoPaginas.length > 0)
  if (jaTem && !opcoes.forcar) return { ...base, jaTinha: true, motivo: null }

  if (!doc.arquivo_url) {
    return { ...base, motivo: "Documento sem arquivo anexado — não há o que transcrever." }
  }

  // ---- baixar
  const download = await baixarArquivo(doc.arquivo_url)
  if (!download.ok) return { ...base, motivo: download.motivo }

  // ---- tentar os provedores, em ordem
  const { resultado: vencedor, tentativas } = await transcreverArquivo({
    nome: doc.arquivo_nome,
    mimeType: doc.arquivo_mime_type,
    conteudo: download.conteudo,
    referencia: documentoId,
  })

  if (!vencedor) {
    const motivo = tentativas.length
      ? tentativas.map((t) => `${t.provedor}: ${t.motivo ?? "sem texto"}`).join(" · ")
      : "Nenhum provedor de transcrição sabe lidar com este tipo de arquivo."
    logRegistral("warn", "transcricao_sem_provedor", { documentoId, tentativas })
    return { ...base, motivo, tentativas }
  }

  // ---- gravar NO DOCUMENTO (dono do dado)
  const texto = vencedor.paginas.map((p) => p.texto).join("\n\n")
  await db.documento.update({
    where: { id: documentoId },
    data: {
      transcricaoTexto: texto,
      transcricaoPaginas: vencedor.paginas as unknown as Prisma.InputJsonValue,
      transcricaoFonte: vencedor.provedor,
      transcricaoEm: new Date(),
    },
  })

  await auditar(db, {
    acao: "registral_transcricao_automatica",
    entidade: "Documento",
    entidadeId: documentoId,
    descricao: `Transcrição automática por ${vencedor.provedor}.`,
    detalhes: {
      provedor: vencedor.provedor,
      paginas: vencedor.paginas.length,
      caracteres: vencedor.caracteres,
      tentativas: tentativas.map((t) => ({ provedor: t.provedor, ok: t.ok })),
    },
    usuarioId: opcoes.usuarioId ?? null,
  })

  // Reconciliação contínua: transcrever é material novo para o motor.
  notificarDocumentoAlterado({ documentoId, motivo: "documento_transcrito", usuarioId: opcoes.usuarioId ?? null }).catch(
    (e) => logRegistral("warn", "gancho_pos_transcricao_falhou", { documentoId, erro: String(e) }),
  )

  return {
    documentoId,
    transcrito: true,
    jaTinha: false,
    provedor: vencedor.provedor,
    caracteres: vencedor.caracteres,
    motivo: null,
    tentativas,
  }
}

/**
 * Garante a transcrição de VÁRIOS documentos (o lote chama isto antes de ler).
 * Best-effort por documento: um que falha não impede os outros.
 */
export async function garantirTranscricoes(
  documentoIds: number[],
  opcoes: { usuarioId?: number | null } = {},
): Promise<{ transcritos: number; jaTinham: number; semTranscricao: number; detalhes: ResultadoOperacao[] }> {
  const detalhes: ResultadoOperacao[] = []
  for (const id of documentoIds) {
    try {
      detalhes.push(await transcreverDocumento(id, opcoes))
    } catch (e) {
      detalhes.push({
        documentoId: id,
        transcrito: false,
        jaTinha: false,
        provedor: null,
        caracteres: 0,
        motivo: e instanceof Error ? e.message : String(e),
        tentativas: [],
      })
    }
  }
  return {
    transcritos: detalhes.filter((d) => d.transcrito).length,
    jaTinham: detalhes.filter((d) => d.jaTinha).length,
    semTranscricao: detalhes.filter((d) => !d.transcrito && !d.jaTinha).length,
    detalhes,
  }
}

/** Situação dos provedores — para a tela e para o smoke dizerem a verdade. */
export function situacaoDosProvedores(): Array<{ nome: string; disponivel: boolean; motivo: string | null }> {
  return PROVEDORES.map((p) => {
    const d = p.disponivel()
    return { nome: p.nome, disponivel: d.ok, motivo: d.ok ? null : d.motivo }
  })
}

export { textoUtil }
