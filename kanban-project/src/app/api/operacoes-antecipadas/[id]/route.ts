// src/app/api/operacoes-antecipadas/[id]/route.ts
// PATCH avalia a operação antecipada: resultado ∈ SIM | PARCIAL | NAO | CANCELAR.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { avaliarOperacaoAntecipada } from "@/src/services/operacao-antecipada"
import type { ResultadoAvaliacao } from "@/src/lib/operacoes/tipos"

const RESULTADOS = new Set(["SIM", "PARCIAL", "NAO", "CANCELAR"])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "processos.editar")
  if (erro) return erro
  try {
    const { id } = await params
    const opId = parseInt(id)
    if (isNaN(opId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))
    const resultado = String(body?.resultado ?? "").toUpperCase()
    if (!RESULTADOS.has(resultado)) return NextResponse.json({ error: "resultado deve ser SIM, PARCIAL, NAO ou CANCELAR" }, { status: 400 })
    const r = await avaliarOperacaoAntecipada(opId, resultado as ResultadoAvaliacao, {
      resultadoObtido: body?.resultadoObtido ?? null,
      resultadoDados: body?.resultadoDados ?? null,
      usuarioId: usuario?.userId ?? null,
    })
    return NextResponse.json(r)
  } catch (e) {
    console.error("[PATCH operacoes-antecipadas]", e)
    return NextResponse.json({ error: (e as Error)?.message ?? "Erro ao avaliar operação" }, { status: 422 })
  }
}
