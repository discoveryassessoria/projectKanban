// GET /api/financeiro/v3/extrato?processoId= — EXTRATO como PROJEÇÃO DO LEDGER.
// Somente leitura: movimentos reais do razão (LedgerEntry) em ordem cronológica,
// com saldo por obrigação. Não recalcula valorContratado nem câmbio. Flag posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '@/src/app/api/financeiro/v3/_flags'
import { listarExtratoLedger } from '@/lib/financeiro/leitura/extrato-ledger'

export async function GET(req: NextRequest) {
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const processoId = Number(req.nextUrl.searchParams.get('processoId'))
  if (!processoId) return NextResponse.json({ erro: 'processoId inválido' }, { status: 400 })
  try {
    return NextResponse.json({ disponivel: true, movimentos: await listarExtratoLedger(processoId) })
  } catch (e) {
    return NextResponse.json({ disponivel: false, erro: e instanceof Error ? e.message : 'Falha ao carregar extrato.' }, { status: 500 })
  }
}
