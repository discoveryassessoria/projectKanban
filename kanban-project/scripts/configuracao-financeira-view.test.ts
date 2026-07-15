/**
 * configuracao-financeira-view — testes puros (sem banco).
 * Rodar: npx tsx scripts/configuracao-financeira-view.test.ts
 */
import {
  derivarPapel,
  paraConfiguracaoView,
  agruparPorItemMestre,
  type ProdutoFinanceiroLike,
} from '../src/lib/financeiro/configuracao-financeira-view'

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

function prod(p: Partial<ProdutoFinanceiroLike> & { id: number; codigo: string }): ProdutoFinanceiroLike {
  return {
    nome: p.codigo, naturezaFinanceira: 'revenue', itemCatalogoId: null, categoriaId: null, planoContaId: null,
    moedaPadrao: 'BRL', valorPadrao: null, cobravelDoCliente: false, custoInterno: false, repasse: false,
    reembolsavel: false, ativo: true, ...p,
  }
}

console.log('configuracao-financeira-view — puro\n')

// 1) derivarPapel
ok(derivarPapel('cost') === 'CUSTO', '1) cost → CUSTO')
ok(derivarPapel('revenue') === 'RECEITA', '1b) revenue → RECEITA')
ok(derivarPapel(null) === 'RECEITA', '1c) null → RECEITA (default do schema)')
ok(derivarPapel('COST') === 'CUSTO', '1d) case-insensitive')

// 2) projeção mantém facetas e detecta órfão
{
  const v = paraConfiguracaoView(prod({ id: 1, codigo: 'CIT_CUSTO', naturezaFinanceira: 'cost', repasse: true, itemCatalogoId: null }))
  ok(v.papel === 'CUSTO', '2) papel CUSTO')
  ok(v.facetas.repasse === true, '2b) faceta repasse preservada')
  ok(v.semMestre === true, '2c) semMestre quando itemCatalogoId null')
}
{
  const v = paraConfiguracaoView(prod({ id: 2, codigo: 'X', itemCatalogoId: 5 }))
  ok(v.semMestre === false && v.itemCatalogoId === 5, '2d) com mestre → semMestre false')
}

// 3) agrupamento: 1 entidade (item) com N papéis, sem duplicar o documento
{
  const configs = [
    paraConfiguracaoView(prod({ id: 1, codigo: 'C', naturezaFinanceira: 'cost', itemCatalogoId: 10 })),
    paraConfiguracaoView(prod({ id: 2, codigo: 'R', naturezaFinanceira: 'revenue', itemCatalogoId: 10 })),
    paraConfiguracaoView(prod({ id: 3, codigo: 'ORF', itemCatalogoId: null })),
  ]
  const { porItem, orfaos } = agruparPorItemMestre(configs)
  ok(porItem.size === 1 && porItem.get(10)?.length === 2, '3) item 10 agrega CUSTO+RECEITA (1 entidade, 2 papéis)')
  ok(orfaos.length === 1 && orfaos[0].codigo === 'ORF', '3b) órfão isolado')
  const papeis = (porItem.get(10) ?? []).map((c) => c.papel).sort()
  ok(papeis.join(',') === 'CUSTO,RECEITA', '3c) papéis do item = CUSTO,RECEITA')
}

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('configuracao-financeira-view: validado ✅')
