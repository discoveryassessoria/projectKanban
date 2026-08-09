// F5.5 — Integração de Contas a Pagar: um custo com cronograma + pagamento parcial +
// comprovante + repasse aparece corretamente em Contas a Pagar (dashboard/relatório),
// na timeline financeira (obrigacaoId) e na auditoria. Valida o reuso dos read-models.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { definirCronogramaPagavel, parcelasPagaveisComStatus } from '@/lib/financeiro/pagavel/cronograma-pagavel'
import { registrarRepasse } from '@/lib/financeiro/pagavel/repasse'
import { listarContasAPagar } from '@/lib/financeiro/leitura/contas-a-pagar'
import { timelineIndividualParticipante } from '@/lib/financeiro/leitura/timeline-financeira'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now(); const dias = (n: number) => new Date(Date.now() + n * 86_400_000)

async function main() {
  const { obrigacaoId: c } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 1000, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null, vencimento: dias(30) })
  const { obrigacaoId: cob } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 1000, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })

  await definirCronogramaPagavel(c, [{ vencimento: dias(30), valor: 500 }, { vencimento: dias(60), valor: 500 }], { usuarioId: 1 })
  await registrarOcorrencia({ obrigacaoId: c, tipo: 'PAGAMENTO_PARCIAL', valor: 500, moeda: 'BRL', criadoPorId: 1, idempotencyKey: `i1-${TS}` } as any)
  await prisma.receitaDocumento.create({ data: { obrigacaoId: c, receitaId: null, arquivoUrl: 'https://r2/x.pdf', arquivoNome: 'nf.pdf', tipo: 'comprovante', criadoPorId: 1 } as any })
  await registrarRepasse(c, { tipo: 'REPASSE', valor: 300, receitaObrigacaoId: cob }, { usuarioId: 1 })

  // Contas a Pagar (dashboard/relatório): o custo aparece, PARCIAL, com saldo 500
  const cp = await listarContasAPagar({ processoId: 16 })
  const item = cp.itens.find((o) => o.obrigacaoId === c)
  chk(!!item && item.balde === 'PARCIAL' && Number(item.saldoBrl) === 500, `Contas a Pagar: custo PARCIAL, saldo 500 (${item?.balde}/${item?.saldoBrl})`)
  chk(cp.kpis.aPagarBrl >= 500, 'KPI aPagar reflete o saldo do custo')

  // cronograma: parcela 1 PAGA (derivado do Ledger), parcela 2 PENDENTE
  const parc = await parcelasPagaveisComStatus(c)
  chk(parc[0].status === 'PAGA' && parc[1].status === 'PENDENTE', 'cronograma: 1 PAGA / 2 PENDENTE (derivado)')

  // comprovante rico
  chk((await prisma.receitaDocumento.count({ where: { obrigacaoId: c } })) === 1, 'comprovante do custo presente')

  // repasse vinculado
  chk((await prisma.repasseCusto.count({ where: { custoObrigacaoId: c, status: 'ATIVO' } })) === 1, 'repasse vinculado ativo')

  // timeline financeira (obrigacaoId): pagamento aparece
  const tl = await timelineIndividualParticipante(c)
  chk(tl.some((e) => e.tipo === 'PAGAMENTO_PARCIAL' || e.tipo === 'PAGAMENTO'), 'timeline financeira do custo mostra o pagamento')

  // auditoria: cronograma + repasse registrados
  chk((await prisma.logAuditoria.count({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c, acao: { in: ['CRONOGRAMA_PAGAVEL', 'REPASSE'] } } })) >= 2, 'auditoria: cronograma + repasse')

  // limpeza
  await prisma.repasseCusto.deleteMany({ where: { custoObrigacaoId: c } }); await prisma.parcelaPagavel.deleteMany({ where: { obrigacaoId: c } })
  await prisma.receitaDocumento.deleteMany({ where: { obrigacaoId: c } }); await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c } }).catch(() => {})
  for (const id of [c, cob]) {
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } }); await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }
  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
