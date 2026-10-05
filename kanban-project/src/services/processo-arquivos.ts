// src/services/processo-arquivos.ts
// ============================================================================
// EXCLUSÃO DE PROCESSO NÃO DEIXA ARQUIVO ÓRFÃO (ponto (b) de docs/proposta-anexos-cliente-e-privacidade.md).
//
// O problema: `Processo` cascateia (ON DELETE CASCADE) até as linhas que guardam a CHAVE de um arquivo no storage — e a linha some, o
// objeto não. Sem a linha, ninguém mais sabe que o objeto existe (foi o que deixou 287 arquivos de clientes sobrando no bucket).
//
// O que este módulo faz, em duas metades (a orquestração está em `processo-ciclo-vida.ts::excluirProcesso`):
//   1. LEVANTAR (dentro da transação, ANTES de apagar as linhas): as chaves de tudo que o processo possui no storage;
//   2. APAGAR (DEPOIS do commit): os objetos, com nova tentativa; o que não apagar é REGISTRADO e REPORTADO — nunca engolido.
//
// ─── REGRA DE CASCATA (conferida no banco de produção, `pg_constraint`, em 05/10/2026) ──────────────────────────────────────────
//   CASCATEIA a partir de Processo (a linha some, o arquivo ficava):
//     ColetaArquivo.chave (Processo → ColetaLink → ColetaEnvio → ColetaArquivo) · AnexoProcesso.urlArquivo ·
//     AnexoProtocolo.urlArquivo (Processo → Protocolo → AnexoProtocolo) · Recibo.pdfUrl · ReceitaDocumento.arquivoUrl (só quando
//     tem `receitaId`: Receita → ReceitaDocumento).
//   NÃO cascateia (a linha SOBREVIVE):
//     · ReceitaDocumento que só tem `obrigacaoId` — não há chave estrangeira; ao apagar o processo a linha ficava apontando para uma
//       obrigação que não existe mais, com o arquivo. Esta correção apaga essas linhas junto (são do processo, via obrigação).
//     · DocumentoGerado.processoId é SET NULL — o documento gerado (procuração etc.) e as VERSÕES dele (DocumentoGeradoVersao →
//       DocumentoGerado é CASCADE, mas o DocumentoGerado em si NÃO some com o processo) continuam no banco, com os arquivos de
//       `privado/documentos/`. Não são órfãos de storage (a linha ainda aponta para eles); perderam só o vínculo com o processo.
//       Por isso NÃO são apagados aqui: são REGISTRADOS na auditoria como "preservados". Apagá-los é decisão do dono.
//     · AnexoContratante / AnexoRequerente: pertencem ao CLIENTE, que continua existindo — não são do processo.
// ============================================================================
import type { Prisma, PrismaClient } from "@prisma/client"

type DB = Prisma.TransactionClient | PrismaClient

export type FonteDoArquivo = "COLETA" | "ANEXO_PROCESSO" | "ANEXO_PROTOCOLO" | "DOCUMENTO_FINANCEIRO" | "RECIBO"

export interface ArquivoDoProcesso { fonte: FonteDoArquivo; id: number; chave: string }

export interface LevantamentoDeArquivos {
  /** Chaves (únicas) de objetos NOSSOS que perderão a linha que os referencia. */
  arquivos: ArquivoDoProcesso[]
  /** Valores que não são do nosso storage (endereço de outro serviço): nada a apagar; fica registrado. */
  externos: Array<{ fonte: FonteDoArquivo; id: number }>
  /** `ReceitaDocumento` sem `receitaId` (só `obrigacaoId`): sem cascata — a exclusão apaga estas linhas junto. */
  documentosFinanceirosSemCascata: number[]
  /** Documentos gerados do processo que SOBREVIVEM (processoId vira nulo): só registro, nunca apagados aqui. */
  geradosPreservados: Array<{ documentoGeradoId: number; versoes: number }>
}

/** "https://pub-xxx.r2.dev/documentos/1/a b.pdf" → "documentos/1/a b.pdf"; chave pura → ela mesma; outro endereço → `null`. */
export function chaveDeUrlOuChave(valor: string | null | undefined, urlPublica: string | null | undefined): string | null {
  const v = String(valor ?? "").trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) return v.replace(/^\/+/, "") || null
  const base = String(urlPublica ?? "").trim().replace(/\/+$/, "")
  if (!base || !v.startsWith(`${base}/`)) return null
  const caminho = v.slice(base.length + 1).split("?")[0].split("#")[0]
  try { return decodeURIComponent(caminho) || null } catch { return caminho || null }
}

/** O que se lê do banco para levantar, sem acoplar a Prisma (testável com dados soltos). */
export function montarLevantamento(args: {
  urlPublica: string | null | undefined
  linhas: Array<{ fonte: FonteDoArquivo; id: number; valor: string | null }>
  documentosFinanceirosSemCascata: number[]
  geradosPreservados: Array<{ documentoGeradoId: number; versoes: number }>
}): LevantamentoDeArquivos {
  const vistas = new Set<string>()
  const arquivos: ArquivoDoProcesso[] = []
  const externos: LevantamentoDeArquivos["externos"] = []
  for (const l of args.linhas) {
    if (!String(l.valor ?? "").trim()) continue
    const chave = chaveDeUrlOuChave(l.valor, args.urlPublica)
    if (chave == null) { externos.push({ fonte: l.fonte, id: l.id }); continue }
    if (vistas.has(chave)) continue
    vistas.add(chave)
    arquivos.push({ fonte: l.fonte, id: l.id, chave })
  }
  return { arquivos, externos, documentosFinanceirosSemCascata: args.documentosFinanceirosSemCascata, geradosPreservados: args.geradosPreservados }
}

/** LEVANTA (só leitura) tudo que o processo possui no storage. Chamado DENTRO da transação da exclusão, antes de apagar as linhas. */
export async function levantarArquivosDoProcesso(processoId: number, db: DB, urlPublica: string | null | undefined = process.env.R2_PUBLIC_URL): Promise<LevantamentoDeArquivos> {
  const obrigacoes = await db.obrigacaoEconomica.findMany({ where: { processoId }, select: { id: true } })
  const obrigacaoIds = obrigacoes.map((o) => o.id)
  const [coleta, anexosProc, anexosProt, docsFin, recibos, gerados] = await Promise.all([
    db.coletaArquivo.findMany({ where: { envio: { link: { processoId } } }, select: { id: true, chave: true } }),
    db.anexoProcesso.findMany({ where: { processoId }, select: { id: true, urlArquivo: true } }),
    db.anexoProtocolo.findMany({ where: { protocolo: { processoId } }, select: { id: true, urlArquivo: true } }),
    db.receitaDocumento.findMany({
      where: { OR: [{ receita: { processoId } }, ...(obrigacaoIds.length ? [{ obrigacaoId: { in: obrigacaoIds } }] : [])] },
      select: { id: true, arquivoUrl: true, receitaId: true },
    }),
    db.recibo.findMany({ where: { processoId }, select: { id: true, pdfUrl: true } }),
    db.documentoGerado.findMany({ where: { processoId }, select: { id: true, _count: { select: { versoes: true } } } }),
  ])
  return montarLevantamento({
    urlPublica,
    linhas: [
      ...coleta.map((r) => ({ fonte: "COLETA" as const, id: r.id, valor: r.chave })),
      ...anexosProc.map((r) => ({ fonte: "ANEXO_PROCESSO" as const, id: r.id, valor: r.urlArquivo })),
      ...anexosProt.map((r) => ({ fonte: "ANEXO_PROTOCOLO" as const, id: r.id, valor: r.urlArquivo })),
      ...docsFin.map((r) => ({ fonte: "DOCUMENTO_FINANCEIRO" as const, id: r.id, valor: r.arquivoUrl })),
      ...recibos.map((r) => ({ fonte: "RECIBO" as const, id: r.id, valor: r.pdfUrl })),
    ],
    documentosFinanceirosSemCascata: docsFin.filter((d) => d.receitaId == null).map((d) => d.id),
    geradosPreservados: gerados.map((g) => ({ documentoGeradoId: g.id, versoes: g._count.versoes })),
  })
}

// ─── APAGAR (depois do commit) ───────────────────────────────────────────────────────────────────────────────────────────────

export type ApagadorDeObjeto = (chave: string) => Promise<void>

export interface ResultadoDoApagar {
  apagadas: string[]
  falhas: Array<{ chave: string; erro: string; tentativas: number }>
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Apaga cada chave com nova tentativa (espera crescente). Uma falha NÃO interrompe as outras e NUNCA é engolida: volta em `falhas`. */
export async function apagarChavesComNovaTentativa(
  chaves: string[],
  apagar: ApagadorDeObjeto,
  opcoes: { tentativas?: number; esperaMs?: number } = {},
): Promise<ResultadoDoApagar> {
  const tentativas = Math.max(1, opcoes.tentativas ?? 3)
  const base = opcoes.esperaMs ?? 300
  const apagadas: string[] = []
  const falhas: ResultadoDoApagar["falhas"] = []
  for (const chave of [...new Set(chaves)]) {
    let ultimo = ""
    let feito = false
    for (let t = 1; t <= tentativas && !feito; t++) {
      try { await apagar(chave); feito = true } catch (e) {
        ultimo = String((e as Error)?.message ?? e).slice(0, 200)
        if (t < tentativas) await espera(base * t)
      }
    }
    if (feito) apagadas.push(chave); else falhas.push({ chave, erro: ultimo, tentativas })
  }
  return { apagadas, falhas }
}

/**
 * Das chaves levantadas, quais AINDA são referenciadas por alguma linha que sobreviveu (ex.: o mesmo endereço colado num anexo de cliente)?
 * Essas NÃO se apagam: apagar o objeto quebraria a linha que sobrou.
 */
export async function chavesAindaReferenciadas(chaves: string[], db: DB): Promise<Set<string>> {
  const ainda = new Set<string>()
  const lista = [...new Set(chaves)]
  for (let i = 0; i < lista.length; i += 50) {
    const lote = lista.slice(i, i + 50)
    const ou = <T extends string>(campo: T) => lote.map((k) => ({ [campo]: { contains: k } }))
    const [a, b, c, d, e, f, g, h, i2] = await Promise.all([
      db.anexoProcesso.findMany({ where: { OR: ou("urlArquivo") as never }, select: { urlArquivo: true } }),
      db.anexoProtocolo.findMany({ where: { OR: ou("urlArquivo") as never }, select: { urlArquivo: true } }),
      db.anexoContratante.findMany({ where: { OR: ou("urlArquivo") as never }, select: { urlArquivo: true } }),
      db.anexoRequerente.findMany({ where: { OR: ou("urlArquivo") as never }, select: { urlArquivo: true } }),
      db.receitaDocumento.findMany({ where: { OR: ou("arquivoUrl") as never }, select: { arquivoUrl: true } }),
      db.documentoArquivo.findMany({ where: { OR: ou("url") as never }, select: { url: true } }),
      db.coletaArquivo.findMany({ where: { chave: { in: lote } }, select: { chave: true } }),
      db.documentoGeradoVersao.findMany({ where: { OR: [{ docxChave: { in: lote } }, { pdfChave: { in: lote } }] }, select: { docxChave: true, pdfChave: true } }),
      db.recibo.findMany({ where: { OR: ou("pdfUrl") as never }, select: { pdfUrl: true } }),
    ])
    const textos = [
      ...a.map((x) => x.urlArquivo), ...b.map((x) => x.urlArquivo), ...c.map((x) => x.urlArquivo), ...d.map((x) => x.urlArquivo),
      ...e.map((x) => x.arquivoUrl), ...f.map((x) => x.url), ...g.map((x) => x.chave), ...h.flatMap((x) => [x.docxChave, x.pdfChave]),
      ...i2.map((x) => x.pdfUrl ?? ""),
    ]
    for (const k of lote) if (textos.some((t) => t.includes(k))) ainda.add(k)
  }
  return ainda
}
