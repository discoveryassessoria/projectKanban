// /api/financeiro/v3/contas-a-pagar — F5: dashboard/relatório de Contas a Pagar.
//   GET ?processoId&fornecedor&moeda&origem → baldes/KPIs/agrupamentos (read-model V3).
// Reusa listarContasAPagar (não cria fonte nova). Gated por financeiro.ver + posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { listarContasAPagar } from '@/lib/financeiro/leitura/contas-a-pagar'
import { riscosContasAPagar } from '@/lib/financeiro/inteligencia/riscos-custo'
import { usuarioFlag } from '../_flags'

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado.' }, { status: 409 })
  const sp = req.nextUrl.searchParams
  const processoId = sp.get('processoId') ? Number(sp.get('processoId')) : undefined
  try {
    const filtro = { processoId, fornecedor: sp.get('fornecedor') || undefined, moeda: sp.get('moeda') || undefined, origem: sp.get('origem') || undefined }
    // F8.2 — riscos/pendências derivam do MESMO read-model: nenhum número diverge da lista.
    const [r, riscos] = await Promise.all([listarContasAPagar(filtro), riscosContasAPagar(filtro)])
    return NextResponse.json({ ok: true, ...r, ...riscos })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao carregar Contas a Pagar.' }, { status: 500 })
  }
}
