// GET /api/cambio/snapshot — snapshot das cotações vigentes (LÊ SÓ O BANCO). Usado pelo
// card "Cotações de hoje" da Home e pela tela admin. Nunca consulta a Confidence aqui.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { snapshotCotacoes } from '@/src/lib/cambio/servico-cambio'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'processos.ver')
  if (erro) return erro
  try { return NextResponse.json(await snapshotCotacoes()) }
  catch (e) { console.error('[cambio snapshot]', e); return NextResponse.json({ error: 'erro' }, { status: 500 }) }
}
