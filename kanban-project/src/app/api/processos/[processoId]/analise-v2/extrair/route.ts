// src/app/api/processos/[processoId]/analise-v2/extrair/route.ts
//
// EXTRAÇÃO AUTOMÁTICA — liga o OCR (src/services/registral/ocr/, já existente) à
// Análise Documental v2. Fluxo por documento da árvore:
//
//   1. garante a transcrição (camada de texto do PDF é grátis; OCR externo só se
//      OCR_ENDPOINT estiver configurado — nunca inventa texto sem provedor real);
//   2. se há texto, roda o extrator determinístico por tipo (extrator-inteiro-teor)
//      e grava em Documento.structuredData;
//   3. dataStatus vira "ai_extracted" — extração automática NUNCA marca "reviewed"
//      sozinha; confirmação humana continua obrigatória antes de virar canônico
//      (buildCanonical só aceita base "reviewed"/"manual_filled").
//
// Documento já com dataStatus diferente de "not_filled" é PULADO — extração
// automática nunca sobrescreve rascunho ou revisão que já existe.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { TipoDocumento } from "@prisma/client"
import { transcreverDocumento } from "@/src/services/registral/ocr"
import { extrairNascimento, extrairCasamento, extrairObito } from "@/src/lib/documentos/extrator-inteiro-teor"

// Vários documentos, cada um com download + tentativa de transcrição — pode
// passar do limite padrão em árvore grande.
export const maxDuration = 120

const TIPOS_ANALISADOS: TipoDocumento[] = [
  "CERTIDAO_NASCIMENTO", "CERTIDAO_NASCIMENTO_INTEIRO_TEOR",
  "CERTIDAO_CASAMENTO", "CERTIDAO_CASAMENTO_INTEIRO_TEOR",
  "CERTIDAO_OBITO", "CERTIDAO_OBITO_INTEIRO_TEOR",
]

function eventoDe(tipo: string): "nascimento" | "casamento" | "obito" {
  const t = tipo.toUpperCase()
  if (t.includes("CASAMENTO")) return "casamento"
  if (t.includes("OBITO")) return "obito"
  return "nascimento"
}

interface ResultadoPorDoc {
  documentoId: number
  pessoaNome: string
  status: "extraido" | "pulado_ja_preenchido" | "sem_arquivo" | "sem_texto" | "sem_campos_reconhecidos"
  motivo: string | null
  camposExtraidos: string[]
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const erroPermissao = await verificarPermissao(req, "tarefas.iniciar_concluir")
  if (erroPermissao) return erroPermissao

  const { processoId } = await params
  const id = Number(processoId)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const processo = await prisma.processo.findUnique({ where: { id }, select: { id: true, arvoreId: true } })
  if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
  if (!processo.arvoreId) return NextResponse.json({ resultados: [] })

  const documentos = await prisma.documento.findMany({
    where: {
      pessoa: { arvoreId: processo.arvoreId, linhaReta: true },
      tipo: { in: TIPOS_ANALISADOS },
      status: { notIn: ["CANCELADO", "INVALIDO"] },
    },
    select: {
      id: true, tipo: true, dataStatus: true, cidade_registro: true, arquivo_url: true,
      pessoa: { select: { nome: true, sobrenome: true } },
    },
  })

  const resultados: ResultadoPorDoc[] = []

  for (const doc of documentos) {
    const nomePessoa = `${doc.pessoa.nome}${doc.pessoa.sobrenome ? " " + doc.pessoa.sobrenome : ""}`
    if (doc.dataStatus !== "not_filled") {
      resultados.push({ documentoId: doc.id, pessoaNome: nomePessoa, status: "pulado_ja_preenchido", motivo: `Já está em "${doc.dataStatus}" — extração automática não sobrescreve.`, camposExtraidos: [] })
      continue
    }
    if (!doc.arquivo_url) {
      resultados.push({ documentoId: doc.id, pessoaNome: nomePessoa, status: "sem_arquivo", motivo: "Documento sem arquivo anexado.", camposExtraidos: [] })
      continue
    }

    const transcricao = await transcreverDocumento(doc.id)
    const textoFinal = transcricao.transcrito || transcricao.jaTinha
      ? (await prisma.documento.findUnique({ where: { id: doc.id }, select: { transcricaoTexto: true } }))?.transcricaoTexto ?? null
      : null

    if (!textoFinal || !textoFinal.trim()) {
      resultados.push({
        documentoId: doc.id, pessoaNome: nomePessoa, status: "sem_texto",
        motivo: transcricao.motivo ?? "Nenhum provedor de transcrição conseguiu ler este arquivo.",
        camposExtraidos: [],
      })
      continue
    }

    const tipoEvento = eventoDe(doc.tipo ?? "")
    let structuredData: Record<string, unknown>
    let campos: Record<string, unknown>
    if (tipoEvento === "nascimento") {
      campos = extrairNascimento(textoFinal, doc.cidade_registro ?? undefined)
      structuredData = { birth: campos }
    } else if (tipoEvento === "casamento") {
      campos = extrairCasamento(textoFinal)
      structuredData = { marriage: campos }
    } else {
      campos = extrairObito(textoFinal, doc.cidade_registro ?? undefined)
      structuredData = { death: campos }
    }

    const camposComValor = achatarCamposComValor(campos)
    if (camposComValor.length === 0) {
      resultados.push({
        documentoId: doc.id, pessoaNome: nomePessoa, status: "sem_campos_reconhecidos",
        motivo: "O texto foi lido, mas nenhum campo conhecido bateu com o boilerplate esperado — preencha manualmente.",
        camposExtraidos: [],
      })
      continue
    }

    await prisma.documento.update({
      where: { id: doc.id },
      data: { structuredData: structuredData as object, dataStatus: "ai_extracted" },
    })
    resultados.push({ documentoId: doc.id, pessoaNome: nomePessoa, status: "extraido", motivo: null, camposExtraidos: camposComValor })
  }

  return NextResponse.json({
    resultados,
    resumo: {
      total: resultados.length,
      extraidos: resultados.filter((r) => r.status === "extraido").length,
      pulados: resultados.filter((r) => r.status === "pulado_ja_preenchido").length,
      semTexto: resultados.filter((r) => r.status === "sem_texto").length,
      semCampos: resultados.filter((r) => r.status === "sem_campos_reconhecidos").length,
    },
  })
}

/** Nomes dos campos que vieram com valor de verdade — pra dizer o que a extração achou. */
function achatarCamposComValor(obj: Record<string, unknown>, prefixo = ""): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k
    if (v == null) continue
    if (typeof v === "object" && !Array.isArray(v)) {
      out.push(...achatarCamposComValor(v as Record<string, unknown>, caminho))
    } else if (v !== "") {
      out.push(caminho)
    }
  }
  return out
}
