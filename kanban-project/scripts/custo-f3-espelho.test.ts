// F3 — Consolidação: todo Custo (legado) do processo passa a existir no motor V3
// (ObrigacaoEconomica/A_PAGAR) via espelho idempotente, best-effort. Prova:
//  (1) um Custo legado sem espelho vira uma ObrigacaoEconomica CUSTO com Ledger;
//  (2) aparece em listarObrigacoes(CUSTO) (fonte lida pelas telas V3);
//  (3) idempotência: rodar de novo NÃO duplica.
import { prisma } from '@/lib/prisma'
import { espelharCustosDoProcesso } from '@/lib/financeiro/dual-write'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const PROC = 16
  const custo = await prisma.custo.create({ data: {
    codigo: `CUS-F3-${Date.now().toString().slice(-8)}`, processoId: PROC, tipo: 'SERVICO', categoria: 'OUTROS',
    descricao: 'Custo legado do motor (teste F3)', moeda: 'BRL', valor: 350, fxEstimado: 1, fxRule: 'VARIAVEL',
    nParcelas: 1, vencimento: new Date('2026-09-01'), status: 'ATIVA', custoOperacional: false, origem: 'motor',
  } as any })

  const n1 = await espelharCustosDoProcesso(PROC)
  chk(n1 >= 1, `espelhou ≥1 custo (n=${n1})`)
  const obr = await prisma.obrigacaoEconomica.findFirst({ where: { origemTipo: 'Custo', origemId: custo.id } })
  chk(!!obr, 'ObrigacaoEconomica(origemTipo=Custo) criada')
  chk(obr?.natureza === 'CUSTO' && obr?.direcao === 'A_PAGAR', `natureza/direção corretas (${obr?.natureza}/${obr?.direcao})`)
  chk(Number(obr?.valorContratado) === 350, 'valor espelhado')
  const ledger = obr ? await prisma.ledgerFinanceiro.findUnique({ where: { obrigacaoId: obr.id } }) : null
  chk(!!ledger, 'Ledger criado para o custo espelhado')
  const naLista = (await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).some((o) => o.obrigacaoId === obr!.id)
  chk(naLista, 'custo espelhado aparece em listarObrigacoes(CUSTO)')

  // idempotência
  const n2 = await espelharCustosDoProcesso(PROC)
  const qtd = await prisma.obrigacaoEconomica.count({ where: { origemTipo: 'Custo', origemId: custo.id } })
  chk(qtd === 1, `idempotente: exatamente 1 obrigação após 2ª passada (n2=${n2}, qtd=${qtd})`)

  // limpeza
  if (obr) {
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obr.id)
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: obr.id } })
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: obr.id } })
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obr.id } })
    await prisma.obrigacaoEconomica.delete({ where: { id: obr.id } }).catch(() => {})
  }
  await prisma.eventoFinanceiro.deleteMany({ where: { custoId: custo.id } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { custoId: custo.id } }).catch(() => {})
  await prisma.custo.delete({ where: { id: custo.id } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
