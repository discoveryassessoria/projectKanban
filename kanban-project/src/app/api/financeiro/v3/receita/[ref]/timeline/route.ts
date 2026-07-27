// GET /api/financeiro/v3/receita/[ref]/timeline?escopo=geral
// Timeline GERAL (de NEGÓCIO) da Receita consolidada: criação, edição,
// redistribuição, cancelamento, arquivamento. SEM eventos individuais de
// pagamento. Só leitura. Gate: financeiro.ver + flag posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { timelineGeralReceita } from '@/lib/financeiro/leitura/timeline-financeira'
import { usuarioFlag } from '../../../_flags'

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const ref = (await params).ref
  const escopo = req.nextUrl.searchParams.get('escopo') ?? 'geral'
  if (escopo !== 'geral') return NextResponse.json({ erro: "escopo inválido — use 'geral' (individual: /participante/[obrigacaoId]/timeline)" }, { status: 400 })
  return NextResponse.json({ disponivel: true, escopo: 'geral', eventos: await timelineGeralReceita(ref) })
}
