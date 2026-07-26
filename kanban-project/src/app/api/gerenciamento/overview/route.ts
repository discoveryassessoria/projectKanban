// src/app/api/gerenciamento/overview/route.ts
//
// GET /api/gerenciamento/overview — Painel Geral do Gerenciamento.
// TODOS os números são REAIS, lidos das tabelas que existem (Usuario, Perfil,
// CategoriaFinanceira, ContaBancaria, Fornecedor, CentroCusto, Status,
// LogAuditoria). NÃO existe valor mock/prévia neste endpoint.
//
// A projeção (rótulos, ordem, marcação de duplicidade) vive em
// lib/gerenciamento/overview-projecao.ts — fonte única compartilhada com o
// OverviewTab, para que um mesmo número não receba dois nomes diferentes.
//
// "Última alteração" IGNORA eventos de acesso (entidade "ACESSO": LOGIN /
// LOGIN_NEGADO): logar não é alterar configuração. `ultimaAcao` continua
// devolvendo o último log SEM filtro, por retrocompatibilidade.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ENTIDADE_ACESSO, montarStrip } from "@/lib/gerenciamento/overview-projecao"

export async function GET(_req: NextRequest) {
  try {
    const [usuarios, perfis, categorias, contas, fornecedores, centros, statusCols, ultimoLog, ultimaAlteracaoLog] =
      await Promise.all([
        prisma.usuario.count(),
        prisma.perfil.count(),
        prisma.categoriaFinanceira.count(),
        prisma.contaBancaria.count(),
        prisma.fornecedor.count({ where: { ativo: true } }),
        prisma.centroCusto.count({ where: { ativo: true } }),
        prisma.status.count(),
        // último log SEM filtro — mantido só para `ultimaAcao` (retrocompat).
        prisma.logAuditoria.findFirst({ orderBy: { criadoEm: "desc" }, select: { acao: true, entidade: true, criadoEm: true } }),
        // última ALTERAÇÃO de fato: exclui acesso. Filtra por entidade (indexada).
        prisma.logAuditoria.findFirst({
          where: { NOT: { entidade: ENTIDADE_ACESSO } },
          orderBy: { criadoEm: "desc" },
          select: { acao: true, entidade: true, criadoEm: true },
        }),
      ])

    // alertas/recomendações reais simples
    const alertas: string[] = []
    const semPerfil = await prisma.usuario.count({ where: { perfilId: null, tipo: { not: "admin" } } })
    if (semPerfil > 0) alertas.push(`${semPerfil} usuário(s) sem perfil atribuído`)
    if (contas === 0) alertas.push("Nenhuma conta bancária cadastrada")
    if (fornecedores === 0) alertas.push("Nenhum fornecedor ativo cadastrado")

    const contagens = { usuarios, perfis, contas, categorias, fornecedores, centros, statusCols }

    return NextResponse.json({
      // cards reais
      cards: contagens,
      // strip de KPIs — as 7 contagens vêm marcadas com `duplicadoEmCards`
      strip: montarStrip(contagens, ultimaAlteracaoLog?.criadoEm ?? null),
      alertas,
      // alteração de configuração (sem eventos de acesso)
      ultimaAlteracao: ultimaAlteracaoLog
        ? { acao: ultimaAlteracaoLog.acao, entidade: ultimaAlteracaoLog.entidade, em: ultimaAlteracaoLog.criadoEm }
        : null,
      // DEPRECADO: último log sem filtro (pode ser LOGIN). Mantido enquanto
      // houver consumidor; usar `ultimaAlteracao`.
      ultimaAcao: ultimoLog ? { acao: ultimoLog.acao, entidade: ultimoLog.entidade, em: ultimoLog.criadoEm } : null,
    })
  } catch (e) {
    console.error("[gerenciamento/overview] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar painel" }, { status: 500 })
  }
}
