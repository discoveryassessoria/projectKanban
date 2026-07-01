import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET — últimos logs de auditoria (só leitura). Filtros são no cliente.
export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  try {
    const { searchParams } = new URL(request.url)
    const take = Math.min(Number(searchParams.get('take')) || 300, 1000)
    const logs = await prisma.logAuditoria.findMany({
      orderBy: { criadoEm: 'desc' },
      take,
      include: { usuario: { select: { nome: true } } },
    })
    const out = logs.map(l => ({
      id: l.id, acao: l.acao, entidade: l.entidade, entidadeId: l.entidadeId,
      descricao: l.descricao, detalhes: l.detalhes, usuarioId: l.usuarioId,
      usuarioNome: l.usuario?.nome ?? null, criadoEm: l.criadoEm,
    }))
    return NextResponse.json({ logs: out })
  } catch (e) {
    console.error('GET auditoria', e)
    return NextResponse.json({ error: 'Erro ao carregar os logs.' }, { status: 500 })
  }
}