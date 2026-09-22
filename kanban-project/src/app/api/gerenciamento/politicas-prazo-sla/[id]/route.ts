// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/politicas-prazo-sla/[id]/route.ts
//
// GET    - a política + todas as versões (histórico)
// PUT    - edita nome/descrição/ativo. Se PUBLICADA, edição de conteúdo dos
//          parâmetros só acontece via publicação de nova versão — este PUT
//          nunca reescreve uma versão já congelada.
// DELETE - exclusão física, só se NUNCA usada (0 tarefas vinculadas). Se em
//          uso, inative (ativo: false) em vez de excluir.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const politica = await prisma.politicaPrazoSla.findUnique({
      where: { id: Number(id) },
      include: { versoes: { orderBy: { versao: "desc" } }, _count: { select: { tarefas: true } } },
    })
    if (!politica) return NextResponse.json({ error: "Política não encontrada." }, { status: 404 })
    return NextResponse.json({ politica })
  } catch (error) {
    console.error("Erro ao buscar política de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const atual = await prisma.politicaPrazoSla.findUnique({ where: { id: Number(id) } })
    if (!atual) return NextResponse.json({ error: "Política não encontrada." }, { status: 404 })

    const b = await request.json().catch(() => ({}))
    const usuario = await extrairUsuarioComPermissoes(request)

    // Inativação é seu próprio evento auditável, não só um PUT qualquer.
    const inativando = b.ativo === false && atual.ativo === true
    const reativando = b.ativo === true && atual.ativo === false

    const politica = await prisma.politicaPrazoSla.update({
      where: { id: atual.id },
      data: {
        nome: b.nome !== undefined ? String(b.nome).trim() : atual.nome,
        descricao: b.descricao !== undefined ? (b.descricao ? String(b.descricao) : null) : atual.descricao,
        ativo: b.ativo !== undefined ? Boolean(b.ativo) : atual.ativo,
        status: inativando ? "INATIVA" : atual.status,
      },
    })

    if (inativando) {
      await prisma.eventoPrazoSla.create({
        data: { tipo: "POLITICA_INATIVADA", politicaId: politica.id, usuarioId: usuario?.userId ?? null, chaveIdempotencia: `POLITICA_INATIVADA::${politica.id}::${Date.now()}` },
      }).catch(() => null)
    } else if (reativando) {
      await prisma.eventoPrazoSla.create({
        data: { tipo: "POLITICA_REATIVADA", politicaId: politica.id, usuarioId: usuario?.userId ?? null, chaveIdempotencia: `POLITICA_REATIVADA::${politica.id}::${Date.now()}` },
      }).catch(() => null)
    } else {
      await prisma.eventoPrazoSla.create({
        data: { tipo: "POLITICA_EDITADA", politicaId: politica.id, usuarioId: usuario?.userId ?? null, valorAnterior: { nome: atual.nome }, valorNovo: { nome: politica.nome }, chaveIdempotencia: `POLITICA_EDITADA::${politica.id}::${Date.now()}` },
      }).catch(() => null)
    }

    return NextResponse.json({ politica })
  } catch (error) {
    console.error("Erro ao editar política de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { id } = await params
    const atual = await prisma.politicaPrazoSla.findUnique({ where: { id: Number(id) } })
    if (!atual) return NextResponse.json({ error: "Política não encontrada." }, { status: 404 })

    const emUso = await prisma.tarefa.count({ where: { politicaPrazoSlaId: atual.id } })
    if (emUso > 0) {
      return NextResponse.json({ error: `Esta política é usada por ${emUso} tarefa(s). Inative-a em vez de excluir.`, codigo: "EM_USO" }, { status: 409 })
    }

    await prisma.$transaction([
      prisma.eventoPrazoSla.deleteMany({ where: { politicaId: atual.id } }),
      prisma.politicaPrazoSlaVersao.deleteMany({ where: { politicaId: atual.id } }),
      prisma.politicaPrazoSla.delete({ where: { id: atual.id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erro ao excluir política de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
