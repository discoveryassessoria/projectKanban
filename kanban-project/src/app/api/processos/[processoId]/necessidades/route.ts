// src/app/api/processos/[processoId]/necessidades/route.ts
// CP-3 — lista e geração idempotente de NecessidadeDocumental do processo.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { garantirNecessidade } from "@/src/services/necessidade-documental"

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

    // MOTOR ÚNICO. "gerar_arvore" e "gerar_matriz" eram dois materializadores
    // paralelos: geravam necessidade com `varianteKey` próprio, fora das Regras
    // Documentais publicadas e sem avaliar condição, duplicando a obrigação que o
    // motor oficial já havia criado. Não foram desativados — foram eliminados.
    if (acao === "gerar_arvore" || acao === "gerar_matriz") {
      return NextResponse.json({
        error: "Ação eliminada. As obrigações documentais são criadas exclusivamente por materializarExecucaoDaFase → materializarGenealogia, a partir das Regras Documentais publicadas.",
        code: "MATERIALIZADOR_LEGADO_ELIMINADO",
      }, { status: 410 })
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

    return NextResponse.json({ error: "Ação inválida (criar_manual)" }, { status: 400 })
  } catch (error) {
    console.error("Erro ao gerar necessidades:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
