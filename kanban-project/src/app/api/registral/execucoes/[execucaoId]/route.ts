// GET — pipeline de UM documento: etapa atual, trilha completa de etapas
// (append-only), ocorrências, correspondências e evidências.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ execucaoId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar"])
  if (!auth.ok) return auth.resposta

  const { execucaoId: raw } = await params
  const execucaoId = idDe(raw)
  if (execucaoId == null) return erro("execucaoId inválido")

  const execucao = await prisma.execucaoRegistral.findUnique({
    where: { id: execucaoId },
    select: {
      id: true,
      loteId: true,
      documentoId: true,
      necessidadeId: true,
      etapa: true,
      tipoDetectado: true,
      confiancaTipo: true,
      versaoExtrator: true,
      fonteTexto: true,
      tentativas: true,
      proximaEm: true,
      erro: true,
      ocorrenciasDetectadas: true,
      camposExtraidos: true,
      camposDivergentes: true,
      evidenciasCriadas: true,
      correlationId: true,
      criadoEm: true,
      finalizadoEm: true,
      etapas: { orderBy: { criadoEm: "asc" } },
      ocorrencias: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          papel: true,
          nomeBruto: true,
          nomeNormalizado: true,
          chaveFonetica: true,
          sexoInferido: true,
          atributos: true,
          pessoaResolvidaId: true,
          classe: true,
          scoreIdentidade: true,
          resolvidaAutomaticamente: true,
          correspondencias: {
            orderBy: { score: "desc" },
            select: {
              id: true,
              pessoaId: true,
              classe: true,
              score: true,
              evidencias: true,
              decisao: true,
              decididoEm: true,
              pessoa: { select: { id: true, nome: true, sobrenome: true } },
            },
          },
        },
      },
      evidencias: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          campo: true,
          pagina: true,
          regiao: true,
          trechoTexto: true,
          valorBruto: true,
          valorNormalizado: true,
          metodoExtracao: true,
          versaoProcessamento: true,
          confiancaExtracao: true,
          confiancaAssociacao: true,
          regraAplicada: true,
          favoravel: true,
          fatoId: true,
          pessoaId: true,
        },
      },
      conflitos: {
        select: { id: true, codigo: true, severidade: true, status: true, descricao: true, acaoSugerida: true },
      },
      propostas: {
        select: { id: true, tipo: true, criticidade: true, status: true, recomendacao: true, confianca: true },
      },
      documento: { select: { id: true, descricao: true, arquivo_nome: true, tipo: true, transcricaoFonte: true } },
    },
  })
  if (!execucao) return erro("Execução não encontrada", 404)
  return NextResponse.json({ execucao })
}
