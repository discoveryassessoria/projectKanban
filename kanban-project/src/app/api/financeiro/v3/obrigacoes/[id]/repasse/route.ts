// /api/financeiro/v3/obrigacoes/[id]/repasse — F5: vínculo de Repasse/Reembolso do custo
//   GET  → repasses do custo.
//   POST { tipo, valor, percentual?, receitaObrigacaoId?, cobrancaId?, pagadorPessoaId?, motivo? }
//        → registra o vínculo (nunca converte custo em receita). Gated por posicaoRead.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { registrarRepasse, repassesDoCusto } from '@/lib/financeiro/pagavel/repasse'
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
  return NextResponse.json({ ok: true, repasses: await repassesDoCusto(id) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await guard(req); if (b) return b
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, erro: 'id inválido.' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await registrarRepasse(id, {
      tipo: String(body?.tipo ?? '').toUpperCase() as 'REPASSE' | 'REEMBOLSO', valor: Number(body?.valor),
      percentual: body?.percentual != null ? Number(body.percentual) : null,
      receitaObrigacaoId: body?.receitaObrigacaoId != null ? Number(body.receitaObrigacaoId) : null,
      cobrancaId: body?.cobrancaId != null ? Number(body.cobrancaId) : null,
      pagadorPessoaId: body?.pagadorPessoaId != null ? Number(body.pagadorPessoaId) : null,
      motivo: body?.motivo ?? null,
    }, { usuarioId: actor?.userId ?? null })
    return NextResponse.json({ ok: true, ...r, repasses: await repassesDoCusto(id) })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao registrar repasse.' }, { status: 422 })
  }
}
