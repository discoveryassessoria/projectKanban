// src/app/api/gerenciamento/profissionais/[id]/route.ts
//
// VER, EDITAR E TIRAR DE CIRCULAÇÃO um profissional.
//
// NÃO HÁ EXCLUSÃO FÍSICA quando o profissional já foi usado. Um pedido de retificação
// que aponta para ele continua tendo de dizer quem o conduziu; apagar a linha faria a
// referência virar um número órfão, e o histórico deixaria de responder. Quando nunca
// foi usado, apagar é limpar cadastro errado — e aí é permitido.

import { NextResponse } from "next/server"
import { prisma } from "@/src/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { registrarAuditoria } from "@/lib/gerenciamento/auditoria"
import { texto, idOuNulo, normalizarRegistros, conferirRegistros, traduzir } from "../route"

const SELECT = {
  id: true, nome: true, categoria: true, email: true, telefone: true,
  observacoes: true, ativo: true, organizacaoId: true,
  organizacao: { select: { id: true, name: true, nomeFantasia: true } },
  registros: {
    orderBy: { id: "asc" as const },
    select: { id: true, tipo: true, numero: true, jurisdicao: true, ativo: true, orgaoDeClasseId: true },
  },
  _count: { select: { retificacoes: true } },
} as const

async function idDaRota(params: Promise<{ id: string }>) {
  const { id } = await params
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const id = await idDaRota(params)
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const profissional = await prisma.profissional.findUnique({ where: { id }, select: SELECT })
  if (!profissional) return NextResponse.json({ error: "NAO_ENCONTRADO" }, { status: 404 })
  return NextResponse.json({ profissional })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const id = await idDaRota(params)
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const atual = await prisma.profissional.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true } })
  if (!atual) return NextResponse.json({ error: "NAO_ENCONTRADO" }, { status: 404 })

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const registros = body.registros !== undefined ? normalizarRegistros(body.registros) : null
  if (registros) {
    const problema = conferirRegistros(registros)
    if (problema) return NextResponse.json({ error: "VALIDACAO", mensagem: problema }, { status: 422 })
  }
  if (body.nome !== undefined && String(body.nome).trim() === "") {
    return NextResponse.json({ error: "VALIDACAO", mensagem: "O nome é obrigatório." }, { status: 422 })
  }

  try {
    const atualizado = await prisma.$transaction(async (tx) => {
      // OS REGISTROS SÃO SUBSTITUÍDOS EM BLOCO, e não editados linha a linha, porque a
      // tela edita o conjunto: o que sumiu da lista sumiu de propósito. A troca é
      // dentro da transação — nunca existe um instante sem inscrição nenhuma.
      if (registros) {
        await tx.registroProfissional.deleteMany({ where: { profissionalId: id } })
        if (registros.length) {
          await tx.registroProfissional.createMany({
            data: registros.map((r) => ({ ...r, profissionalId: id })),
          })
        }
      }
      return tx.profissional.update({
        where: { id },
        data: {
          ...(body.nome !== undefined ? { nome: String(body.nome).trim() } : {}),
          ...(body.categoria !== undefined ? { categoria: String(body.categoria).trim() } : {}),
          ...(body.email !== undefined ? { email: texto(body.email) } : {}),
          ...(body.telefone !== undefined ? { telefone: texto(body.telefone) } : {}),
          ...(body.observacoes !== undefined ? { observacoes: texto(body.observacoes) } : {}),
          ...(body.organizacaoId !== undefined ? { organizacaoId: idOuNulo(body.organizacaoId) } : {}),
          ...(body.ativo !== undefined ? { ativo: !!body.ativo } : {}),
        },
        select: SELECT,
      })
    })
    const mudouAtivo = body.ativo !== undefined && !!body.ativo !== atual.ativo
    await registrarAuditoria(request, {
      acao: mudouAtivo ? (atualizado.ativo ? "REATIVAR" : "DESATIVAR") : "EDITAR",
      entidade: "Profissional", entidadeId: id,
      descricao: mudouAtivo
        ? `Profissional "${atualizado.nome}" ${atualizado.ativo ? "reativado" : "tirado de circulação"}.`
        : `Profissional "${atualizado.nome}" editado.`,
    })
    return NextResponse.json({ ok: true, profissional: atualizado })
  } catch (e) {
    return NextResponse.json(traduzir(e), { status: 409 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  const id = await idDaRota(params)
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const p = await prisma.profissional.findUnique({
    where: { id }, select: { id: true, nome: true, _count: { select: { retificacoes: true } } },
  })
  if (!p) return NextResponse.json({ error: "NAO_ENCONTRADO" }, { status: 404 })

  // USADO É HISTÓRICO. Apagar deixaria pedidos apontando para um número sem nome.
  if (p._count.retificacoes > 0) {
    return NextResponse.json({
      error: "EM_USO",
      mensagem:
        `"${p.nome}" conduz ${p._count.retificacoes} pedido(s) de retificação e não pode ser apagado — ` +
        `o histórico deixaria de saber quem foi. Tire de circulação: ele some das novas escolhas e ` +
        `continua aparecendo onde já foi usado.`,
    }, { status: 409 })
  }

  await prisma.profissional.delete({ where: { id } })
  await registrarAuditoria(request, {
    acao: "EXCLUIR", entidade: "Profissional", entidadeId: id,
    descricao: `Profissional "${p.nome}" excluído (nunca havia sido usado).`,
  })
  return NextResponse.json({ ok: true })
}
