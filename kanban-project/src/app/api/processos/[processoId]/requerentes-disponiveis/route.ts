// src/app/api/processos/[processoId]/requerentes-disponiveis/route.ts
// ============================================================================
// Lista os Requerentes (participantes oficiais) do Processo para o SELETOR da
// Árvore Genealógica. Alimenta o fluxo de REUSO — a árvore vincula uma Pessoa a
// partir daqui em vez de criar uma nova. `jaNaArvore` indica se o requerente já
// é nó desta árvore (Pessoa vinculada com o mesmo arvoreId do processo).
// ============================================================================

import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "arvore.ver")
  if (erro) return erro

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const processo = await prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, arvoreId: true },
    })
    if (!processo) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    const vinculos = await prisma.processoRequerente.findMany({
      where: { processoId },
      include: { requerente: { include: { pessoa: true } } },
    })

    const requerentes = vinculos.map(({ requerente }) => ({
      requerenteId: requerente.id,
      nome: requerente.nome,
      personId: requerente.personId ?? null,
      sexo: requerente.sexo ?? null,
      dataNascimento: requerente.dataNascimento ?? null,
      nacionalidade: requerente.nacionalidade ?? null,
      // É nó DESTA árvore quando a Pessoa vinculada tem o mesmo arvoreId do processo.
      jaNaArvore:
        processo.arvoreId != null && requerente.pessoa?.arvoreId === processo.arvoreId,
    }))

    return NextResponse.json({ arvoreId: processo.arvoreId, requerentes })
  } catch (error) {
    console.error("[GET /api/processos/[processoId]/requerentes-disponiveis]", error)
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
  }
}
