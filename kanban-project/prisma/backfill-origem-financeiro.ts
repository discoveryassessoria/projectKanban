// prisma/backfill-origem-financeiro.ts
// ============================================================================
// §15 — backfill IDEMPOTENTE de ORIGEM do Financeiro Geral + §3 relatório de regras
// incompatíveis. NÃO destrutivo, dry-run por padrão (--execute para gravar).
//
//   • ContaPagar sem processoId  → origem CORPORATIVA (evidência inequívoca).
//   • ContaPagar com processoId mas SEM vínculo a um Custo → ORIGEM_DESCONHECIDA
//     (entra em relatório para revisão; NÃO associa por aproximação insegura).
//   • Receita/Custo já nascem origemLancamento=PROCESSO (default da coluna) — nada
//     a fazer; apenas conferência.
//   • Relatório (read-only) de PhaseEconomicRule/PhaseTriggerRule cuja natureza é
//     incompatível com a Configuração Financeira (§3) — não altera dados.
//
// Uso:
//   npx tsx prisma/backfill-origem-financeiro.ts            (dry-run)
//   npx tsx prisma/backfill-origem-financeiro.ts --execute  (grava)
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { deriveNaturezaFinanceira, admiteCusto, admiteVenda } from '../lib/financeiro/natureza-financeira'

const url = process.env.INSPECT_DB_URL
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient()
const EXECUTE = process.argv.includes('--execute')

async function main() {
  // 1) ContaPagar — classificação de origem.
  const contas = await prisma.contaPagar.findMany({ select: { id: true, processoId: true, origem: true, custoOrigemId: true } })
  const corporativas = contas.filter((c) => c.processoId == null)
  const desconhecidas = contas.filter((c) => c.processoId != null && c.custoOrigemId == null)

  // 2) §3 — regras existentes com natureza incompatível (read-only).
  const [econ, trig, configs] = await Promise.all([
    prisma.phaseEconomicRule.findMany({ select: { id: true, componentName: true, custoConfigId: true, receitaConfigId: true } }),
    prisma.phaseTriggerRule.findMany({ select: { id: true, name: true, entryType: true, configItemId: true } }),
    prisma.produtoFinanceiro.findMany({ select: { id: true, nome: true, naturezaFin: true, possuiCusto: true, possuiReceita: true, valorCustoPadrao: true, valorReceitaPadrao: true } }),
  ])
  const cfgById = new Map(configs.map((c) => [c.id, c]))
  const natDe = (id: number | null) => {
    if (id == null) return null
    const c = cfgById.get(id)
    if (!c) return null
    return deriveNaturezaFinanceira({ naturezaFin: c.naturezaFin, possuiCusto: c.possuiCusto, possuiReceita: c.possuiReceita, valorCustoPadrao: c.valorCustoPadrao == null ? null : Number(c.valorCustoPadrao), valorReceitaPadrao: c.valorReceitaPadrao == null ? null : Number(c.valorReceitaPadrao) })
  }
  const regrasIncompat: string[] = []
  for (const e of econ) {
    if (e.custoConfigId != null && !admiteCusto(natDe(e.custoConfigId))) regrasIncompat.push(`PhaseEconomicRule#${e.id} "${e.componentName}" gera CUSTO em config ${e.custoConfigId} (${natDe(e.custoConfigId)})`)
    if (e.receitaConfigId != null && !admiteVenda(natDe(e.receitaConfigId))) regrasIncompat.push(`PhaseEconomicRule#${e.id} "${e.componentName}" gera RECEITA em config ${e.receitaConfigId} (${natDe(e.receitaConfigId)})`)
  }
  for (const t of trig) {
    const alvoCusto = t.entryType === 'cost'
    const nat = natDe(t.configItemId)
    if (t.configItemId != null && ((alvoCusto && !admiteCusto(nat)) || (!alvoCusto && !admiteVenda(nat)))) regrasIncompat.push(`PhaseTriggerRule#${t.id} "${t.name}" (${t.entryType}) incompatível com config ${t.configItemId} (${nat})`)
  }

  console.log(`\n=== BACKFILL ORIGEM FINANCEIRO ${EXECUTE ? '(EXECUTE)' : '(DRY-RUN)'} ===`)
  console.log(`ContaPagar total: ${contas.length}`)
  console.log(`  → CORPORATIVA (sem processo):        ${corporativas.length}`)
  console.log(`  → ORIGEM_DESCONHECIDA (com processo, sem vínculo a Custo): ${desconhecidas.length}`)
  console.log(`\n§3 — Regras Financeiras INCOMPATÍVEIS (revisar; NÃO alteradas): ${regrasIncompat.length}`)
  for (const r of regrasIncompat) console.log(`  ⚠ ${r}`)

  if (!EXECUTE) { console.log('\nDRY-RUN — nada gravado. Rode com --execute para aplicar.\n'); return }

  let n = 0
  for (const c of corporativas) if (c.origem !== 'CORPORATIVA') { await prisma.contaPagar.update({ where: { id: c.id }, data: { origem: 'CORPORATIVA' } }); n++ }
  let d = 0
  for (const c of desconhecidas) if (c.origem !== 'ORIGEM_DESCONHECIDA') { await prisma.contaPagar.update({ where: { id: c.id }, data: { origem: 'ORIGEM_DESCONHECIDA' } }); d++ }
  console.log(`\nAPLICADO: ${n} → CORPORATIVA, ${d} → ORIGEM_DESCONHECIDA. Regras incompatíveis NÃO foram tocadas (apenas relatadas).\n`)
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
