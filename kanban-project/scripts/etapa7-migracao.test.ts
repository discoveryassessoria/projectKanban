// Regressão da Etapa 7 (migração V1→V3 definitiva do Financeiro do Processo):
// 1) visão-geral V3 = fonte única (obrigações) no shape ItemAPI com parcelas reais;
// 2) documentos por obrigacaoId funcionam para CUSTO (receitaId nulo).
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { carregarVisaoGeralProcesso } from '@/lib/financeiro/leitura/visao-geral-processo'
import { carregarReceitaConsolidada } from '@/lib/financeiro/leitura/receita-detalhe'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  // ── 1) VISÃO GERAL V3 — shape/paridade ──
  const vg: any = await carregarVisaoGeralProcesso(16)
  chk(vg && Array.isArray(vg.receitas) && Array.isArray(vg.custos), 'visão-geral retorna { receitas[], custos[] }')
  const amostra = [...(vg.receitas ?? []), ...(vg.custos ?? [])]
  chk(amostra.length > 0, `visão-geral traz obrigações do processo 16 (${amostra.length})`)
  if (amostra[0]) {
    const it = amostra[0]
    const shapeOk = ['id', 'codigo', 'moeda', 'valor', 'parcelas'].every((k) => k in it)
    chk(shapeOk, 'item no shape ItemAPI (id/codigo/moeda/valor/parcelas)')
    chk(Array.isArray(it.parcelas) && it.parcelas.length >= 1, `item tem parcelas reais/sintéticas (${it.parcelas?.length})`)
    const p = it.parcelas?.[0]
    chk(p && ['numero', 'vencimento', 'valor', 'status'].every((k) => k in p), 'parcela no shape ParcelaAPI')
  }
  // canceladas ficam fora (mesma regra do ativo() da tela)
  chk(amostra.every((i: any) => i.status !== 'CANCELADA'), 'visão-geral exclui canceladas')

  // ── 2) DOCUMENTOS por obrigacaoId em CUSTO (receitaId nulo) ──
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
    natureza: 'CUSTO', valorContratado: 300, moedaContratual: 'BRL',
    processoId: 16, origemTipo: 'nativo', criadoPorId: 1, observacoes: 'etapa7 doc test',
  })
  const doc = await prisma.receitaDocumento.create({
    data: { obrigacaoId, receitaId: null, arquivoUrl: 'https://x/doc.pdf', arquivoNome: 'contrato.pdf', tipo: 'contrato', tamanho: 123, criadoPorId: 1 },
  })
  chk(doc.receitaId === null && doc.obrigacaoId === obrigacaoId, 'documento de CUSTO criado com receitaId nulo + obrigacaoId')
  const det: any = await carregarReceitaConsolidada(String(obrigacaoId))
  chk(!!det && det.natureza === 'CUSTO', 'detalhe do custo carrega')
  chk(Array.isArray(det?.documentos) && det.documentos.some((d: any) => d.id === doc.id), 'read-model lista o documento por obrigacaoId (custo)')

  // limpeza
  await prisma.receitaDocumento.delete({ where: { id: doc.id } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrigacaoId)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
