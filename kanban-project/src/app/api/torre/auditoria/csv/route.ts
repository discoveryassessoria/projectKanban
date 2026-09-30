// GET /api/torre/auditoria/csv?<mesmos filtros> — "Exportar CSV" (Bloco I2): o que está filtrado, gerado pelo
// SERVIDOR, só administrador. A exportação também fica registrada (quem exportou, com quais filtros).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { csvDaAuditoria, filtroDaQuery } from '@/lib/operacional/torre-auditoria'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  if (usuario.tipo !== 'admin') return NextResponse.json({ error: 'A exportação da auditoria é só para administradores.' }, { status: 403 })
  const filtro = filtroDaQuery(request.nextUrl.searchParams)
  const r = await csvDaAuditoria(filtro)
  await prisma.logAuditoria.create({
    data: {
      acao: 'AUDITORIA_EXPORTADA', entidade: 'Torre', entidadeId: null, usuarioId: usuario.userId,
      descricao: `Auditoria exportada em CSV: ${r.linhas} de ${r.total} linha(s)${r.truncado ? ' (truncado)' : ''}.`,
      detalhes: JSON.parse(JSON.stringify({ filtro, linhas: r.linhas, total: r.total, truncado: r.truncado })),
    },
  })
  const dia = new Date().toISOString().slice(0, 10)
  return new NextResponse(r.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="auditoria-torre-${dia}.csv"`,
      'X-Auditoria-Total': String(r.total), 'X-Auditoria-Linhas': String(r.linhas), 'X-Auditoria-Truncado': r.truncado ? '1' : '0',
    },
  })
}
