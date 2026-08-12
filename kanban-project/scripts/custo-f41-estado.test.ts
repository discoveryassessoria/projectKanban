// F4.1 — Estados explícitos do Custo (fundação). Máquina de transições de domínio +
// atribuição do estado na criação (1ª classe; nunca inferido por saldo). Receita = null.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { podeTransicionarEstadoCusto, transicionarEstadoCusto, ehEstadoCusto, ESTADO_CUSTO_INICIAL } from '@/lib/financeiro/dominio/estado-custo'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const PROC = 16
  // máquina de estados
  chk(ESTADO_CUSTO_INICIAL === 'CONTRATADO', 'estado inicial padrão = CONTRATADO')
  chk(podeTransicionarEstadoCusto('CONTRATADO', 'PAGO'), 'CONTRATADO → PAGO válido')
  chk(podeTransicionarEstadoCusto('PAGO', 'CONCILIADO'), 'PAGO → CONCILIADO válido')
  chk(!podeTransicionarEstadoCusto('PAGO', 'PREVISTO'), 'PAGO → PREVISTO inválido (não retrocede)')
  chk(!podeTransicionarEstadoCusto('CANCELADO', 'PAGO'), 'CANCELADO → PAGO inválido (terminal)')
  chk(podeTransicionarEstadoCusto('CONTRATADO', 'CANCELADO_PARCIAL'), 'CONTRATADO → CANCELADO_PARCIAL válido')
  chk(transicionarEstadoCusto('CONTRATADO', 'APROVADO').ok === false, 'transição inválida retorna ok:false (CONTRATADO→APROVADO)')
  chk(transicionarEstadoCusto('PREVISTO', 'APROVADO').estado === 'APROVADO', 'transição válida aplica o novo estado')
  chk(ehEstadoCusto('CONCILIADO') && !ehEstadoCusto('FOO'), 'ehEstadoCusto valida corretamente')

  // atribuição na criação
  const { obrigacaoId: cId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 100, moedaContratual: 'BRL', processoId: PROC, origemTipo: 'nativo', origemId: null })
  const c = await prisma.obrigacaoEconomica.findUnique({ where: { id: cId }, select: { estadoCusto: true } })
  chk(c?.estadoCusto === 'CONTRATADO', `custo novo nasce CONTRATADO (${c?.estadoCusto})`)

  const { obrigacaoId: cId2 } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 100, moedaContratual: 'BRL', processoId: PROC, origemTipo: 'nativo', origemId: null, estadoCusto: 'PREVISTO' })
  const c2 = await prisma.obrigacaoEconomica.findUnique({ where: { id: cId2 }, select: { estadoCusto: true } })
  chk(c2?.estadoCusto === 'PREVISTO', `estado inicial pode ser sobrescrito (provisão PREVISTO) (${c2?.estadoCusto})`)

  const { obrigacaoId: rId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 100, moedaContratual: 'BRL', processoId: PROC, origemTipo: 'nativo', origemId: null })
  const r = await prisma.obrigacaoEconomica.findUnique({ where: { id: rId }, select: { estadoCusto: true } })
  chk(r?.estadoCusto === null, 'Receita NÃO usa estadoCusto (null)')

  // limpeza
  for (const id of [cId, cId2, rId]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } })
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
