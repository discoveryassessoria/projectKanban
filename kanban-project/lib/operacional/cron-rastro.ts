// lib/operacional/cron-rastro.ts
// ============================================================================
// O RASTRO DE CADA CRON (09/10/2026) — «vigiar não é citar o nome: é provar que o job deixou o rastro que só ele deixa» (TOR-001).
// Seis jobs não deixavam rastro NENHUM quando não havia o que fazer (a purga, por exemplo, só escreve se apagar algo): se parassem, ninguém saberia.
// Agora cada um grava, ao terminar BEM (nunca em ensaio), a hora da última passagem em `ConfiguracaoSistema` (`cron.<chave>.ultimo`) — sem migration,
// sem uma linha nova por hora — e a verificação CRON-006 cobra a idade desse rastro contra o ritmo do agendamento (vercel.json).
// ============================================================================
import { prisma } from "@/lib/prisma"

export interface CronComRastro { chave: string; descricao: string; maxHoras: number }

/** O ritmo vem do `vercel.json`: toda hora (3 h de folga) · diário (36 h) · semanal (9 dias). */
export const CRONS_COM_RASTRO: readonly CronComRastro[] = [
  { chave: "avisos-prazo", descricao: "varredura horária do sino", maxHoras: 3 },
  { chave: "resumo-diario", descricao: "resumo diário do sino", maxHoras: 36 },
  { chave: "cartorios", descricao: "sincronização da base nacional de cartórios", maxHoras: 36 },
  { chave: "coleta-purga", descricao: "retenção da coleta de dados", maxHoras: 36 },
  { chave: "coleta-orfaos", descricao: "varredura de arquivos órfãos da coleta", maxHoras: 36 },
  { chave: "conferidor-orfaos", descricao: "conferidor semanal de arquivos órfãos", maxHoras: 24 * 9 },
]

/** Antes desta data nenhum cron podia ter deixado rastro (o registro nasceu nela): a contagem da idade começa aqui, nunca antes. */
export const RASTRO_DE_CRON_DESDE = new Date("2026-10-09T23:00:00Z")

export const chaveDoRastro = (cron: string) => `cron.${cron}.ultimo`

/** Chamado pelo cron ao terminar bem. Nunca derruba o cron: falha em gravar o rastro vira só aviso no log. */
export async function registrarExecucaoDeCron(cron: string): Promise<void> {
  try {
    const valor = new Date().toISOString()
    await prisma.configuracaoSistema.upsert({
      where: { chave: chaveDoRastro(cron) },
      create: { chave: chaveDoRastro(cron), valor, grupo: "cron" },
      update: { valor },
    })
  } catch (e) {
    console.error(`[cron/${cron}] não foi possível gravar o rastro da execução:`, e)
  }
}

/** PURA: horas desde a última passagem (ou desde o começo da contagem, se nunca passou) e se estourou o ritmo. */
export function situacaoDoRastro(args: { ultimo: Date | null; agora: Date; maxHoras: number }): { horas: number; atrasado: boolean; nuncaRodou: boolean } {
  const base = args.ultimo && args.ultimo > RASTRO_DE_CRON_DESDE ? args.ultimo : RASTRO_DE_CRON_DESDE
  const horas = (args.agora.getTime() - base.getTime()) / 3_600_000
  return { horas, atrasado: horas > args.maxHoras, nuncaRodou: args.ultimo == null }
}
