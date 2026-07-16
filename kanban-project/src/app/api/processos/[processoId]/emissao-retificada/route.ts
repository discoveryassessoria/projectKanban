// src/app/api/processos/[processoId]/emissao-retificada/route.ts
//
// GET — lista os documentos em Emissão documental retificada do processo, com KPIs e
// progresso. Espelha o padrão de traducao/route.ts (Next 15, prisma @/lib/prisma).
//
// Os documentos desta fase são os IMPACTADOS pela retificação. Eles são derivados dos
// RetificacaoPacote VALIDADOS do processo (campo Json affectedDocIds) e materializados
// em registros EmissaoRetificada (1 por documento) na primeira leitura — assim o GET não
// refaz joins a cada chamada e guardamos um snapshot (pessoaNome, correção) como já é
// feito em Divergencia.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ AJUSTE AO SEU SCHEMA nos 2 pontos marcados com «AJUSTE»:                     │
// │  (1) como ler os documentos afetados dos pacotes validados;                 │
// │  (2) como buscar Documento + Pessoa para o snapshot (nomes dos campos).      │
// │ Idealmente, em vez do seed aqui, o retificacao-engine cria os registros      │
// │ EmissaoRetificada quando valida o último pacote (mesma função seed).         │
// └───────────────────────────────────────────────────────────────────────────┘

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { buildInitialWorkflow, RE_STATUS } from "@/src/lib/process-stage/emissao-retificada-engine"

const DOCT: Record<string, string> = {
  nascimento: "Certidão de Nascimento",
  casamento: "Certidão de Casamento",
  obito: "Certidão de Óbito",
}

export async function GET(_req: Request, { params }: { params: Promise<{ processoId: string }> }) {
  const { processoId: pid } = await params
  const processoId = Number(pid)

  // só materializa/lista quando o processo está nesta fase
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
  })
  if (!processo) return NextResponse.json({ error: "Processo não encontrado." }, { status: 404 })

  // ----- seed: garante 1 EmissaoRetificada por documento afetado -----
  await seedFromRetificacao(processoId)

  const registros = await prisma.emissaoRetificada.findMany({
    where: { processoId },
    orderBy: { id: "asc" },
  })

  const documentos = registros.map((r) => {
    const wf = (r.workflow ?? {}) as { averbacao?: object; solicitation?: object; conference?: object }
    return {
      id: r.id,
      documentoId: r.documentoId,
      pessoaNome: r.pessoaNome,
      pessoaGen: r.pessoaGen ?? "",
      pessoaPapel: r.pessoaPapel ?? "",
      documentoTitulo: r.documentoTitulo,
      correcao: { campo: r.correcaoCampo ?? "—", old: r.correcaoOld ?? "", novo: r.correcaoNovo ?? "" },
      status: r.status,
      nextAction: r.nextAction,
      workflow: r.workflow,
      averbacao: wf.averbacao ?? {},
      solicitation: wf.solicitation ?? {},
      conference: wf.conference ?? {},
    }
  })

  const by = (s: string) => documentos.filter((d) => d.status === s).length
  const kpis = {
    total: documentos.length,
    averb: by(RE_STATUS.AVERBACAO_ENVIADA),
    solic: by(RE_STATUS.SOLICITADA),
    aguard: by(RE_STATUS.AGUARDANDO_RETORNO),
    receb: by(RE_STATUS.RECEBIDA),
    conf: by(RE_STATUS.CONFERIDA),
    valid: by(RE_STATUS.VALIDADA),
    bloq: by(RE_STATUS.DIVERGENTE) + by("bloqueada"),
  }
  const progress = documentos.length
    ? Math.round((kpis.valid / documentos.length) * 100)
    : 0

  return NextResponse.json({ documentos, kpis, progress })
}

// ============================================================
// seed — cria registros EmissaoRetificada para os documentos afetados
// pelos pacotes de retificação VALIDADOS que ainda não têm registro.
// (Exportável para o retificacao-engine chamar ao validar o último pacote.)
// ============================================================
export async function seedFromRetificacao(processoId: number) {
  // (1) «AJUSTE» — documentos afetados = união dos affectedDocIds dos pacotes validados
  const pacotes = await prisma.retificacaoPacote.findMany({
    where: { processoId, status: "validado" },
  })
  const docIds = new Set<number>()
  for (const p of pacotes) {
    const aff = (p as { affectedDocIds?: unknown }).affectedDocIds
    if (Array.isArray(aff)) aff.forEach((x) => docIds.add(Number(x)))
  }
  if (docIds.size === 0) return

  const jaExistem = await prisma.emissaoRetificada.findMany({
    where: { processoId, documentoId: { in: [...docIds] } },
    select: { documentoId: true },
  })
  const existentes = new Set(jaExistem.map((r) => r.documentoId))
  const faltam = [...docIds].filter((id) => !existentes.has(id))
  if (faltam.length === 0) return

  for (const documentoId of faltam) {
    // (2) «AJUSTE» — buscar o documento + pessoa para o snapshot.
    // Troque os nomes de campos pelos do seu schema (ex.: documento.tipo, documento.pessoa.nome).
    const doc = await prisma.documento.findUnique({
      where: { id: documentoId },
      include: { pessoa: true },
    }).catch(() => null)

    const tipo = (doc as any)?.tipo as string | undefined
    const pessoa = (doc as any)?.pessoa
    // correção que motivou a retificação: tente puxar da divergência marcada "retificacao".
    const div = await prisma.divergencia.findFirst({
      where: { documentoId, status: "retificacao" },
      orderBy: { id: "asc" },
    }).catch(() => null)

    await prisma.emissaoRetificada.create({
      data: {
        processoId,
        documentoId,
        pessoaNome: pessoa?.nome ?? "—",
        pessoaGen: pessoa?.gen ?? pessoa?.geracao ?? null,
        pessoaPapel: pessoa?.papel ?? null,
        documentoTitulo: (tipo && DOCT[tipo]) || (doc as any)?.titulo || "Documento",
        correcaoCampo: (div as any)?.campoLabel ?? null,
        correcaoOld: (div as any)?.valorDocumento ?? null,
        correcaoNovo: (div as any)?.valorArvore ?? null,
        status: RE_STATUS.PENDENTE_AVERBACAO,
        nextAction: "Enviar pedido de averbação ao cartório",
        workflow: buildInitialWorkflow() as object,
      },
    })
  }
}