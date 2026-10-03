// src/services/coleta/coleta-purga.ts
// ============================================================================
// RETENÇÃO — dados e arquivos de envios DESCARTADOS são apagados 30 dias depois do
// encerramento do link; fica só o registro de que houve o envio (sem dado pessoal):
// id, link, papel declarado, consentimento, status, decisão. Idempotente.
// ============================================================================

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { apagarObjetoColeta } from "./storage-coleta"

export const DIAS_RETENCAO_DESCARTADOS = 30

export async function purgarEnviosDescartados(agora = new Date()): Promise<{ envios: number; arquivos: number; falhas: number }> {
  const corte = new Date(agora.getTime() - DIAS_RETENCAO_DESCARTADOS * 24 * 60 * 60 * 1000)
  const envios = await prisma.coletaEnvio.findMany({
    where: { status: "DESCARTADO", purgadoEm: null, link: { encerradoEm: { lt: corte } } },
    include: { arquivos: true },
    take: 200,
  })
  let arquivos = 0
  let falhas = 0
  for (const e of envios) {
    let tudoApagado = true
    for (const a of e.arquivos) {
      try {
        await apagarObjetoColeta(a.chave)
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
      await prisma.coletaEnvio.update({ where: { id: e.id }, data: { dados: Prisma.DbNull, cpf: null, ipHash: null, purgadoEm: agora } })
    }
  }
  return { envios: envios.length, arquivos, falhas }
}
