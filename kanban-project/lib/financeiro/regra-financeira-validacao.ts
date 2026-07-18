// lib/financeiro/regra-financeira-validacao.ts
// ============================================================================
// §3 — validação de NATUREZA da Regra Financeira contra a Configuração Financeira,
// no BACKEND (a UI filtra, mas NÃO é a única proteção). Serviço único e reutilizável
// por aplicabilidade-economica (PhaseEconomicRule) e disparo-fase (PhaseTriggerRule).
//
//   SOMENTE_CUSTO   → só pode gerar CUSTO.
//   SOMENTE_RECEITA → só pode gerar RECEITA.
//   CUSTO_E_RECEITA → CUSTO, RECEITA ou AMBOS.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { deriveNaturezaFinanceira, admiteCusto, admiteVenda, type LancamentoNatureza } from './natureza-financeira'

export interface RegraValidacao { ok: boolean; motivo?: string }

/** A config aponta pode gerar um LANÇAMENTO da natureza `alvo` (CUSTO|RECEITA)? */
export async function validarConfigGeraLancamento(configId: number | null | undefined, alvo: LancamentoNatureza): Promise<RegraValidacao> {
  if (configId == null) return { ok: true } // sem config vinculada → nada a validar aqui
  const cfg = await prisma.produtoFinanceiro.findUnique({
    where: { id: configId },
    select: { naturezaFin: true, possuiCusto: true, possuiReceita: true, valorCustoPadrao: true, valorReceitaPadrao: true, nome: true },
  })
  if (!cfg) return { ok: false, motivo: `Configuração Financeira ${configId} não encontrada` }
  const nat = deriveNaturezaFinanceira({
    naturezaFin: cfg.naturezaFin, possuiCusto: cfg.possuiCusto, possuiReceita: cfg.possuiReceita,
    valorCustoPadrao: cfg.valorCustoPadrao == null ? null : Number(cfg.valorCustoPadrao),
    valorReceitaPadrao: cfg.valorReceitaPadrao == null ? null : Number(cfg.valorReceitaPadrao),
  })
  if (alvo === 'CUSTO' && !admiteCusto(nat)) return { ok: false, motivo: `"${cfg.nome}" (${nat ?? 'sem natureza'}) não permite gerar CUSTO` }
  if (alvo === 'RECEITA' && !admiteVenda(nat)) return { ok: false, motivo: `"${cfg.nome}" (${nat ?? 'sem natureza'}) não permite gerar RECEITA` }
  return { ok: true }
}

/** PhaseEconomicRule: custoConfig gera CUSTO, receitaConfig gera RECEITA. */
export async function validarRegraEconomica(custoConfigId: number | null | undefined, receitaConfigId: number | null | undefined): Promise<RegraValidacao> {
  const c = await validarConfigGeraLancamento(custoConfigId, 'CUSTO')
  if (!c.ok) return c
  return validarConfigGeraLancamento(receitaConfigId, 'RECEITA')
}
