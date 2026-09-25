// src/app/api/operacao/auditoria-processo/route.ts
// ============================================================================
// EXPORTAÇÃO PRONTA PARA AUDITORIA/COMPLIANCE (D6, mandato "grandes fluxos
// operacionais", 24/09/2026) — antes, "quem fez o quê, quando, nesta
// família" era caça ao tesouro dentro de `LogAuditoria`. Aqui é uma
// consulta, pronta pra exportar.
//
//   GET /api/operacao/auditoria-processo?processoId=N
//
// FONTE ÚNICA: `LogAuditoria`, filtrado por TODAS as Tarefas do processo
// (entidade "Tarefa") + o próprio processo (entidade "Processo") — nenhuma
// tabela nova, nenhuma auditoria paralela.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  if (usuario.tipo !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores exportam auditoria.' }, { status: 403 })
  }

  const processoId = Number(request.nextUrl.searchParams.get('processoId'))
  if (!Number.isInteger(processoId) || processoId <= 0) {
    return NextResponse.json({ error: 'processoId é obrigatório' }, { status: 400 })
  }

  const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, nome: true } })
  if (!processo) return NextResponse.json({ error: 'Processo não encontrado' }, { status: 404 })

  const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId }, select: { id: true } })).map((t) => t.id)

  const logs = await prisma.logAuditoria.findMany({
    where: {
      OR: [
        { entidade: 'Tarefa', entidadeId: { in: tarefaIds } },
        { entidade: 'Processo', entidadeId: processoId },
      ],
    },
    orderBy: { criadoEm: 'asc' },
    select: { id: true, acao: true, entidade: true, entidadeId: true, descricao: true, criadoEm: true, usuario: { select: { nome: true } } },
    take: 2000,
  })

  return NextResponse.json({
    processo: { id: processo.id, nome: processo.nome },
    itens: logs.map((l) => ({
      id: l.id, quando: l.criadoEm.toISOString(), acao: l.acao, entidade: l.entidade,
      entidadeId: l.entidadeId, descricao: l.descricao, autor: l.usuario?.nome ?? 'Sistema',
    })),
  })
}
