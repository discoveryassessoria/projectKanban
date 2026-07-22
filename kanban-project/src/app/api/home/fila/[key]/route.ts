// ============================================================================
// GET /api/home/fila/[key] — DRILL-DOWN de uma fila da Central Operacional
// ----------------------------------------------------------------------------
// Retorna exatamente os itens que compõem a contagem exibida no card da Home,
// porque usa a MESMA coleta (src/lib/home/coleta.ts). Nada é recontado aqui.
// ============================================================================

import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { carregarBase, listarFila, type ContextoHome } from "@/src/lib/home/coleta"
import type { HomePermissions } from "@/src/types/home"

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

    const { key } = await params
    const isAdmin = usuario.tipo === "admin"
    const permissoes: HomePermissions = {
      verProcessos: isAdmin || temPermissao(usuario.permissoes, "processos.ver"),
      verTarefas: isAdmin || temPermissao(usuario.permissoes, "tarefas.ver"),
      verEventos: isAdmin || temPermissao(usuario.permissoes, "eventos.ver"),
      verFinanceiro: isAdmin || temPermissao(usuario.permissoes, "financeiro.ver"),
      isAdmin,
    }

    const ctx: ContextoHome = { userId: usuario.userId, isAdmin, permissoes, agora: new Date() }
    const base = await carregarBase(ctx)
    const detalhe = await listarFila(key, base, ctx)
    if (!detalhe) return NextResponse.json({ error: "Fila não encontrada" }, { status: 404 })

    return NextResponse.json(detalhe, {
      headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" },
    })
  } catch (e) {
    console.error("[/api/home/fila] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar a fila" }, { status: 500 })
  }
}
