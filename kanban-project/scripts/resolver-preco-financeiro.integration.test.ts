/**
 * resolverPrecoFinanceiro — teste de INTEGRAÇÃO (com banco, via TabelaValor real).
 *
 * ⚠️ NÃO RODAR durante o freeze da migração Legacy→V2. Este teste ESCREVE dados
 * dentro de uma transação e faz ROLLBACK ao final (nada persiste), mas ainda
 * assim toca o banco — rodar só APÓS o freeze:
 *   npx tsx scripts/resolver-preco-financeiro.integration.test.ts
 *
 * Valida o caminho real: query (itemCatalogoId+natureza+arquivado) → mapeamento
 * Decimal→number → núcleo. Todo o trabalho ocorre numa transação abortada de
 * propósito (throw ROLLBACK_SENTINELA), então o banco fica intacto.
 */
import { PrismaClient, NaturezaPreco, Moeda } from '@prisma/client'
import {
  resolverPrecoFinanceiro,
  type CarregadorLinhasPreco,
  type LinhaPreco,
} from '../src/lib/motor/resolver-preco-financeiro'

const prisma = new PrismaClient()
const ROLLBACK = 'ROLLBACK_SENTINELA'

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

async function main() {
  console.log('resolverPrecoFinanceiro — integração (transação com rollback)\n')
  try {
    await prisma.$transaction(async (tx) => {
      // loader ligado ao CLIENTE DA TRANSAÇÃO (enxerga as linhas não-commitadas)
      const carregar: CarregadorLinhasPreco = async (itemCatalogoId, natureza) => {
        const rows = await tx.tabelaValor.findMany({ where: { itemCatalogoId, natureza, arquivado: false } })
        return rows.map((r): LinhaPreco => ({
          id: r.id, valor: Number(r.valor), moeda: r.moeda, modoCalculo: r.modoCalculo,
          natureza: r.natureza, arquivado: r.arquivado, processoId: r.processoId ?? null,
          processoTipoId: r.processoTipoId ?? null, regiao: r.regiao ?? null,
          fornecedorId: r.fornecedorId ?? null, vigenciaInicio: r.vigenciaInicio ?? null, vigenciaFim: r.vigenciaFim ?? null,
        }))
      }

      const item = await tx.itemCatalogo.create({
        data: { code: `TEST_RESOLVER_${Date.now()}`, name: 'Item de teste do resolver (rollback)', natureza: 'OUTRO' },
      })

      // RECEITA: global 90 (EUR) + específico de processo 200
      await tx.tabelaValor.create({ data: { name: 'g', itemCatalogoId: item.id, natureza: NaturezaPreco.RECEITA, moeda: Moeda.EUR, valor: 90 } })
      await tx.tabelaValor.create({ data: { name: 'p', itemCatalogoId: item.id, natureza: NaturezaPreco.RECEITA, moeda: Moeda.EUR, valor: 200, processoId: 777 } })
      // CUSTO: só uma linha [AJUSTAR] com valor 0 → deve ser DESCARTADA (B2)
      await tx.tabelaValor.create({ data: { name: '[AJUSTAR]', itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO, moeda: Moeda.BRL, valor: 0 } })

      const global = await resolverPrecoFinanceiro({ itemCatalogoId: item.id, natureza: NaturezaPreco.RECEITA }, carregar)
      ok(global.ok && global.valor === 90 && global.nivel === 'global', 'INT-1) global 90 resolvido do banco')

      const proc = await resolverPrecoFinanceiro({ itemCatalogoId: item.id, natureza: NaturezaPreco.RECEITA, processoId: 777 }, carregar)
      ok(proc.ok && proc.valor === 200 && proc.nivel === 'processo', 'INT-2) processo específico vence global (banco)')

      const custoZero = await resolverPrecoFinanceiro({ itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO }, carregar)
      ok(!custoZero.ok && custoZero.motivo === 'SEM_PRECO_VALIDO', 'INT-3) custo [AJUSTAR]=0 NÃO contabiliza zero')

      const custoFallback = await resolverPrecoFinanceiro({ itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO, fallbackValorPadrao: 150, fallbackMoeda: Moeda.BRL }, carregar)
      ok(custoFallback.ok && custoFallback.valor === 150 && custoFallback.nivel === 'fallback_padrao', 'INT-4) fallback explícito usado (banco)')

      throw new Error(ROLLBACK) // aborta a transação: NADA persiste
    })
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e
  }

  console.log(`\n${passed} passaram, ${failed} falharam (transação revertida — banco intacto)`)
  if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exitCode = 1 }
  else console.log('resolverPrecoFinanceiro: integração validada ✅')
}

main()
  .catch((e) => { console.error('ERRO (rollback garantido):', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
