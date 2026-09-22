// GET — lista os Modelos da Biblioteca de Tarefas, com quantos Vínculos cada um tem.
// POST — cria um Modelo novo (casca + um passo em branco), sempre RASCUNHO.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { criarModelo } from "@/src/services/biblioteca-tarefas/modelo"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const modelos = await prisma.bibliotecaModeloTarefa.findMany({
    orderBy: { criadoEm: "asc" },
    include: {
      workflow: {
        select: {
          id: true, versao: true, rascunhoAlteradoEm: true,
          passos: { select: { id: true, key: true, label: true, regraDeConclusao: true, _count: { select: { subtarefas: true } } } },
        },
      },
      vinculos: {
        select: { id: true, status: true, phaseKey: true, tipoProcessoId: true, modalidadeId: true, modeloVersao: true },
      },
    },
  })

  return NextResponse.json({
    modelos: modelos.map((m) => ({
      id: m.id, chave: m.chave, nome: m.nome, descricao: m.descricao,
      status: m.status, versaoPublicada: m.versaoPublicada, ativo: m.ativo,
      workflowId: m.workflowId, temAlteracaoNaoPublicada: m.workflow.rascunhoAlteradoEm != null,
      passo: m.workflow.passos[0] ?? null,
      vinculos: m.vinculos,
      criadoEm: m.criadoEm, atualizadoEm: m.atualizadoEm,
    })),
  })
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const usuario = await extrairUsuarioComPermissoes(request)

  if (body.duplicarDeModeloId) {
    const { duplicarModelo } = await import("@/src/services/biblioteca-tarefas/modelo")
    const r = await duplicarModelo(
      Number(body.duplicarDeModeloId), String(body.chave ?? ""), String(body.nome ?? ""),
      usuario?.userId ?? null,
    )
    if (!r.ok) return NextResponse.json({ error: r.mensagem, code: r.erro }, { status: 422 })
    return NextResponse.json(r, { status: 201 })
  }

  const r = await criarModelo({
    chave: String(body.chave ?? ""), nome: String(body.nome ?? ""),
    descricao: body.descricao ? String(body.descricao) : null,
    criadoPorId: usuario?.userId ?? null,
  })
  if (!r.ok) return NextResponse.json({ error: r.mensagem, code: r.erro }, { status: 422 })
  return NextResponse.json(r, { status: 201 })
}
