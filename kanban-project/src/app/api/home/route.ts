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
import { carregarBase, contarTrabalhoPendenteDistinto, montarAgenda, montarAlertas, montarFilas, montarPrazosResumo, montarResumoDia, montarSla, type ContextoHome } from "@/src/lib/home/coleta"
import { montarStatus } from "@/src/lib/home/home-logic"
import type { HomeData, HomePermissions } from "@/src/types/home"
import { agregacaoPorFamilia, indicadoresGerenciais } from "@/lib/operacional/tarefa-projecoes"
import { fasesParaSelecao } from "@/src/lib/process-stage/fases-catalog"

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
    // ESCOPO — admin sem filtro (universo global autorizado); operacional só
    // o próprio trabalho. Decidido AQUI, a partir da sessão — nunca aceito do
    // cliente (ver src/lib/autorizacao/escopo-operacional.ts).
    const filtroCentral = isAdmin ? {} : { responsavelId: usuario.userId }
    const [filas, agenda, resumoDia, alertas, familiasCentral, indicadoresCentral] = await Promise.all([
      Promise.resolve(montarFilas(base, ctx)),
      montarAgenda(ctx),
      montarResumoDia(base, ctx),
      montarAlertas(base, ctx),
      permissoes.verTarefas ? agregacaoPorFamilia(ctx.agora, filtroCentral) : Promise.resolve([]),
      permissoes.verTarefas ? indicadoresGerenciais(filtroCentral, ctx.agora) : Promise.resolve(null),
    ])

    // Métrica COMPOSTA e deduplicada — não é Σ fila.quantidade (isso contava o
    // mesmo Step/Tarefa/Processo mais de uma vez quando ele pertencia a mais de
    // uma fila ao mesmo tempo; achado real da auditoria de 10/09/2026 — ver
    // `contarTrabalhoPendenteDistinto`). Nunca ler como contagem de Tarefa.
    const totalAcoes = contarTrabalhoPendenteDistinto(base, ctx)
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
      sla: montarSla(base, ctx),
      prazosResumo: montarPrazosResumo(base, ctx),
      agenda,
      alertas,
      resumoDia,
      centralOperacional: indicadoresCentral
        ? { indicadores: indicadoresCentral, familias: familiasCentral, fases: fasesParaSelecao() }
        : null,
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
