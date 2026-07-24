// /api/financeiro/cadastros-pagamento — seletores da tela de recebimento (Registrar
// Pagamento). Espelha o GET de gerenciamento/formas-pagamento, porém sob a permissão
// 'financeiro.ver' (o operador financeiro não tem 'usuarios.gerenciar'). Somente leitura.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'financeiro.ver')
  if (erro) return erro
  try {
    const [formasPagamento, carteiras, contas, adquirentes, bandeiras, taxasRaw] = await Promise.all([
      prisma.formaPagamentoCadastro.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, type: true, icone: true, categoria: true, usoRecebimento: true, moeda: true, exigeAdquirente: true, permiteParcelas: true, minParcelas: true, maxParcelas: true },
      }),
      prisma.carteiraRecebimento.findMany({ where: { ativo: true }, orderBy: [{ isDefault: 'desc' }, { nome: 'asc' }], select: { id: true, nome: true, moeda: true } }),
      prisma.contaBancaria.findMany({ where: { ativo: true }, orderBy: [{ principal: 'desc' }, { nome: 'asc' }], select: { id: true, nome: true, banco: true, agencia: true, conta: true, moeda: true, principal: true, isDefaultReceiving: true } }),
      prisma.adquirente.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, slug: true, formasSuportadas: true } }).catch(() => [] as any[]),
      prisma.bandeira.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, slug: true, adquirentesCompativeis: true } }).catch(() => [] as any[]),
      prisma.taxaPagamento.findMany({ where: { ativo: true }, select: { id: true, name: true, formaPagamentoId: true, feeType: true, feePercent: true, fixedFee: true, baseIncidencia: true, quemAbsorve: true, adquirenteId: true, bandeiraId: true, installmentsFrom: true, installmentsTo: true, vigenciaInicio: true, vigenciaFim: true, ativo: true } }).catch(() => [] as any[]),
    ])
    // Mapeia TaxaPagamento → TaxaView (motor lib/financeiro/taxas-pagamento.ts) p/ o cálculo no cliente.
    const taxas = taxasRaw.map((t) => ({
      id: t.id, nome: t.name, formaPagamentoId: t.formaPagamentoId, adquirenteId: t.adquirenteId, bandeiraId: t.bandeiraId,
      tipo: t.feeType ?? 'PERCENTUAL', percentual: t.feePercent != null ? Number(t.feePercent) : 0, valorFixo: t.fixedFee != null ? Number(t.fixedFee) : 0,
      baseIncidencia: t.baseIncidencia ?? 'TOTAL', quemAbsorve: t.quemAbsorve ?? 'EMPRESA',
      parcelasDe: t.installmentsFrom ?? null, parcelasAte: t.installmentsTo ?? null, ativo: t.ativo,
      vigenciaInicio: t.vigenciaInicio ? t.vigenciaInicio.toISOString() : null, vigenciaFim: t.vigenciaFim ? t.vigenciaFim.toISOString() : null,
    }))
    // formas úteis ao RECEBIMENTO primeiro (usoRecebimento != false)
    const formas = formasPagamento.filter((f) => f.usoRecebimento !== false)
    return NextResponse.json({ formasPagamento: formas.length ? formas : formasPagamento, carteiras, contas, adquirentes, bandeiras, taxas })
  } catch (e) {
    console.error('cadastros-pagamento GET', e)
    return NextResponse.json({ formasPagamento: [], carteiras: [], contas: [], adquirentes: [], bandeiras: [], taxas: [] })
  }
}
