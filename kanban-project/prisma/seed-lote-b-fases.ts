// prisma/seed-lote-b-fases.ts
// ============================================================================
// LOTE B — Popular TODAS as fases além da Emissão: Tradução, Apostilamento
// (Certidão + Tradução) e Retificação. TUDO configurável, valores [AJUSTAR].
//
// Cria, de forma IDEMPOTENTE (upsert por code), a cadeia completa por componente:
//   ItemCatalogo (identidade)
//     → 2 ProdutoFinanceiro (custo + receita, SEPARADOS)
//     → 2 linhas TabelaValor [AJUSTAR] (custo + receita, moedas independentes)
//     → 1 PhaseEconomicRule (fase → componente, ligada aos produtos)
//
// NÃO inventa preço (valor 0 = [AJUSTAR], Marco preenche na tela).
// NÃO cria enum/switch/mapa. NÃO duplica (idempotente).
// Rodar DEPOIS do db push:  npx tsx prisma/seed-lote-b-fases.ts
// ============================================================================
import { prisma } from '@/lib/prisma'
import { NaturezaItem, UnidadeItem, NaturezaPreco, Moeda } from '@prisma/client'

// ---- Definição dos componentes por fase (o "mapa" agora é DADO, não código) --
// unidade: como o preço é medido (DOCUMENTO, PAGINA, PACOTE...) — Marco pode mudar.
type ComponenteDef = {
  itemCode: string          // code no Catálogo Mestre
  itemName: string
  natureza: NaturezaItem
  unidade: UnidadeItem
  phaseKey: string          // fase real do workflow
  componentKey: string      // identidade do componente
  componentName: string     // = nome da coluna/TipoServico
  appliesTo: string         // any | certificate | translation | original
  custoCode: string         // ProdutoFinanceiro (custo)
  receitaCode: string       // ProdutoFinanceiro (receita)
  custoMoeda: Moeda
  receitaMoeda: Moeda
  ordem: number
}

const COMPONENTES: ComponenteDef[] = [
  // ── TRADUÇÃO JURAMENTADA (preço por PÁGINA, ex.) ──────────────────────────
  {
    itemCode: 'TRAD_JURAMENTADA', itemName: 'Tradução Juramentada', natureza: NaturezaItem.SERVICO, unidade: UnidadeItem.PAGINA,
    phaseKey: 'traducao', componentKey: 'TRADUCAO_JURAMENTADA', componentName: 'Tradução Juramentada', appliesTo: 'any',
    custoCode: 'TRAD_CUSTO', receitaCode: 'TRAD_RECEITA', custoMoeda: Moeda.BRL, receitaMoeda: Moeda.EUR, ordem: 10,
  },
  // ── APOSTILAMENTO CERTIDÃO (preço por DOCUMENTO) ──────────────────────────
  {
    itemCode: 'APOST_CERTIDAO', itemName: 'Apostilamento de Certidão', natureza: NaturezaItem.SERVICO, unidade: UnidadeItem.DOCUMENTO,
    phaseKey: 'apostilamento', componentKey: 'APOSTILA_CERTIDAO', componentName: 'Apostilamento Certidão', appliesTo: 'certificate',
    custoCode: 'APOST_CERT_CUSTO', receitaCode: 'APOST_CERT_RECEITA', custoMoeda: Moeda.BRL, receitaMoeda: Moeda.EUR, ordem: 20,
  },
  // ── APOSTILAMENTO TRADUÇÃO (preço por DOCUMENTO) ──────────────────────────
  {
    itemCode: 'APOST_TRADUCAO', itemName: 'Apostilamento de Tradução', natureza: NaturezaItem.SERVICO, unidade: UnidadeItem.DOCUMENTO,
    phaseKey: 'apostilamento', componentKey: 'APOSTILA_TRADUCAO', componentName: 'Apostilamento Tradução', appliesTo: 'translation',
    custoCode: 'APOST_TRAD_CUSTO', receitaCode: 'APOST_TRAD_RECEITA', custoMoeda: Moeda.BRL, receitaMoeda: Moeda.EUR, ordem: 30,
  },
  // ── RETIFICAÇÃO (preço por DOCUMENTO; varia por modo via preço/condição) ──
  {
    itemCode: 'RETIFICACAO', itemName: 'Retificação de Registro', natureza: NaturezaItem.SERVICO, unidade: UnidadeItem.DOCUMENTO,
    phaseKey: 'retificacao', componentKey: 'RETIFICACAO', componentName: 'Retificação', appliesTo: 'any',
    custoCode: 'RETIF_CUSTO', receitaCode: 'RETIF_RECEITA', custoMoeda: Moeda.BRL, receitaMoeda: Moeda.EUR, ordem: 40,
  },
]

async function upsertItem(c: ComponenteDef) {
  return prisma.itemCatalogo.upsert({
    where: { code: c.itemCode },
    update: { name: c.itemName, natureza: c.natureza, unidade: c.unidade, ativo: true },
    create: { code: c.itemCode, name: c.itemName, natureza: c.natureza, unidade: c.unidade, ativo: true },
  })
}

async function upsertProduto(codigo: string, nome: string, natureza: 'cost' | 'revenue', moeda: Moeda, itemCatalogoId: number) {
  const existe = await prisma.produtoFinanceiro.findFirst({ where: { codigo } })
  const data = {
    nome, moedaPadrao: moeda, naturezaFinanceira: natureza,
    cobravelDoCliente: natureza === 'revenue', ativo: true, itemCatalogoId,
    // valorPadrao fica NULL de propósito — o preço real vem da TabelaValor ([AJUSTAR])
  }
  if (existe) return prisma.produtoFinanceiro.update({ where: { id: existe.id }, data })
  return prisma.produtoFinanceiro.create({ data: { codigo, ...data } })
}

async function upsertPrecoTabela(itemCatalogoId: number, natureza: NaturezaPreco, moeda: Moeda) {
  const existe = await prisma.tabelaValor.findFirst({
    where: { itemCatalogoId, natureza, processoTipoId: null, regiao: null, fornecedorId: null, arquivado: false },
  })
  if (existe) return existe
  return prisma.tabelaValor.create({
    data: { name: `[AJUSTAR] ${natureza === 'CUSTO' ? 'Custo' : 'Receita'} padrão global`, itemCatalogoId, natureza, moeda, valor: 0, modoCalculo: 'fixed' },
  })
}

async function upsertRegraEconomica(c: ComponenteDef) {
  const existe = await prisma.phaseEconomicRule.findFirst({ where: { phaseKey: c.phaseKey, componentKey: c.componentKey } })
  const data = {
    tipoProcessoId: null, phaseKey: c.phaseKey, documentTypeCode: null, appliesTo: c.appliesTo,
    componentKey: c.componentKey, componentName: c.componentName,
    custoProdutoCode: c.custoCode, receitaProdutoCode: c.receitaCode,
    participaPlanilha: true, ordem: c.ordem, ativo: true,
  }
  if (existe) return prisma.phaseEconomicRule.update({ where: { id: existe.id }, data })
  return prisma.phaseEconomicRule.create({ data })
}

async function main() {
  console.log('🏗️  LOTE B — populando fases (Tradução/Apostila/Retificação), valores [AJUSTAR]\n')
  for (const c of COMPONENTES) {
    const item = await upsertItem(c)
    await upsertProduto(c.custoCode, `${c.itemName} — Custo`, 'cost', c.custoMoeda, item.id)
    await upsertProduto(c.receitaCode, `${c.itemName} — Receita`, 'revenue', c.receitaMoeda, item.id)
    await upsertPrecoTabela(item.id, NaturezaPreco.CUSTO, c.custoMoeda)
    await upsertPrecoTabela(item.id, NaturezaPreco.RECEITA, c.receitaMoeda)
    const regra = await upsertRegraEconomica(c)
    console.log(`• ${c.phaseKey.padEnd(14)} → ${c.componentName.padEnd(24)} (item #${item.id}, regra #${regra.id}) [AJUSTAR]`)
  }
  console.log('\n─── resumo do que existe agora ───')
  const nItens = await prisma.itemCatalogo.count()
  const nRegras = await prisma.phaseEconomicRule.count({ where: { ativo: true } })
  const nPrecos = await prisma.tabelaValor.count({ where: { arquivado: false } })
  console.log(`  Itens no Catálogo Mestre: ${nItens}`)
  console.log(`  Regras econômicas ativas: ${nRegras}`)
  console.log(`  Preços na TabelaValor:    ${nPrecos}  (todos [AJUSTAR] = 0 até o Marco preencher)`)
  console.log('\n✅ Fases populadas. Motor já sabe gerar Tradução/Apostila/Retificação — falta só cadastrar a REGRA NA MATRIZ de cada fase e preencher preços na tela.')
  console.log('⚠ Para o motor GERAR de fato numa fase, precisa existir MatrizDocumental (fase + documento). Emissão já tem (teste). As outras: cadastrar na tela Matriz Documental.')
}
main().catch(console.error).finally(() => prisma.$disconnect())