import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const [totalPessoas, totalDocumentos, totalArvores] = await Promise.all([
      prisma.pessoa.count(),
      prisma.documento.count(),
      prisma.arvore.count(),
    ])

    return NextResponse.json({
      totalPessoas,
      totalDocumentos,
      totalArvores,
    })
  } catch (error) {
    console.error("Erro ao buscar estatísticas:", error)
    return NextResponse.json(
      { error: "Erro ao buscar estatísticas" },
      { status: 500 }
    )
  }
}