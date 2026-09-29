// src/services/orgao-vinculo-documento.ts
// ============================================================================
// CARTÓRIO DO PAINEL DO DOCUMENTO — de texto livre para cadastro (29/09/2026).
//
// UMA porta para "este documento é emitido por este órgão": grava
// `Documento.orgaoId` E `Tarefa.orgaoId` (as tarefas do documento) na MESMA
// transação — a mesma escrita que `vincular-orgao-lote` faz por tarefa. Toda
// rota que vincula órgão a documento chama `vincularOrgaoAoDocumento`.
//
// Também: busca por proximidade (nome/cidade/UF/tipo), cadastro rápido com
// bloqueio de duplicidade (nome normalizado igual na mesma cidade/UF) e a
// lista "órgãos a mapear" (texto livre legado sem `orgaoId`).
// ============================================================================
import type { Prisma, PrismaClient } from "@prisma/client"
import { chaveDeNome, similaridade } from "@/src/services/organizacao-identidade"

type DB = Prisma.TransactionClient | PrismaClient

export const TIPOS_ORGAO_RAPIDO = ["CARTORIO", "CONSULADO", "JUIZO", "OUTRO"] as const
export type TipoOrgaoRapido = (typeof TIPOS_ORGAO_RAPIDO)[number]
/** Valor gravado em `OrgaoProtocolo.type` (vocabulário minúsculo do cadastro). */
const TIPO_GRAVADO: Record<TipoOrgaoRapido, string> = {
  CARTORIO: "cartorio", CONSULADO: "consulado", JUIZO: "tribunal", OUTRO: "outro",
}

const norm = (v: string | null | undefined) => chaveDeNome(v ?? "")
const ufDe = (v: string | null | undefined) => (v ?? "").trim().toUpperCase()

export interface OrgaoBusca {
  id: number; name: string; nomeFantasia: string | null; type: string | null
  city: string | null; state: string | null; pais: string | null; score: number
}

/** Autocomplete: cada termo precisa aparecer em nome/fantasia/cidade/UF/tipo; ordena por proximidade. */
export async function buscarOrgaos(db: DB, q: string, opts: { uf?: string; limit?: number } = {}): Promise<OrgaoBusca[]> {
  const termos = norm(q).split(" ").filter(Boolean)
  if (termos.length === 0) return []
  const uf = ufDe(opts.uf)
  const rows = await db.orgaoProtocolo.findMany({
    where: {
      ativo: true,
      ...(uf ? { state: { equals: uf, mode: "insensitive" as const } } : {}),
      AND: termos.map((t) => ({
        OR: [
          { name: { contains: t, mode: "insensitive" as const } },
          { nomeFantasia: { contains: t, mode: "insensitive" as const } },
          { city: { contains: t, mode: "insensitive" as const } },
          { state: { contains: t, mode: "insensitive" as const } },
          { type: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, name: true, nomeFantasia: true, type: true, city: true, state: true, pais: { select: { countryLabel: true } } },
    take: 200,
  })
  const limit = Math.min(50, Math.max(1, opts.limit ?? 15))
  return rows
    .map((o) => {
      const alvo = [o.name, o.city, o.state].filter(Boolean).join(" ")
      const score = Math.max(similaridade(q, alvo), o.nomeFantasia ? similaridade(q, o.nomeFantasia) : 0)
      return { id: o.id, name: o.name, nomeFantasia: o.nomeFantasia, type: o.type, city: o.city, state: o.state, pais: o.pais?.countryLabel ?? null, score: Number(score.toFixed(3)) }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** A escrita única: Documento + Tarefas do documento, na mesma transação. */
export async function vincularOrgaoAoDocumento(db: PrismaClient, documentoId: number, orgaoId: number) {
  return db.$transaction(async (tx) => {
    const org = await tx.orgaoProtocolo.findUnique({ where: { id: orgaoId }, select: { id: true, name: true } })
    if (!org) throw new OrgaoInexistenteError()
    const doc = await tx.documento.findUnique({ where: { id: documentoId }, select: { id: true } })
    if (!doc) throw new DocumentoInexistenteError()
    await tx.documento.update({ where: { id: documentoId }, data: { orgaoId } })
    const t = await tx.tarefa.updateMany({ where: { documentoId }, data: { orgaoId } })
    return { orgao: org, tarefasVinculadas: t.count }
  }, { timeout: 20000, maxWait: 10000 })
}
export class OrgaoInexistenteError extends Error { constructor() { super("Órgão não cadastrado.") } }
export class DocumentoInexistenteError extends Error { constructor() { super("Documento não encontrado.") } }

export interface EntradaNovoOrgao {
  name: string; tipo: string; city: string; state?: string | null; paisId?: number | null
  email?: string | null; telefone?: string | null
}

/** Órgão já cadastrado que é a MESMA entidade: nome normalizado igual na mesma cidade/UF (ou mesmo nome+país). */
export async function acharDuplicado(db: DB, e: Pick<EntradaNovoOrgao, "name" | "city" | "state" | "paisId">) {
  const chave = norm(e.name)
  const cidade = norm(e.city)
  const uf = ufDe(e.state)
  const mesmaCidade = await db.orgaoProtocolo.findMany({
    where: { city: { equals: e.city.trim(), mode: "insensitive" } },
    select: { id: true, name: true, city: true, state: true, type: true },
    take: 500,
  })
  const hit = mesmaCidade.find((o) => norm(o.name) === chave && norm(o.city) === cidade && (!uf || !o.state || ufDe(o.state) === uf))
  if (hit) return hit
  // A chave única do cadastro é (nome oficial, país): mesma grafia exata também é a mesma entidade.
  const exato = await db.orgaoProtocolo.findFirst({
    where: { name: e.name.trim(), paisId: e.paisId ?? null },
    select: { id: true, name: true, city: true, state: true, type: true },
  })
  return exato ?? null
}

export type ResultadoCadastro =
  | { ok: true; orgaoId: number; criado: true }
  | { ok: false; code: "CAMPOS_OBRIGATORIOS" | "TIPO_INVALIDO" | "PAIS_INEXISTENTE"; mensagem: string }
  | { ok: false; code: "DUPLICADO"; mensagem: string; existente: { id: number; name: string; city: string | null; state: string | null; type: string | null } }

export async function cadastrarOrgaoRapido(db: PrismaClient, e: EntradaNovoOrgao, usuarioId: number | null): Promise<ResultadoCadastro> {
  const name = (e.name ?? "").trim().slice(0, 200)
  const city = (e.city ?? "").trim().slice(0, 100)
  const tipo = String(e.tipo ?? "").toUpperCase() as TipoOrgaoRapido
  if (!name || !city || !e.tipo) return { ok: false, code: "CAMPOS_OBRIGATORIOS", mensagem: "Nome, tipo e cidade são obrigatórios." }
  if (!TIPOS_ORGAO_RAPIDO.includes(tipo)) return { ok: false, code: "TIPO_INVALIDO", mensagem: "Tipo inválido." }
  const paisId = e.paisId && Number.isInteger(e.paisId) && e.paisId > 0 ? e.paisId : null
  if (paisId != null) {
    const p = await db.catalogoPais.findUnique({ where: { id: paisId }, select: { id: true } })
    if (!p) return { ok: false, code: "PAIS_INEXISTENTE", mensagem: "País não encontrado no Cadastro Mestre." }
  }
  const state = e.state?.trim() ? e.state.trim().slice(0, 60) : null
  const dup = await acharDuplicado(db, { name, city, state, paisId })
  if (dup) return { ok: false, code: "DUPLICADO", mensagem: `Já existe "${dup.name}" cadastrado nesta cidade.`, existente: dup }

  const criado = await db.orgaoProtocolo.create({
    data: {
      name, city, state, paisId, type: TIPO_GRAVADO[tipo], funcoes: ["ORGAO"], ativo: true,
      email: e.email?.trim() ? e.email.trim().slice(0, 200) : null,
      telefone: e.telefone?.trim() ? e.telefone.trim().slice(0, 60) : null,
    },
    select: { id: true },
  })
  await db.logAuditoria.create({
    data: {
      acao: "ORGAO_CRIADO_PAINEL_DOCUMENTO", entidade: "OrgaoProtocolo", entidadeId: criado.id,
      descricao: `Órgão "${name}" (${TIPO_GRAVADO[tipo]}) cadastrado inline no painel do documento.`, usuarioId,
    },
  }).catch(() => null)
  return { ok: true, orgaoId: criado.id, criado: true }
}

export interface OrgaoAMapear {
  texto: string; origem: "DOCUMENTO_CARTORIO"; documentos: number; tarefas: number
  documentoIds: number[]
}

/** Texto livre (Documento.cartorio) sem `orgaoId`, agrupado por texto normalizado, com contagem. */
export async function orgaosAMapear(db: DB): Promise<OrgaoAMapear[]> {
  const docs = await db.documento.findMany({
    where: { orgaoId: null, cartorio: { not: null } },
    select: { id: true, cartorio: true, _count: { select: { tarefasVinculadas: true } } },
  })
  const grupos = new Map<string, OrgaoAMapear & { variantes: Map<string, number> }>()
  for (const d of docs) {
    const texto = (d.cartorio ?? "").trim()
    if (!texto) continue
    const k = norm(texto) || texto.toLowerCase()
    let g = grupos.get(k)
    if (!g) { g = { texto, origem: "DOCUMENTO_CARTORIO", documentos: 0, tarefas: 0, documentoIds: [], variantes: new Map() }; grupos.set(k, g) }
    g.documentos++; g.tarefas += d._count.tarefasVinculadas; g.documentoIds.push(d.id)
    g.variantes.set(texto, (g.variantes.get(texto) ?? 0) + 1)
  }
  return [...grupos.values()]
    .map(({ variantes, ...g }) => ({ ...g, texto: [...variantes.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.documentos - a.documentos || a.texto.localeCompare(b.texto))
}
