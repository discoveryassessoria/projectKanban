// POST /api/torre/tarefas/vincular-orgao — a JUSTIFICATIVA do "Vincular órgão" (Torre nova, aba Tarefas, 01/10/2026).
// body: { tarefaIds, orgaoId, justificativa }. O vínculo em si é da porta da Operação (`vincular-orgao-lote`, que grava
// `Documento.orgaoId` e `Tarefa.orgaoId`); esta rota NÃO vincula nada: ela só grava, sob cada tarefa que JÁ TEM o órgão
// (conferido no banco, depois do vínculo), UMA linha de auditoria dizendo quem vinculou, qual órgão, quando e por quê.
// Tarefa que a porta ignorou (não é o responsável, sem documento…) não ganha linha: o histórico nunca afirma o que não aconteceu.
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { justificativaValida } from '@/src/services/torre-tarefas-justificativa'

export async function POST(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.editar')
  if (erro) return erro
  const b = await request.json().catch(() => ({}))
  const justificativa = justificativaValida(b?.justificativa)
  if (!justificativa) return NextResponse.json({ ok: false, mensagem: 'Escreva pelo menos 5 letras na justificativa.' }, { status: 400 })
  const orgaoId = Number(b?.orgaoId)
  const tarefaIds: number[] = Array.isArray(b?.tarefaIds) ? [...new Set<number>(b.tarefaIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 200) : []
  if (!Number.isInteger(orgaoId) || orgaoId <= 0 || tarefaIds.length === 0) return NextResponse.json({ ok: false, mensagem: 'Informe o órgão e as tarefas.' }, { status: 400 })
  const [orgao, vinculadas] = await Promise.all([
    prisma.orgaoProtocolo.findUnique({ where: { id: orgaoId }, select: { name: true } }),
    prisma.tarefa.findMany({ where: { id: { in: tarefaIds }, orgaoId }, select: { id: true, titulo: true } }),
  ])
  if (!orgao) return NextResponse.json({ ok: false, mensagem: 'Órgão não encontrado.' }, { status: 404 })
  if (vinculadas.length > 0) {
    await prisma.logAuditoria.createMany({
      data: vinculadas.map((t) => ({
        acao: 'TAREFA_ORGAO_VINCULADO', entidade: 'Tarefa', entidadeId: t.id, usuarioId: usuario.userId,
        descricao: `Órgão emissor "${orgao.name}" vinculado à tarefa "${t.titulo}". Justificativa: ${justificativa}`,
        detalhes: { tarefaId: t.id, orgaoId, justificativa },
      })),
    })
  }
  return NextResponse.json({ ok: true, auditadas: vinculadas.length })
}
