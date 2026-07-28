// F4.3 — Ações contextuais de avanço de estado (Aprovar/Contratar/Executar) via serviço
// mudarEstadoCusto (usado pelo endpoint /v3/obrigacoes/[id]/estado). Valida a máquina,
// audita e recusa transição inválida com erro compreensível. Receita = fora de escopo.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { mudarEstadoCusto } from '@/lib/financeiro/acoes/estado-custo-service'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const estado = async (id: number) => (await prisma.obrigacaoEconomica.findUnique({ where: { id }, select: { estadoCusto: true } }))?.estadoCusto

async function main() {
  // provisão (PREVISTO) → APROVADO → CONTRATADO → EXECUTADO
  const { obrigacaoId: c } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 500, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null, estadoCusto: 'PREVISTO' })
  const ref = String(c)
  chk(await estado(c) === 'PREVISTO', 'provisão nasce PREVISTO')
  chk((await mudarEstadoCusto(ref, 'APROVADO', { usuarioId: 1 })).ok && await estado(c) === 'APROVADO', 'Aprovar → APROVADO')
  chk((await mudarEstadoCusto(ref, 'CONTRATADO', { usuarioId: 1 })).ok && await estado(c) === 'CONTRATADO', 'Contratar → CONTRATADO')
  chk((await mudarEstadoCusto(ref, 'EXECUTADO', { usuarioId: 1 })).ok && await estado(c) === 'EXECUTADO', 'Marcar executado → EXECUTADO')

  // transição inválida recusada com erro (não retrocede)
  const inval = await mudarEstadoCusto(ref, 'PREVISTO', { usuarioId: 1 })
  chk(inval.ok === false && !!inval.erro && await estado(c) === 'EXECUTADO', `transição inválida recusada (${inval.erro?.slice(0, 40)}…) e estado inalterado`)

  // auditoria das transições
  const nAudit = await prisma.logAuditoria.count({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c, acao: 'ESTADO_CUSTO' } })
  chk(nAudit === 3, `3 transições auditadas (ESTADO_CUSTO) (${nAudit})`)

  // Receita fora de escopo
  const { obrigacaoId: r } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 100, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })
  const rr = await mudarEstadoCusto(String(r), 'APROVADO', { usuarioId: 1 })
  chk(rr.ok === false, 'Receita: mudarEstadoCusto recusa (não é custo)')

  for (const id of [c, r]) {
    await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: id } }).catch(() => {})
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
