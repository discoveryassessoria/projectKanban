// POST /api/financeiro/cobrancas/simular — SIMULAÇÃO de Cobrança (não persiste).
// Recebe os IDs da cobrança em rascunho, roda o ChargeCalculationService no
// backend (autoridade) e devolve a memória de cálculo completa. A UI usa antes
// de confirmar; a confirmação recalcula de novo, sem confiar no número do cliente.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { montarECalcular } from '@/lib/financeiro/charge-runtime'

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const b = await req.json().catch(() => ({}))
  if (!b.receitaId) return NextResponse.json({ error: 'Informe a receita' }, { status: 400 })

  const out = await montarECalcular({
    receitaId: Number(b.receitaId),
    formaPagamentoId: b.formaPagamentoId ? Number(b.formaPagamentoId) : null,
    condicaoPagamentoId: b.condicaoPagamentoId ? Number(b.condicaoPagamentoId) : null,
    carteiraId: b.carteiraId ? Number(b.carteiraId) : null,
    contaBancariaId: b.contaBancariaId ? Number(b.contaBancariaId) : null,
    nParcelas: b.nParcelas != null ? Number(b.nParcelas) : null,
    bandeiraId: b.bandeiraId ? Number(b.bandeiraId) : null,
    entradaValor: b.entradaValor != null ? Number(b.entradaValor) : null,
    politicaTaxasEscolhida: b.politicaTaxasEscolhida ?? null,
    congelar: false,
  })
  if ('erro' in out) return NextResponse.json({ error: out.erro }, { status: out.status })
  return NextResponse.json({ simulacao: out.resultado })
}
