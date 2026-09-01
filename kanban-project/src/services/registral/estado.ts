// src/services/registral/estado.ts
//
// MRG — carregamento do ESTADO GENEALÓGICO para os motores puros.
//
// Papel único: ler do banco e montar as entradas de `integridade`,
// `elegibilidade` e `versao`. Nenhuma regra vive aqui — regra vive nos módulos
// puros, que são os que estão cobertos por teste.
//
// É aqui também que se resolve a COMPROVAÇÃO DOCUMENTAL por pessoa: quais campos
// registrais estão confirmados. A fonte é dupla e declarada:
//   · FatoRegistral em estado CONFIRMADO / CONFIRMADO_MULTIPLAS_EVIDENCIAS;
//   · NecessidadeDocumental ATENDIDA do Sistema Documental (que é o dono da
//     exigência) — uma certidão de nascimento atendida comprova nascimento e
//     filiação daquela pessoa.

import { prisma } from "@/lib/prisma"
import { VINCULO_PROCESSO_ATIVO, PESSOA_ATIVA } from "@/src/lib/genealogia/vinculo-ativo"
import type { Prisma } from "@prisma/client"
import type { PessoaEntrada, UniaoEntrada, PaisAlvo } from "@/src/lib/genealogia/motor/tipos"
import type { CampoRegistral } from "@/src/lib/genealogia/registral/tipos"
import type { FatoParaIntegridade } from "@/src/lib/genealogia/registral/integridade"
import type { AliasSnapshot, FatoSnapshot } from "@/src/lib/genealogia/registral/versao"
import type { EstadoGenealogico } from "@/src/lib/genealogia/registral/impacto"
import { TETO_PESSOAS_IMPACTO } from "./constantes"

type DB = typeof prisma | Prisma.TransactionClient

export interface ContextoProcesso {
  processoId: number
  arvoreId: number | null
  paisAlvo: PaisAlvo | null
  requerenteIds: number[]
  raizId: number | null
}

const MAPA_PAIS: Record<string, PaisAlvo> = {
  ITALIA: "ITALIA",
  IT: "ITALIA",
  PORTUGAL: "PORTUGAL",
  PT: "PORTUGAL",
  ESPANHA: "ESPANHA",
  ES: "ESPANHA",
  ALEMANHA: "ALEMANHA",
  DE: "ALEMANHA",
}

export async function carregarContexto(db: DB, processoId: number): Promise<ContextoProcesso | null> {
  const proc = await db.processo.findUnique({
    where: { id: processoId },
    select: {
      id: true,
      arvoreId: true,
      paisCanonico: { select: { countryKey: true } },
      arvore: { select: { id: true, pessoaPrincipalId: true } },
      requerentes: { where: VINCULO_PROCESSO_ATIVO, select: { requerente: { select: { personId: true } } } },
    },
  })
  if (!proc) return null

  const dosPapeis = proc.requerentes
    .map((r) => r.requerente?.personId ?? null)
    .filter((x): x is number => x != null)

  // Requerente também pode estar marcado na própria árvore (Pessoa.requerente).
  const marcados = proc.arvoreId
    ? await db.pessoa.findMany({
        where: { arvoreId: proc.arvoreId, requerente: { in: ["sim", "maior", "menor"] } },
        select: { id: true },
      })
    : []

  return {
    processoId: proc.id,
    arvoreId: proc.arvoreId ?? null,
    // POR IDENTIDADE: a chave canônica do cadastro resolve direto o alvo. O
    // mapa continua existindo só para as siglas (IT/PT/ES/DE) e para linha sem
    // `paisId` — e some com a coluna espelho.
    paisAlvo: MAPA_PAIS[(proc.paisCanonico?.countryKey ?? String(proc.paisCanonico?.countryKey || "")).toUpperCase()] ?? null,
    requerenteIds: [...new Set([...dosPapeis, ...marcados.map((m) => m.id)])].sort((a, b) => a - b),
    raizId: proc.arvore?.pessoaPrincipalId ?? null,
  }
}

const SELECT_PESSOA = {
  id: true,
  nome: true,
  sobrenome: true,
  sexo: true,
  data_nasc: true,
  data_obito: true,
  local_nasc: true,
  estado_nasc: true,
  pais_nasc: true,
  vivo: true,
  batizado: true,
  data_batismo: true,
  local_batismo: true,
  igreja_batismo: true,
  profissao: true,
  nacionalidade: true,
  naturalizado: true,
  data_naturalizacao: true,
  pais_naturalizacao: true,
  data_emigracao: true,
  local_emigracao: true,
  porto_embarque: true,
  data_chegada: true,
  porto_chegada: true,
  pais_destino: true,
  navio: true,
  requerente: true,
  casado: true,
  numeroLinhagem: true,
  linhaReta: true,
  documentacao: true,
  paiId: true,
  maeId: true,
  arvoreId: true,
} satisfies Prisma.PessoaSelect

export async function carregarPessoas(db: DB, arvoreId: number): Promise<PessoaEntrada[]> {
  const linhas = await db.pessoa.findMany({
    where: { arvoreId },
    select: SELECT_PESSOA,
    orderBy: { id: "asc" },
    take: TETO_PESSOAS_IMPACTO,
  })
  return linhas.map((p) => ({ ...p })) as PessoaEntrada[]
}

export async function carregarUnioes(db: DB, pessoaIds: number[]): Promise<UniaoEntrada[]> {
  if (!pessoaIds.length) return []
  const linhas = await db.uniao.findMany({
    where: { OR: [{ pessoa1Id: { in: pessoaIds } }, { pessoa2Id: { in: pessoaIds } }] },
    select: {
      id: true,
      pessoa1Id: true,
      pessoa2Id: true,
      data_inicio: true,
      data_fim: true,
      tipo: true,
      local: true,
      cartorio: true,
    },
    orderBy: { id: "asc" },
  })
  return linhas as UniaoEntrada[]
}

/** Fatos registrais ATIVOS das pessoas/uniões dadas, com os documentos que os sustentam. */
export async function carregarFatos(
  db: DB,
  pessoaIds: number[],
  uniaoIds: number[],
): Promise<FatoParaIntegridade[]> {
  if (!pessoaIds.length && !uniaoIds.length) return []
  const fatos = await db.fatoRegistral.findMany({
    where: {
      ativo: true,
      OR: [
        ...(pessoaIds.length ? [{ pessoaId: { in: pessoaIds } }] : []),
        ...(uniaoIds.length ? [{ uniaoId: { in: uniaoIds } }] : []),
      ],
    },
    select: {
      pessoaId: true,
      uniaoId: true,
      campo: true,
      valorNormalizado: true,
      valorData: true,
      estado: true,
      evidencias: { select: { documentoId: true } },
    },
    orderBy: { id: "asc" },
  })
  return fatos.map((f) => ({
    pessoaId: f.pessoaId,
    uniaoId: f.uniaoId,
    campo: f.campo as CampoRegistral,
    valorNormalizado: f.valorNormalizado,
    valorData: f.valorData ? f.valorData.toISOString().slice(0, 10) : null,
    estado: f.estado,
    documentoIds: [...new Set(f.evidencias.map((e) => e.documentoId))],
  }))
}

/**
 * Campos comprovados por pessoa. Duas fontes, ambas oficiais:
 *   (a) FatoRegistral confirmado;
 *   (b) NecessidadeDocumental ATENDIDA — quem decide exigência documental é o
 *       Sistema Documental, então uma necessidade atendida comprova os campos que
 *       aquele documento mestre carrega.
 */
export async function carregarComprovacao(
  db: DB,
  processoId: number,
  pessoaIds: number[],
): Promise<Map<number, Set<CampoRegistral>>> {
  const mapa = new Map<number, Set<CampoRegistral>>()
  const add = (pessoaId: number, campos: CampoRegistral[]) => {
    let s = mapa.get(pessoaId)
    if (!s) {
      s = new Set<CampoRegistral>()
      mapa.set(pessoaId, s)
    }
    for (const c of campos) s.add(c)
  }

  if (pessoaIds.length) {
    const confirmados = await db.fatoRegistral.findMany({
      where: {
        ativo: true,
        pessoaId: { in: pessoaIds },
        estado: { in: ["CONFIRMADO", "CONFIRMADO_MULTIPLAS_EVIDENCIAS"] },
      },
      select: { pessoaId: true, campo: true },
    })
    for (const f of confirmados) {
      if (f.pessoaId != null) add(f.pessoaId, [f.campo as CampoRegistral])
    }
  }

  const atendidas = await db.necessidadeDocumental.findMany({
    where: { processoId, status: "ATENDIDA", pessoaId: { not: null } },
    select: { pessoaId: true, itemCatalogo: { select: { code: true, name: true } } },
  })
  for (const n of atendidas) {
    if (n.pessoaId == null) continue
    add(n.pessoaId, camposDoItemMestre(n.itemCatalogo?.code, n.itemCatalogo?.name))
  }

  return mapa
}

/**
 * Que campos registrais um Documento Mestre comprova. O critério é o CÓDIGO do
 * item (vocabulário estruturado do Sistema Documental), nunca o texto livre.
 */
export function camposDoItemMestre(code?: string | null, name?: string | null): CampoRegistral[] {
  const k = `${code ?? ""} ${name ?? ""}`.toUpperCase()
  if (k.includes("NASC")) {
    return ["DATA_NASCIMENTO", "LOCAL_NASCIMENTO", "FILIACAO_PAI", "FILIACAO_MAE", "NOME_REGISTRAL"]
  }
  if (k.includes("CASAM") || k.includes("MATRIM")) {
    return ["DATA_CASAMENTO", "LOCAL_CASAMENTO", "CONJUGE", "FILIACAO_PAI", "FILIACAO_MAE"]
  }
  if (k.includes("OBITO") || k.includes("ÓBITO")) {
    return ["DATA_OBITO", "LOCAL_OBITO", "NOME_REGISTRAL"]
  }
  if (k.includes("BATIS")) return ["DATA_BATISMO", "LOCAL_BATISMO", "FILIACAO_PAI", "FILIACAO_MAE"]
  if (k.includes("NATURALIZ") || k.includes("CNN")) return ["NATURALIZACAO"]
  return []
}

/** Monta o estado completo para impacto/revalidação. */
export async function carregarEstado(db: DB, processoId: number): Promise<EstadoGenealogico | null> {
  const ctx = await carregarContexto(db, processoId)
  if (!ctx || ctx.arvoreId == null) return null

  const pessoas = await carregarPessoas(db, ctx.arvoreId)
  const pessoaIds = pessoas.map((p) => p.id)
  const unioes = await carregarUnioes(db, pessoaIds)
  const fatos = await carregarFatos(db, pessoaIds, unioes.map((u) => u.id))
  const comprovacao = await carregarComprovacao(db, processoId, pessoaIds)

  return {
    integridade: { pessoas, unioes, requerenteIds: ctx.requerenteIds, fatos },
    elegibilidade: {
      pessoas,
      unioes,
      paisAlvo: ctx.paisAlvo,
      requerenteId: ctx.requerenteIds[0] ?? null,
      raizId: ctx.raizId,
      comprovacaoPorPessoa: comprovacao,
    },
  }
}

/** Fatos e aliases na forma do snapshot (versionamento). */
export async function carregarParaSnapshot(
  db: DB,
  pessoaIds: number[],
  uniaoIds: number[],
): Promise<{ fatos: FatoSnapshot[]; aliases: AliasSnapshot[] }> {
  if (!pessoaIds.length) return { fatos: [], aliases: [] }

  const fatos = await db.fatoRegistral.findMany({
    where: {
      ativo: true,
      OR: [
        { pessoaId: { in: pessoaIds } },
        ...(uniaoIds.length ? [{ uniaoId: { in: uniaoIds } }] : []),
      ],
    },
    select: {
      pessoaId: true,
      uniaoId: true,
      campo: true,
      valorNormalizado: true,
      estado: true,
      confianca: true,
      versao: true,
    },
  })

  const aliases = await db.nomePessoa.findMany({
    where: { pessoaId: { in: pessoaIds }, ativo: true },
    select: { pessoaId: true, nome: true, sobrenome: true, tipo: true, principal: true },
  })

  return {
    fatos: fatos.map((f) => ({
      pessoaId: f.pessoaId,
      uniaoId: f.uniaoId,
      campo: f.campo as CampoRegistral,
      valorNormalizado: f.valorNormalizado,
      estado: f.estado,
      confianca: f.confianca,
      versao: f.versao,
    })),
    aliases: aliases.map((a) => ({
      pessoaId: a.pessoaId,
      nome: a.nome,
      sobrenome: a.sobrenome,
      tipo: a.tipo,
      principal: a.principal,
    })),
  }
}

/** Nome exibível de cada pessoa (para explicações e propostas). */
export async function carregarNomes(db: DB, pessoaIds: number[]): Promise<Map<number, string>> {
  if (!pessoaIds.length) return new Map()
  const linhas = await db.pessoa.findMany({
    where: { id: { in: pessoaIds } },
    select: { id: true, nome: true, sobrenome: true },
  })
  return new Map(linhas.map((p) => [p.id, [p.nome, p.sobrenome].filter(Boolean).join(" ")]))
}

/**
 * Quantos PROCESSOS dependem de uma pessoa. Entra direto na análise de impacto:
 * mais de um processo afetado é bloqueio pela matriz de automação.
 */
export async function processosQueDependemDe(db: DB, pessoaIds: number[]): Promise<number[]> {
  if (!pessoaIds.length) return []
  const arvores = await db.pessoa.findMany({
    where: { id: { in: pessoaIds } },
    select: { arvoreId: true },
  })
  const arvoreIds = [...new Set(arvores.map((a) => a.arvoreId).filter((x): x is number => x != null))]

  const porArvore = arvoreIds.length
    ? await db.processo.findMany({ where: { arvoreId: { in: arvoreIds } }, select: { id: true } })
    : []

  const porRequerente = await db.processoRequerente.findMany({
    where: { requerente: { personId: { in: pessoaIds } } },
    select: { processoId: true },
  })

  return [...new Set([...porArvore.map((p) => p.id), ...porRequerente.map((p) => p.processoId)])].sort(
    (a, b) => a - b,
  )
}

/** Requerentes (papel) que apontam para estas pessoas. */
export async function requerentesQueDependemDe(db: DB, pessoaIds: number[]): Promise<number[]> {
  if (!pessoaIds.length) return []
  const linhas = await db.requerente.findMany({
    where: { personId: { in: pessoaIds } },
    select: { id: true },
  })
  return linhas.map((r) => r.id)
}
