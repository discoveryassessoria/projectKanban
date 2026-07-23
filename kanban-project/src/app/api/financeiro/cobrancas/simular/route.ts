// POST /api/financeiro/cobrancas/simular — SIMULAÇÃO de Cobrança (não persiste).
// Recebe os IDs da cobrança em rascunho, roda o ChargeCalculationService no
// backend (autoridade) e devolve a memória de cálculo completa. A UI usa antes
// de confirmar; a confirmação recalcula de novo, sem confiar no número do cliente.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { temPermissao } from '@/src/lib/permissoes'
import { montarECalcular } from '@/lib/financeiro/charge-runtime'

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const b = await req.json().catch(() => ({}))
  if (!b.receitaId) return NextResponse.json({ error: 'Informe a receita' }, { status: 400 })

  const usuario = await extrairUsuarioComPermissoes(req)
  const autorizadoManual = !!usuario && (usuario.tipo === 'admin' || temPermissao(usuario.permissoes, 'financeiro.custos_editar'))

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
    moedaRecebimento: b.moedaRecebimento ?? null,
    cotacaoManual: b.cotacaoManual != null ? Number(b.cotacaoManual) : null,
    autorizadoManual,
    fonteCotacao: b.fonteCotacao ?? null,
    dataCotacao: b.dataCotacao ?? null,
    justificativaCotacaoManual: b.justificativaCotacaoManual ?? null,
    usuarioId: usuario?.userId ?? null,
    congelar: false,
  })
  if ('erro' in out) return NextResponse.json({ error: out.erro }, { status: out.status })
  // devolve também a cotação resolvida (estado/tipo/fonte) para a UI de Recebimento.
  return NextResponse.json({ simulacao: out.resultado, cambio: out.cambio })
}
