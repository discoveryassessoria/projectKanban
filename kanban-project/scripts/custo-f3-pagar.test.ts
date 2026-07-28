// F3.2 — "A Pagar" (Financeiro Geral) passa a ler custos de processo do V3, unindo os
// custos legados AINDA NÃO espelhados (leitura-compat). Invariantes:
//  - custo espelhado aparece via V3 e NÃO no fallback legado (sem dupla contagem);
//  - custo legado sem espelho aparece no fallback (não some da tela).
import { prisma } from '@/lib/prisma'
import { espelharCustoComoObrigacao } from '@/lib/financeiro/dual-write'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const mk = (n: string) => ({ codigo: `CUS-${n}-${Date.now().toString().slice(-7)}`, processoId: 16, tipo: 'SERVICO' as const, categoria: 'OUTROS' as const, descricao: `Custo ${n}`, moeda: 'BRL' as const, valor: 200, fxEstimado: 1, fxRule: 'VARIAVEL' as const, nParcelas: 1, vencimento: new Date('2026-09-01'), status: 'ATIVA' as const, custoOperacional: false, origem: 'motor' })

async function main() {
  const A = await prisma.custo.create({ data: mk('A') as any })
  const B = await prisma.custo.create({ data: mk('B') as any })
  const obrA = await espelharCustoComoObrigacao({ id: A.id, codigo: A.codigo, valor: 200, moeda: 'BRL', processoId: 16, vencimento: A.vencimento })
  chk(obrA != null, 'custo A espelhado no V3')

  // replica o sourcing da rota /financas/pagar
  const custosV3 = await listarObrigacoes({ natureza: 'CUSTO' })
  const mirrored = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Custo', origemId: { not: null } }, select: { origemId: true } })
  const mirroredSet = new Set(mirrored.map((m) => m.origemId))
  const custosLegado = (await prisma.custo.findMany({ where: { canceladoEm: null, status: { not: 'CANCELADA' }, cancelado: false }, select: { id: true } })).filter((c) => !mirroredSet.has(c.id))

  chk(custosV3.some((o) => o.obrigacaoId === obrA), 'A aparece via V3')
  chk(!custosLegado.some((c) => c.id === A.id), 'A NÃO aparece no fallback legado (sem dupla contagem)')
  chk(mirroredSet.has(A.id), 'mirroredSet contém A')
  chk(custosLegado.some((c) => c.id === B.id), 'B (não espelhado) aparece no fallback legado (não some)')
  chk(!mirroredSet.has(B.id), 'B não está no mirroredSet')

  // limpeza
  if (obrA) {
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrA)
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: obrA } })
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: obrA } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrA } })
    await prisma.obrigacaoEconomica.delete({ where: { id: obrA } }).catch(() => {})
  }
  for (const c of [A, B]) {
    await prisma.eventoFinanceiro.deleteMany({ where: { custoId: c.id } }).catch(() => {})
    await prisma.parcelaFinanceira.deleteMany({ where: { custoId: c.id } }).catch(() => {})
    await prisma.custo.delete({ where: { id: c.id } }).catch(() => {})
  }

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
