// src/services/organizacao-identidade.ts
//
// ORGANIZAÇÃO ÚNICA — resolução de identidade e detecção de duplicidade.
//
// ARQUITETURA PERMANENTE do Discovery: o módulo Órgãos e Organizações é a ÚNICA
// fonte de verdade das organizações. A mesma entidade existe UMA vez no banco e
// exerce N FUNÇÕES (Órgão, Fornecedor, Parceiro, Correspondente, Cliente
// Corporativo). Classificar jamais é criar cadastro novo: acrescenta-se função
// e categoria ao registro que já existe.
//
// Toda criação/importação passa por aqui, na ordem obrigatória:
//   1. id
//   2. identificação fiscal (CNPJ/CPF/VAT/NIF/CIF/Partita IVA…)
//   3. nome oficial + país
//   4. nome fantasia + país
//   5. só então é entidade nova
//
// Além da resolução exata, há a DETECÇÃO de duplicidade provável (normalização
// + similaridade), que nunca funde nada sozinha: ela AVISA. Fusão de cadastro é
// decisão humana.

import type { Prisma, PrismaClient, FuncaoOrganizacao } from '@prisma/client'

type DB = Prisma.TransactionClient | PrismaClient

export const FUNCOES: FuncaoOrganizacao[] = ['ORGAO', 'FORNECEDOR', 'PARCEIRO', 'CORRESPONDENTE', 'CLIENTE_CORPORATIVO']

export const FUNCAO_LABEL: Record<FuncaoOrganizacao, string> = {
  ORGAO: 'Órgão',
  FORNECEDOR: 'Fornecedor',
  PARCEIRO: 'Parceiro',
  CORRESPONDENTE: 'Correspondente',
  CLIENTE_CORPORATIVO: 'Cliente Corporativo',
}

/** Só dígitos e letras — CNPJ com e sem máscara é a MESMA identidade. */
export function normalizarIdentificacaoFiscal(v: string | null | undefined): string | null {
  if (!v) return null
  const limpo = String(v).replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  return limpo || null
}

/**
 * Forma canônica do nome para COMPARAÇÃO (nunca para gravação): sem acento,
 * sem pontuação, sem caixa e sem as palavras que não distinguem entidade.
 */
const RUIDO = new Set([
  'de', 'da', 'do', 'das', 'dos', 'del', 'della', 'di', 'du', 'des', 'la', 'le', 'el', 'los', 'las',
  'e', 'y', 'et', 'and', 'a', 'o', 'as', 'os', 'the', 'ltda', 'sa', 'srl', 'spa', 'inc', 'llc', 'gmbh',
])
export function chaveDeNome(nome: string): string {
  return String(nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !RUIDO.has(p))
    .join(' ')
    .trim()
}

/** Similaridade 0..1 por bag of words — barata e suficiente para AVISAR. */
export function similaridade(a: string, b: string): number {
  const A = new Set(chaveDeNome(a).split(' ').filter(Boolean))
  const B = new Set(chaveDeNome(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let comuns = 0
  for (const t of A) if (B.has(t)) comuns++
  return (2 * comuns) / (A.size + B.size)
}

export interface EntradaIdentidade {
  id?: number | null
  name?: string | null
  nomeFantasia?: string | null
  /** IDENTIDADE geográfica. O país entra por vínculo, nunca por texto. */
  paisId?: number | null
  identificacaoFiscal?: string | null
}

export type ComoResolveu = 'id' | 'identificacao-fiscal' | 'nome-oficial-pais' | 'nome-fantasia-pais' | 'nova'

export interface ResolucaoOrganizacao {
  id: number | null
  como: ComoResolveu
  /** `pais` é o RÓTULO para a mensagem de erro — derivado, nunca persistido. */
  registro: { id: number; publicCode: string | null; name: string; paisId: number | null; pais: string | null } | null
}

const SELECT_MIN = {
  id: true, publicCode: true, name: true, paisId: true,
  pais: { select: { countryLabel: true } },
} as const

type LinhaMin = { id: number; publicCode: string | null; name: string; paisId: number | null; pais: { countryLabel: string } | null }

/** Achata a relação num rótulo. A apresentação deriva; a identidade é `paisId`. */
const comRotulo = (r: LinhaMin) => ({
  id: r.id, publicCode: r.publicCode, name: r.name, paisId: r.paisId, pais: r.pais?.countryLabel ?? null,
})

/**
 * Encontra a organização que a entrada JÁ é, na ordem obrigatória. Devolve
 * `como: 'nova'` só quando nada casou — aí sim é entidade diferente.
 */
export async function resolverOrganizacao(db: DB, e: EntradaIdentidade): Promise<ResolucaoOrganizacao> {
  // 1) id
  if (e.id != null) {
    const porId = await db.orgaoProtocolo.findUnique({ where: { id: e.id }, select: SELECT_MIN })
    if (porId) return { id: porId.id, como: 'id', registro: comRotulo(porId) }
  }

  // 2) identificação fiscal — a chave forte: mesma inscrição = mesma pessoa jurídica
  const fiscal = normalizarIdentificacaoFiscal(e.identificacaoFiscal)
  if (fiscal) {
    const porFiscal = await db.orgaoProtocolo.findUnique({ where: { identificacaoFiscal: fiscal }, select: SELECT_MIN })
    if (porFiscal) return { id: porFiscal.id, como: 'identificacao-fiscal', registro: comRotulo(porFiscal) }
  }

  // A REGRA NÃO MUDOU: "mesmo nome no mesmo país é a mesma entidade". O que
  // mudou é como o país é endereçado — por vínculo, não pela grafia do rótulo.
  const paisId = e.paisId ?? null

  // 3) nome oficial + país
  if (e.name?.trim()) {
    const porNome = await db.orgaoProtocolo.findFirst({ where: { name: e.name.trim(), paisId }, select: SELECT_MIN })
    if (porNome) return { id: porNome.id, como: 'nome-oficial-pais', registro: comRotulo(porNome) }
  }

  // 4) nome fantasia + país
  if (e.nomeFantasia?.trim()) {
    const porFantasia = await db.orgaoProtocolo.findFirst({
      where: { nomeFantasia: e.nomeFantasia.trim(), paisId },
      select: SELECT_MIN,
    })
    if (porFantasia) return { id: porFantasia.id, como: 'nome-fantasia-pais', registro: comRotulo(porFantasia) }
  }

  return { id: null, como: 'nova', registro: null }
}

export interface SuspeitaDuplicidade {
  id: number
  publicCode: string | null
  name: string
  paisId: number | null
  /** Rótulo do país, para a tela mostrar. Derivado da relação. */
  pais: string | null
  similaridade: number
  motivo: string
}

/**
 * Candidatas a MESMA entidade que a resolução exata não pegou (acento, sigla,
 * grafia). Não decide nada: entrega a lista para quem cria/edita confirmar.
 */
export async function detectarDuplicidade(
  db: DB,
  e: EntradaIdentidade,
  opts: { limiar?: number; ignorarId?: number | null } = {},
): Promise<SuspeitaDuplicidade[]> {
  const limiar = opts.limiar ?? 0.8
  const nome = e.name?.trim() || e.nomeFantasia?.trim()
  if (!nome) return []

  const candidatas = await db.orgaoProtocolo.findMany({
    where: {
      ...(e.paisId != null ? { paisId: e.paisId } : {}),
      ...(opts.ignorarId ? { id: { not: opts.ignorarId } } : {}),
    },
    select: { ...SELECT_MIN, nomeFantasia: true },
    take: 2000,
  })

  const achados: SuspeitaDuplicidade[] = []
  for (const c of candidatas) {
    const sNome = similaridade(nome, c.name)
    const sFantasia = c.nomeFantasia ? similaridade(nome, c.nomeFantasia) : 0
    const s = Math.max(sNome, sFantasia)
    if (s >= limiar) {
      achados.push({
        id: c.id, publicCode: c.publicCode, name: c.name,
        paisId: c.paisId, pais: c.pais?.countryLabel ?? null,
        similaridade: Number(s.toFixed(2)),
        motivo: s === 1 ? 'nome equivalente (só difere em acento/pontuação)' : 'nome muito parecido',
      })
    }
  }
  return achados.sort((a, b) => b.similaridade - a.similaridade).slice(0, 10)
}

/** União de funções sem repetir — acrescentar função NUNCA remove as que já existem. */
export function unirFuncoes(atuais: FuncaoOrganizacao[], novas: FuncaoOrganizacao[]): FuncaoOrganizacao[] {
  const set = new Set<FuncaoOrganizacao>([...(atuais ?? []), ...(novas ?? [])])
  return FUNCOES.filter((f) => set.has(f))
}
