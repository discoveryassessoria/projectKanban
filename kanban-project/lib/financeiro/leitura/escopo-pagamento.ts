// lib/financeiro/leitura/escopo-pagamento.ts
// ============================================================================
// Fonte de dados do drawer "Definir escopo do pagamento" (Registrar Pagamento).
// Lista os PARTICIPANTES e as COBRANÇAS ABERTAS da Receita consolidada — para que
// o botão GERAL nunca abra automaticamente no valor/cobrança de um participante.
// Reusa carregarReceitaConsolidada + carregarReceitaDetalhe (câmbio idêntico à UI).
// ============================================================================
import { carregarReceitaConsolidada, carregarReceitaDetalhe } from './receita-detalhe'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface CobrancaEscopo {
  chave: string
  obrigacaoId: number
  participanteNome: string
  parcelaNumero: number
  totalParcelas: number
  vencimento: string | null
  valorOriginalBrl: number
  recebidoBrl: number
  saldoBrl: number
  status: string
}
export interface ParticipanteEscopo { obrigacaoId: number; nome: string; saldoBrl: number; recebidoBrl: number; cobrancasAbertas: number }
export interface EscopoPagamento {
  ref: string
  obrigacaoIdRef: number
  codigo: string | null
  descricao: string | null
  moeda: string
  totalContratadoBrl: number
  totalRecebidoBrl: number
  totalSaldoBrl: number
  participantes: ParticipanteEscopo[]
  cobrancas: CobrancaEscopo[]
}

export async function carregarEscopoPagamento(ref: string): Promise<EscopoPagamento | null> {
  const cons = await carregarReceitaConsolidada(ref)
  if (!cons) return null
  const detalhes = await Promise.all(cons.participantes.map((p) => carregarReceitaDetalhe(String(p.obrigacaoId)).catch(() => null)))

  const cobrancas: CobrancaEscopo[] = []
  const participantes: ParticipanteEscopo[] = []
  cons.participantes.forEach((p, i) => {
    const det = detalhes[i]
    const abertas = (det?.parcelasDetalhe ?? []).filter((pc) => (pc.status ?? '').toUpperCase() !== 'PAGA' && cent(pc.saldoBrl) > 0.005)
    abertas.forEach((pc, k) =>
      cobrancas.push({
        chave: `${p.obrigacaoId}:${pc.numero}:${k}`, obrigacaoId: p.obrigacaoId, participanteNome: p.nome,
        parcelaNumero: pc.numero, totalParcelas: pc.totalParcelas, vencimento: pc.vencimento,
        valorOriginalBrl: cent(pc.valorBrl), recebidoBrl: cent(pc.recebidoBrl), saldoBrl: cent(pc.saldoBrl), status: pc.status,
      }),
    )
    // participante com saldo mas SEM parcela emitida → "cobrança" sintética representando o saldo em aberto
    if (!abertas.length && cent(p.saldoBrl) > 0.005) {
      cobrancas.push({
        chave: `${p.obrigacaoId}:saldo`, obrigacaoId: p.obrigacaoId, participanteNome: p.nome,
        parcelaNumero: 1, totalParcelas: 1, vencimento: p.proximoVencimento ?? null,
        valorOriginalBrl: cent(p.valorContratadoBrl), recebidoBrl: cent(p.recebidoBrl), saldoBrl: cent(p.saldoBrl), status: p.status,
      })
    }
    participantes.push({ obrigacaoId: p.obrigacaoId, nome: p.nome, saldoBrl: cent(p.saldoBrl), recebidoBrl: cent(p.recebidoBrl), cobrancasAbertas: abertas.length || (cent(p.saldoBrl) > 0.005 ? 1 : 0) })
  })

  return {
    ref, obrigacaoIdRef: cons.obrigacaoId, codigo: cons.codigo, descricao: cons.descricao, moeda: cons.moeda,
    totalContratadoBrl: cent(cons.valorContratadoBrl), totalRecebidoBrl: cent(cons.recebidoBrl), totalSaldoBrl: cent(cons.saldoBrl),
    participantes, cobrancas,
  }
}
