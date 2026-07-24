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
    const [formasPagamento, carteiras, contas] = await Promise.all([
      prisma.formaPagamentoCadastro.findMany({
        where: { ativo: true },
        orderBy: [{ ordem: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, type: true, icone: true, categoria: true, usoRecebimento: true, moeda: true },
      }),
      prisma.carteiraRecebimento.findMany({ where: { ativo: true }, orderBy: [{ isDefault: 'desc' }, { nome: 'asc' }], select: { id: true, nome: true, moeda: true } }),
      prisma.contaBancaria.findMany({ where: { ativo: true }, orderBy: [{ principal: 'desc' }, { nome: 'asc' }], select: { id: true, nome: true, banco: true, agencia: true, conta: true, moeda: true, principal: true, isDefaultReceiving: true } }),
    ])
    // formas úteis ao RECEBIMENTO primeiro (usoRecebimento != false)
    const formas = formasPagamento.filter((f) => f.usoRecebimento !== false)
    return NextResponse.json({ formasPagamento: formas.length ? formas : formasPagamento, carteiras, contas })
  } catch (e) {
    console.error('cadastros-pagamento GET', e)
    return NextResponse.json({ formasPagamento: [], carteiras: [], contas: [] })
  }
}
