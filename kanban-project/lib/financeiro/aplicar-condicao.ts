// lib/financeiro/aplicar-condicao.ts
// ============================================================================
// APLICAÇÃO DA CONDIÇÃO DE PAGAMENTO NO LANÇAMENTO — ponto único.
//
// Junta os três motores puros e devolve, pronto para persistir:
//   • cronograma  → lib/financeiro/condicao-pagamento.ts
//   • taxas       → lib/financeiro/taxas-pagamento.ts
//   • encargos    → lib/financeiro/encargos-financeiros.ts
//
// O FinanceRuleEngine (executor.ts e matriz-economica.ts) chama SÓ isto — não
// conhece parcelamento, taxa nem encargo. Sem condição vinculada, devolve o
// comportamento histórico (1 parcela na data base, sem taxa).
//
// Tudo o que sai daqui é CONGELADO no lançamento: alterar a condição ou a taxa
// depois nunca recalcula lançamentos antigos.
// ============================================================================

import { gerarCronograma, type Cronograma } from './condicao-pagamento'
import { calcularTaxas, type ResultadoTaxas } from './taxas-pagamento'
import { calcularEncargos, type ResultadoEncargos } from './encargos-financeiros'
import { condicaoDaConfig, rotuloPeriodicidade } from './resolver-condicao'

export interface EntradaAplicacao {
  configId: number | null | undefined
  natureza: 'RECEITA' | 'CUSTO'
  moeda: string
  /** Total contratado calculado pelo motor de preço. Invariante. */
  valor: number
  dataBase: Date
  pais?: string | null
  modalidade?: string | null
  tipoProcesso?: string | null
}

export interface ParcelaParaCriar {
  numero: number
  vencimento: Date
  valor: number
  status: 'PENDENTE'
  entrada: boolean
  valorTaxa: number | null
  valorLiquido: number | null
}

export interface AplicacaoCondicao {
  /** Campos prontos para o `data` do create de Receita/Custo. */
  campos: {
    nParcelas: number
    periodicidade: string
    condicaoPagamentoId: number | null
    condicaoVersao: number | null
    condicaoCodigo: string | null
    valorBruto: number
    valorTaxas: number | null
    valorLiquido: number | null
    memoriaCalculo: Record<string, unknown> | null
  }
  parcelas: ParcelaParaCriar[]
  /** Primeiro vencimento — grava em Receita.data1 / Custo.vencimento. */
  data1: Date
  /** Sufixo para a descrição do evento CRIACAO. */
  resumo: string
  cronograma: Cronograma
  taxas: ResultadoTaxas | null
  encargos: ResultadoEncargos | null
}

/**
 * Resolve a condição, gera o cronograma, calcula taxas e encargos de geração,
 * e devolve tudo pronto para persistir.
 */
export async function aplicarCondicaoPagamento(e: EntradaAplicacao): Promise<AplicacaoCondicao> {
  const { condicao, taxas: taxasVinculadas } = await condicaoDaConfig(e.configId, {
    natureza: e.natureza,
    moeda: e.moeda,
    total: e.valor,
    pais: e.pais ?? null,
    modalidade: e.modalidade ?? null,
    tipoProcesso: e.tipoProcesso ?? null,
    emDatas: e.dataBase,
  })

  const cronograma = gerarCronograma(condicao, { total: e.valor, dataBase: e.dataBase })

  // Taxas: só quando há condição com taxas vinculadas.
  const taxas =
    condicao && taxasVinculadas.length > 0
      ? calcularTaxas(taxasVinculadas, {
          valorBruto: e.valor,
          nParcelas: cronograma.nParcelas,
          moeda: e.moeda,
          emDatas: e.dataBase,
        })
      : null

  // Encargos de GERAÇÃO (descontos à vista/comercial). Não alteram o valor
  // contratado — ficam registrados na memória para uso na cobrança.
  const encargos = condicao
    ? calcularEncargos({
        regras: condicao,
        base: e.valor,
        momento: 'GERACAO',
        nParcelas: cronograma.nParcelas,
        dataEvento: e.dataBase,
      })
    : null

  // Rateio da taxa absorvida entre as parcelas, proporcional ao valor.
  const totalTaxa = taxas?.valorTaxas ?? 0
  const parcelas: ParcelaParaCriar[] = cronograma.parcelas.map((p, i, arr) => {
    let valorTaxa: number | null = null
    if (totalTaxa > 0 && e.valor > 0) {
      const bruto = Math.round(((p.valor / e.valor) * totalTaxa) * 100) / 100
      // A última parcela absorve o resto do rateio: a soma fecha o total exato.
      valorTaxa =
        i === arr.length - 1
          ? Math.round((totalTaxa - arr.slice(0, -1).reduce((s, x) => s + Math.round(((x.valor / e.valor) * totalTaxa) * 100) / 100, 0)) * 100) / 100
          : bruto
    }
    return {
      numero: p.numero,
      vencimento: p.vencimento,
      valor: p.valor,
      status: 'PENDENTE' as const,
      entrada: p.entrada,
      valorTaxa,
      valorLiquido: valorTaxa == null ? null : Math.round((p.valor - valorTaxa) * 100) / 100,
    }
  })

  const memoriaCalculo =
    condicao || taxas || encargos
      ? {
          condicao: condicao
            ? { id: condicao.id ?? null, codigo: condicao.codigo ?? null, nome: condicao.nome ?? null, versao: condicao.versao ?? 1 }
            : null,
          cronograma: {
            nParcelas: cronograma.nParcelas,
            periodicidade: cronograma.periodicidade,
            valorEntrada: cronograma.valorEntrada,
            primeiroVencimento: cronograma.data1.toISOString().slice(0, 10),
            observacoes: cronograma.observacoes,
          },
          taxas: taxas ? { linhas: taxas.linhas, memoria: taxas.memoria } : null,
          encargos: encargos ? { linhas: encargos.linhas, memoria: encargos.memoria } : null,
          geradoEm: e.dataBase.toISOString(),
        }
      : null

  const resumo = condicao
    ? ` (condição ${condicao.codigo ?? condicao.nome ?? condicao.id}${condicao.versao ? ` v${condicao.versao}` : ''}, ${cronograma.nParcelas}x${totalTaxa > 0 ? `, taxas ${totalTaxa.toFixed(2)}` : ''})`
    : ''

  return {
    campos: {
      nParcelas: cronograma.nParcelas,
      periodicidade: rotuloPeriodicidade(cronograma.periodicidade),
      condicaoPagamentoId: condicao?.id ?? null,
      condicaoVersao: condicao?.versao ?? null,
      condicaoCodigo: condicao?.codigo ?? null,
      valorBruto: e.valor,
      valorTaxas: taxas ? taxas.valorTaxas : null,
      valorLiquido: taxas ? taxas.valorLiquido : null,
      memoriaCalculo,
    },
    parcelas,
    data1: cronograma.data1,
    resumo,
    cronograma,
    taxas,
    encargos,
  }
}
