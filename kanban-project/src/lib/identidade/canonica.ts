// src/lib/identidade/canonica.ts
//
// RESOLUÇÃO DE IDENTIDADE CANÔNICA.
//
// ─── O PROBLEMA QUE ISTO RESOLVE ────────────────────────────────────────────
// Quatro conceitos do negócio viviam em duas fontes ao mesmo tempo: país
// (`Processo.pais` texto × `CatalogoPais`), tipo documental (`enum
// TipoDocumento` × `TipoDocumentoCadastro`), canal (`enum
// CanalSolicitacaoDocumento` × `CanalOperacional`) e o vínculo por code da
// Matriz Documental. Duas listas do mesmo conceito viram, no primeiro dia em que
// discordarem, uma discussão sobre qual está certa.
//
// ─── A REGRA DA TRANSIÇÃO ───────────────────────────────────────────────────
// A FK passa a ser a FONTE DE VERDADE. A coluna antiga continua sendo gravada
// porque ainda tem leitores — mas como ESPELHO, derivado da identidade e escrito
// só por aqui. Nunca o contrário: ninguém deriva a FK a partir do texto na hora
// de ler.
//
// Isso permite migrar leitores sem big bang, e é por isso que o guard proíbe
// escrever a string fora deste arquivo: espelho escrito em dois lugares deixa de
// ser espelho e vira a segunda fonte de novo.
//
// ─── RESOLUÇÃO POR CHAVE, NUNCA POR RÓTULO ──────────────────────────────────
// `countryKey`, `code` e `key` são IDENTIDADE. `countryLabel` e `nome` são
// APRESENTAÇÃO e podem mudar amanhã sem que nada deixe de ser a mesma coisa.

import { prisma } from "@/lib/prisma"
import type { Prisma, PrismaClient } from "@prisma/client"

type Db = Prisma.TransactionClient | PrismaClient

/** O que gravar num Processo: identidade + espelho, sempre juntos. */
export interface PaisCanonico { paisId: number | null; pais: string }

/**
 * País a partir do texto que a operação usa hoje ('espanha', 'Espanha', 'ITALIA').
 *
 * A comparação é sobre `countryKey` em minúsculas — não sobre o rótulo. Um país
 * que não estiver no cadastro NÃO é inventado aqui: devolve identidade nula e
 * preserva o texto, e a lacuna aparece no relatório de cobertura em vez de virar
 * um registro fabricado.
 */
export async function resolverPais(db: Db, texto: string | null | undefined): Promise<PaisCanonico> {
  const t = (texto ?? "").trim()
  if (!t) return { paisId: null, pais: "" }
  const achado = await db.catalogoPais.findFirst({
    where: { countryKey: t.toLowerCase() },
    select: { id: true, countryKey: true },
  })
  return achado ? { paisId: achado.id, pais: achado.countryKey } : { paisId: null, pais: t }
}

/** Idem, quando quem chama já tem o ID do cadastro (caminho preferido). */
export async function paisPorId(db: Db, paisId: number | null | undefined): Promise<PaisCanonico> {
  if (paisId == null) return { paisId: null, pais: "" }
  const p = await db.catalogoPais.findUnique({ where: { id: paisId }, select: { id: true, countryKey: true } })
  if (!p) throw new Error(`PAIS_INEXISTENTE: ${paisId}`)
  return { paisId: p.id, pais: p.countryKey }
}

export interface TipoDocumentoCanonico { documentoTipoId: number | null; tipo: string | null }

/**
 * Tipo documental a partir do valor do enum legado OU do `code` do cadastro.
 *
 * A ponte é `legacyEnumKey`, que já existia no cadastro justamente para isto.
 * Um tipo criado depois da migração não tem enum equivalente — e está correto
 * que `tipo` fique nulo: o enum é o legado, não a fonte.
 */
export async function resolverTipoDocumento(
  db: Db, valor: string | null | undefined,
): Promise<TipoDocumentoCanonico> {
  const v = (valor ?? "").trim()
  if (!v) return { documentoTipoId: null, tipo: null }
  const achado = await db.tipoDocumentoCadastro.findFirst({
    where: { OR: [{ legacyEnumKey: v }, { code: v }] },
    select: { id: true, legacyEnumKey: true },
  })
  return achado
    ? { documentoTipoId: achado.id, tipo: achado.legacyEnumKey }
    : { documentoTipoId: null, tipo: null }
}

export interface CanalCanonico { canalOperacionalId: number | null; canal: string | null }

/** Canal a partir da chave (`CRC`, `EMAIL`…) — as mesmas do enum, por desenho. */
export async function resolverCanal(db: Db, valor: string | null | undefined): Promise<CanalCanonico> {
  const v = (valor ?? "").trim()
  if (!v) return { canalOperacionalId: null, canal: null }
  const achado = await db.canalOperacional.findFirst({ where: { key: v }, select: { id: true, key: true } })
  return achado ? { canalOperacionalId: achado.id, canal: achado.key } : { canalOperacionalId: null, canal: v }
}

/**
 * Filtro de país para consultas.
 *
 * Aceita a chave do cadastro e devolve a cláusula que usa a IDENTIDADE, com o
 * texto como rede de segurança para as linhas que ainda não tiverem FK. Quando
 * a coluna legada sair, some só o segundo termo.
 */
export function ondePaisEh(paisKey: string | null | undefined) {
  const k = (paisKey ?? "").trim().toLowerCase()
  if (!k) return {}
  return { OR: [{ paisCanonico: { countryKey: k } }, { paisId: null as number | null, pais: k }] }
}

/** Consulta o cadastro por chave — para quem precisa do ID antes de gravar. */
export async function idDoPais(paisKey: string): Promise<number | null> {
  const p = await prisma.catalogoPais.findFirst({
    where: { countryKey: paisKey.trim().toLowerCase() },
    select: { id: true },
  })
  return p?.id ?? null
}
