// CRIAR EM: src/app/api/gerenciamento/overview/route.ts
//
// GET /api/gerenciamento/overview — Painel Geral do Gerenciamento.
// REAL: contagens das tabelas que existem (Usuario, Perfil, CategoriaFinanceira,
// ContaBancaria, Fornecedor, CentroCusto, LogAuditoria, Status).
// MOCK ("prévia"): contagens de coisas sem tabela (valores, automações,
// workflows, SLA, templates) — devolvidas como exemplo pro strip ficar fiel.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(_req: NextRequest) {
  try {
    const [usuarios, perfis, categorias, contas, fornecedores, centros, statusCols, ultimoLog] = await Promise.all([
      prisma.usuario.count(),
      prisma.perfil.count(),
      prisma.categoriaFinanceira.count(),
      prisma.contaBancaria.count(),
      prisma.fornecedor.count({ where: { ativo: true } }),
      prisma.centroCusto.count({ where: { ativo: true } }),
      prisma.status.count(),
      prisma.logAuditoria.findFirst({ orderBy: { criadoEm: "desc" }, select: { acao: true, entidade: true, criadoEm: true } }),
    ])

    // alertas/recomendações reais simples
    const alertas: string[] = []
    const semPerfil = await prisma.usuario.count({ where: { perfilId: null, tipo: { not: "admin" } } })
    if (semPerfil > 0) alertas.push(`${semPerfil} usuário(s) sem perfil atribuído`)
    if (contas === 0) alertas.push("Nenhuma conta bancária cadastrada")
    if (fornecedores === 0) alertas.push("Nenhum fornecedor ativo cadastrado")

    return NextResponse.json({
      // cards reais
      cards: {
        usuarios, perfis, categorias, contas, fornecedores, centros, statusCols,
      },
      // strip de KPIs (8) — mistura real + prévia
      strip: [
        { label: "Usuários", value: usuarios, real: true },
        { label: "Perfis", value: perfis, real: true },
        { label: "Contas bancárias", value: contas, real: true },
        { label: "Categorias financeiras", value: categorias, real: true },
        { label: "Fornecedores ativos", value: fornecedores, real: true },
        { label: "Centros de custo", value: centros, real: true },
        { label: "Colunas de status", value: statusCols, real: true },
        { label: "Última alteração", value: ultimoLog ? new Date(ultimoLog.criadoEm).toLocaleDateString("pt-BR") : "—", real: true, isText: true },
      ],
      alertas,
      ultimaAcao: ultimoLog ? { acao: ultimoLog.acao, entidade: ultimoLog.entidade, em: ultimoLog.criadoEm } : null,
    })
  } catch (e) {
    console.error("[gerenciamento/overview] erro:", e)
    return NextResponse.json({ error: "Erro ao carregar painel" }, { status: 500 })
  }
}