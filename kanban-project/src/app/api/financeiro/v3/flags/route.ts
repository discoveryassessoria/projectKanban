// /api/financeiro/v3/flags — estado das feature flags do Motor V3 para a UI.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagsV3 } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  return NextResponse.json({ flags: flagsV3(await usuarioFlag(req)) })
}
