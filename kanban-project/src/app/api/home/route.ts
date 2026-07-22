// ============================================================================
// GET /api/home — AGREGADOR do CENTRO OPERACIONAL (Home)
// ----------------------------------------------------------------------------
// UMA resposta com o que a Home precisa: status, filas executáveis, agenda,
// alertas e o resumo do dia. A coleta vive em src/lib/home/coleta.ts — a MESMA
// usada pelo drill-down de cada fila (/api/home/fila/[key]), então a contagem
// do card e a lista da fila jamais divergem.
//
// A Home só CONSOLIDA: não recalcula regra de negócio (bloqueio, conclusão,
// prontidão de fase vêm do estado gravado pelo motor) e não duplica consulta
// que já existe nos módulos.
// ============================================================================

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { carregarBase, montarAgenda, montarAlertas, montarFilas, montarResumoDia, type ContextoHome } from "@/src/lib/home/coleta"
import { montarStatus } from "@/src/lib/home/home-logic"
import type { HomeData, HomePermissions } from "@/src/types/home"

export async function GET(request: NextRequest) {
  try {
    const usuario = await extrairUsuarioComPermissoes(request)
    if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

    const isAdmin = usuario.tipo === "admin"
    const permissoes: HomePermissions = {
      verProcessos: isAdmin || temPermissao(usuario.permissoes, "processos.ver"),
      verTarefas: isAdmin || temPermissao(usuario.permissoes, "tarefas.ver"),
      verEventos: isAdmin || temPermissao(usuario.permissoes, "eventos.ver"),
      verFinanceiro: isAdmin || temPermissao(usuario.permissoes, "financeiro.ver"),
      isAdmin,
    }

    const ctx: ContextoHome = { userId: usuario.userId, isAdmin, permissoes, agora: new Date() }

    // O token do admin não carrega o nome — a saudação vem do cadastro.
    const perfil = await prisma.usuario.findUnique({
      where: { id: usuario.userId },
      select: { nome: true, email: true },
    })

    const base = await carregarBase(ctx)
    const [filas, agenda, resumoDia, alertas] = await Promise.all([
      Promise.resolve(montarFilas(base, ctx)),
      montarAgenda(ctx),
      montarResumoDia(base, ctx),
      montarAlertas(base, ctx),
    ])

    const totalAcoes = filas.reduce((acc, f) => acc + f.quantidade, 0)
    const criticos = filas.filter((f) => f.nivel === "critico").reduce((acc, f) => acc + f.quantidade, 0)

    const payload: HomeData = {
      usuario: {
        id: usuario.userId,
        nome: perfil?.nome || usuario.nome || "Usuário",
        email: perfil?.email || usuario.email,
        tipo: usuario.tipo,
      },
      geradoEm: ctx.agora.toISOString(),
      permissions: permissoes,
      status: montarStatus({ totalAcoes, criticos, alertas: alertas.length }),
      filas,
      agenda,
      alertas,
      resumoDia,
    }

    return NextResponse.json(payload, {
      // Cache curto e privado: a Home é consultada várias vezes por sessão e o
      // dado tolera segundos de defasagem (o SWR do cliente revalida).
      headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" },
    })
  } catch (e) {
    console.error("[/api/home] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar o Centro Operacional" }, { status: 500 })
  }
}
