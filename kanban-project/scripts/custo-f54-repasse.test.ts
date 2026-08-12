// F5.4 — Repasse/Reembolso: vínculo EXPLÍCITO e auditável Custo→Cobrança. Nunca converte
// custo em receita; valida as direções (custo=A_PAGAR, cobrança=A_RECEBER).
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarRepasse, cancelarRepasse, repassesDoCusto } from '@/lib/financeiro/pagavel/repasse'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const { obrigacaoId: custo } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 500, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })
  const { obrigacaoId: cobranca } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 500, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null }) // A_RECEBER

  // vínculo válido: custo → cobrança do cliente
  const r = await registrarRepasse(custo, { tipo: 'REEMBOLSO', valor: 500, receitaObrigacaoId: cobranca, motivo: 'reembolso ao cliente' }, { usuarioId: 1 })
  chk(r.id > 0 && r.receitaObrigacaoId === cobranca && r.tipo === 'REEMBOLSO', 'vínculo explícito custo→cobrança registrado')
  chk((await repassesDoCusto(custo)).length === 1, 'repasse aparece no read do custo')
  chk(!!(await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: custo, acao: 'REPASSE' } })), 'auditoria REPASSE registrada')

  // NUNCA converter: vincular a um CUSTO (A_PAGAR) deve falhar
  let barrouCusto = false
  try { await registrarRepasse(custo, { tipo: 'REPASSE', valor: 100, receitaObrigacaoId: custo } as any) } catch { barrouCusto = true }
  chk(barrouCusto, 'vincular a obrigação A_PAGAR (não-cobrança) é BARRADO (custo nunca vira receita)')

  // repasse deve partir de um CUSTO, não de uma receita
  let barrouReceita = false
  try { await registrarRepasse(cobranca, { tipo: 'REPASSE', valor: 100 } as any) } catch { barrouReceita = true }
  chk(barrouReceita, 'repasse a partir de obrigação A_RECEBER é BARRADO (parte do custo)')

  // cancelar
  await cancelarRepasse(r.id, { usuarioId: 1 })
  chk((await repassesDoCusto(custo))[0].status === 'CANCELADO', 'repasse cancelado (status CANCELADO)')

  // limpeza
  await prisma.repasseCusto.deleteMany({ where: { custoObrigacaoId: custo } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: custo } }).catch(() => {})
  for (const id of [custo, cobranca]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } }); await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }
  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
