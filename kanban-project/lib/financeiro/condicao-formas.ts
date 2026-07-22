// lib/financeiro/condicao-formas.ts
// ============================================================================
// FORMAS DE PAGAMENTO DE UMA CONDIÇÃO — dois conceitos SEPARADOS:
//
//   • FORMAS PERMITIDAS (N:N, tabela CondicaoPagamentoForma)
//       quais Formas podem ser usadas com esta condição. Multisseleção.
//       VAZIO = SEM RESTRIÇÃO → a cobrança pode usar qualquer forma ativa
//       COMPATÍVEL (a compatibilidade continua sendo da Forma, não da Condição).
//
//   • FORMA PADRÃO (FK opcional, coluna legada `formaSugeridaId` PRESERVADA)
//       apenas a SUGESTÃO inicial ao criar a cobrança. O operador pode trocar
//       por qualquer outra forma permitida e compatível. Quando há restrição,
//       a padrão precisa OBRIGATORIAMENTE estar entre as permitidas.
//
// A coluna `formaSugeridaId` é reaproveitada de propósito: é exatamente a FK
// "uma única FormaPagamento" que a Forma padrão exige. Nada de coluna nova nem
// de arquitetura paralela; o dado histórico continua onde sempre esteve.
//
// Este módulo é a autoridade do backend: o frontend nunca é.
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'
import { idsSelecionados } from './condicao-aplicabilidade'

type DB = Prisma.TransactionClient | PrismaClient

async function clientePadrao(): Promise<DB> {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

export interface SelecaoFormas {
  permitidas: number[]
  padrao: number | null
}

export interface ErroFormas {
  campo: 'formasPermitidas' | 'formaPadraoId'
  mensagem: string
}

export interface ResolucaoFormas {
  selecao: SelecaoFormas
  erros: ErroFormas[]
}

const CAMPOS_PERMITIDAS = ['formasPermitidas', 'formaPagamentoPermitidaIds']
const CAMPOS_PADRAO = ['formaPadraoId', 'formaPagamentoPadraoId', 'formaSugeridaId']

/** Um único id (ou null). Texto livre e valores não-inteiros viram null. */
export function idUnico(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const bruto = typeof v === 'object' ? (v as { id?: unknown }).id : v
  const n = Number(bruto)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Normaliza permitidas + padrão do body, sem tocar no banco. */
export function selecaoFormasDoBody(b: Record<string, unknown>): SelecaoFormas {
  let permitidas: number[] = []
  for (const c of CAMPOS_PERMITIDAS) if (c in b) { permitidas = idsSelecionados(b[c]); break }
  let padrao: number | null = null
  for (const c of CAMPOS_PADRAO) if (c in b) { padrao = idUnico(b[c]); break }
  return { permitidas, padrao }
}

/** O body declarou cada eixo? Ausente ≠ vazio (PUT parcial não apaga nada). */
export function eixosFormasPresentes(b: Record<string, unknown>) {
  return {
    permitidas: CAMPOS_PERMITIDAS.some((c) => c in b),
    padrao: CAMPOS_PADRAO.some((c) => c in b),
  }
}

/**
 * Regra pura: a Forma padrão precisa estar entre as permitidas quando existe
 * restrição. Sem restrição (lista vazia), qualquer forma ativa pode ser padrão.
 * Usada também pela UI — remover a padrão das permitidas limpa o campo.
 */
export function padraoValido(permitidas: number[], padrao: number | null): boolean {
  if (padrao == null) return true
  if (!permitidas.length) return true // vazio = sem restrição
  return permitidas.includes(padrao)
}

/**
 * Valida contra o cadastro real: ids existem, estão ativos, sem duplicidade
 * (garantida por construção em `idsSelecionados`), e a padrão pertence às
 * permitidas. 1 query, independentemente da quantidade de ids.
 */
export async function resolverFormas(
  b: Record<string, unknown>,
  cliente?: DB,
): Promise<ResolucaoFormas> {
  const selecao = selecaoFormasDoBody(b)
  const erros: ErroFormas[] = []
  const pedidos = Array.from(new Set([...selecao.permitidas, ...(selecao.padrao ? [selecao.padrao] : [])]))
  if (!pedidos.length) return { selecao, erros }

  const db = cliente ?? (await clientePadrao())
  const achadas = await db.formaPagamentoCadastro.findMany({
    where: { id: { in: pedidos } },
    select: { id: true, name: true, ativo: true },
  })
  const porId = new Map(achadas.map((f) => [f.id, f]))

  const inexistentes = selecao.permitidas.filter((id) => !porId.has(id))
  if (inexistentes.length) {
    erros.push({ campo: 'formasPermitidas', mensagem: `Forma de pagamento inexistente no cadastro (#${inexistentes.join(', #')}).` })
  }
  const inativas = selecao.permitidas.filter((id) => porId.get(id)?.ativo === false)
  if (inativas.length) {
    erros.push({ campo: 'formasPermitidas', mensagem: `Forma de pagamento inativa não pode ser permitida (#${inativas.join(', #')}).` })
  }

  if (selecao.padrao != null) {
    const p = porId.get(selecao.padrao)
    if (!p) {
      erros.push({ campo: 'formaPadraoId', mensagem: `Forma padrão inexistente no cadastro (#${selecao.padrao}).` })
    } else if (p.ativo === false) {
      erros.push({ campo: 'formaPadraoId', mensagem: `Forma padrão "${p.name}" está inativa.` })
    } else if (!padraoValido(selecao.permitidas, selecao.padrao)) {
      erros.push({ campo: 'formaPadraoId', mensagem: `Forma padrão "${p.name}" precisa estar entre as formas permitidas.` })
    }
  }

  return { selecao, erros }
}

/** Include padrão da API: a tela precisa dos NOMES, não só dos ids. */
export const INCLUDE_FORMAS = {
  formasPermitidas: {
    select: { formaId: true, forma: { select: { id: true, code: true, name: true, ativo: true, icone: true } } },
  },
} as const

/**
 * A Forma escolhida numa cobrança é aceita por esta condição?
 * Sem restrição (lista vazia) => qualquer forma passa por aqui; a validação de
 * COMPATIBILIDADE (moeda, direção, parcelamento, adquirente…) continua sendo do
 * motor da Forma — a condição nunca torna válida uma forma incompatível.
 */
export function formaPermitidaNaCondicao(permitidas: number[] | null | undefined, formaId: number | null | undefined): boolean {
  if (!permitidas || permitidas.length === 0) return true
  if (formaId == null) return true // sem forma escolhida ainda: nada a barrar aqui
  return permitidas.includes(formaId)
}
