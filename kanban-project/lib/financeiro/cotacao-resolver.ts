// lib/financeiro/cotacao-resolver.ts
// ============================================================================
// RESOLVEDOR de cotação para a Cobrança (server-side). Fonte da verdade da
// cotação usada: automática (CotacaoCambio vigente), manual (com permissão) ou
// estimada (fallback EXPLÍCITO e rotulado — nunca silencioso). Indisponível
// bloqueia a geração. Nunca assume cotação 1 para moedas diferentes.
// ============================================================================
import type { PrismaClient } from '@prisma/client'
import { cotacaoEfetiva, exigeCotacao, type DirecaoConversao } from './cambio-conversao'

export type TipoCotacao = 'MESMA' | 'AUTOMATICA' | 'MANUAL' | 'ESTIMADA'
export type EstadoCotacao = 'MESMA' | 'ATUAL' | 'MANUAL' | 'ESTIMADA' | 'INDISPONIVEL' | 'MANUAL_NAO_AUTORIZADA'

export interface CotacaoResolvida {
  moedaOrigem: string
  moedaDestino: string
  cotacao: number
  direcao: DirecaoConversao
  tipo: TipoCotacao
  estado: EstadoCotacao
  fonte: string | null
  data: Date | null
  cotacaoId: number | null
  usuarioId: number | null
  justificativa: string | null
  /** Mensagem de bloqueio quando não é possível prosseguir (senão null). */
  bloqueio: string | null
}

export interface OpcoesCotacao {
  origem: string
  destino: string
  cotacaoManual?: number | null
  autorizadoManual?: boolean
  fonteManual?: string | null
  dataManual?: Date | null
  justificativa?: string | null
  usuarioId?: number | null
  /** Fallback explícito (receita.fxEstimado) — só usado se não houver automática. */
  fxEstimadoFallback?: number | null
}

export async function resolverCotacao(prisma: PrismaClient, o: OpcoesCotacao): Promise<CotacaoResolvida> {
  const origem = String(o.origem || '').toUpperCase()
  const destino = String(o.destino || origem).toUpperCase()
  const baseVazia = { moedaOrigem: origem, moedaDestino: destino, cotacaoId: null as number | null, usuarioId: o.usuarioId ?? null, justificativa: null as string | null }

  // Mesma moeda: sem conversão.
  if (!exigeCotacao(origem, destino)) {
    return { ...baseVazia, cotacao: 1, direcao: 'MESMA', tipo: 'MESMA', estado: 'MESMA', fonte: null, data: null, bloqueio: null }
  }

  // Manual (exige permissão).
  if (o.cotacaoManual != null && Number(o.cotacaoManual) > 0) {
    if (!o.autorizadoManual) {
      return { ...baseVazia, cotacao: 0, direcao: 'DIRETA', tipo: 'MANUAL', estado: 'MANUAL_NAO_AUTORIZADA', fonte: null, data: null, bloqueio: 'Cotação manual não permitida para este usuário.' }
    }
    return {
      ...baseVazia, cotacao: Number(o.cotacaoManual), direcao: 'DIRETA', tipo: 'MANUAL', estado: 'MANUAL',
      fonte: o.fonteManual || 'Manual', data: o.dataManual ?? new Date(),
      justificativa: o.justificativa ?? null, usuarioId: o.usuarioId ?? null, bloqueio: null,
    }
  }

  // Automática: cotação vigente para o par (direta ou inversa).
  const candidatas = await prisma.cotacaoCambio.findMany({
    where: { ativo: true, moedaDe: { in: [origem, destino] as any }, moedaPara: { in: [origem, destino] as any } },
    orderBy: [{ vigente: 'desc' }, { dataReferencia: 'desc' }, { data: 'desc' }, { id: 'desc' }],
    take: 20,
    select: { id: true, moedaDe: true, moedaPara: true, taxa: true, fonte: true, data: true, dataReferencia: true },
  })
  for (const c of candidatas) {
    const ef = cotacaoEfetiva(origem, destino, { moedaDe: String(c.moedaDe), moedaPara: String(c.moedaPara), taxa: Number(c.taxa) })
    if (ef) {
      return {
        ...baseVazia, cotacao: ef.cotacao, direcao: ef.direcao, tipo: 'AUTOMATICA', estado: 'ATUAL',
        fonte: c.fonte ?? 'Cotação vigente', data: c.dataReferencia ?? c.data ?? null, cotacaoId: c.id, bloqueio: null,
      }
    }
  }

  // Fallback ESTIMADO explícito (rotulado) — nunca silencioso.
  if (o.fxEstimadoFallback != null && Number(o.fxEstimadoFallback) > 0) {
    return {
      ...baseVazia, cotacao: Number(o.fxEstimadoFallback), direcao: 'DIRETA', tipo: 'ESTIMADA', estado: 'ESTIMADA',
      fonte: 'Estimada (receita)', data: null, bloqueio: null,
    }
  }

  // Indisponível → bloqueia a geração.
  return {
    ...baseVazia, cotacao: 0, direcao: 'DIRETA', tipo: 'AUTOMATICA', estado: 'INDISPONIVEL', fonte: null, data: null,
    bloqueio: `Não existe cotação válida para ${origem} → ${destino} na data selecionada.`,
  }
}
