// src/services/registral/consultas.ts
//
// MRG — leitura: dossiê do copiloto, linhagem, evidências, conflitos, propostas
// e trilha de auditoria.
//
// Só LÊ. Nenhuma função deste arquivo escreve — é o que permite expor tudo em
// rotas de consulta sem risco de efeito colateral.

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { apurarElegibilidade } from "@/src/lib/genealogia/registral/elegibilidade"
import { verificarIntegridade } from "@/src/lib/genealogia/registral/integridade"
import { responder, severidadeDoDossie, type DossieCopiloto, type FatoDoDossie, type RespostaCopiloto } from "@/src/lib/genealogia/registral/copiloto"
import type { CampoRegistral, Inconsistencia, ResultadoElegibilidade } from "@/src/lib/genealogia/registral/tipos"
import { auditar } from "./auditoria"
import { ACOES_AUDITORIA } from "./constantes"
import {
  carregarComprovacao,
  carregarContexto,
  carregarFatos,
  carregarNomes,
  carregarPessoas,
  carregarUnioes,
} from "./estado"

type DB = typeof prisma | Prisma.TransactionClient

export interface ResultadoLinhagem {
  processoId: number
  arvoreId: number | null
  elegibilidade: ResultadoElegibilidade
  inconsistencias: Inconsistencia[]
  nomes: Array<{ id: number; nome: string }>
}

/**
 * Recalcula linhagem e integridade do processo. Cálculo puro sobre estado atual —
 * não persiste conclusão (a conclusão é derivada, e derivada persistida vira
 * segunda fonte de verdade).
 */
export async function recalcularLinhagem(processoId: number, db: DB = prisma): Promise<ResultadoLinhagem | null> {
  const ctx = await carregarContexto(db, processoId)
  if (!ctx || ctx.arvoreId == null) return null

  const pessoas = await carregarPessoas(db, ctx.arvoreId)
  const pessoaIds = pessoas.map((p) => p.id)
  const unioes = await carregarUnioes(db, pessoaIds)
  const fatos = await carregarFatos(db, pessoaIds, unioes.map((u) => u.id))
  const comprovacao = await carregarComprovacao(db, processoId, pessoaIds)

  const inconsistencias = verificarIntegridade({
    pessoas,
    unioes,
    requerenteIds: ctx.requerenteIds,
    fatos,
  })
  const elegibilidade = apurarElegibilidade({
    pessoas,
    unioes,
    paisAlvo: ctx.paisAlvo,
    requerenteId: ctx.requerenteIds[0] ?? null,
    raizId: ctx.raizId,
    comprovacaoPorPessoa: comprovacao,
    inconsistencias,
  })

  const relevantes = new Set<number>([
    ...(elegibilidade.caminhoPrincipal?.ids ?? []),
    ...inconsistencias.flatMap((i) => i.pessoaIds),
  ])
  const nomes = await carregarNomes(db, [...relevantes])

  return {
    processoId,
    arvoreId: ctx.arvoreId,
    elegibilidade,
    inconsistencias,
    nomes: [...nomes.entries()].map(([id, nome]) => ({ id, nome })),
  }
}

/** Registra na auditoria que a linhagem foi recalculada sob demanda. */
export async function registrarRecalculo(processoId: number, usuarioId: number | null, resumo: string): Promise<void> {
  await auditar(prisma, {
    acao: ACOES_AUDITORIA.LINHAGEM_RECALCULADA,
    entidade: "Processo",
    entidadeId: processoId,
    descricao: `Linhagem recalculada: ${resumo}`,
    usuarioId,
  })
}

// ---------------------------------------------------------------- evidências

export async function listarEvidencias(p: {
  processoId?: number
  documentoId?: number
  pessoaId?: number
  campo?: CampoRegistral
  fatoId?: number
  limite?: number
}) {
  const where: Prisma.EvidenciaRegistralWhereInput = {
    ...(p.documentoId ? { documentoId: p.documentoId } : {}),
    ...(p.pessoaId ? { pessoaId: p.pessoaId } : {}),
    ...(p.campo ? { campo: p.campo } : {}),
    ...(p.fatoId ? { fatoId: p.fatoId } : {}),
    ...(p.processoId ? { execucao: { lote: { processoId: p.processoId } } } : {}),
  }
  return prisma.evidenciaRegistral.findMany({
    where,
    orderBy: [{ documentoId: "asc" }, { id: "asc" }],
    take: p.limite ?? 300,
    select: {
      id: true,
      documentoId: true,
      itemCatalogoId: true,
      necessidadeId: true,
      ocorrenciaId: true,
      fatoId: true,
      pessoaId: true,
      uniaoId: true,
      campo: true,
      pagina: true,
      regiao: true,
      trechoTexto: true,
      valorBruto: true,
      valorNormalizado: true,
      metodoExtracao: true,
      versaoProcessamento: true,
      confiancaExtracao: true,
      confiancaAssociacao: true,
      regraAplicada: true,
      favoravel: true,
      criadoEm: true,
      documento: { select: { id: true, descricao: true, arquivo_nome: true, tipo: true } },
      itemCatalogo: { select: { code: true, name: true } },
    },
  })
}

/** Fatos registrais de uma pessoa, com as evidências que os sustentam. */
export async function dossieDaPessoa(pessoaId: number) {
  const fatos = await prisma.fatoRegistral.findMany({
    where: { pessoaId },
    orderBy: [{ campo: "asc" }, { versao: "desc" }],
    select: {
      id: true,
      campo: true,
      valorBruto: true,
      valorNormalizado: true,
      valorData: true,
      estado: true,
      confianca: true,
      origem: true,
      responsavelId: true,
      afirmadoEm: true,
      justificativa: true,
      regraAplicada: true,
      totalEvidencias: true,
      evidenciasFavoraveis: true,
      evidenciasContrarias: true,
      versao: true,
      ativo: true,
      supersedidoPorId: true,
      evidencias: {
        select: {
          id: true,
          documentoId: true,
          pagina: true,
          regiao: true,
          trechoTexto: true,
          metodoExtracao: true,
          confiancaExtracao: true,
          favoravel: true,
          documento: { select: { descricao: true, arquivo_nome: true, tipo: true } },
        },
      },
    },
  })
  const aliases = await prisma.nomePessoa.findMany({
    where: { pessoaId },
    orderBy: [{ principal: "desc" }, { id: "asc" }],
    select: { id: true, nome: true, sobrenome: true, tipo: true, principal: true, confianca: true, origem: true, ativo: true },
  })
  const ocorrencias = await prisma.ocorrenciaDocumental.findMany({
    where: { pessoaResolvidaId: pessoaId },
    orderBy: { id: "desc" },
    take: 100,
    select: {
      id: true,
      documentoId: true,
      papel: true,
      nomeBruto: true,
      classe: true,
      scoreIdentidade: true,
      resolvidaAutomaticamente: true,
    },
  })
  return { fatos, aliases, ocorrencias }
}

// ---------------------------------------------------------------- conflitos

export async function listarConflitos(p: {
  processoId?: number
  status?: Array<"ABERTO" | "EM_REVISAO" | "RESOLVIDO" | "DESCARTADO">
  severidade?: Array<"CRITICO" | "ALTO" | "MEDIO" | "BAIXO" | "INFO">
  limite?: number
}) {
  return prisma.conflitoRegistral.findMany({
    where: {
      ...(p.processoId ? { processoId: p.processoId } : {}),
      ...(p.status?.length ? { status: { in: p.status } } : {}),
      ...(p.severidade?.length ? { severidade: { in: p.severidade } } : {}),
    },
    orderBy: [{ severidade: "asc" }, { criadoEm: "desc" }],
    take: p.limite ?? 200,
    select: {
      id: true,
      processoId: true,
      arvoreId: true,
      loteId: true,
      execucaoId: true,
      codigo: true,
      severidade: true,
      status: true,
      campo: true,
      pessoaId: true,
      uniaoId: true,
      descricao: true,
      explicacao: true,
      acaoSugerida: true,
      evidencias: true,
      documentoIds: true,
      propostaId: true,
      resolvidoEm: true,
      resolucaoNota: true,
      criadoEm: true,
      resolvidoPor: { select: { id: true, nome: true } },
      decisoes: {
        orderBy: { criadoEm: "desc" },
        select: { id: true, decisao: true, motivo: true, permissao: true, criadoEm: true, responsavelId: true },
      },
    },
  })
}

// ---------------------------------------------------------------- propostas

export async function listarPropostas(p: {
  processoId?: number
  loteId?: number
  status?: Array<"PENDENTE" | "APROVADA" | "REJEITADA" | "ADIADA" | "APLICADA" | "REVERTIDA" | "ABORTADA">
  criticidade?: Array<"AUTOMATICA" | "APROVACAO_HUMANA" | "BLOQUEIO">
  limite?: number
}) {
  return prisma.propostaReconciliacao.findMany({
    where: {
      ...(p.processoId ? { processoId: p.processoId } : {}),
      ...(p.loteId ? { loteId: p.loteId } : {}),
      ...(p.status?.length ? { status: { in: p.status } } : {}),
      ...(p.criticidade?.length ? { criticidade: { in: p.criticidade } } : {}),
    },
    orderBy: [{ criticidade: "asc" }, { risco: "asc" }, { criadoEm: "desc" }],
    take: p.limite ?? 200,
    select: {
      id: true,
      processoId: true,
      arvoreId: true,
      loteId: true,
      tipo: true,
      criticidade: true,
      status: true,
      entidadeAlvo: true,
      alvoId: true,
      campo: true,
      valorAtual: true,
      valorProposto: true,
      origemValorAtual: true,
      origemValorProposto: true,
      confianca: true,
      justificativa: true,
      regraAplicada: true,
      recomendacao: true,
      risco: true,
      aplicavelAutomaticamente: true,
      pessoasAfetadas: true,
      decididoEm: true,
      decisaoNota: true,
      aplicadoEm: true,
      revertidoEm: true,
      motivoAbortoRevalidacao: true,
      versaoArvoreAntes: true,
      versaoArvoreDepois: true,
      criadoEm: true,
      decididoPor: { select: { id: true, nome: true } },
    },
  })
}

export async function detalharProposta(propostaId: number) {
  return prisma.propostaReconciliacao.findUnique({
    where: { id: propostaId },
    include: {
      impactos: { orderBy: { calculadoEm: "desc" } },
      decisoes: { orderBy: { criadoEm: "desc" }, include: { responsavel: { select: { id: true, nome: true } } } },
      conflitos: { select: { id: true, codigo: true, severidade: true, status: true, descricao: true } },
      fato: {
        select: {
          id: true,
          campo: true,
          estado: true,
          confianca: true,
          valorNormalizado: true,
          evidencias: {
            select: { id: true, documentoId: true, metodoExtracao: true, favoravel: true, trechoTexto: true, pagina: true },
          },
        },
      },
      decididoPor: { select: { id: true, nome: true } },
      revertidaPor: { select: { id: true, nome: true } },
    },
  })
}

// ---------------------------------------------------------------- copiloto

export async function montarDossie(processoId: number): Promise<DossieCopiloto | null> {
  const linhagem = await recalcularLinhagem(processoId)
  if (!linhagem) return null

  const pessoaIds = (
    await prisma.pessoa.findMany({
      where: { arvoreId: linhagem.arvoreId ?? -1 },
      select: { id: true },
    })
  ).map((p) => p.id)

  const fatosDb = await prisma.fatoRegistral.findMany({
    where: { ativo: true, pessoaId: { in: pessoaIds.length ? pessoaIds : [-1] } },
    select: {
      pessoaId: true,
      uniaoId: true,
      campo: true,
      valorNormalizado: true,
      estado: true,
      confianca: true,
      evidencias: {
        select: {
          documentoId: true,
          metodoExtracao: true,
          favoravel: true,
          documento: { select: { descricao: true, arquivo_nome: true, tipo: true } },
        },
      },
    },
  })

  const fatos: FatoDoDossie[] = fatosDb.map((f) => ({
    pessoaId: f.pessoaId,
    uniaoId: f.uniaoId,
    campo: f.campo as CampoRegistral,
    valorNormalizado: f.valorNormalizado,
    estado: f.estado,
    confianca: f.confianca,
    evidencias: f.evidencias.map((e) => ({
      documentoId: e.documentoId,
      rotulo: e.documento?.descricao || e.documento?.arquivo_nome || String(e.documento?.tipo ?? "documento"),
      metodo: e.metodoExtracao,
      favoravel: e.favoravel,
    })),
  }))

  const necessidades = await prisma.necessidadeDocumental.findMany({
    where: { processoId },
    select: {
      id: true,
      pessoaId: true,
      uniaoId: true,
      status: true,
      obrigatoriedade: true,
      itemCatalogo: { select: { code: true, name: true } },
    },
    orderBy: { id: "asc" },
  })

  const propostas = await prisma.propostaReconciliacao.findMany({
    where: { processoId, status: { in: ["PENDENTE", "ADIADA"] } },
    select: { id: true, tipo: true, criticidade: true, recomendacao: true, justificativa: true, pessoasAfetadas: true },
    orderBy: { id: "asc" },
  })

  const nomes = await carregarNomes(prisma, pessoaIds)

  return {
    processoId,
    arvoreId: linhagem.arvoreId,
    nomePorPessoa: nomes,
    elegibilidade: linhagem.elegibilidade,
    inconsistencias: linhagem.inconsistencias,
    fatos,
    necessidadesAbertas: necessidades.map((n) => ({
      id: n.id,
      pessoaId: n.pessoaId,
      uniaoId: n.uniaoId,
      item: n.itemCatalogo?.name ?? n.itemCatalogo?.code ?? `item #${n.id}`,
      status: n.status,
      obrigatoria: n.obrigatoriedade === "OBRIGATORIA",
    })),
    propostasPendentes: propostas.map((x) => ({
      id: x.id,
      tipo: x.tipo,
      criticidade: x.criticidade,
      descricao: x.recomendacao ?? x.justificativa.slice(0, 200),
      pessoasAfetadas: Array.isArray(x.pessoasAfetadas)
        ? (x.pessoasAfetadas as unknown[]).map(Number).filter((v) => Number.isFinite(v))
        : [],
    })),
  }
}

export async function consultarCopiloto(
  processoId: number,
  pergunta: string,
): Promise<{ resposta: RespostaCopiloto; severidade: string } | null> {
  const dossie = await montarDossie(processoId)
  if (!dossie) return null
  return { resposta: responder(pergunta, dossie), severidade: severidadeDoDossie(dossie) }
}

// ---------------------------------------------------------------- auditoria

const ENTIDADES_REGISTRAIS = [
  "LoteRegistral",
  "ExecucaoRegistral",
  "FatoRegistral",
  "EvidenciaRegistral",
  "ConflitoRegistral",
  "PropostaReconciliacao",
  "VersaoGenealogica",
  "Processo",
]

export async function listarAuditoria(p: {
  processoId?: number
  entidade?: string
  entidadeId?: number
  limite?: number
}) {
  return prisma.logAuditoria.findMany({
    where: {
      acao: { startsWith: "registral_" },
      ...(p.entidade ? { entidade: p.entidade } : { entidade: { in: ENTIDADES_REGISTRAIS } }),
      ...(p.entidadeId ? { entidadeId: p.entidadeId } : {}),
    },
    orderBy: { criadoEm: "desc" },
    take: p.limite ?? 200,
    select: {
      id: true,
      acao: true,
      entidade: true,
      entidadeId: true,
      descricao: true,
      detalhes: true,
      criadoEm: true,
      usuario: { select: { id: true, nome: true } },
    },
  })
}

/** Métricas agregadas do motor (observabilidade). */
export async function listarMetricas(p: { escopo?: string; desde?: Date; limite?: number }) {
  return prisma.metricaRegistral.findMany({
    where: {
      ...(p.escopo ? { escopo: p.escopo } : {}),
      ...(p.desde ? { janelaInicio: { gte: p.desde } } : {}),
    },
    orderBy: [{ janelaInicio: "desc" }, { chave: "asc" }],
    take: p.limite ?? 500,
    select: { chave: true, escopo: true, janelaInicio: true, valor: true, amostras: true },
  })
}
