// src/services/coleta/coleta-purga.ts
// ============================================================================
// RETENÇÃO DA COLETA — dados e arquivos de envios que NÃO viraram cadastro são apagados 30 dias depois do encerramento do link;
// fica só o registro de que houve o envio (sem dado pessoal): id, link, papel declarado, consentimento, status, decisão. Idempotente.
//
// QUEM ENTRA NA CONTAGEM DE 30 DIAS (decisão do Marco, 05/10/2026 — docs/proposta-anexos-cliente-e-privacidade.md, ponto (c)):
//   • envios DESCARTADOS de link encerrado (como sempre);
//   • envios PENDENTES (que o Marco nunca confirmou) de link encerrado POR QUALQUER MOTIVO — saída da fase pré-contrato (`FASE_MUDOU`, o
//     normal: o link vale até o processo sair dela, em geral para Genealogia), fechamento manual (`MANUAL`) ou fim da conferência
//     (`CONFERENCIA`). Contam 30 dias desde o `encerradoEm` do link.
//   Ao ser purgado, o pendente passa a DESCARTADO (decisão do sistema, sem usuário): assim deixa de contar como "conferência pendente".
//   NUNCA entram: CONFIRMADO (já virou cadastro e o arquivo foi para o processo) e qualquer envio de link ATIVO (sem `encerradoEm`).
//
// A DATA DO ENCERRAMENTO: o link só era carimbado como encerrado quando alguém o abria. A rotina também carimba o link de processo que já
// saiu da fase, usando a data REAL da saída (`PhaseAdvanceLog`); sem registro, a data de agora (a contagem de 30 dias nunca começa antes
// de o link estar de fato encerrado). Sem coluna nova.
// ============================================================================

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { apagarObjetoColeta } from "./storage-coleta"
import { PHASEKEY_A_INICIAR, ROTULO_AGUARDANDO_FECHAMENTO } from "@/src/lib/process-stage/fase-pre-contrato"
import { RESULTADOS_QUE_MOVEM_DE_FASE } from "@/lib/operacional/metricas-processo"

export const DIAS_RETENCAO_DESCARTADOS = 30
export const DIAS_RETENCAO_PENDENTES = DIAS_RETENCAO_DESCARTADOS

type ApagarObjeto = (chave: string) => Promise<void>

/**
 * Carimba como encerrado (FASE_MUDOU) o link ATIVO cujo processo já saiu da fase pré-contrato e ninguém abriu. A data é a da saída
 * real da fase (log do motor); sem log, agora. Idempotente.
 */
export async function encerrarLinksDeProcessosQueSairamDaFase(agora = new Date()): Promise<{ encerrados: number }> {
  const links = await prisma.coletaLink.findMany({
    where: { encerradoEm: null, processo: { OR: [{ faseAtualKey: null }, { faseAtualKey: { not: PHASEKEY_A_INICIAR } }] } },
    select: { id: true, processoId: true, criadoEm: true },
    take: 500,
  })
  let encerrados = 0
  for (const l of links) {
    const saida = await prisma.phaseAdvanceLog.findFirst({
      where: { processoId: l.processoId, faseAtual: PHASEKEY_A_INICIAR, resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] }, criadoEm: { gte: l.criadoEm, lte: agora } },
      orderBy: { criadoEm: "asc" }, select: { criadoEm: true },
    })
    const quando = saida?.criadoEm ?? agora
    const r = await prisma.coletaLink.updateMany({ where: { id: l.id, encerradoEm: null }, data: { encerradoEm: quando, motivoEncerramento: "FASE_MUDOU" } })
    if (r.count > 0) {
      encerrados++
      await prisma.logAuditoria.create({
        data: {
          acao: "ENCERRAR", entidade: "COLETA_LINK", entidadeId: l.id,
          descricao: `Link de coleta do processo ${l.processoId} encerrado: o processo saiu de “${ROTULO_AGUARDANDO_FECHAMENTO}” (${saida ? "data da saída registrada" : "data de agora: saída sem registro"}).`,
          detalhes: { processoId: l.processoId, motivo: "FASE_MUDOU", encerradoEm: quando.toISOString(), origem: "rotina de retenção" },
        },
      })
    }
  }
  return { encerrados }
}

export async function purgarEnviosDescartados(
  agora = new Date(),
  apagarObjeto: ApagarObjeto = apagarObjetoColeta,
): Promise<{ envios: number; arquivos: number; falhas: number; pendentesPorPrazo: number }> {
  const corte = new Date(agora.getTime() - DIAS_RETENCAO_DESCARTADOS * 24 * 60 * 60 * 1000)
  const envios = await prisma.coletaEnvio.findMany({
    where: {
      purgadoEm: null,
      AND: [
        { link: { encerradoEm: { lt: corte } } },
        { status: { in: ["DESCARTADO", "PENDENTE"] } },
      ],
    },
    include: { arquivos: true, link: { select: { id: true, processoId: true, encerradoEm: true, motivoEncerramento: true } } },
    take: 200,
  })
  let arquivos = 0
  let falhas = 0
  let pendentesPorPrazo = 0
  for (const e of envios) {
    let tudoApagado = true
    for (const a of e.arquivos) {
      try {
        await apagarObjeto(a.chave)
        await prisma.coletaArquivo.delete({ where: { id: a.id } })
        arquivos++
      } catch (err) {
        tudoApagado = false
        falhas++
        console.error("[coleta-purga] arquivo não apagado (tenta de novo no próximo ciclo):", err)
      }
    }
    // Só apaga os dados pessoais quando os arquivos foram todos — senão repete amanhã.
    if (tudoApagado) {
      const eraPendente = e.status === "PENDENTE"
      await prisma.coletaEnvio.update({
        where: { id: e.id },
        data: { dados: Prisma.DbNull, cpf: null, ipHash: null, purgadoEm: agora, ...(eraPendente ? { status: "DESCARTADO", decididoEm: agora } : {}) },
      })
      if (eraPendente) {
        pendentesPorPrazo++
        // O registro NÃO leva dado pessoal: só ids, o motivo e as datas.
        await prisma.logAuditoria.create({
          data: {
            acao: "COLETA_PENDENTE_PURGADO_POR_PRAZO", entidade: "ColetaEnvio", entidadeId: e.id,
            descricao: `Envio pendente da coleta (link ${e.link.id}, processo ${e.link.processoId}) apagado ${DIAS_RETENCAO_PENDENTES} dias após o encerramento do link (${e.link.motivoEncerramento ?? "sem motivo registrado"}); ficou só o registro, sem dado pessoal.`,
            detalhes: { linkId: e.link.id, processoId: e.link.processoId, encerradoEm: e.link.encerradoEm?.toISOString() ?? null, motivoEncerramento: e.link.motivoEncerramento, arquivosApagados: e.arquivos.length },
          },
        })
      }
    }
  }
  return { envios: envios.length, arquivos, falhas, pendentesPorPrazo }
}

/** A rotina diária inteira: primeiro carimba os links de processos que já saíram da fase, depois purga o que passou de 30 dias. */
export async function rodarRetencaoDaColeta(agora = new Date(), apagarObjeto: ApagarObjeto = apagarObjetoColeta) {
  const { encerrados } = await encerrarLinksDeProcessosQueSairamDaFase(agora)
  const purga = await purgarEnviosDescartados(agora, apagarObjeto)
  return { linksEncerrados: encerrados, ...purga }
}
