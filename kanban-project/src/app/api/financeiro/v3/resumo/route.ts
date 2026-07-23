// /api/financeiro/v3/resumo — visão geral financeira (derivada do Ledger).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { resumoFinanceiro } from '@/lib/financeiro/leitura/consultas'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  return NextResponse.json({ disponivel: true, resumo: await resumoFinanceiro() })
}
