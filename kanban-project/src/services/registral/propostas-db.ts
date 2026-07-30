// src/services/registral/propostas-db.ts
//
// MRG — persistência de PropostaReconciliacao.
//
// Idempotência com semântica: a mesma proposta, vinda de um SEGUNDO documento,
// não é uma proposta nova — é a MESMA proposta com mais evidência. Então o
// upsert ACUMULA evidências e recalcula a confiança, em vez de sobrescrever.
//
// Proposta já DECIDIDA (aprovada/rejeitada/aplicada/revertida) não volta a
// PENDENTE por reprocessamento: isso apagaria a decisão humana. Quando aparece
// evidência nova sobre uma proposta rejeitada, a evidência é anexada e a
// proposta permanece rejeitada — quem reabre é gente.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type { EvidenciaIdentidade, PropostaMontada } from "@/src/lib/genealogia/registral/tipos"
import { auditar } from "./auditoria"
import { ACOES_AUDITORIA } from "./constantes"

export interface ResultadoPersistencia {
  propostaId: number
  criada: boolean
  atualizada: boolean
  /** true quando havia decisão humana e a proposta foi preservada. */
  preservadaPorDecisao: boolean
}

function evidenciasDoJson(v: Prisma.JsonValue | null): EvidenciaIdentidade[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is Prisma.JsonObject => !!x && typeof x === "object" && !Array.isArray(x)).map((x) => ({
    campo: String(x.campo ?? ""),
    descricao: String(x.descricao ?? ""),
    favoravel: x.favoravel !== false,
    peso: Number(x.peso ?? 1),
  }))
}

function unir(a: EvidenciaIdentidade[], b: EvidenciaIdentidade[]): EvidenciaIdentidade[] {
  const mapa = new Map<string, EvidenciaIdentidade>()
  for (const e of [...a, ...b]) mapa.set(`${e.campo}|${e.descricao}`, e)
  return [...mapa.values()]
}

export async function persistirProposta(p: {
  processoId: number
  arvoreId: number | null
  loteId: number | null
  execucaoId: number | null
  correlationId: string
  montada: PropostaMontada
}): Promise<ResultadoPersistencia> {
  const m = p.montada
  const existente = await prisma.propostaReconciliacao.findUnique({
    where: { chaveIdempotencia: m.chaveIdempotencia },
    select: {
      id: true,
      status: true,
      confianca: true,
      evidenciasFavoraveis: true,
      evidenciasContrarias: true,
    },
  })

  if (existente) {
    const favoraveis = unir(evidenciasDoJson(existente.evidenciasFavoraveis), m.evidenciasFavoraveis)
    const contrarias = unir(evidenciasDoJson(existente.evidenciasContrarias), m.evidenciasContrarias)
    const decidida = existente.status !== "PENDENTE" && existente.status !== "ADIADA"

    await prisma.propostaReconciliacao.update({
      where: { id: existente.id },
      data: {
        evidenciasFavoraveis: favoraveis as unknown as Prisma.InputJsonValue,
        evidenciasContrarias: contrarias as unknown as Prisma.InputJsonValue,
        // Mais evidência favorável eleva a confiança; contrária derruba. Teto 0.99:
        // o motor não afirma certeza absoluta.
        confianca: Math.min(
          0.99,
          Math.max(0, (existente.confianca + m.confianca) / 2 + (favoraveis.length - contrarias.length) * 0.01),
        ),
        // Só o que NÃO foi decidido pode ter criticidade/aplicabilidade recalculada.
        ...(decidida
          ? {}
          : {
              criticidade: m.criticidade,
              aplicavelAutomaticamente: m.aplicavelAutomaticamente,
              risco: m.risco,
              recomendacao: m.recomendacao.slice(0, 300),
              justificativa: m.justificativa,
            }),
      },
    })
    return { propostaId: existente.id, criada: false, atualizada: true, preservadaPorDecisao: decidida }
  }

  const criada = await prisma.propostaReconciliacao.create({
    data: {
      processoId: p.processoId,
      arvoreId: p.arvoreId,
      loteId: p.loteId,
      execucaoId: p.execucaoId,
      tipo: m.operacao.tipo,
      criticidade: m.criticidade,
      status: "PENDENTE",
      entidadeAlvo: m.operacao.entidadeAlvo.slice(0, 20),
      alvoId: m.operacao.alvoId,
      campo: m.operacao.campo,
      valorAtual: m.operacao.valorAtual?.slice(0, 400) ?? null,
      valorProposto: m.operacao.valorProposto?.slice(0, 400) ?? null,
      origemValorAtual: m.origemValorAtual?.slice(0, 120) ?? null,
      origemValorProposto: m.origemValorProposto?.slice(0, 120) ?? null,
      evidenciasFavoraveis: m.evidenciasFavoraveis as unknown as Prisma.InputJsonValue,
      evidenciasContrarias: m.evidenciasContrarias as unknown as Prisma.InputJsonValue,
      confianca: m.confianca,
      justificativa: m.justificativa,
      regraAplicada: m.regraAplicada.slice(0, 80),
      recomendacao: m.recomendacao.slice(0, 300),
      risco: m.risco,
      operacao: m.operacao.dados as unknown as Prisma.InputJsonValue,
      pessoasAfetadas: m.pessoasAfetadas as unknown as Prisma.InputJsonValue,
      aplicavelAutomaticamente: m.aplicavelAutomaticamente,
      correlationId: p.correlationId,
      chaveIdempotencia: m.chaveIdempotencia,
    },
    select: { id: true },
  })

  await auditar(prisma, {
    acao: ACOES_AUDITORIA.PROPOSTA_CRIADA,
    entidade: "PropostaReconciliacao",
    entidadeId: criada.id,
    descricao: `${m.operacao.tipo} (${m.criticidade}) — ${m.recomendacao}`,
    detalhes: {
      tipo: m.operacao.tipo,
      criticidade: m.criticidade,
      campo: m.operacao.campo,
      confianca: m.confianca,
      aplicavelAutomaticamente: m.aplicavelAutomaticamente,
      pessoasAfetadas: m.pessoasAfetadas,
    },
    correlationId: p.correlationId,
  })

  return { propostaId: criada.id, criada: true, atualizada: false, preservadaPorDecisao: false }
}
