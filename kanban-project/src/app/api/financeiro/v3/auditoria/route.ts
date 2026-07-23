// /api/financeiro/v3/auditoria — auditoria financeira V3 (LogAuditoria).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { listarAuditoria } from '@/lib/financeiro/leitura/consultas'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false }, { status: 409 })
  return NextResponse.json({ disponivel: true, auditoria: await listarAuditoria() })
}
