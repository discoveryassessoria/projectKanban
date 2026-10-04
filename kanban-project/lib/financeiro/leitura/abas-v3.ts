// lib/financeiro/leitura/abas-v3.ts
// ============================================================================
// AS QUATRO ABAS DO FINANCEIRO (A Receber · Dashboard · Fluxo de Caixa · DRE) LIDAS DO MOTOR V3.
//
// Antes elas liam o motor antigo (ParcelaFinanceira · ContaPagar · Custo · PagamentoFatura) e a aba Central lia o V3
// (ObrigacaoEconomica → Ocorrência → Ledger): a mesma empresa mostrava 22.600 EUR na Central e zero nas outras quatro.
// Agora há UMA fonte: `listarObrigacoes()` (a mesma da Central) para o que se deve/recebe, e `OcorrenciaFinanceira` para o que
// foi pago. O motor antigo deixa de ser lido por estas abas.
//
// REGRAS (todas sobre a mesma lista de obrigações):
//   • A receber  = obrigação A_RECEBER não cancelada; "em aberto" = saldo > 0; valor em BRL = `saldoBrl` (câmbio da própria obrigação).
//   • A pagar    = obrigação A_PAGAR, mesma conta.
//   • Vencimento = o da obrigação. Sem vencimento NÃO entra em vencido/a vencer/calendário — aparece à parte ("sem vencimento"),
//                  nunca com data inventada.
//   • Recebido/pago no período = ocorrências de PAGAMENTO processadas, convertidas pela cotação corrente (ausência declarada).
//   • DRE por COMPETÊNCIA: a obrigação pertence ao mês em que foi criada (o V3 não tem cronograma de parcelas).
// ============================================================================
import { prisma } from '@/lib/prisma'
import { carregarFx, converterBrl, type FxFinancas } from '@/lib/financeiro/cambio-financas'
import { listarObrigacoes, type ObrigacaoLista } from './consultas'

export const cent2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const EPS = 0.005
const TIPOS_PAGAMENTO = ['PAGAMENTO', 'PAGAMENTO_PARCIAL']

export interface ObrigacaoDaAba extends ObrigacaoLista {
  processoNome: string | null
  pais: string | null
  paisLabel: string | null
  flag: string | null
}
export interface PagamentoDaAba {
  obrigacaoId: number
  direcao: string
  data: Date
  valorBrl: number
}
export interface BaseV3 {
  agora: Date
  obrigacoes: ObrigacaoDaAba[]
  pagamentos: PagamentoDaAba[]
  fx: FxFinancas
  /** valor que ficou de fora por falta de cotação (declarado, nunca zerado em silêncio). */
  naoConvertido: { moeda: string; valor: number }[]
}

export const emAberto = (o: Pick<ObrigacaoLista, 'saldoBrl' | 'saldo'>) => o.saldo > EPS
export const recebida = (o: Pick<ObrigacaoLista, 'saldo' | 'valorContratado'>) => o.saldo <= EPS && o.valorContratado > EPS
/** Dias até o vencimento (arredondado para cima, como as telas já faziam). Sem vencimento = null. */
export function diasAte(venc: string | null, agora: Date): number | null {
  if (!venc) return null
  return Math.ceil((new Date(venc).getTime() - agora.getTime()) / 86_400_000)
}
export const SEM_VENCIMENTO = 99_999

export async function carregarBaseV3(agora = new Date()): Promise<BaseV3> {
  const [lista, fx] = await Promise.all([listarObrigacoes(), carregarFx()])
  const procIds = [...new Set(lista.map((o) => o.processoId).filter((v): v is number => v != null))]
  const procs = procIds.length
    ? await prisma.processo.findMany({ where: { id: { in: procIds } }, select: { id: true, nome: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } } } })
    : []
  const procPor = new Map(procs.map((p) => [p.id, p]))
  const obrigacoes: ObrigacaoDaAba[] = lista.map((o) => {
    const p = o.processoId != null ? procPor.get(o.processoId) : undefined
    return { ...o, processoNome: p?.nome ?? null, pais: p?.paisCanonico?.countryKey ?? null, paisLabel: p?.paisCanonico?.countryLabel ?? null, flag: p?.paisCanonico?.flag ?? null }
  })
  const direcaoPor = new Map(obrigacoes.map((o) => [o.obrigacaoId, o.direcao]))
  const oc = obrigacoes.length
    ? await prisma.ocorrenciaFinanceira.findMany({
        where: { obrigacaoId: { in: [...direcaoPor.keys()] }, tipo: { in: TIPOS_PAGAMENTO }, status: 'PROCESSADA' },
        select: { obrigacaoId: true, valor: true, moeda: true, data: true },
      })
    : []
  const naoConvertido: { moeda: string; valor: number }[] = []
  const pagamentos: PagamentoDaAba[] = oc.map((x) => {
    const v = Number(x.valor)
    const brl = converterBrl(fx, v, String(x.moeda))
    if (brl == null) naoConvertido.push({ moeda: String(x.moeda), valor: v })
    return { obrigacaoId: x.obrigacaoId, direcao: direcaoPor.get(x.obrigacaoId) ?? 'A_RECEBER', data: x.data, valorBrl: brl ?? 0 }
  })
  for (const o of obrigacoes) if (o.naoConvertido > EPS) naoConvertido.push({ moeda: o.moeda, valor: o.naoConvertido })
  return { agora, obrigacoes, pagamentos, fx, naoConvertido }
}

export const doMes = (d: Date, ref: Date) => d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear()
export const soma = <T>(arr: T[], f: (x: T) => number) => cent2(arr.reduce((a, x) => a + f(x), 0))

export const NATUREZAS_RECEITA = ['RECEITA', 'RECEITA_EXTRA']
