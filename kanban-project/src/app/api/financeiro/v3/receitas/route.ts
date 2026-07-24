// /api/financeiro/v3/receitas — aba Receitas (KPIs + tabela) do Financeiro V3.
//   GET  — lista/KPIs (motor V3)
//   POST — lançamento MANUAL de Receita a partir de um item do Catálogo Mestre.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'
import { criarLancamentoManual } from '@/lib/financeiro/extras/lancamento-manual'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { usuarioFlag } from '../_flags'

const MOEDAS = new Set(['BRL', 'EUR', 'USD'])

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) return NextResponse.json({ disponivel: false, fallbackLegado: true }, { status: 409 })
  const processoId = req.nextUrl.searchParams.get("processoId"); return NextResponse.json({ disponivel: true, ...(await listarReceitas(processoId ? Number(processoId) : undefined)) })
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }
  const b = await req.json().catch(() => ({}))
  const processoId = b?.processoId != null ? Number(b.processoId) : null
  const itemCatalogoId = b?.itemCatalogoId != null ? Number(b.itemCatalogoId) : null
  const valorUnitario = Number(b?.valorUnitario ?? b?.valor)
  const moeda = MOEDAS.has(b?.moeda) ? b.moeda : 'BRL'

  if (!processoId) return NextResponse.json({ ok: false, erro: 'processoId é obrigatório.' }, { status: 400 })
  if (!itemCatalogoId) return NextResponse.json({ ok: false, erro: 'Selecione um item do Catálogo Mestre.' }, { status: 400 })
  if (!isFinite(valorUnitario) || valorUnitario <= 0) return NextResponse.json({ ok: false, erro: 'Informe um valor maior que zero.' }, { status: 400 })

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await criarLancamentoManual({
      natureza: 'RECEITA',
      processoId, itemCatalogoId,
      descricao: b?.descricao ?? null,
      quantidade: b?.quantidade != null ? Number(b.quantidade) : 1,
      valorUnitario, moeda,
      desconto: b?.desconto != null ? Number(b.desconto) : 0,
      vencimento: b?.vencimento ? new Date(b.vencimento) : null,
      formaCobranca: b?.formaCobranca ?? null,
      faseLabel: b?.faseLabel ?? null,
      rateio: b?.rateio ?? null,
      pagamento: b?.registrarPagamento ? { observacao: 'Pagamento no lançamento manual de receita' } : null,
      criadoPorId: actor?.userId ?? null,
    })
    await registrarAuditoria(req, { acao: 'CRIAR', entidade: 'ReceitaManual', entidadeId: r.obrigacaoId, descricao: `Receita manual lançada (${r.moeda} ${r.total})`, detalhes: { processoId, itemCatalogoId, total: r.total, moeda: r.moeda } })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao criar a receita.' }, { status: 422 })
  }
}
