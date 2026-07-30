// src/services/registral/leitura-documento.ts
//
// MRG — a PORTA DE LEITURA do documento.
//
// Esta é a única fronteira entre o motor registral e o conteúdo do documento. O
// motor não abre arquivo, não chama OCR e não guarda texto: ele lê o que o
// SISTEMA DOCUMENTAL já tem sobre o documento, em quatro canais reais:
//
//   1. `Documento.transcricaoPaginas` / `transcricaoTexto` — a transcrição do
//      documento (texto por página). É onde entra o resultado de OCR/digitação,
//      gravado pelo endpoint de transcrição do próprio Sistema Documental.
//   2. `Documento.registral` — dado registral já REVISADO por humano (AD2).
//   3. `Documento.structuredData` — extração estruturada da AD2.
//   4. as colunas literais do cadastro do documento (nome_registrado,
//      pai_registrado, mae_registrada, conjuge_registrado, cartório, livro,
//      folha, termo, datas, cidade/estado/país, comune).
//
// DEPENDÊNCIA EXTERNA DECLARADA: quem produz o texto da transcrição é um serviço
// de OCR/digitalização externo ao Discovery. Sem transcrição, os canais 2/3/4
// continuam funcionando (e são dado real, não simulação) — o pipeline roda com
// menos cobertura e registra a lacuna. Nenhum ponto do motor "finge" ter lido.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import type { LeituraDocumento, PaginaTexto } from "@/src/lib/genealogia/registral/tipos"

type DB = typeof prisma | Prisma.TransactionClient

/** Colunas do Documento que o motor precisa. Nada além disto é lido. */
export const SELECT_DOCUMENTO_REGISTRAL = {
  id: true,
  pessoaId: true,
  necessidadeId: true,
  tipo: true,
  descricao: true,
  nome_registrado: true,
  pai_registrado: true,
  mae_registrada: true,
  conjuge_registrado: true,
  cartorio: true,
  livro: true,
  folha: true,
  termo: true,
  numero_registro: true,
  matricula: true,
  data_evento: true,
  data_evento_documento: true,
  data_registro: true,
  data_registro_documento: true,
  cidade_registro: true,
  estado_registro: true,
  pais_registro: true,
  comune: true,
  observacoes: true,
  registral: true,
  structuredData: true,
  transcricaoTexto: true,
  transcricaoPaginas: true,
  transcricaoFonte: true,
  documentType: { select: { code: true, legacyEnumKey: true, itemCatalogoId: true, nature: true } },
} satisfies Prisma.DocumentoSelect

export type DocumentoRegistral = Prisma.DocumentoGetPayload<{
  select: typeof SELECT_DOCUMENTO_REGISTRAL
}>

export async function carregarDocumento(db: DB, documentoId: number): Promise<DocumentoRegistral | null> {
  return db.documento.findUnique({ where: { id: documentoId }, select: SELECT_DOCUMENTO_REGISTRAL })
}

function paginasDe(doc: DocumentoRegistral): { paginas: PaginaTexto[]; fonte: string } {
  const bruto = doc.transcricaoPaginas
  if (Array.isArray(bruto)) {
    const paginas: PaginaTexto[] = []
    for (const item of bruto) {
      if (!item || typeof item !== "object") continue
      const o = item as Record<string, unknown>
      const pagina = Number(o.pagina ?? o.page ?? paginas.length + 1)
      const texto = String(o.texto ?? o.text ?? "")
      if (!texto.trim()) continue
      paginas.push({ pagina: Number.isFinite(pagina) ? pagina : paginas.length + 1, texto })
    }
    if (paginas.length) {
      return { paginas: paginas.sort((a, b) => a.pagina - b.pagina), fonte: doc.transcricaoFonte || "transcricao_paginas" }
    }
  }
  if (doc.transcricaoTexto && doc.transcricaoTexto.trim()) {
    return { paginas: [{ pagina: 1, texto: doc.transcricaoTexto }], fonte: doc.transcricaoFonte || "transcricao_texto" }
  }
  // Sem transcrição: as observações do cadastro são texto real do documento
  // digitado pelo operador. Não é simulação — é a transcrição parcial que existe.
  if (doc.observacoes && doc.observacoes.trim()) {
    return { paginas: [{ pagina: 1, texto: doc.observacoes }], fonte: "observacoes_cadastro" }
  }
  return { paginas: [], fonte: "sem_texto" }
}

function jsonObjeto(v: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function dataStr(v: Date | null): string | null {
  return v ? v.toISOString().slice(0, 10) : null
}

/** Projeta o Documento na forma que o motor puro consome. */
export function montarLeitura(doc: DocumentoRegistral): LeituraDocumento {
  const { paginas, fonte } = paginasDe(doc)
  return {
    documentoId: doc.id,
    pessoaId: doc.pessoaId ?? null,
    necessidadeId: doc.necessidadeId ?? null,
    itemCatalogoId: doc.documentType?.itemCatalogoId ?? null,
    tipoDeclarado:
      doc.documentType?.legacyEnumKey ?? doc.documentType?.code ?? (doc.tipo ? String(doc.tipo) : null),
    paginas,
    literais: {
      nomeRegistrado: doc.nome_registrado,
      paiRegistrado: doc.pai_registrado,
      maeRegistrada: doc.mae_registrada,
      conjugeRegistrado: doc.conjuge_registrado,
      cartorio: doc.cartorio,
      livro: doc.livro,
      folha: doc.folha,
      termo: doc.termo,
      numeroRegistro: doc.numero_registro,
      matricula: doc.matricula,
      dataEvento: dataStr(doc.data_evento_documento) ?? dataStr(doc.data_evento),
      dataRegistro: dataStr(doc.data_registro_documento) ?? dataStr(doc.data_registro),
      cidadeRegistro: doc.cidade_registro,
      estadoRegistro: doc.estado_registro,
      paisRegistro: doc.pais_registro,
      comune: doc.comune,
      observacoes: doc.observacoes,
    },
    registral: jsonObjeto(doc.registral),
    estruturado: jsonObjeto(doc.structuredData),
    fonte,
  }
}

export async function lerDocumento(db: DB, documentoId: number): Promise<LeituraDocumento | null> {
  const doc = await carregarDocumento(db, documentoId)
  if (!doc) return null
  return montarLeitura(doc)
}

/**
 * Há material suficiente para o pipeline? Serve para a etapa RECEBIDO decidir
 * entre seguir e ir direto para DOCUMENTO_INSUFICIENTE — sem gastar extração.
 */
export function temMaterialParaLer(l: LeituraDocumento): boolean {
  if (l.paginas.some((p) => p.texto.trim().length >= 20)) return true
  const L = l.literais
  if (L.nomeRegistrado || L.paiRegistrado || L.maeRegistrada || L.conjugeRegistrado) return true
  if (l.registral && Object.keys(l.registral).length) return true
  if (l.estruturado && Object.keys(l.estruturado).length) return true
  return false
}
