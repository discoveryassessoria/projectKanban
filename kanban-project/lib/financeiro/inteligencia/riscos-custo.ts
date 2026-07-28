// lib/financeiro/inteligencia/riscos-custo.ts
// ============================================================================
// F8.2 — RISCOS E PENDÊNCIAS de Contas a Pagar.
//
// Os baldes de vencimento respondem "quanto vence quando". Isto responde a outra
// pergunta, a que gera trabalho: "o que está EMPERRADO ou ERRADO agora?" — custo parado
// esperando aprovação, custo sem fornecedor (não dá para pagar), custo sem data
// (invisível no fluxo de caixa), valor em moeda estrangeira sem cotação, pagamento
// feito e nunca conciliado, e duplicidades prováveis já gravadas.
//
// Derivado do MESMO read-model da tela (listarContasAPagar) + ParcelaPagavel: sem
// segunda fonte de verdade, sem número que diverge da lista. Somente leitura.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { listarContasAPagar, type FiltroContasAPagar, type ItemContaPagar } from '../leitura/contas-a-pagar'

export type SeveridadeRisco = 'alto' | 'atencao' | 'info'
export type CodigoRisco =
  | 'VENCIDOS'
  | 'AGUARDANDO_APROVACAO'
  | 'SEM_FORNECEDOR'
  | 'SEM_DATA'
  | 'SEM_COTACAO'
  | 'PAGO_SEM_CONCILIAR'
  | 'DUPLICIDADE_SUSPEITA'

export interface Risco {
  codigo: CodigoRisco
  severidade: SeveridadeRisco
  titulo: string
  /** O que fazer a respeito — a tela mostra junto, para não virar alerta estéril. */
  acao: string
  qtd: number
  totalBrl: number
  obrigacaoIds: number[]
}

/** Dias parado em análise a partir dos quais a aprovação vira pendência. */
export const DIAS_APROVACAO_PENDENTE = 7
/** Dias após o pagamento a partir dos quais a conciliação vira pendência. */
export const DIAS_CONCILIACAO_PENDENTE = 15
/** Janela para considerar dois custos iguais como duplicidade suspeita. */
export const JANELA_DUPLICIDADE_DIAS = 30

const DIA = 86_400_000
const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const diasDesde = (iso: string | null): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DIA) : null

/** Em aberto = ainda gera trabalho (não paga, não cancelada). */
export function emAberto(o: ItemContaPagar): boolean {
  return o.balde !== 'PAGA' && o.balde !== 'CANCELADA'
}

/**
 * NÚCLEO PURO: agrupa custos iguais (mesmo processo + fornecedor + valor + moeda) criados
 * dentro da janela. Só conta como suspeita quando há 2 ou mais no mesmo grupo.
 */
export function gruposDuplicados(itens: ItemContaPagar[], janelaDias = JANELA_DUPLICIDADE_DIAS): ItemContaPagar[][] {
  const limite = Date.now() - janelaDias * DIA
  const recentes = itens.filter((o) => o.criadoEm && new Date(o.criadoEm).getTime() >= limite && o.fornecedor)
  const mapa = new Map<string, ItemContaPagar[]>()
  for (const o of recentes) {
    const chave = `${o.processoId ?? 0}|${o.fornecedor}|${o.moeda}|${cent(Number(o.valorContratado)).toFixed(2)}`
    mapa.set(chave, [...(mapa.get(chave) ?? []), o])
  }
  return [...mapa.values()].filter((g) => g.length > 1)
}

export interface ResultadoRiscos {
  riscos: Risco[]
  /** Total de custos analisados (a mesma base que a lista mostra). */
  analisados: number
}

export async function riscosContasAPagar(filtro?: FiltroContasAPagar): Promise<ResultadoRiscos> {
  const { itens } = await listarContasAPagar(filtro)
  const abertos = itens.filter(emAberto)
  const ids = itens.map((o) => o.obrigacaoId)

  // Cronograma oficial de pagáveis: um custo sem parcela E sem vencimento não entra
  // em nenhuma projeção de caixa.
  const comParcela = ids.length
    ? new Set((await prisma.parcelaPagavel.findMany({ where: { obrigacaoId: { in: ids }, canceladaEm: null }, select: { obrigacaoId: true } }).catch(() => [])).map((p) => p.obrigacaoId))
    : new Set<number>()

  const soma = (arr: ItemContaPagar[]) => cent(arr.reduce((s, o) => s + Number(o.saldoBrl ?? 0), 0))
  const risco = (codigo: CodigoRisco, severidade: SeveridadeRisco, titulo: string, acao: string, arr: ItemContaPagar[]): Risco | null =>
    arr.length ? { codigo, severidade, titulo, acao, qtd: arr.length, totalBrl: soma(arr), obrigacaoIds: arr.map((o) => o.obrigacaoId) } : null

  const vencidos = abertos.filter((o) => o.balde === 'VENCIDA')
  const aguardando = abertos.filter((o) => o.estadoCusto === 'PREVISTO' && (diasDesde(o.criadoEm) ?? 0) >= DIAS_APROVACAO_PENDENTE)
  const semFornecedor = abertos.filter((o) => !o.fornecedor)
  const semData = abertos.filter((o) => !o.vencimento && !comParcela.has(o.obrigacaoId))
  const semCotacao = abertos.filter((o) => Number(o.naoConvertido ?? 0) > 0)
  const pagoSemConciliar = itens.filter((o) => o.estadoCusto === 'PAGO' && (diasDesde(o.criadoEm) ?? 0) >= DIAS_CONCILIACAO_PENDENTE)
  const duplicados = gruposDuplicados(itens).flat()

  const riscos = [
    risco('VENCIDOS', 'alto', 'Custos vencidos', 'Pague ou renegocie: já passaram do vencimento.', vencidos),
    risco('DUPLICIDADE_SUSPEITA', 'alto', 'Possível duplicidade', 'Mesmo fornecedor, mesmo valor e mesmo processo na mesma janela. Confira e cancele o excedente.', duplicados),
    risco('AGUARDANDO_APROVACAO', 'atencao', `Parados em análise há ${DIAS_APROVACAO_PENDENTE}+ dias`, 'Aprove ou reprove: custo previsto não vira compromisso sozinho.', aguardando),
    risco('SEM_FORNECEDOR', 'atencao', 'Sem fornecedor', 'Sem beneficiário não há como pagar nem conciliar.', semFornecedor),
    risco('SEM_DATA', 'atencao', 'Sem vencimento nem cronograma', 'Defina a data ou o parcelamento: sem isso o custo não entra na projeção de caixa.', semData),
    risco('SEM_COTACAO', 'atencao', 'Sem cotação de câmbio', 'Valor em moeda estrangeira sem conversão: os totais em BRL não representam este custo.', semCotacao),
    risco('PAGO_SEM_CONCILIAR', 'info', `Pagos e não conciliados há ${DIAS_CONCILIACAO_PENDENTE}+ dias`, 'Concilie com o extrato para fechar o ciclo.', pagoSemConciliar),
  ].filter((r): r is Risco => r != null)

  const peso: Record<SeveridadeRisco, number> = { alto: 0, atencao: 1, info: 2 }
  riscos.sort((a, b) => peso[a.severidade] - peso[b.severidade] || b.totalBrl - a.totalBrl)

  return { riscos, analisados: itens.length }
}
