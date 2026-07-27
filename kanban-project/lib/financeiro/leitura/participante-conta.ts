// lib/financeiro/leitura/participante-conta.ts
// ============================================================================
// CONTA FINANCEIRA INDIVIDUAL DO PARTICIPANTE (Motor Financeiro V3 · leitura).
// O "participante financeiro" É uma ObrigacaoEconomica (obrigação-filha por
// participação): 1 obrigação por requerente. Esta visão consolida, PARA ESSA
// obrigação, tudo o que o participante deve/pagou — resumo (câmbio/aging via
// Ledger), parcelas, cobranças, pagamentos/estornos, documentos e histórico.
//
// FONTE ÚNICA: reusa carregarReceitaDetalhe (que já deriva câmbio/aging/parcelas/
// cobranças/documentos/histórico do Ledger + computeCambioAging). NÃO recomputa
// câmbio próprio. A única leitura extra é a das ocorrências para incluir ESTORNO
// no bloco de pagamentos (o detalhe expõe só PAGAMENTO) — mapeada pelo MESMO
// helper mapearPagamentos (sem duplicar o formato).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarReceitaDetalhe, mapearPagamentos, type ReceitaDetalhe } from './receita-detalhe'

export interface ContaParticipante {
  obrigacaoId: number
  pessoaId: number | null
  nome: string
  papel: string
  resumo: {
    valorContratadoBrl: number
    recebidoBrl: number
    saldoBrl: number
    aVencerBrl: number
    vencidoBrl: number
    statusAging: string
    cotacao: number | null
    moeda: string
    valorBase: number
  }
  parcelas: ReceitaDetalhe['parcelasDetalhe']
  cobrancas: ReceitaDetalhe['cobrancas']
  pagamentos: ReceitaDetalhe['pagamentos']
  documentos: ReceitaDetalhe['documentos']
  observacoes: string | null
  historico: ReceitaDetalhe['historico']
}

export async function carregarContaParticipante(obrigacaoIdParticipante: number): Promise<ContaParticipante | null> {
  const detalhe = await carregarReceitaDetalhe(String(obrigacaoIdParticipante))
  if (!detalhe) return null
  const obrigacaoId = detalhe.obrigacaoId

  // Pagamentos do participante — inclui ESTORNO (o detalhe expõe só PAGAMENTO).
  // Uma leitura enxuta, indexada por obrigacaoId; sem N+1.
  const ocs = await prisma.ocorrenciaFinanceira.findMany({
    where: { obrigacaoId, tipo: { in: ['PAGAMENTO', 'PAGAMENTO_PARCIAL', 'ESTORNO'] } },
    orderBy: { data: 'asc' },
    select: { id: true, tipo: true, data: true, valor: true, formaLabel: true, contaBanco: true, contaAgencia: true, contaNumero: true, referencia: true, status: true },
  }).catch(() => [])
  const pagamentos = mapearPagamentos(ocs, ['PAGAMENTO', 'PAGAMENTO_PARCIAL', 'ESTORNO'])

  return {
    obrigacaoId,
    pessoaId: detalhe.responsaveis[0]?.id ?? null,
    nome: detalhe.responsavel?.nome ?? detalhe.responsaveis[0]?.nome ?? 'Não identificado',
    papel: detalhe.responsavel?.papel ?? 'Participante',
    resumo: {
      valorContratadoBrl: detalhe.valorContratadoBrl,
      recebidoBrl: detalhe.recebidoBrl,
      saldoBrl: detalhe.saldoBrl,
      aVencerBrl: detalhe.aVencerBrl,
      vencidoBrl: detalhe.vencidoBrl,
      statusAging: detalhe.statusLabel,
      cotacao: detalhe.cotacaoAplicada,
      moeda: detalhe.moeda,
      valorBase: detalhe.valorBase,
    },
    parcelas: detalhe.parcelasDetalhe,
    cobrancas: detalhe.cobrancas,
    pagamentos,
    documentos: detalhe.documentos,
    observacoes: detalhe.observacao,
    historico: detalhe.historico,
  }
}
