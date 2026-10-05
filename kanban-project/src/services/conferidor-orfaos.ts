// src/services/conferidor-orfaos.ts
// ============================================================================
// CONFERIDOR SEMANAL DE ARQUIVOS ÓRFÃOS — SÓ RELATÓRIO. NUNCA APAGA NADA.
//
// Compara o que EXISTE nos buckets com o que o BANCO referencia e lista: (1) órfãos — objeto no bucket que nenhuma linha referencia;
// (2) referências sem objeto — linha que aponta para um arquivo que não está em nenhum bucket; (3) cópias legadas no público — objeto
// `privado/` que ainda está no bucket público como plano B do modo duplo (já referenciado; o apagar é um ato separado, com ordem do dono).
// Apagar órfão exige a ORDEM EXPLÍCITA do dono (docs/proposta-anexos-cliente-e-privacidade.md): este módulo não importa nenhuma função de
// exclusão — um teste do gate garante isso.
//
// COMO NÃO FICAR CEGO PARA UMA TABELA NOVA: `FONTES_DE_CHAVES` é a lista de onde o banco guarda chave/endereço de arquivo. O teste
// `conferidor-orfaos.test.ts` lê o schema e FALHA se aparecer coluna de arquivo que não esteja aqui (senão um arquivo em uso viraria "órfão").
// ============================================================================
import { prisma } from "@/lib/prisma"
import { chaveDeUrlOuChave } from "@/src/services/processo-arquivos"
import { configDosBuckets, ehChavePrivada, type ConfigBuckets } from "@/src/lib/r2-buckets"

export interface FonteDeChave { tabela: string; coluna: string }

/** Onde o banco guarda a chave (ou o endereço) de um arquivo no storage. */
export const FONTES_DE_CHAVES: readonly FonteDeChave[] = [
  { tabela: "ColetaArquivo", coluna: "chave" },
  { tabela: "AnexoProcesso", coluna: "urlArquivo" },
  { tabela: "AnexoContratante", coluna: "urlArquivo" },
  { tabela: "AnexoRequerente", coluna: "urlArquivo" },
  { tabela: "AnexoProtocolo", coluna: "urlArquivo" },
  { tabela: "DocumentoArquivo", coluna: "url" },
  { tabela: "ReceitaDocumento", coluna: "arquivoUrl" },
  { tabela: "Recibo", coluna: "pdfUrl" },
  { tabela: "DocumentoGeradoVersao", coluna: "docxChave" },
  { tabela: "DocumentoGeradoVersao", coluna: "pdfChave" },
  { tabela: "ModeloDocumentalVersao", coluna: "arquivoChave" },
] as const

/** Prefixos de backup INTENCIONAL (feitos por ordem do dono): aparecem à parte, nunca como órfãos. */
export const PREFIXOS_DE_BACKUP: readonly string[] = ["backup-"]

export interface ObjetoDoBucket { chave: string; tamanho: number; data: string | null }
export interface ObjetosPorBucket { publico: ObjetoDoBucket[]; privado: ObjetoDoBucket[] }

export interface RelatorioDeOrfaos {
  geradoEm: string
  buckets: { publico: string; privado: string | null }
  totais: { objetosPublico: number; objetosPrivado: number; chavesNoBanco: number }
  orfaos: Array<ObjetoDoBucket & { bucket: "publico" | "privado" }>
  bytesOrfaos: number
  /** Linha do banco apontando para arquivo que não está em nenhum bucket. */
  referenciasSemObjeto: string[]
  /** `privado/` ainda no bucket público como plano B do modo duplo (já referenciado). */
  copiasLegadasNoPublico: string[]
  /** Objetos em prefixo de backup intencional (não contam como órfãos). */
  backupsIntencionais: number
  /** Links ainda ativos há mais de 90 dias com envios pendentes (só aviso — nada é apagado por isso). */
  linksAtivosAntigosComPendentes?: LinkAntigoComPendentes[]
  /** Lembrete fixo: este relatório nunca apaga. */
  nota: string
}

/** Link ainda ATIVO há mais de 90 dias com envios pendentes: só relatório (o dono decide; o sistema não apaga por isso). */
export const DIAS_LINK_ATIVO_ANTIGO = 90
export interface LinkAntigoComPendentes { linkId: number; processoId: number; criadoEm: string; diasAtivo: number; pendentes: number }

/** PURA — filtra e ordena (mais antigo primeiro). */
export function linksAtivosAntigosComPendentes(
  links: Array<{ linkId: number; processoId: number; criadoEm: Date; pendentes: number }>, agora: Date,
): LinkAntigoComPendentes[] {
  return links
    .map((l) => ({ ...l, diasAtivo: Math.floor((agora.getTime() - l.criadoEm.getTime()) / 86_400_000) }))
    .filter((l) => l.pendentes > 0 && l.diasAtivo > DIAS_LINK_ATIVO_ANTIGO)
    .sort((a, b) => b.diasAtivo - a.diasAtivo || a.linkId - b.linkId)
    .map((l) => ({ linkId: l.linkId, processoId: l.processoId, criadoEm: l.criadoEm.toISOString(), diasAtivo: l.diasAtivo, pendentes: l.pendentes }))
}

/** Lê (só leitura) os links ativos com envios pendentes. */
export async function lerLinksAtivosComPendentes(agora = new Date()): Promise<LinkAntigoComPendentes[]> {
  const links = await prisma.coletaLink.findMany({
    where: { encerradoEm: null, envios: { some: { status: "PENDENTE" } } },
    select: { id: true, processoId: true, criadoEm: true, _count: { select: { envios: { where: { status: "PENDENTE" } } } } },
  })
  return linksAtivosAntigosComPendentes(links.map((l) => ({ linkId: l.id, processoId: l.processoId, criadoEm: l.criadoEm, pendentes: l._count.envios })), agora)
}

export const NOTA_DO_RELATORIO = "Somente relatório. Nada foi apagado. Apagar órfão exige a ordem explícita do dono."

/** PURA — a comparação. Testável com dados soltos. */
export function compararObjetosComReferencias(args: {
  objetos: ObjetosPorBucket
  chavesReferenciadas: ReadonlySet<string>
  buckets: ConfigBuckets
  agora?: Date
}): RelatorioDeOrfaos {
  const { objetos, chavesReferenciadas: ref, buckets } = args
  const ehBackup = (k: string) => PREFIXOS_DE_BACKUP.some((p) => k.startsWith(p))
  const orfaos: RelatorioDeOrfaos["orfaos"] = []
  const copias: string[] = []
  let backups = 0
  const existentes = new Set<string>()
  const examinar = (lista: ObjetoDoBucket[], bucket: "publico" | "privado") => {
    for (const o of lista) {
      existentes.add(o.chave)
      if (ehBackup(o.chave)) { backups++; continue }
      if (!ref.has(o.chave)) { orfaos.push({ ...o, bucket }); continue }
      if (bucket === "publico" && buckets.privado != null && ehChavePrivada(o.chave)) copias.push(o.chave)
    }
  }
  examinar(objetos.publico, "publico")
  examinar(objetos.privado, "privado")
  const semObjeto = [...ref].filter((k) => !existentes.has(k)).sort()
  return {
    geradoEm: (args.agora ?? new Date()).toISOString(),
    buckets: { publico: buckets.publico, privado: buckets.privado },
    totais: { objetosPublico: objetos.publico.length, objetosPrivado: objetos.privado.length, chavesNoBanco: ref.size },
    orfaos: orfaos.sort((a, b) => a.chave.localeCompare(b.chave)),
    bytesOrfaos: orfaos.reduce((s, o) => s + o.tamanho, 0),
    referenciasSemObjeto: semObjeto,
    copiasLegadasNoPublico: copias.sort(),
    backupsIntencionais: backups,
    nota: NOTA_DO_RELATORIO,
  }
}

/** Lê do banco TODAS as chaves referenciadas (só SELECT), já normalizadas (endereço → chave). */
export async function lerChavesReferenciadasNoBanco(urlPublica: string | null | undefined = process.env.R2_PUBLIC_URL): Promise<Set<string>> {
  const out = new Set<string>()
  for (const f of FONTES_DE_CHAVES) {
    const linhas = await prisma.$queryRawUnsafe<Array<{ v: string | null }>>(`SELECT "${f.coluna}" AS v FROM "${f.tabela}" WHERE "${f.coluna}" IS NOT NULL`)
    for (const l of linhas) { const k = chaveDeUrlOuChave(l.v, urlPublica); if (k) out.add(k) }
  }
  return out
}

/** Lista os objetos dos buckets (só LIST: nomes, tamanhos e datas — nunca abre o conteúdo). */
export async function listarObjetosDosBuckets(cfg: ConfigBuckets = configDosBuckets()): Promise<ObjetosPorBucket> {
  const { r2 } = await import("@/src/lib/r2")
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3")
  const listar = async (bucket: string): Promise<ObjetoDoBucket[]> => {
    const out: ObjetoDoBucket[] = []
    let token: string | undefined
    do {
      const r = await r2.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }))
      for (const o of r.Contents ?? []) out.push({ chave: o.Key!, tamanho: o.Size ?? 0, data: o.LastModified?.toISOString() ?? null })
      token = r.NextContinuationToken
    } while (token)
    return out
  }
  return { publico: await listar(cfg.publico), privado: cfg.privado ? await listar(cfg.privado) : [] }
}

const LIMITE_NA_AUDITORIA = 300

/** O conferidor inteiro: lê, compara, REGISTRA na auditoria (resumo + as primeiras chaves) e devolve o relatório. Não apaga nada. */
export async function conferirOrfaos(): Promise<RelatorioDeOrfaos> {
  const cfg = configDosBuckets()
  const [objetos, chaves] = await Promise.all([listarObjetosDosBuckets(cfg), lerChavesReferenciadasNoBanco()])
  const rel: RelatorioDeOrfaos = { ...compararObjetosComReferencias({ objetos, chavesReferenciadas: chaves, buckets: cfg }), linksAtivosAntigosComPendentes: await lerLinksAtivosComPendentes() }
  await prisma.logAuditoria.create({
    data: {
      acao: "conferidor_orfaos_relatorio",
      entidade: "Storage",
      entidadeId: 0,
      descricao: `Conferidor semanal: ${rel.orfaos.length} órfão(s) (${rel.bytesOrfaos} bytes), ${rel.referenciasSemObjeto.length} referência(s) sem objeto, ${rel.copiasLegadasNoPublico.length} cópia(s) legada(s) no público, ${rel.linksAtivosAntigosComPendentes?.length ?? 0} link(s) ativo(s) há mais de ${DIAS_LINK_ATIVO_ANTIGO} dias com envio pendente. ${NOTA_DO_RELATORIO}`,
      detalhes: JSON.parse(JSON.stringify({
        totais: rel.totais, bytesOrfaos: rel.bytesOrfaos, backupsIntencionais: rel.backupsIntencionais,
        orfaos: rel.orfaos.slice(0, LIMITE_NA_AUDITORIA), orfaosTruncado: rel.orfaos.length > LIMITE_NA_AUDITORIA,
        referenciasSemObjeto: rel.referenciasSemObjeto.slice(0, LIMITE_NA_AUDITORIA), copiasLegadasNoPublico: rel.copiasLegadasNoPublico.slice(0, LIMITE_NA_AUDITORIA),
        linksAtivosAntigosComPendentes: rel.linksAtivosAntigosComPendentes ?? [],
        nota: NOTA_DO_RELATORIO,
      })),
    },
  })
  if (rel.orfaos.length) console.warn(`[conferidor-orfaos] ${rel.orfaos.length} órfão(s) — ver auditoria; NADA foi apagado.`)
  return rel
}
