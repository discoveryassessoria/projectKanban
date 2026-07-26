// lib/financeiro/cambio/canonico.ts
// ============================================================================
// SERVIÇO CANÔNICO DE CÂMBIO DO DOMÍNIO FINANCEIRO — fonte única.
//
// Antes desta consolidação existiam DUAS políticas autônomas: `cotacoesVivas`
// (usada por computeCambioAging, Financeiro do processo/V2) e `carregarFx`
// (usada pelo Financeiro Geral /api/financas). Ambas liam CotacaoCambio, mas
// divergiam na ausência de cotação e no arredondamento. Agora as duas delegam
// AQUI: consulta, arredondamento, precedência e política de ausência existem
// em um só lugar.
//
// ── POLÍTICA OFICIAL, em ordem ─────────────────────────────────────────────
//  1. BRL não converte — taxa 1, estado 'BRL'.
//  2. SNAPSHOT HISTÓRICO: taxa congelada na obrigação/origem, quando faz parte
//     do fato financeiro já registrado. Estado 'HISTORICO'. Tem precedência
//     sobre a cotação corrente para FATOS CONSOLIDADOS — o que foi contratado
//     àquela taxa não é reescrito por cotação de hoje.
//  3. CORRENTE: cotação oficial válida em CotacaoCambio. Estado 'CORRENTE'.
//     É o que vale para projeções e consultas atuais.
//  4. AUSENTE: não existe cotação oficial nem snapshot histórico válido.
//     NÃO se inventa conversão. `converter` devolve null e o chamador reporta
//     o valor como não convertido.
//
// PROIBIDO em qualquer caminho: taxa fixa embutida, fallback silencioso para
// 1:1, e zero apresentado como se fosse valor convertido.
// ============================================================================

import { snapshotCotacoes } from '@/src/lib/cambio/servico-cambio'

export type EstadoCambio = 'BRL' | 'HISTORICO' | 'CORRENTE' | 'AUSENTE'

/** arredondamento monetário — implementação ÚNICA do domínio. */
export const cent = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

export const MOEDA_CONTABIL = 'BRL'

export interface CotacoesCorrentes {
  /** apenas moedas com cotação oficial válida; BRL sempre 1. */
  taxas: Record<string, number>
  /** moedas consultadas e sem cotação válida. */
  indisponiveis: string[]
  dataReferencia: string | null
  fonte: string
}

/** taxa congelada no fato financeiro (obrigação/receita de origem). */
export interface SnapshotHistorico {
  taxa?: number | null
  data?: Date | string | null
  /** valor em BRL já congelado — quando existe, é o próprio fato. */
  valorBrlCongelado?: number | null
}

export interface ResolucaoCambio {
  taxa: number | null
  estado: EstadoCambio
  dataCotacao: string | null
}

const valida = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Consulta ÚNICA a CotacaoCambio. Nenhum outro módulo deve consultar direto. */
export async function carregarCotacoesCorrentes(): Promise<CotacoesCorrentes> {
  const taxas: Record<string, number> = { [MOEDA_CONTABIL]: 1 }
  const indisponiveis: string[] = []
  let dataReferencia: string | null = null
  let fonte = 'CotacaoCambio'

  try {
    const snap = await snapshotCotacoes()
    fonte = snap.fonte ?? fonte
    for (const m of snap.moedas) {
      const moeda = String(m.moeda)
      const taxa = valida(m.valor)
      if (taxa != null) {
        taxas[moeda] = taxa
        if (!dataReferencia && m.dataReferencia) dataReferencia = m.dataReferencia
      } else {
        indisponiveis.push(moeda)
      }
    }
  } catch {
    // Falha de leitura não vira taxa inventada: só BRL segue conversível.
    fonte = 'indisponivel'
  }

  return { taxas, indisponiveis, dataReferencia, fonte }
}

/**
 * Resolve a taxa aplicável segundo a política oficial.
 *
 * `preferirHistorico` distingue os dois usos:
 *   • true  → FATO CONSOLIDADO: a taxa congelada manda (não reescreve o passado).
 *   • false → PROJEÇÃO/CONSULTA ATUAL: a cotação corrente manda; o snapshot
 *             histórico só entra se não houver corrente.
 */
export function resolverTaxa(args: {
  moeda?: string | null
  correntes: CotacoesCorrentes
  snapshotHistorico?: SnapshotHistorico | null
  preferirHistorico?: boolean
}): ResolucaoCambio {
  const moeda = (args.moeda ?? MOEDA_CONTABIL).toUpperCase()
  if (moeda === MOEDA_CONTABIL) return { taxa: 1, estado: 'BRL', dataCotacao: null }

  const historica = valida(args.snapshotHistorico?.taxa)
  const corrente = valida(args.correntes.taxas[moeda])
  const dataHist = args.snapshotHistorico?.data
    ? new Date(args.snapshotHistorico.data).toISOString()
    : null

  const ordem: ResolucaoCambio[] = args.preferirHistorico
    ? [
        { taxa: historica, estado: 'HISTORICO', dataCotacao: dataHist },
        { taxa: corrente, estado: 'CORRENTE', dataCotacao: args.correntes.dataReferencia },
      ]
    : [
        { taxa: corrente, estado: 'CORRENTE', dataCotacao: args.correntes.dataReferencia },
        { taxa: historica, estado: 'HISTORICO', dataCotacao: dataHist },
      ]

  for (const candidata of ordem) if (candidata.taxa != null) return candidata
  return { taxa: null, estado: 'AUSENTE', dataCotacao: null }
}

/** Converte para BRL. null = não convertido. NUNCA 1:1, NUNCA zero como conversão. */
export function converter(valor: number, r: ResolucaoCambio): number | null {
  if (r.taxa == null) return null
  return cent(Number(valor) * r.taxa)
}

export interface SomaCanonica {
  total: number
  /** o que ficou fora do total por ausência de cotação, agrupado por moeda. */
  naoConvertido: { moeda: string; valor: number }[]
}

/**
 * Soma em BRL aplicando a política. Item sem taxa NÃO entra no total e é
 * devolvido em `naoConvertido` — a lacuna fica visível, nunca silenciada.
 */
export function somarCanonico(
  correntes: CotacoesCorrentes,
  itens: {
    valor: number
    moeda?: string | null
    valorBrlCongelado?: number | null
    snapshotHistorico?: SnapshotHistorico | null
    preferirHistorico?: boolean
  }[],
): SomaCanonica {
  let total = 0
  const faltando = new Map<string, number>()

  for (const it of itens) {
    // BRL congelado é o próprio fato financeiro: tem precedência absoluta.
    const congelado = it.valorBrlCongelado
    if (congelado != null && Number.isFinite(Number(congelado))) {
      total += Number(congelado)
      continue
    }
    const r = resolverTaxa({
      moeda: it.moeda,
      correntes,
      snapshotHistorico: it.snapshotHistorico ?? null,
      preferirHistorico: it.preferirHistorico ?? false,
    })
    const convertido = converter(Number(it.valor) || 0, r)
    if (convertido == null) {
      const m = (it.moeda ?? MOEDA_CONTABIL).toUpperCase()
      faltando.set(m, cent((faltando.get(m) ?? 0) + (Number(it.valor) || 0)))
      continue
    }
    total += convertido
  }

  return {
    total: cent(total),
    naoConvertido: [...faltando.entries()].map(([moeda, valor]) => ({ moeda, valor })),
  }
}
