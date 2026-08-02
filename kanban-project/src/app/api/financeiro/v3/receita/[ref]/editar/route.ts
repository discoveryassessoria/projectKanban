// /api/financeiro/v3/receita/[ref]/editar
//   GET                → estado editável da Receita (textuais + valor-base + câmbio + flags)
//   POST ?preview=1    → prévia de impacto de um patch (não grava)
//   PATCH (ou POST)    → aplica a edição (transacional, auditável, nunca reescreve pagamento)
// Flag-gated (posicaoRead|ocorrencias). Fluxo DISTINTO de "Editar distribuição".
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { carregarReceitaEditavel, previaImpactoEdicao, editarReceita, type EditarReceitaPatch } from '@/lib/financeiro/acoes/editar-receita'
import { verificarPermissaoCustoPorRef } from '@/lib/financeiro/permissoes-custo'

async function guard(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, erro: 'Edição de Receita V3 não habilitada neste ambiente/usuário.' }, { status: 409 })
  }
  return null
}

function extrairPatch(b: Record<string, unknown>): EditarReceitaPatch {
  const p = (b?.patch && typeof b.patch === 'object' ? b.patch : b) as Record<string, unknown>
  return {
    titulo: p.titulo as string | null | undefined,
    descricaoDetalhada: p.descricaoDetalhada as string | null | undefined,
    referenciaContratual: p.referenciaContratual as string | null | undefined,
    tipoServicoId: p.tipoServicoId === undefined ? undefined : (p.tipoServicoId == null ? null : Number(p.tipoServicoId)),
    origem: p.origem as string | null | undefined,
    observacoes: p.observacoes as string | null | undefined,
    moeda: p.moeda as string | null | undefined,
    valorBaseTotal: p.valorBaseTotal === undefined ? undefined : (p.valorBaseTotal == null ? null : Number(p.valorBaseTotal)),
    cambio: (p.cambio ?? undefined) as EditarReceitaPatch['cambio'],
    responsavelId: p.responsavelId === undefined ? undefined : (p.responsavelId == null ? null : Number(p.responsavelId)),
    vencimento: p.vencimento === undefined ? undefined : (p.vencimento as string | null),
    fornecedorId: p.fornecedorId === undefined ? undefined : (p.fornecedorId == null ? null : Number(p.fornecedorId)),
    faseId: p.faseId === undefined ? undefined : (p.faseId == null ? null : Number(p.faseId)),
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  try {
    const estado = await carregarReceitaEditavel(ref)
    if (!estado) return NextResponse.json({ ok: false, erro: 'Receita não encontrada.' }, { status: 404 })
    return NextResponse.json({ ok: true, receita: estado })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao carregar a Receita.' }, { status: 422 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  const isPreview = req.nextUrl.searchParams.get('preview') === '1'
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  const patch = extrairPatch(b)
  if (isPreview) {
    try {
      const prev = await previaImpactoEdicao(ref, patch)
      if (!prev) return NextResponse.json({ ok: false, erro: 'Receita não encontrada.' }, { status: 404 })
      return NextResponse.json({ ok: true, previa: prev })
    } catch (e) {
      return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao calcular a prévia.' }, { status: 422 })
    }
  }
  return aplicar(req, ref, b, patch)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const bloqueio = await guard(req); if (bloqueio) return bloqueio
  const { ref } = await params
  const b = await req.json().catch(() => ({} as Record<string, unknown>))
  return aplicar(req, ref, b, extrairPatch(b))
}

async function aplicar(req: NextRequest, ref: string, b: Record<string, unknown>, patch: EditarReceitaPatch) {
  // F6 — segregação: se a obrigação é custo (A_PAGAR), editar exige financeiro.custo_editar.
  const gCusto = await verificarPermissaoCustoPorRef(req, 'editar', ref); if (gCusto) return gCusto
  const actor = await extrairUsuarioComPermissoes(req)
  const estrategia = b?.estrategia === 'AJUSTE_COMPENSATORIO' ? 'AJUSTE_COMPENSATORIO' : 'ATUALIZAR_ABERTAS'
  try {
    const r = await editarReceita(ref, patch, {
      estrategia,
      justificativa: typeof b?.justificativa === 'string' ? b.justificativa : null,
      criadoPorId: actor?.userId ?? null,
    })
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.erros[0] ?? 'Falha na validação.', erros: r.erros }, { status: 422 })
    return NextResponse.json({ ...r, ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao editar a Receita.' }, { status: 422 })
  }
}
