// Modelos DISPONÍVEIS para gerar — ativos e com versão publicada.
//
// A tela de geração não monta lista própria e não conhece "Procuração Judicial"
// por nome: ela pergunta ao repositório o que existe publicado hoje. Publicar um
// modelo novo o faz aparecer aqui sem tocar em uma linha de frontend.
import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/src/lib/prisma"

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "documentos_gerados.ver")
  if (erro) return erro

  const modelos = await prisma.modeloDocumental.findMany({
    where: { ativo: true, versoes: { some: { status: "PUBLICADA" } } },
    orderBy: [{ categoria: "asc" }, { nome: "asc" }],
    select: {
      id: true,
      codigo: true,
      nome: true,
      descricao: true,
      categoria: true,
      documentType: { select: { id: true, name: true, publicCode: true } },
      versoes: {
        where: { status: "PUBLICADA" },
        select: { id: true, numero: true, publicadoEm: true, placeholders: true, obrigatorios: true },
      },
    },
  })

  return NextResponse.json({
    modelos: modelos.map((m) => ({
      id: m.id,
      codigo: m.codigo,
      nome: m.nome,
      descricao: m.descricao,
      categoria: m.categoria,
      documentType: m.documentType,
      versaoPublicada: m.versoes[0] ?? null,
    })),
  })
}
