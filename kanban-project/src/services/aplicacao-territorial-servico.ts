// src/services/aplicacao-territorial-servico.ts
// ============================================================================
// APLICAÇÃO TERRITORIAL DO SERVIÇO — autoridade do BACKEND.
//
// A UI decide o que mostrar; aqui se decide o que é gravável. O módulo:
//   • lê a seleção do body sem confiar na UI (ids, não texto livre);
//   • aplica as regras do "Todas" pela fonte única pura
//     (lib/gerenciamento/aplicacao-territorial);
//   • confere os ids contra o cadastro REAL de Países e Regiões em UMA query;
//   • rejeita país inexistente ou inativo;
//   • grava os vínculos de forma idempotente (estado final, sem duplicar).
//
// PUT PARCIAL: um body que não declara aplicação territorial NÃO mexe nos
// vínculos existentes. Só quem declara, altera.
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client'
import {
  normalizarSelecao, selecaoDoLegado, validarSelecao, estadoTerritorial,
  type SelecaoTerritorial, type PaisAplicavel,
} from '@/lib/gerenciamento/aplicacao-territorial'

type DB = Prisma.TransactionClient | PrismaClient

async function clientePadrao(): Promise<DB> {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

export interface ErroTerritorio {
  campo: 'aplicacaoGlobal' | 'paises'
  mensagem: string
}

export interface ResolucaoTerritorial {
  /** Seleção final, já com as regras do "Todas" aplicadas. */
  selecao: SelecaoTerritorial
  /** O body declarou aplicação territorial? Se não, não se grava nada. */
  declarado: boolean
  erros: ErroTerritorio[]
}

/** Campos aceitos no body, em ordem de precedência. */
const CAMPO_GLOBAL = ['aplicacaoGlobal', 'todosPaises'] as const
const CAMPO_PAISES = ['paises', 'paisesIds'] as const

/** O body mexeu em aplicação territorial (em qualquer das formas aceitas)? */
export function declarouTerritorio(b: Record<string, unknown>): boolean {
  return CAMPO_GLOBAL.some((c) => c in b) || CAMPO_PAISES.some((c) => c in b) || 'nationality' in b
}

/**
 * Seleção declarada no body. Precedência:
 *   1. `aplicacaoGlobal` / `paises` — o modelo oficial;
 *   2. `nationality` — cliente antigo. Traduzido para a seleção equivalente,
 *      nunca gravado como texto (o campo legado fica congelado no banco).
 */
export function selecaoDoBody(
  b: Record<string, unknown>,
  catalogo: PaisAplicavel[],
): SelecaoTerritorial | null {
  const temOficial = CAMPO_GLOBAL.some((c) => c in b) || CAMPO_PAISES.some((c) => c in b)
  if (temOficial) {
    const global = CAMPO_GLOBAL.map((c) => b[c]).find((v) => v !== undefined)
    const paisIds = CAMPO_PAISES.map((c) => b[c]).find((v) => v !== undefined)
    return normalizarSelecao({ global, paisIds })
  }
  if ('nationality' in b) {
    return selecaoDoLegado(b.nationality == null ? null : String(b.nationality), catalogo)
  }
  return null
}

/**
 * Valida a seleção contra o cadastro real. UMA query, independentemente da
 * quantidade de ids. Não grava nada.
 *
 * `permiteSemAplicacao` reflete o TIPO do item: um serviço pode existir sem
 * território (é um estado legítimo do catálogo), então o padrão é `true`.
 */
export async function resolverAplicacaoTerritorial(
  b: Record<string, unknown>,
  opcoes: { cliente?: DB; permiteSemAplicacao?: boolean } = {},
): Promise<ResolucaoTerritorial> {
  const db = opcoes.cliente ?? (await clientePadrao())

  // O catálogo só é necessário para traduzir o campo legado; nos demais casos a
  // leitura é restrita aos ids pedidos.
  const precisaCatalogo = !CAMPO_GLOBAL.some((c) => c in b) && !CAMPO_PAISES.some((c) => c in b) && 'nationality' in b
  const catalogo: PaisAplicavel[] = precisaCatalogo
    ? await db.catalogoPais.findMany({ select: { id: true, countryKey: true, countryLabel: true, nationalityKey: true, ativo: true } })
    : []

  const selecao = selecaoDoBody(b, catalogo)
  if (!selecao) return { selecao: { global: true, paisIds: [] }, declarado: false, erros: [] }

  const erros: ErroTerritorio[] = validarSelecao(selecao, { permiteSemAplicacao: opcoes.permiteSemAplicacao !== false })

  if (selecao.paisIds.length > 0) {
    const achados = await db.catalogoPais.findMany({
      where: { id: { in: selecao.paisIds } },
      select: { id: true, ativo: true },
    })
    const porId = new Map(achados.map((p) => [p.id, p]))
    const inexistentes = selecao.paisIds.filter((id) => !porId.has(id))
    if (inexistentes.length) {
      erros.push({ campo: 'paises', mensagem: `País inexistente no cadastro (#${inexistentes.join(', #')}).` })
    }
    const inativos = selecao.paisIds.filter((id) => porId.get(id)?.ativo === false)
    if (inativos.length) {
      erros.push({ campo: 'paises', mensagem: `País inativo não pode ser selecionado (#${inativos.join(', #')}).` })
    }
  }

  return { selecao, declarado: true, erros }
}

/**
 * Grava o ESTADO FINAL dos vínculos do serviço. Idempotente: remove o que saiu,
 * cria o que entrou, não mexe no que permaneceu (preserva `criadoEm`, que é o
 * que dá ordem estável ao rótulo "Itália + Espanha").
 *
 * Aplicação global NUNCA materializa vínculo — é o que faz um país cadastrado
 * no futuro já nascer abrangido.
 */
export async function gravarAplicacaoTerritorial(
  tx: DB,
  servicoId: number,
  selecao: SelecaoTerritorial,
): Promise<void> {
  const alvo = selecao.global ? [] : selecao.paisIds
  const atuais = await tx.servicoProdutoPais.findMany({ where: { servicoId }, select: { paisId: true } })
  const tinha = new Set(atuais.map((v) => v.paisId))

  const remover = atuais.map((v) => v.paisId).filter((id) => !alvo.includes(id))
  const criar = alvo.filter((id) => !tinha.has(id))

  if (remover.length) {
    await tx.servicoProdutoPais.deleteMany({ where: { servicoId, paisId: { in: remover } } })
  }
  if (criar.length) {
    // `skipDuplicates`: uma corrida com outra escrita não vira erro 500.
    await tx.servicoProdutoPais.createMany({
      data: criar.map((paisId) => ({ servicoId, paisId })),
      skipDuplicates: true,
    })
  }
}

/** Seleção como está gravada hoje (para PUT parcial e para a resposta da API). */
export function selecaoDoRegistro(reg: {
  aplicacaoGlobal?: boolean | null
  paises?: { paisId: number }[] | null
}): SelecaoTerritorial {
  if (reg.aplicacaoGlobal !== false) return { global: true, paisIds: [] }
  return { global: false, paisIds: (reg.paises ?? []).map((v) => v.paisId) }
}

/** Estado legível para log/auditoria. */
export function rotuloEstado(sel: SelecaoTerritorial): string {
  const e = estadoTerritorial(sel)
  return e === 'global' ? 'global' : e === 'paises' ? `${sel.paisIds.length} país(es)` : 'sem aplicação territorial'
}
