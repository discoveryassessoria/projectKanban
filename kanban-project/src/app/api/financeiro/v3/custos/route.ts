// /api/financeiro/v3/custos — lançamento MANUAL de Custo (Motor Financeiro V3).
//   POST { processoId, itemCatalogoId, descricao?, valor, moeda?, vencimento? }
// Cria uma ObrigacaoEconomica de natureza CUSTO (A_PAGAR) com Ledger próprio,
// a partir de um item já cadastrado no Catálogo Mestre (Gerenciamento). Gated
// pela mesma flag de leitura (posicaoRead) que já alimenta a lista de Custos.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { prisma } from '@/lib/prisma'
import { usuarioFlag } from '../_flags'

const MOEDAS = new Set(['BRL', 'EUR', 'USD'])

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }

  const b = await req.json().catch(() => ({}))
  const processoId = b?.processoId != null ? Number(b.processoId) : null
  const itemCatalogoId = b?.itemCatalogoId != null ? Number(b.itemCatalogoId) : null
  const valor = Number(b?.valor)
  const moeda = MOEDAS.has(b?.moeda) ? b.moeda : 'BRL'

  if (!processoId) return NextResponse.json({ ok: false, erro: 'processoId é obrigatório.' }, { status: 400 })
  if (!itemCatalogoId) return NextResponse.json({ ok: false, erro: 'Selecione um item do Catálogo Mestre.' }, { status: 400 })
  if (!isFinite(valor) || valor <= 0) return NextResponse.json({ ok: false, erro: 'Informe um valor maior que zero.' }, { status: 400 })

  // O item é a FONTE do custo: nome vira a descrição (fallback à descrição livre).
  const item = await prisma.itemCatalogo.findUnique({ where: { id: itemCatalogoId }, select: { id: true, name: true, ativo: true } })
  if (!item || !item.ativo) return NextResponse.json({ ok: false, erro: 'Item do Catálogo Mestre inválido ou inativo.' }, { status: 400 })

  const descricao = (typeof b?.descricao === 'string' && b.descricao.trim()) ? b.descricao.trim() : item.name

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await criarObrigacaoEconomicaComLedger({
      natureza: 'CUSTO',
      valorContratado: valor,
      moedaContratual: moeda,
      processoId,
      vencimento: b?.vencimento ? new Date(b.vencimento) : null,
      observacoes: descricao,
      origemTipo: 'nativo',
      origemId: null,
      criadoPorId: actor?.userId ?? null,
    })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao criar o custo.' }, { status: 422 })
  }
}
