// /api/financeiro/v3/obrigacoes — lista de obrigações (saldo por projeção).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const sp = req.nextUrl.searchParams
  const obrigacoes = await listarObrigacoes({
    processoId: sp.get('processoId') ? Number(sp.get('processoId')) : undefined,
    status: sp.get('status') ?? undefined,
    natureza: sp.get('natureza') ?? undefined,
  })
  return NextResponse.json({ disponivel: true, obrigacoes })
}
