// /api/financeiro/v3/custos/analise — F8.1: inteligência do lançamento de custo.
//   POST { processoId?, itemCatalogoId?, fornecedorId?, valor?, moeda?,
//          vencimento?, ignorarObrigacaoId? } → { avisos, sugestoes, baseHistorica }
// SOMENTE LEITURA: não grava, não bloqueia, não auto-preenche. É conselho com evidência —
// quem decide é o operador. Gated por financeiro.ver (não expõe nada além do que a lista
// de Custos já mostra).
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { analisarLancamentoCusto } from '@/lib/financeiro/inteligencia/analise-lancamento-custo'

const numOuNulo = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  try {
    const analise = await analisarLancamentoCusto({
      processoId: numOuNulo(b?.processoId),
      itemCatalogoId: numOuNulo(b?.itemCatalogoId),
      fornecedorId: numOuNulo(b?.fornecedorId),
      valor: b?.valor != null ? Number(b.valor) : null,
      moeda: typeof b?.moeda === 'string' ? b.moeda : null,
      vencimento: typeof b?.vencimento === 'string' ? b.vencimento : null,
      ignorarObrigacaoId: numOuNulo(b?.ignorarObrigacaoId),
    })
    return NextResponse.json({ ok: true, ...analise })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha na análise.' }, { status: 500 })
  }
}
