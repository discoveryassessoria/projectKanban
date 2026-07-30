// /api/financeiro/v3/custos — lançamento MANUAL de Custo (Motor Financeiro V3).
//   POST { processoId, itemCatalogoId, descricao?, quantidade?, valorUnitario,
//          moeda?, desconto?, acrescimo?, vencimento?, formaCobranca?,
//          fornecedorId?, faseLabel?, rateio?, registrarPagamento?, parcelas? }
// `parcelas` (aditivo): cronograma de pagáveis definido no MESMO request da
// criação — o parcelamento faz parte do ato de lançar o custo, não de um segundo
// passo que o operador pode esquecer. Reusa definirCronogramaPagavel (idempotente,
// valida soma = valor da obrigação). Falha no cronograma NÃO desfaz a obrigação:
// ela é o fato econômico; o cronograma é plano e volta como `cronogramaErro`.
// Cria uma ObrigacaoEconomica de natureza CUSTO (A_PAGAR) a partir de um item já
// cadastrado no Catálogo Mestre (Gerenciamento). Reusa o motor V3
// (criarLancamentoManual → criarLancamentoExtra). Gated pela mesma flag de
// leitura (posicaoRead) que já alimenta a lista de Custos. Auditoria registrada.
import { NextRequest, NextResponse } from 'next/server'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { flagAtiva } from '@/lib/financeiro/flags'
import { criarLancamentoManual } from '@/lib/financeiro/extras/lancamento-manual'
import { definirCronogramaPagavel } from '@/lib/financeiro/pagavel/cronograma-pagavel'
import { registrarAuditoria } from '@/lib/gerenciamento/auditoria'
import { usuarioFlag } from '../_flags'
import { verificarPermissaoCusto } from '@/lib/financeiro/permissoes-custo'

const MOEDAS = new Set(['BRL', 'EUR', 'USD'])

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, 'financeiro.ver'); if (erro) return erro
  if (!flagAtiva('posicaoRead', await usuarioFlag(req))) {
    return NextResponse.json({ ok: false, motivo: 'Financeiro V3 não habilitado neste ambiente/usuário.' }, { status: 409 })
  }

  const b = await req.json().catch(() => ({}))
  // F6 — segregação: criar custo exige financeiro.custo_criar (retrocompat via financeiro.ver).
  if (String(b?.natureza ?? 'CUSTO').toUpperCase() === 'CUSTO') { const g = await verificarPermissaoCusto(req, 'criar'); if (g) return g }
  const processoId = b?.processoId != null ? Number(b.processoId) : null
  const itemCatalogoId = b?.itemCatalogoId != null ? Number(b.itemCatalogoId) : null
  // Retrocompat: aceita `valor` (versão antiga do modal) como valorUnitário.
  const valorUnitario = Number(b?.valorUnitario ?? b?.valor)
  const moeda = MOEDAS.has(b?.moeda) ? b.moeda : 'BRL'

  if (!processoId) return NextResponse.json({ ok: false, erro: 'processoId é obrigatório.' }, { status: 400 })
  if (!itemCatalogoId) return NextResponse.json({ ok: false, erro: 'Selecione um item do Catálogo de Serviços.' }, { status: 400 })
  if (!isFinite(valorUnitario) || valorUnitario <= 0) return NextResponse.json({ ok: false, erro: 'Informe um valor maior que zero.' }, { status: 400 })

  const actor = await extrairUsuarioComPermissoes(req)
  try {
    const r = await criarLancamentoManual({
      natureza: 'CUSTO',
      processoId, itemCatalogoId,
      descricao: b?.descricao ?? null,
      quantidade: b?.quantidade != null ? Number(b.quantidade) : 1,
      valorUnitario, moeda,
      desconto: b?.desconto != null ? Number(b.desconto) : 0,
      acrescimo: b?.acrescimo != null ? Number(b.acrescimo) : 0,
      vencimento: b?.vencimento ? new Date(b.vencimento) : null,
      formaCobranca: b?.formaCobranca ?? null,
      fornecedorId: b?.fornecedorId != null ? Number(b.fornecedorId) : null,
      centroCustoId: b?.centroCustoId != null ? Number(b.centroCustoId) : null,
      faseLabel: b?.faseLabel ?? null,
      rateio: b?.rateio ?? null,
      pagamento: b?.registrarPagamento ? { observacao: 'Pagamento no lançamento manual de custo' } : null,
      criadoPorId: actor?.userId ?? null,
    })
    // Cronograma de pagáveis, quando o lançamento nasce parcelado.
    let cronograma: { criadas: number } | null = null
    let cronogramaErro: string | null = null
    const parcelas = Array.isArray(b?.parcelas)
      ? b.parcelas.map((p: any, i: number) => ({ numero: p?.numero != null ? Number(p.numero) : i + 1, vencimento: String(p?.vencimento), valor: Number(p?.valor) }))
      : []
    if (parcelas.length > 1) {
      try {
        const c = await definirCronogramaPagavel(r.obrigacaoId, parcelas, { usuarioId: actor?.userId ?? null })
        cronograma = { criadas: c.criadas }
      } catch (e) {
        cronogramaErro = e instanceof Error ? e.message : 'Falha ao definir o cronograma.'
      }
    }
    await registrarAuditoria(req, { acao: 'CRIAR', entidade: 'CustoManual', entidadeId: r.obrigacaoId, descricao: `Custo manual lançado (${r.moeda} ${r.total})`, detalhes: { processoId, itemCatalogoId, total: r.total, moeda: r.moeda } })
    return NextResponse.json({ ok: true, ...r, cronograma, cronogramaErro })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : 'Falha ao criar o custo.' }, { status: 422 })
  }
}
