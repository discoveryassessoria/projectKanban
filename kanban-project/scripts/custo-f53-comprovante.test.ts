// F5.3 — Comprovante rico de CUSTO (reuso de ReceitaDocumento.obrigacaoId, já existente).
// Prova: anexar/ler comprovante por obrigacaoId funciona para custo (mesmo caminho do
// endpoint /v3/obrigacoes/[id]/documentos e da leitura do detalhe).
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const { obrigacaoId: c } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 300, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })

  // anexar comprovante ao CUSTO (mesmo shape do endpoint: obrigacaoId + receitaId null)
  const doc = await prisma.receitaDocumento.create({ data: { obrigacaoId: c, receitaId: null, arquivoUrl: 'https://r2/comprovante-custo.pdf', arquivoNome: 'comprovante.pdf', tipo: 'comprovante', criadoPorId: 1 } as any })
  chk(!!doc.id && doc.receitaId === null && doc.obrigacaoId === c, 'comprovante anexado ao custo por obrigacaoId (sem Receita)')

  // ler pelo MESMO caminho do detalhe (receita-detalhe usa findMany where obrigacaoId)
  const docs = await prisma.receitaDocumento.findMany({ where: { obrigacaoId: c } })
  chk(docs.length === 1 && docs[0].arquivoNome === 'comprovante.pdf', 'comprovante do custo aparece na leitura por obrigacaoId (galeria do detalhe)')
  chk(docs[0].tipo === 'comprovante', 'tipo comprovante preservado')

  // limpeza
  await prisma.receitaDocumento.deleteMany({ where: { obrigacaoId: c } })
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, c).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: c } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: c } }); await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: c } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: c } })
  await prisma.obrigacaoEconomica.delete({ where: { id: c } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
