// lib/operacional/sla-por-orgao.ts
// ============================================================================
// REGRA TEMPORAL POR TERCEIRO/CARTÓRIO — mandato Bloco 2.
//
// PRECEDÊNCIA (nunca escolhida em código de tela — sempre resolvida aqui, o
// ÚNICO lugar que decide):
//
//   1. regra específica do terceiro/cartório  — RegraTemporalOrgao
//      (stepKey × orgaoProtocoloId), cadastro em Gerenciamento/Base Órgãos.
//   2. regra do Workflow/Step                 — `PhaseWorkflowStepInstance.slaDays`,
//      já snapshotado na instância na materialização (Etapa 3, `tempo-operacional.ts`).
//   3. default geral                          — sem prazo (nenhuma data
//      inventada; mesma filosofia de `PRAZO_HERDADO` em `tempo-operacional.ts`).
//
// O QUARTO degrau da precedência do mandato — "override local justificado,
// não altera configuração global" — NÃO mora aqui: já existe, é
// `lib/operacional/tarefa-ciclo.ts::alterarPrazo` (valor+motivo+autor+data via
// LogAuditoria, escopado a UMA Tarefa, nunca ao cadastro). Esta função resolve
// só os 3 primeiros degraus — a configuração; o 4º é sempre uma decisão humana
// pontual, feita DEPOIS que a operação já existe.
// ============================================================================
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

type Leitor = Prisma.TransactionClient | typeof prisma

export type OrigemPoliticaTemporal = "ORGAO" | "PASSO" | "DEFAULT"

export interface PoliticaTemporalResolvida {
  /** `null` = sem prazo (default geral) — honesto, nunca inventado. */
  slaDays: number | null
  /** Cadência sugerida do próximo acompanhamento, quando o cadastro do órgão a declara. */
  followUpDays: number | null
  origem: OrigemPoliticaTemporal
  /** A regra de órgão que decidiu, quando `origem==="ORGAO"` — para auditoria/exibição. */
  regraId: number | null
}

/**
 * RESOLVE a política temporal de UM (passo, órgão) — pura leitura, idempotente,
 * sem efeito colateral. `slaDaysDoPasso` é o que a Etapa 3 já calcula
 * (`PhaseWorkflowStepInstance.slaDays`, o snapshot da instância — nunca a
 * definição viva, pela mesma razão que `politicaDeSla` já documenta).
 */
export async function resolverPoliticaTemporal(
  db: Leitor,
  args: { stepKey: string; orgaoProtocoloId: number | null; slaDaysDoPasso: number | null },
): Promise<PoliticaTemporalResolvida> {
  if (args.orgaoProtocoloId != null) {
    const regra = await db.regraTemporalOrgao.findFirst({
      where: { stepKey: args.stepKey, orgaoProtocoloId: args.orgaoProtocoloId, ativo: true },
      select: { id: true, slaDays: true, followUpDays: true },
    })
    if (regra) {
      return { slaDays: regra.slaDays, followUpDays: regra.followUpDays, origem: "ORGAO", regraId: regra.id }
    }
  }
  if (args.slaDaysDoPasso != null && args.slaDaysDoPasso > 0) {
    return { slaDays: args.slaDaysDoPasso, followUpDays: null, origem: "PASSO", regraId: null }
  }
  return { slaDays: null, followUpDays: null, origem: "DEFAULT", regraId: null }
}
