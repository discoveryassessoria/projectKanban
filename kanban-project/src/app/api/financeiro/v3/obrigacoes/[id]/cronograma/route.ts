// /api/financeiro/v3/obrigacoes/[id]/cronograma — F5: cronograma de PAGÁVEIS (ParcelaPagavel).
//   GET  → parcelas com status derivado do Ledger.
//   POST { parcelas: [{ numero?, vencimento, valor }] } → define o cronograma (idempotente,
//         valida soma = valorContratado; saldo segue no Ledger). Gated por posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { definirCronogramaPagavel, parcelasPagaveisComStatus } from '@/lib/financeiro/pagavel/cronograma-pagavel'
import { verificarPermissaoCustoDaObrigacao } from '@/lib/financeiro/permissoes-custo'
import { usuarioFlag } from '../../../_flags'

async function guard(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado.' }, { status: 409 })
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await guard(req); if (b) return b
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, erro: 'id inválido.' }, { status: 400 })
  return NextResponse.json({ ok: true, parcelas: await parcelasPagaveisComStatus(id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await guard(req); if (b) return b
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, erro: 'id inválido.' }, { status: 400 })
  // F6 — segregação: definir cronograma de pagáveis exige financeiro.custo_editar.
  const gCusto = await verificarPermissaoCustoDaObrigacao(req, 'editar', id); if (gCusto) return gCusto
  const body = await req.json().catch(() => ({}))
  const parcelas = Array.isArray(body?.parcelas) ? body.parcelas.map((p: any) => ({ numero: p.numero != null ? Number(p.numero) : undefined, vencimento: String(p.vencimento), valor: Number(p.valor) })) : []
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await definirCronogramaPagavel(id, parcelas, { usuarioId: actor?.userId ?? null })
    return NextResponse.json({ ok: true, ...r, parcelas: await parcelasPagaveisComStatus(id) })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao definir cronograma.' }, { status: 422 })
  }
}
