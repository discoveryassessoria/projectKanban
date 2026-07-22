// GET /api/financeiro/config — configuração financeira agregada (FONTE ÚNICA), p/ o
// wizard de Cobrança. Lê os cadastros oficiais de Gerenciamento (não duplica).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { obterConfiguracaoFinanceira } from '@/lib/financeiro/financial-configuration-service'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver')
  if (erro) return erro
  try { return NextResponse.json(await obterConfiguracaoFinanceira()) }
  catch (e) { console.error('[financeiro config]', e); return NextResponse.json({ error: 'erro' }, { status: 500 }) }
}
