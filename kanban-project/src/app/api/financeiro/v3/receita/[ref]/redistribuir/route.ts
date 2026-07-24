// /api/financeiro/v3/receita/[ref]/redistribuir
//   GET  → estado editável da distribuição (participantes + disponíveis + total)
//   POST → aplica a nova distribuição (aditivo; total invariante; nunca abaixo do recebido)
// Flag-gated (posicaoRead). Não apaga Receita/pagamento.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { carregarDistribuicaoEditavel, redistribuir } from '@/lib/financeiro/distribuicao/redistribuir-service'

async function guard(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, erro: 'Distribuição V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  try {
    const estado = await carregarDistribuicaoEditavel(ref)
    if (!estado) return NextResponse.json({ ok: false, erro: 'Distribuição não encontrada.' }, { status: 404 })
    return NextResponse.json({ ok: true, distribuicao: estado })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao carregar distribuição.' }, { status: 422 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  if (!Array.isArray(b?.participantes)) return NextResponse.json({ ok: false, erro: 'participantes é obrigatório.' }, { status: 400 })
  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await redistribuir({
      ref,
      metodo: typeof b?.metodo === 'string' ? b.metodo : undefined,
      estrategia: b?.estrategia ?? undefined,
      participantes: b.participantes,
      motivo: b?.motivo ?? null,
      criadoPorId: actor?.userId ?? null,
    })
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.erros[0] ?? 'Falha na validação.', erros: r.erros }, { status: 422 })
    return NextResponse.json({ ...r, ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao redistribuir.' }, { status: 422 })
  }
}
