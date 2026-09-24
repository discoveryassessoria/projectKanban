// src/app/api/operacao/historico-atribuicoes/route.ts
// ============================================================================
// HISTÓRICO DE ATRIBUIÇÕES — quem recebeu o quê, de quem, e quando.
//
//   GET /api/operacao/historico-atribuicoes?limite=50
//
// Não é uma tabela nova: `atribuirTarefa`/`transferirTarefa` já gravam
// `LogAuditoria` (acao TAREFA_ATRIBUIDA/TAREFA_TRANSFERIDA, entidade "Tarefa")
// a cada chamada — essa rota só LÊ o que o comando canônico já audita, nunca
// duplica o fato em lugar novo.
//
// Mesma hierarquia de "Distribuição": ver quem distribuiu o quê é gestão.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { prisma } from '@/lib/prisma'

const ACOES = ['TAREFA_ATRIBUIDA', 'TAREFA_TRANSFERIDA'] as const

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro

  const limite = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limite')) || 50, 1), 200)

  const logs = await prisma.logAuditoria.findMany({
    where: { entidade: 'Tarefa', acao: { in: [...ACOES] } },
    orderBy: { criadoEm: 'desc' },
    take: limite,
    select: {
      id: true, acao: true, criadoEm: true, entidadeId: true, detalhes: true,
      usuario: { select: { id: true, nome: true } },
    },
  })

  const tarefaIds = [...new Set(logs.map((l) => l.entidadeId).filter((n): n is number => n != null))]
  const destinatarioIds = [...new Set(
    logs.map((l) => (l.detalhes as { para?: number } | null)?.para).filter((n): n is number => typeof n === 'number'),
  )]

  const [tarefas, destinatarios] = await Promise.all([
    prisma.tarefa.findMany({ where: { id: { in: tarefaIds } }, select: { id: true, titulo: true, processoId: true } }),
    prisma.usuario.findMany({ where: { id: { in: destinatarioIds } }, select: { id: true, nome: true } }),
  ])
  const tarefaPorId = new Map(tarefas.map((t) => [t.id, t]))
  const usuarioPorId = new Map(destinatarios.map((u) => [u.id, u.nome]))

  const itens = logs.map((l) => {
    const detalhes = l.detalhes as { de?: number | null; para?: number; motivo?: string | null } | null
    const tarefa = l.entidadeId != null ? tarefaPorId.get(l.entidadeId) : null
    return {
      id: l.id,
      quando: l.criadoEm.toISOString(),
      transferencia: l.acao === 'TAREFA_TRANSFERIDA',
      tarefaId: l.entidadeId,
      tarefaTitulo: tarefa?.titulo ?? null,
      processoId: tarefa?.processoId ?? null,
      autorNome: l.usuario?.nome ?? null,
      destinatarioNome: detalhes?.para != null ? usuarioPorId.get(detalhes.para) ?? null : null,
      motivo: detalhes?.motivo ?? null,
    }
  })

  return NextResponse.json({ itens, total: itens.length })
}
