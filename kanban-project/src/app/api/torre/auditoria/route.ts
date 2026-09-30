// GET /api/torre/auditoria?de=&ate=&autorId=&processoId=&acao=&pagina=&porPagina= — a aba AUDITORIA (Bloco I2).
// LogAuditoria de processo e tarefa, paginado no servidor. SÓ ADMINISTRADOR (auditoria é sensível; mesma régua de
// `/api/operacao/auditoria-processo`).
import { type NextRequest, NextResponse } from 'next/server'
import { exigirTorre } from '@/src/lib/torre-acesso'
import { consultarAuditoria, filtroDaQuery } from '@/lib/operacional/torre-auditoria'

export async function GET(request: NextRequest) {
  const { usuario, erro } = await exigirTorre(request, 'tarefas.ver')
  if (erro) return erro
  if (usuario.tipo !== 'admin') return NextResponse.json({ error: 'A auditoria é só para administradores.' }, { status: 403 })
  const sp = request.nextUrl.searchParams
  const r = await consultarAuditoria(filtroDaQuery(sp), Number(sp.get('pagina') ?? 1), Number(sp.get('porPagina') ?? 50))
  return NextResponse.json(r)
}
