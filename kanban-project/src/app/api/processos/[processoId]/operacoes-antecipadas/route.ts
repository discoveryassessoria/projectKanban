// src/app/api/processos/[processoId]/operacoes-antecipadas/route.ts
// GET lista as operações antecipadas do processo (opcional ?necessidadeId). POST cria uma.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { criarOperacaoAntecipada, listarOperacoesAntecipadas } from "@/src/services/operacao-antecipada"

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const necessidadeId = new URL(request.url).searchParams.get("necessidadeId")
    const operacoes = await listarOperacoesAntecipadas(id, necessidadeId ? parseInt(necessidadeId) : null)
    return NextResponse.json({ operacoes })
  } catch (e) {
    console.error("[GET operacoes-antecipadas]", e)
    return NextResponse.json({ error: "Erro ao listar operações antecipadas" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    if (!body?.necessidadeId || !body?.operationType) {
      return NextResponse.json({ error: "necessidadeId e operationType são obrigatórios" }, { status: 400 })
    }
    const op = await criarOperacaoAntecipada({
      processoId: id,
      necessidadeId: Number(body.necessidadeId),
      operationType: String(body.operationType),
      targetPhaseCode: body.targetPhaseCode ?? null,
      originStepKey: body.originStepKey ?? null,
      objetivo: body.objetivo ?? null,
      resultadoEsperado: body.resultadoEsperado ?? null,
      responsavelId: body.responsavelId != null ? Number(body.responsavelId) : null,
      pessoaId: body.pessoaId != null ? Number(body.pessoaId) : null,
      params: body.params ?? undefined,
      usuarioId: usuario?.userId ?? null,
    })
    return NextResponse.json({ operacao: op }, { status: 201 })
  } catch (e) {
    console.error("[POST operacoes-antecipadas]", e)
    return NextResponse.json({ error: (e as Error)?.message ?? "Erro ao criar operação antecipada" }, { status: 422 })
  }
}
