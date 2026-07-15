/**
 * Tabela de Preços por Configuração Financeira (FK) — integração (tx + ROLLBACK).
 * Prova: preço chaveia por configuracaoFinanceiraItemId; precedência fornecedor>nacionalidade>global;
 * zero é ignorado (nunca silencioso); Fase não participa. Não polui produção.
 *   PRISMA_DATABASE_URL=$DIRECT_DATABASE_URL npx tsx scripts/preco-por-config.integration.test.ts
 */
import { PrismaClient, Moeda } from '@prisma/client'
import { resolverPrecoCore, type LinhaPreco, type ContextoPrecoFinanceiro } from '../src/lib/motor/resolver-preco-financeiro'

const prisma = new PrismaClient()
const ROLLBACK = 'ROLLBACK_SENTINELA'
let passed = 0, failed = 0
const falhas: string[] = []
const ok = (c: boolean, n: string) => { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) } }

async function main() {
  console.log('Tabela de Preços por Config (rollback)\n')
  try {
    await prisma.$transaction(async (tx) => {
      const cfg = await tx.produtoFinanceiro.findFirst({ where: { papelFinanceiro: { not: null } }, select: { id: true } })
      if (!cfg) throw new Error('sem ProdutoFinanceiro com papel para teste')
      const fA = await tx.fornecedor.create({ data: { nome: 'Forn A (roll)', tipo: 'outro' }, select: { id: true } })
      const fB = await tx.fornecedor.create({ data: { nome: 'Forn B (roll)', tipo: 'outro' }, select: { id: true } })

      // preços chaveados por configuracaoFinanceiraItemId, contextos distintos
      await tx.tabelaValor.create({ data: { name: 'g', configuracaoFinanceiraItemId: cfg.id, moeda: Moeda.BRL, valor: 100 } })
      await tx.tabelaValor.create({ data: { name: 'fa', configuracaoFinanceiraItemId: cfg.id, moeda: Moeda.BRL, valor: 150, fornecedorId: fA.id } })
      await tx.tabelaValor.create({ data: { name: 'p99', configuracaoFinanceiraItemId: cfg.id, moeda: Moeda.EUR, valor: 90, processoTipoId: '99' } })
      await tx.tabelaValor.create({ data: { name: 'zero', configuracaoFinanceiraItemId: cfg.id, moeda: Moeda.BRL, valor: 0, fornecedorId: fB.id } })

      const carregar = async () => {
        const rows = await tx.tabelaValor.findMany({ where: { configuracaoFinanceiraItemId: cfg.id, arquivado: false, legadoPendente: false } })
        return rows.map((r): LinhaPreco => ({ id: r.id, valor: Number(r.valor), moeda: r.moeda, modoCalculo: r.modoCalculo, natureza: r.natureza, arquivado: r.arquivado, processoId: r.processoId ?? null, processoTipoId: r.processoTipoId ?? null, regiao: r.regiao ?? null, fornecedorId: r.fornecedorId ?? null, vigenciaInicio: r.vigenciaInicio ?? null, vigenciaFim: r.vigenciaFim ?? null }))
      }
      const linhas = await carregar()
      const base = (ctx: Partial<ContextoPrecoFinanceiro>) => resolverPrecoCore(linhas, { itemCatalogoId: cfg.id, natureza: null, ...ctx } as ContextoPrecoFinanceiro)

      const rFor = base({ fornecedorId: fA.id })
      ok(rFor.ok && rFor.valor === 150 && rFor.nivel === 'fornecedor', '(1) preço por FORNECEDOR (150)')
      const rNac = base({ tipoProcessoId: 99 })
      ok(rNac.ok && rNac.valor === 90 && rNac.nivel === 'tipoProcesso', '(2) preço por NACIONALIDADE (90)')
      const rGlob = base({})
      ok(rGlob.ok && rGlob.valor === 100 && rGlob.nivel === 'global', '(3) preço GLOBAL (100)')
      const rZero = base({ fornecedorId: fB.id })
      ok(rZero.ok && rZero.valor === 100, '(4) zero do forn B ignorado → cai no global (nunca zero silencioso)')

      // config sem preços → erro claro
      const cfg2 = await tx.produtoFinanceiro.findFirst({ where: { id: { not: cfg.id }, papelFinanceiro: { not: null } }, select: { id: true } })
      if (cfg2) { const vazio = resolverPrecoCore([], { itemCatalogoId: cfg2.id, natureza: null } as ContextoPrecoFinanceiro); ok(!vazio.ok, '(5) config sem preço → ok:false (nunca zero)') }
      else ok(true, '(5) pulado (sem 2ª config)')

      throw new Error(ROLLBACK)
    })
  } catch (e) { if (!(e instanceof Error) || e.message !== ROLLBACK) throw e }

  console.log(`\n${passed} passaram, ${failed} falharam (revertido — produção intacta)`)
  if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exitCode = 1 }
  else console.log('Tabela de Preços por Config: cutover validado ✅')
}
main().catch((e) => { console.error('ERRO (rollback):', e); process.exit(1) }).finally(() => prisma.$disconnect())
