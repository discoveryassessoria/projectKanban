// src/app/api/processos/[processoId]/necessidades/[necessidadeId]/route.ts
// CP-3 — detalhe + transições de estado da NecessidadeDocumental (append-only).
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { marcarNaoLocalizada, reabrir, retornoGenealogia, dispensarNecessidade, atenderNecessidade, iniciarAtendimentoNecessidade } from "@/src/services/necessidade-documental"

// GET - detalhe da necessidade + histórico (eventos) + documentos que a atendem
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; necessidadeId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { necessidadeId: nid } = await params
    const id = parseInt(nid)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const necessidade = await prisma.necessidadeDocumental.findUnique({
      where: { id },
      include: {
        itemCatalogo: { select: { id: true, code: true, name: true } },
        documentos: { select: { id: true, status: true, arquivo_nome: true } },
        eventos: { orderBy: { criadoEm: "asc" } },
      },
    })
    if (!necessidade) return NextResponse.json({ error: "Necessidade não encontrada" }, { status: 404 })
    return NextResponse.json({ necessidade })
  } catch (error) {
    console.error("Erro ao buscar necessidade:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

// PATCH - transições: nao_localizada | reabrir | retorno_genealogia | dispensar | atender | em_atendimento
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string; necessidadeId: string }> }
) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { necessidadeId: nid } = await params
    const id = parseInt(nid)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const acao = body.acao as string

    switch (acao) {
      case "nao_localizada":
        return NextResponse.json({ necessidade: await marcarNaoLocalizada(id) })
      case "reabrir":
        return NextResponse.json({ necessidade: await reabrir(id) }, { status: 201 })
      case "retorno_genealogia":
        return NextResponse.json({ necessidade: await retornoGenealogia(id, body.motivo) })
      case "dispensar": {
        // Transição CANÔNICA pelo serviço de domínio (nenhuma escrita direta de status).
        await dispensarNecessidade(id, typeof body.motivo === "string" ? body.motivo : undefined)
        return NextResponse.json({ necessidade: await prisma.necessidadeDocumental.findUnique({ where: { id } }) })
      }
      case "em_atendimento": {
        await iniciarAtendimentoNecessidade(id)
        return NextResponse.json({ necessidade: await prisma.necessidadeDocumental.findUnique({ where: { id } }) })
      }
      case "atender": {
        await atenderNecessidade(id)
        return NextResponse.json({ necessidade: await prisma.necessidadeDocumental.findUnique({ where: { id } }) })
      }
      default:
        return NextResponse.json({ error: "Ação inválida" }, { status: 400 })
    }
  } catch (error) {
    console.error("Erro ao transicionar necessidade:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
