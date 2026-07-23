// /api/financeiro/v3/posicao — LEITURA da Posição Financeira (Motor V3).
//   GET ?obrigacaoId= | ?codigo=REC-105 | ?receitaId=  → posição agregada
// Flag-gated (posicaoRead). Sem flag: 409 sinalizando fallback ao legado.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { carregarPosicao } from '@/lib/financeiro/leitura/posicao-service'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ disponivel: false, fallbackLegado: true, motivo: 'Posição Financeira V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  const sp = req.nextUrl.searchParams
  const obrigacaoId = sp.get('obrigacaoId') ? Number(sp.get('obrigacaoId')) : undefined
  const receitaId = sp.get('receitaId') ? Number(sp.get('receitaId')) : undefined
  const codigo = sp.get('codigo') ?? undefined
  if (!obrigacaoId && !receitaId && !codigo) return NextResponse.json({ erro: 'Informe obrigacaoId, codigo ou receitaId.' }, { status: 400 })

  const posicao = await carregarPosicao({ obrigacaoId, receitaId, codigo })
  if (!posicao) return NextResponse.json({ disponivel: false, fallbackLegado: true, motivo: 'Obrigação ainda não espelhada no Motor V3.' }, { status: 404 })
  return NextResponse.json({ disponivel: true, posicao })
}
