// src/app/api/processos/[processoId]/necessidades/route.ts
// CP-3 — lista e geração idempotente de NecessidadeDocumental do processo.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  garantirNecessidadesArvoreDoProcesso,
  garantirNecessidadesDaMatriz,
  garantirNecessidade,
} from "@/src/services/necessidade-documental"

// GET - listar necessidades do processo (dual-read via campos novos)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const necessidades = await prisma.necessidadeDocumental.findMany({
      where: { processoId },
      include: {
        itemCatalogo: { select: { id: true, code: true, name: true } },
        _count: { select: { documentos: true, eventos: true } },
      },
      orderBy: [{ status: "asc" }, { id: "asc" }],
    })
    return NextResponse.json({ necessidades })
  } catch (error) {
    console.error("Erro ao listar necessidades:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

// POST - gerar necessidades (árvore | matriz) ou criar manual
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const acao = body.acao as string

    if (acao === "gerar_arvore") {
      const r = await garantirNecessidadesArvoreDoProcesso(processoId)
      return NextResponse.json({ acao, ...r })
    }
    if (acao === "gerar_matriz") {
      const r = await garantirNecessidadesDaMatriz(processoId, body.phaseKey ?? null)
      return NextResponse.json({ acao, ...r })
    }
    if (acao === "criar_manual") {
      if (!body.itemCatalogoId) return NextResponse.json({ error: "itemCatalogoId é obrigatório" }, { status: 400 })
      try {
        const { necessidade, criada } = await garantirNecessidade({
          processoId,
          itemCatalogoId: body.itemCatalogoId,
          pessoaId: body.pessoaId ?? null,
          uniaoId: body.uniaoId ?? null,
          varianteKey: body.varianteKey,
          origem: "MANUAL",
          obrigatoriedade: body.obrigatoriedade === "OPCIONAL" ? "OPCIONAL" : "OBRIGATORIA",
        })
        return NextResponse.json({ necessidade, criada }, { status: criada ? 201 : 200 })
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 })
      }
    }

    return NextResponse.json({ error: "Ação inválida (gerar_arvore|gerar_matriz|criar_manual)" }, { status: 400 })
  } catch (error) {
    console.error("Erro ao gerar necessidades:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
