// lib/financeiro/condicao-aplicabilidade.ts
// ============================================================================
// APLICABILIDADE DA CONDIÇÃO DE PAGAMENTO — seleção por RELACIONAMENTO REAL.
//
// Nada é digitado na etapa "Aplicabilidade e vigência": moeda, país, modalidade
// e serviço só podem ser SELECIONADOS entre registros que existem no cadastro.
// Este módulo é a autoridade do backend:
//   • normaliza os ids recebidos (dedup, inteiros, sem texto livre);
//   • valida CONTRA O BANCO em 1 query por cadastro (nunca N+1);
//   • rejeita id inexistente e registro inativo;
//   • devolve a PROJEÇÃO legada (arrays de chave/código) que o motor de cálculo
//     (condicaoAplicavel) continua consumindo sem alteração alguma.
//
// Lista vazia = SEM RESTRIÇÃO (regra do domínio, preservada).
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'

type DB = Prisma.TransactionClient | PrismaClient

// O client é carregado sob demanda: assim as regras puras deste módulo podem ser
// testadas (e o módulo importado) sem instanciar o Prisma.
async function clientePadrao(): Promise<DB> {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

/** Ids selecionados em cada eixo de aplicabilidade. */
export interface SelecaoAplicabilidade {
  moedas: number[]
  paises: number[]
  modalidades: number[]
  servicos: number[]
}

/** Projeção derivada, gravada nas colunas-array legadas (compat. com o motor). */
export interface ProjecaoAplicabilidade {
  moedasPermitidas: string[]
  paises: string[]
  modalidades: string[]
  servicos: number[]
}

export interface ErroAplicabilidade {
  campo: keyof SelecaoAplicabilidade
  mensagem: string
}

export interface ResolucaoAplicabilidade {
  selecao: SelecaoAplicabilidade
  projecao: ProjecaoAplicabilidade
  erros: ErroAplicabilidade[]
}

const ROTULO: Record<keyof SelecaoAplicabilidade, string> = {
  moedas: 'Moeda',
  paises: 'País',
  modalidades: 'Modalidade',
  servicos: 'Serviço',
}

/**
 * Ids válidos e sem duplicidade. Só aceita ARRAY de números/ids numéricos —
 * string com vírgulas (formato legado da UI de texto livre) NÃO é aceita aqui:
 * a seleção passou a ser exclusivamente por id de registro real.
 */
export function idsSelecionados(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const x of v) {
    // objetos {id} são aceitos (a UI pode mandar o registro inteiro)
    const bruto = x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : x
    if (typeof bruto === 'boolean') continue
    const n = Number(bruto)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) continue
    if (!out.includes(n)) out.push(n) // sem duplicidade
  }
  return out
}

// Campos aceitos por eixo. `moedasPermitidas`/`paises`/`modalidades` (arrays de
// TEXTO legados) NUNCA são aceitos como entrada de escrita — a seleção é só por id.
const CAMPOS_EIXO: Record<keyof SelecaoAplicabilidade, string[]> = {
  moedas: ['moedasIds', 'moedas'],
  paises: ['paisesIds', 'paisesSelecionados'],
  modalidades: ['modalidadesIds', 'modalidadesSelecionadas'],
  servicos: ['servicosIds', 'servicos'],
}

/** Normaliza os quatro eixos do body, sem tocar no banco. */
export function selecaoDoBody(b: Record<string, unknown>): SelecaoAplicabilidade {
  const eixo = (k: keyof SelecaoAplicabilidade) => {
    for (const campo of CAMPOS_EIXO[k]) if (campo in b) return idsSelecionados(b[campo])
    return []
  }
  return { moedas: eixo('moedas'), paises: eixo('paises'), modalidades: eixo('modalidades'), servicos: eixo('servicos') }
}

/**
 * Quais eixos o body realmente declarou. Um eixo AUSENTE não é "vazio": não deve
 * ser regravado (um PUT parcial jamais apaga vínculos que não veio alterar).
 * Eixo presente e vazio = remover a restrição (vazio = sem restrição).
 */
export function eixosPresentes(b: Record<string, unknown>): Record<keyof SelecaoAplicabilidade, boolean> {
  const presente = (k: keyof SelecaoAplicabilidade) => CAMPOS_EIXO[k].some((campo) => campo in b)
  return { moedas: presente('moedas'), paises: presente('paises'), modalidades: presente('modalidades'), servicos: presente('servicos') }
}

/**
 * Valida a seleção contra o cadastro real e devolve a projeção legada.
 * 4 queries no total (uma por cadastro), independentemente da quantidade de ids.
 */
export async function resolverAplicabilidade(
  b: Record<string, unknown>,
  cliente?: DB,
): Promise<ResolucaoAplicabilidade> {
  const selecao = selecaoDoBody(b)
  const erros: ErroAplicabilidade[] = []
  const nada = !selecao.moedas.length && !selecao.paises.length && !selecao.modalidades.length && !selecao.servicos.length
  // Sem nenhuma restrição declarada não há o que conferir: nem toca no banco.
  const db = cliente ?? (nada ? (null as unknown as DB) : await clientePadrao())

  const [moedas, paises, modalidades, servicos] = await Promise.all([
    selecao.moedas.length
      ? db.moedaCadastro.findMany({ where: { id: { in: selecao.moedas } }, select: { id: true, code: true, ativo: true } })
      : Promise.resolve([]),
    selecao.paises.length
      ? db.catalogoPais.findMany({ where: { id: { in: selecao.paises } }, select: { id: true, countryKey: true, ativo: true } })
      : Promise.resolve([]),
    selecao.modalidades.length
      ? db.modalidadePais.findMany({ where: { id: { in: selecao.modalidades } }, select: { id: true, modalityKey: true, ativo: true } })
      : Promise.resolve([]),
    selecao.servicos.length
      ? db.servicoProduto.findMany({ where: { id: { in: selecao.servicos } }, select: { id: true, ativo: true } })
      : Promise.resolve([]),
  ])

  const conferir = (
    campo: keyof SelecaoAplicabilidade,
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
  conferir('modalidades', selecao.modalidades, modalidades)
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
      moedasPermitidas: mapear(selecao.moedas, moedas, (m) => m.code),
      paises: mapear(selecao.paises, paises, (p) => p.countryKey),
      modalidades: mapear(selecao.modalidades, modalidades, (m) => m.modalityKey),
      servicos: selecao.servicos.filter((id) => servicos.some((s) => s.id === id)),
    },
  }
}

/** Regras puras da etapa (vigência e faixa de valor). Testável sem banco. */
export function validarAplicabilidade(b: Record<string, unknown>): ErroAplicabilidade[] {
  const erros: ErroAplicabilidade[] = []
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

  const min = n(b.valorMinimo)
  const max = n(b.valorMaximo)
  if (min !== null && Number.isFinite(min) && min < 0) {
    erros.push({ campo: 'moedas', mensagem: 'Valor mínimo não pode ser negativo.' })
  }
  if (min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && max < min) {
    erros.push({ campo: 'moedas', mensagem: 'Valor máximo não pode ser menor que o mínimo.' })
  }
  return erros
}

/** Vínculos a gravar (create aninhado). Vazio quando não há restrição. */
export function vinculosParaCriar(s: SelecaoAplicabilidade) {
  return {
    moedasVinculadas: s.moedas.length ? { create: s.moedas.map((moedaId) => ({ moedaId })) } : undefined,
    paisesPermitidos: s.paises.length ? { create: s.paises.map((paisId) => ({ paisId })) } : undefined,
    modalidadesPermitidas: s.modalidades.length ? { create: s.modalidades.map((modalidadeId) => ({ modalidadeId })) } : undefined,
    servicosPermitidos: s.servicos.length ? { create: s.servicos.map((servicoId) => ({ servicoId })) } : undefined,
  }
}

/**
 * Regrava os vínculos de uma condição existente (dentro de transação).
 * Só mexe nos eixos que o body declarou — o resto fica intacto.
 */
export async function regravarVinculos(
  tx: Prisma.TransactionClient,
  condicaoId: number,
  s: SelecaoAplicabilidade,
  presentes: Record<keyof SelecaoAplicabilidade, boolean>,
) {
  if (presentes.moedas) {
    await tx.condicaoPagamentoMoeda.deleteMany({ where: { condicaoId } })
    if (s.moedas.length) await tx.condicaoPagamentoMoeda.createMany({ data: s.moedas.map((moedaId) => ({ condicaoId, moedaId })) })
  }
  if (presentes.paises) {
    await tx.condicaoPagamentoPais.deleteMany({ where: { condicaoId } })
    if (s.paises.length) await tx.condicaoPagamentoPais.createMany({ data: s.paises.map((paisId) => ({ condicaoId, paisId })) })
  }
  if (presentes.modalidades) {
    await tx.condicaoPagamentoModalidade.deleteMany({ where: { condicaoId } })
    if (s.modalidades.length) await tx.condicaoPagamentoModalidade.createMany({ data: s.modalidades.map((modalidadeId) => ({ condicaoId, modalidadeId })) })
  }
  if (presentes.servicos) {
    await tx.condicaoPagamentoServico.deleteMany({ where: { condicaoId } })
    if (s.servicos.length) await tx.condicaoPagamentoServico.createMany({ data: s.servicos.map((servicoId) => ({ condicaoId, servicoId })) })
  }
}

/** Include padrão para devolver a aplicabilidade já resolvida na API (sem N+1). */
export const INCLUDE_APLICABILIDADE = {
  moedasVinculadas: { select: { moedaId: true, moeda: { select: { id: true, code: true, name: true } } } },
  paisesPermitidos: { select: { paisId: true, pais: { select: { id: true, countryKey: true, countryLabel: true, flag: true } } } },
  // O país da modalidade vem da relação canônica — a modalidade não guarda
  // mais cópia da chave do país.
  modalidadesPermitidas: { select: { modalidadeId: true, modalidade: { select: { id: true, modalityKey: true, modalityLabel: true, pais: { select: { countryKey: true } } } } } },
  servicosPermitidos: { select: { servicoId: true, servico: { select: { id: true, name: true, code: true } } } },
} as const
