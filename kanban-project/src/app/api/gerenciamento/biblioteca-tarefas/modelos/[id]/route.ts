// GET — um Modelo, com o passo/subtarefas completos (mesmo shape do editor).
// PUT — metadados do Modelo (nome/descrição) e ciclo de vida (inativar/reativar).
// O CONTEÚDO do passo (subtarefas/campos/ações/dependências) continua sendo
// editado pela porta já existente: PUT /api/gerenciamento/workflows-fase/[workflowId].
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { inativarModelo, reativarModelo } from "@/src/services/biblioteca-tarefas/modelo"
import { INCLUDE_DA_DEFINICAO } from "@/src/services/versao-publicada"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const { id } = await params
  const modelo = await prisma.bibliotecaModeloTarefa.findUnique({
    where: { id: Number(id) },
    include: { workflow: { include: { passos: INCLUDE_DA_DEFINICAO } } },
  })
  if (!modelo) return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 })
  return NextResponse.json({ modelo })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro

  const { id } = await params
  const modeloId = Number(id)
  const body = await request.json().catch(() => ({} as Record<string, unknown>))

  const modelo = await prisma.bibliotecaModeloTarefa.findUnique({ where: { id: modeloId } })
  if (!modelo) return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 })

  if (body.acao === "inativar") {
    const r = await inativarModelo(modeloId)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.mensagem }, { status: 422 })
  }
  if (body.acao === "reativar") {
    const r = await reativarModelo(modeloId)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.mensagem }, { status: 422 })
  }

  const data: { nome?: string; descricao?: string | null } = {}
  if (body.nome !== undefined) data.nome = String(body.nome)
  if (body.descricao !== undefined) data.descricao = body.descricao ? String(body.descricao) : null
  if (Object.keys(data).length) {
    await prisma.bibliotecaModeloTarefa.update({ where: { id: modeloId }, data })
    if (data.nome) await prisma.phaseInternalWorkflow.update({ where: { id: modelo.workflowId }, data: { name: data.nome } })
  }
  return NextResponse.json({ ok: true })
}
