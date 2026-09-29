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
  /** `cadastrado` = já existe como `OrgaoProtocolo`, vincula direto. `cartorio_nacional` =
   *  achado na base nacional de cartórios (`Cartorio`, 7000+ registros, fonte
   *  Registro Civil/Transparência) mas AINDA não promovido a `OrgaoProtocolo` — vincular
   *  passa por `cartorioId`, que promove (cria o `OrgaoProtocolo` a partir do `Cartorio`,
   *  ou reaproveita um já promovido) e só então vincula. */
  origem: "cadastrado" | "cartorio_nacional"
  cartorioId: number | null
}

/**
 * Autocomplete: cada termo precisa aparecer em nome/fantasia/cidade/UF/tipo; ordena por
 * proximidade. Busca as DUAS fontes — `OrgaoProtocolo` (o cadastro operacional, o que
 * `Documento.orgaoId` referencia) e `Cartorio` (a base nacional, só referência, nunca
 * vinculada direto) — e as funde.
 *
 * Achado real (mandato ao vivo, 29/09/2026): a busca só olhava `OrgaoProtocolo`, que
 * não tem cartório de registro civil brasileiro nenhum (city="São Paulo" ali é
 * instituição financeira — Nu Pagamentos, PagSeguro — não cartório). A base real
 * (`Cartorio`, 7000+ linhas, `Santos - 1º/2º Subdistrito` incluso) sempre existiu, só
 * nunca foi ligada a esta busca — "santos" sempre voltava vazio, para QUALQUER
 * cartório brasileiro, não só Santos.
 */
export async function buscarOrgaos(db: DB, q: string, opts: { uf?: string; limit?: number } = {}): Promise<OrgaoBusca[]> {
  const termos = norm(q).split(" ").filter(Boolean)
  if (termos.length === 0) return []
  const uf = ufDe(opts.uf)
  const limit = Math.min(50, Math.max(1, opts.limit ?? 15))

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
  const cadastrados: OrgaoBusca[] = rows.map((o) => {
    const alvo = [o.name, o.city, o.state].filter(Boolean).join(" ")
    const score = Math.max(similaridade(q, alvo), o.nomeFantasia ? similaridade(q, o.nomeFantasia) : 0)
    return { id: o.id, name: o.name, nomeFantasia: o.nomeFantasia, type: o.type, city: o.city, state: o.state, pais: o.pais?.countryLabel ?? null, score: Number(score.toFixed(3)), origem: "cadastrado" as const, cartorioId: null }
  })
  // Chaves (nome normalizado + cidade normalizada) já cobertas por `OrgaoProtocolo` —
  // um `Cartorio` que bate numa delas não é sugestão nova, é o mesmo cartório já
  // promovido (mesma régua de `acharDuplicado`, só que em memória).
  const jaCadastrado = new Set(cadastrados.map((o) => `${norm(o.name)}|${norm(o.city)}`))

  const cartRows = await db.cartorio.findMany({
    where: {
      ativo: true,
      ...(uf ? { uf: { equals: uf, mode: "insensitive" as const } } : {}),
      AND: termos.map((t) => ({
        OR: [
          { nome: { contains: t, mode: "insensitive" as const } },
          { municipio: { contains: t, mode: "insensitive" as const } },
          { uf: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    select: { id: true, nome: true, municipio: true, uf: true },
    take: 200,
  })
  const cartorios: OrgaoBusca[] = cartRows
    .filter((c) => !jaCadastrado.has(`${norm(c.nome)}|${norm(c.municipio)}`))
    .map((c) => {
      const alvo = [c.nome, c.municipio, c.uf].filter(Boolean).join(" ")
      const score = similaridade(q, alvo)
      // `id` negativo: só pra ter uma chave única e nunca colidir com um `OrgaoProtocolo.id`
      // real na lista renderizada. NUNCA é enviado como `orgaoId` pra vincular — quem
      // seleciona esta linha manda `cartorioId` (`promoverCartorioParaOrgao`), não `id`.
      return { id: -c.id, name: c.nome, nomeFantasia: null, type: "cartorio", city: c.municipio, state: c.uf, pais: null, score: Number(score.toFixed(3)), origem: "cartorio_nacional" as const, cartorioId: c.id }
    })

  return [...cadastrados, ...cartorios]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * PROMOVE um `Cartorio` (base nacional, referência) a `OrgaoProtocolo` (cadastro
 * operacional, o que `Documento.orgaoId` de fato referencia) — idempotente: se já
 * existe um `OrgaoProtocolo` pra mesma entidade (nome+cidade normalizados), reaproveita
 * em vez de duplicar. `paisId` fica `null` de propósito: `CatalogoPais` só cadastra os
 * países de CIDADANIA OFERTADA (Itália/Espanha/Portugal/Alemanha) — Brasil, país de
 * ORIGEM dos registros civis, nunca vai entrar ali, e inventar um valor seria a segunda
 * fonte que este campo existe pra evitar.
 */
export async function promoverCartorioParaOrgao(db: PrismaClient, cartorioId: number, usuarioId: number | null): Promise<{ orgaoId: number; criado: boolean }> {
  const c = await db.cartorio.findUnique({ where: { id: cartorioId }, select: { nome: true, municipio: true, uf: true, telefone: true, email: true } })
  if (!c) throw new OrgaoInexistenteError()
  const dup = await acharDuplicado(db, { name: c.nome, city: c.municipio, state: c.uf, paisId: null })
  if (dup) return { orgaoId: dup.id, criado: false }
  const criado = await db.orgaoProtocolo.create({
    data: {
      name: c.nome, city: c.municipio, state: c.uf, paisId: null, type: TIPO_GRAVADO.CARTORIO, funcoes: ["ORGAO"], ativo: true,
      email: c.email, telefone: c.telefone,
    },
    select: { id: true },
  })
  await db.logAuditoria.create({
    data: {
      acao: "ORGAO_PROMOVIDO_DE_CARTORIO_NACIONAL", entidade: "OrgaoProtocolo", entidadeId: criado.id,
      descricao: `Órgão "${c.nome}" (${c.municipio}/${c.uf}) promovido da base nacional de cartórios (Cartorio#${cartorioId}) no painel do documento.`, usuarioId,
    },
  }).catch(() => null)
  return { orgaoId: criado.id, criado: true }
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
