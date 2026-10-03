// src/services/coleta/coleta-pendentes.ts
// A contagem que a porta única de fase consulta. Arquivo mínimo (só prisma) para
// o motor de fase não puxar o resto do serviço de coleta.
import { prisma } from "@/lib/prisma"

/** Envios ainda PENDENTES (aguardando conferência) de todos os links do processo. */
export async function contarEnviosColetaPendentes(processoId: number): Promise<number> {
  return prisma.coletaEnvio.count({ where: { status: "PENDENTE", link: { processoId } } })
}
