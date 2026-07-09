// prisma/test-pricing-hierarquia.ts
// LOTE A · B3 — Prova a ORDEM DE PRECEDÊNCIA do resolverPreco.
// Cria linhas de teste em níveis diferentes, resolve, confere qual ganhou, e LIMPA.
// Rodar: npx tsx prisma/test-pricing-hierarquia.ts
import { prisma } from '@/lib/prisma'
import { resolverPreco } from '@/src/lib/motor/pricing-resolver'
import { NaturezaPreco, Moeda } from '@prisma/client'

async function main() {
  const item = await prisma.itemCatalogo.findUnique({ where: { code: 'CERT_NASCIMENTO_IT' } })
  if (!item) { console.log('❌ rode o seed do Catálogo Mestre antes'); return }
  const TIPO = '5', REG = 'BR-SP', FORN = 999999 // fornecedor fake só p/ teste

  // cria 3 níveis: global(10), nacionalidade(20), processoTipo+regiao... vamos testar precedência
  const criados: number[] = []
  const mk = async (patch: any, valor: number) => {
    const t = await prisma.tabelaValor.create({ data: { name: `[TESTE] ${valor}`, itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO, moeda: Moeda.BRL, valor, modoCalculo: 'fixed', ...patch } })
    criados.push(t.id); return t
  }
  try {
    await mk({}, 10)                                  // global
    await mk({ regiao: REG }, 30)                     // região
    await mk({ processoTipoId: TIPO }, 20)            // nacionalidade

    // 1) sem contexto → global (10)
    const a = await resolverPreco({ itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO })
    console.log(`Teste 1 (global):        ${a?.valor} via ${a?.nivel} — ${a?.valor === 10 && a?.nivel === 'global' ? '✅' : '❌'}`)

    // 2) com nacionalidade → nacionalidade (20) ganha do global
    const b = await resolverPreco({ itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO, processoTipoId: TIPO })
    console.log(`Teste 2 (nacionalidade): ${b?.valor} via ${b?.nivel} — ${b?.valor === 20 && b?.nivel === 'nacionalidade' ? '✅' : '❌'}`)

    // 3) com região → região (30) ganha (mais específica que nacionalidade na nossa ordem: proc>nac>regiao>forn>global)
    //    obs: nacionalidade tem precedência sobre região; então passando AMBOS, nacionalidade ganha:
    const c = await resolverPreco({ itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO, processoTipoId: TIPO, regiao: REG })
    console.log(`Teste 3 (nac+reg→nac):   ${c?.valor} via ${c?.nivel} — ${c?.valor === 20 && c?.nivel === 'nacionalidade' ? '✅' : '❌'}`)

    // 4) só região → região (30)
    const d = await resolverPreco({ itemCatalogoId: item.id, natureza: NaturezaPreco.CUSTO, regiao: REG })
    console.log(`Teste 4 (só região):     ${d?.valor} via ${d?.nivel} — ${d?.valor === 30 && d?.nivel === 'regiao' ? '✅' : '❌'}`)

    // 5) receita sem linha → null (independente do custo)
    const e = await resolverPreco({ itemCatalogoId: item.id, natureza: NaturezaPreco.RECEITA })
    console.log(`Teste 5 (receita vazia): ${e === null ? 'null ✅ (independente do custo)' : '❌ retornou ' + e?.valor}`)
  } finally {
    await prisma.tabelaValor.deleteMany({ where: { id: { in: criados } } })
    console.log('\n🧹 linhas de teste removidas.')
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())