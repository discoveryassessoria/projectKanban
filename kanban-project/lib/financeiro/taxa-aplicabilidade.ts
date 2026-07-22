// lib/financeiro/taxa-aplicabilidade.ts
// ============================================================================
// APLICABILIDADE DA TAXA DE PAGAMENTO — seleção por RELACIONAMENTO REAL.
//
// Nada é digitado na etapa "Aplicabilidade": moeda, país e serviço só podem ser
// SELECIONADOS entre registros que existem no cadastro oficial. Este módulo é a
// autoridade do backend (o frontend nunca é):
//   • normaliza os ids recebidos (dedup, inteiros, sem texto livre / sem CSV);
//   • valida CONTRA O BANCO em 1 query por cadastro (nunca N+1);
//   • rejeita id inexistente e registro inativo;
//   • devolve a PROJEÇÃO legada (arrays de code/countryKey/id) que o motor de
//     cálculo (candidataElegivel, em charge-calculation-service) já consome.
//
// Lista vazia = SEM RESTRIÇÃO (regra do domínio, preservada).
// Espelha lib/financeiro/condicao-aplicabilidade.ts — mesma arquitetura, sem
// caminho paralelo. Serviço não tem tabela de vínculo: `servicos Int[]` já são
// IDs reais de ServicoProduto (array de IDs, nunca CSV).
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'

type DB = Prisma.TransactionClient | PrismaClient

async function clientePadrao(): Promise<DB> {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

/** Ids selecionados em cada eixo de aplicabilidade da Taxa. */
export interface SelecaoTaxa {
  moedas: number[]
  paises: number[]
  servicos: number[]
}

/** Projeção derivada, gravada nas colunas-array legadas (compat. com o motor). */
export interface ProjecaoTaxa {
  moedasAplicaveis: string[]
  paises: string[]
  servicos: number[]
}

export interface ErroTaxaAplic {
  campo: keyof SelecaoTaxa
  mensagem: string
}

export interface ResolucaoTaxa {
  selecao: SelecaoTaxa
  projecao: ProjecaoTaxa
  erros: ErroTaxaAplic[]
}

const ROTULO: Record<keyof SelecaoTaxa, string> = {
  moedas: 'Moeda',
  paises: 'País',
  servicos: 'Serviço',
}

/**
 * Ids válidos e sem duplicidade. Só aceita ARRAY de ids numéricos — string com
 * vírgulas ("BRL, EUR"), que era o formato da UI de texto livre, NÃO é aceita:
 * a seleção passou a ser exclusivamente por id de registro real.
 */
export function idsSelecionados(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const x of v) {
    const bruto = x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : x
    if (typeof bruto === 'boolean') continue
    const n = Number(bruto)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue
    if (!out.includes(n)) out.push(n) // sem duplicidade
  }
  return out
}

// Campos aceitos por eixo. Os arrays de TEXTO legados (`moedasAplicaveis`,
// `paises`) NUNCA são aceitos como entrada de escrita.
const CAMPOS_EIXO: Record<keyof SelecaoTaxa, string[]> = {
  moedas: ['moedasIds'],
  paises: ['paisesIds'],
  servicos: ['servicosIds', 'servicos'],
}

/** Normaliza os três eixos do body, sem tocar no banco. */
export function selecaoDoBody(b: Record<string, unknown>): SelecaoTaxa {
  const eixo = (k: keyof SelecaoTaxa) => {
    for (const campo of CAMPOS_EIXO[k]) if (campo in b) return idsSelecionados(b[campo])
    return []
  }
  return { moedas: eixo('moedas'), paises: eixo('paises'), servicos: eixo('servicos') }
}

/**
 * Quais eixos o body realmente declarou. Eixo AUSENTE não é "vazio": não deve
 * ser regravado (um PUT parcial jamais apaga vínculos que não veio alterar).
 * Eixo presente e vazio = remover a restrição (vazio = sem restrição).
 */
export function eixosPresentes(b: Record<string, unknown>): Record<keyof SelecaoTaxa, boolean> {
  const presente = (k: keyof SelecaoTaxa) => CAMPOS_EIXO[k].some((campo) => campo in b)
  return { moedas: presente('moedas'), paises: presente('paises'), servicos: presente('servicos') }
}

/**
 * Valida a seleção contra o cadastro real e devolve a projeção legada.
 * 3 queries no total (uma por cadastro), independentemente da quantidade de ids.
 */
export async function resolverAplicabilidadeTaxa(
  b: Record<string, unknown>,
  cliente?: DB,
): Promise<ResolucaoTaxa> {
  const selecao = selecaoDoBody(b)
  const erros: ErroTaxaAplic[] = []
  const nada = !selecao.moedas.length && !selecao.paises.length && !selecao.servicos.length
  // Sem nenhuma restrição declarada não há o que conferir: nem toca no banco.
  const db = cliente ?? (nada ? (null as unknown as DB) : await clientePadrao())

  const [moedas, paises, servicos] = await Promise.all([
    selecao.moedas.length
      ? db.moedaCadastro.findMany({ where: { id: { in: selecao.moedas } }, select: { id: true, code: true, ativo: true } })
      : Promise.resolve([]),
    selecao.paises.length
      ? db.catalogoPais.findMany({ where: { id: { in: selecao.paises } }, select: { id: true, countryKey: true, ativo: true } })
      : Promise.resolve([]),
    selecao.servicos.length
      ? db.servicoProduto.findMany({ where: { id: { in: selecao.servicos } }, select: { id: true, ativo: true } })
      : Promise.resolve([]),
  ])

  const conferir = (
    campo: keyof SelecaoTaxa,
    pedidos: number[],
    achados: { id: number; ativo: boolean }[],
  ) => {
    const porId = new Map(achados.map((r) => [r.id, r]))
    const inexistentes = pedidos.filter((id) => !porId.has(id))
    if (inexistentes.length) {
      erros.push({ campo, mensagem: `${ROTULO[campo]} inexistente no cadastro (#${inexistentes.join(', #')}).` })
    }
    const inativos = pedidos.filter((id) => porId.get(id)?.ativo === false)
    if (inativos.length) {
      erros.push({ campo, mensagem: `${ROTULO[campo]} inativo não pode ser selecionado (#${inativos.join(', #')}).` })
    }
  }

  conferir('moedas', selecao.moedas, moedas)
  conferir('paises', selecao.paises, paises)
  conferir('servicos', selecao.servicos, servicos)

  // Projeção na ORDEM DA SELEÇÃO (estável para diff/auditoria).
  const mapear = <T extends { id: number }>(ids: number[], regs: T[], f: (r: T) => string) => {
    const porId = new Map(regs.map((r) => [r.id, r]))
    return ids.map((id) => porId.get(id)).filter(Boolean).map((r) => f(r as T))
  }

  return {
    selecao,
    erros,
    projecao: {
      moedasAplicaveis: mapear(selecao.moedas, moedas, (m) => m.code),
      paises: mapear(selecao.paises, paises, (p) => p.countryKey),
      servicos: selecao.servicos.filter((id) => servicos.some((s) => s.id === id)),
    },
  }
}

/** Vínculos a gravar (create aninhado). Vazio quando não há restrição. */
export function vinculosTaxaParaCriar(s: SelecaoTaxa) {
  return {
    moedasVinculadas: s.moedas.length ? { create: s.moedas.map((moedaId) => ({ moedaId })) } : undefined,
    paisesPermitidos: s.paises.length ? { create: s.paises.map((paisId) => ({ paisId })) } : undefined,
  }
}

/**
 * Regrava os vínculos de uma taxa existente (dentro de transação).
 * Só mexe nos eixos que o body declarou — o resto fica intacto.
 */
export async function regravarVinculosTaxa(
  tx: Prisma.TransactionClient,
  taxaId: number,
  s: SelecaoTaxa,
  presentes: Record<keyof SelecaoTaxa, boolean>,
) {
  if (presentes.moedas) {
    await tx.taxaPagamentoMoeda.deleteMany({ where: { taxaId } })
    if (s.moedas.length) await tx.taxaPagamentoMoeda.createMany({ data: s.moedas.map((moedaId) => ({ taxaId, moedaId })) })
  }
  if (presentes.paises) {
    await tx.taxaPagamentoPais.deleteMany({ where: { taxaId } })
    if (s.paises.length) await tx.taxaPagamentoPais.createMany({ data: s.paises.map((paisId) => ({ taxaId, paisId })) })
  }
}

/** Include padrão para devolver a aplicabilidade já resolvida na API (sem N+1). */
export const INCLUDE_APLICABILIDADE_TAXA = {
  moedasVinculadas: { select: { moedaId: true, moeda: { select: { id: true, code: true, name: true, ativo: true } } } },
  paisesPermitidos: { select: { paisId: true, pais: { select: { id: true, countryKey: true, countryLabel: true, flag: true, ativo: true } } } },
} as const
