// POST /api/financeiro/v3/receita/[ref]/registrar-pagamento
// Recebimento rico (tela "Registrar Pagamento"): N formas + ajustes + pagador +
// aplicação + tratamento de saldo/excedente + comprovantes. Orquestra o motor V3
// (registrarOcorrencia) — não o substitui. Flag-gated (posicaoRead), aditivo.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { usuarioFlag } from '../../../_flags'
import { resolverId } from '@/lib/financeiro/leitura/receita-detalhe'
import { registrarPagamentoComposto } from '@/lib/financeiro/pagamentos/registrar-pagamento-composto'

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  const u = await usuarioFlag(req)
  if (!flagAtiva('ocorrencias', u) && !flagAtiva('posicaoRead', u)) {
    return NextResponse.json({ ok: false, erro: 'Recebimento V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const { ref } = await params
  const b = await req.json().catch(() => ({} as Record<string, unknown>))

  let obrigacaoId = Number(b?.obrigacaoId)
  if (!obrigacaoId || Number.isNaN(obrigacaoId)) {
    const rid = await resolverId(ref)
    if (!rid) return NextResponse.json({ ok: false, erro: 'Cobrança/obrigação não encontrada.' }, { status: 404 })
    obrigacaoId = rid
  }

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await registrarPagamentoComposto({
      obrigacaoId,
      moeda: b?.moeda ?? null,
      formas: Array.isArray(b?.formas) ? b.formas : [],
      pagador: b?.pagador ?? null,
      ajustes: b?.ajustes ?? null,
      aplicacao: b?.aplicacao ?? null,
      excedenteTratamento: b?.excedenteTratamento ?? null,
      parcialTratamento: b?.parcialTratamento ?? null,
      comprovantes: Array.isArray(b?.comprovantes) ? b.comprovantes : [],
      observacao: b?.observacao ?? null,
      saldoSelecionado: b?.saldoSelecionado ?? null,
      totais: b?.totais ?? null,
      criadoPorId: actor?.userId ?? null,
    })
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.erros[0] ?? 'Falha na validação.', erros: r.erros }, { status: 422 })
    return NextResponse.json({ ...r, ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao registrar pagamento.' }, { status: 422 })
  }
}
