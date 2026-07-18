// prisma/backfill-precos-legado-tabelavalor.ts
// ============================================================================
// PREÇO-FONTE-ÚNICA (§10) — migra os VALORES legado da Configuração Financeira
// (ProdutoFinanceiro.valorCustoPadrao / valorReceitaPadrao / valorPadrao) para a
// Tabela de Preços (TabelaValor), estabelecendo-a como ÚNICA fonte de verdade.
//
// Garantias:
//   • NÃO destrutivo: nada é apagado; os campos legado são PRESERVADOS.
//   • valorCustoPadrao  → TabelaValor(natureza=CUSTO), migradoDeCampoLegado=true.
//   • valorReceitaPadrao → TabelaValor(natureza=VENDA), migradoDeCampoLegado=true.
//   • valorPadrao (pré-unificação) só é usado quando a natureza é ÚNICA e não há
//     valor específico — nunca duplica nem sobrescreve.
//   • Idempotente: se já existir preço GLOBAL ativo daquela natureza, NÃO duplica
//     (registra no relatório como "já existe").
//   • Deriva e grava naturezaFin quando ausente (SOMENTE_CUSTO/SOMENTE_RECEITA/
//     CUSTO_E_RECEITA).
//
// Uso:
//   npx tsx prisma/backfill-precos-legado-tabelavalor.ts            (dry-run, read-only)
//   npx tsx prisma/backfill-precos-legado-tabelavalor.ts --execute  (grava)
// Conexão: usa INSPECT_DB_URL se setado; senão o datasource padrão.
// ============================================================================
import { PrismaClient, Moeda, NaturezaPreco, NaturezaFinanceira } from '@prisma/client'
import { deriveNaturezaFinanceira, canonicalNaturezaPreco } from '../lib/financeiro/natureza-financeira'

const url = process.env.INSPECT_DB_URL
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient()
const EXECUTE = process.argv.includes('--execute')

type Acao =
  | { tipo: 'criar_preco'; configId: number; natureza: NaturezaPreco; valor: number; moeda: Moeda; origem: string }
  | { tipo: 'ja_existe'; configId: number; natureza: NaturezaPreco; detalhe: string }
  | { tipo: 'set_natureza_fin'; configId: number; valor: NaturezaFinanceira }

async function main() {
  const configs = await prisma.produtoFinanceiro.findMany({
    select: {
      id: true, codigo: true, nome: true, moedaPadrao: true, naturezaFin: true,
      possuiCusto: true, possuiReceita: true, valorCustoPadrao: true, valorReceitaPadrao: true, valorPadrao: true,
      precosConfig: {
        where: { arquivado: false, legadoPendente: false },
        select: { id: true, natureza: true, processoTipoId: true, regiao: true, fornecedorId: true, processoId: true, modalidadeId: true },
      },
    },
    orderBy: { id: 'asc' },
  })

  const acoes: Acao[] = []

  for (const c of configs) {
    const valCusto = c.valorCustoPadrao != null ? Number(c.valorCustoPadrao) : null
    const valReceita = c.valorReceitaPadrao != null ? Number(c.valorReceitaPadrao) : null
    const valUnico = c.valorPadrao != null ? Number(c.valorPadrao) : null

    // naturezaFin — deriva quando ausente.
    const natFin = deriveNaturezaFinanceira({
      naturezaFin: c.naturezaFin, possuiCusto: c.possuiCusto, possuiReceita: c.possuiReceita,
      valorCustoPadrao: valCusto, valorReceitaPadrao: valReceita,
    })
    if (natFin && c.naturezaFin == null) acoes.push({ tipo: 'set_natureza_fin', configId: c.id, valor: natFin })

    // "preço GLOBAL" = sem dimensão de contexto (nível global do resolver).
    const temGlobal = (nat: NaturezaPreco) =>
      c.precosConfig.some((p) =>
        canonicalNaturezaPreco(p.natureza as NaturezaPreco | null) === canonicalNaturezaPreco(nat) &&
        p.processoTipoId == null && p.regiao == null && p.fornecedorId == null && p.processoId == null && p.modalidadeId == null,
      )

    const planejarPreco = (nat: NaturezaPreco, valor: number | null, origem: string) => {
      if (valor == null || !(valor > 0)) return
      if (temGlobal(nat)) { acoes.push({ tipo: 'ja_existe', configId: c.id, natureza: nat, detalhe: `${origem}=${valor} — já há preço global ${canonicalNaturezaPreco(nat)}` }); return }
      acoes.push({ tipo: 'criar_preco', configId: c.id, natureza: nat, valor, moeda: c.moedaPadrao, origem })
    }

    // Valores específicos têm prioridade sobre o valorPadrao único.
    planejarPreco(NaturezaPreco.CUSTO, valCusto, 'valorCustoPadrao')
    planejarPreco(NaturezaPreco.VENDA, valReceita, 'valorReceitaPadrao')

    // valorPadrao (pré-unificação): só se a natureza for ÚNICA e sem valor específico.
    if (valUnico != null && valUnico > 0) {
      if (natFin === 'SOMENTE_CUSTO' && valCusto == null) planejarPreco(NaturezaPreco.CUSTO, valUnico, 'valorPadrao')
      else if (natFin === 'SOMENTE_RECEITA' && valReceita == null) planejarPreco(NaturezaPreco.VENDA, valUnico, 'valorPadrao')
      // CUSTO_E_RECEITA com valorPadrao ambíguo → NÃO adivinha (fica no relatório abaixo).
      else if (natFin === 'CUSTO_E_RECEITA' && valCusto == null && valReceita == null) {
        acoes.push({ tipo: 'ja_existe', configId: c.id, natureza: NaturezaPreco.CUSTO, detalhe: `valorPadrao=${valUnico} AMBÍGUO em CUSTO_E_RECEITA — revisar manualmente (não migrado)` })
      }
    }
  }

  // Relatório
  const criar = acoes.filter((a) => a.tipo === 'criar_preco') as Extract<Acao, { tipo: 'criar_preco' }>[]
  const jaExiste = acoes.filter((a) => a.tipo === 'ja_existe')
  const setNat = acoes.filter((a) => a.tipo === 'set_natureza_fin') as Extract<Acao, { tipo: 'set_natureza_fin' }>[]

  console.log(`\n=== BACKFILL PREÇOS LEGADO → TABELA DE PREÇOS ${EXECUTE ? '(EXECUTE)' : '(DRY-RUN)'} ===`)
  console.log(`Configs analisadas: ${configs.length}`)
  console.log(`naturezaFin a definir: ${setNat.length}`)
  console.log(`Preços a criar:        ${criar.length}`)
  console.log(`Já existentes/pulados: ${jaExiste.length}`)
  for (const a of criar) console.log(`  + criar  cfg#${a.configId} ${canonicalNaturezaPreco(a.natureza)} ${a.valor} ${a.moeda} (de ${a.origem})`)
  for (const a of jaExiste) console.log(`  = pular  cfg#${a.configId} ${(a as any).detalhe}`)
  for (const a of setNat) console.log(`  ~ natFin cfg#${a.configId} = ${a.valor}`)

  if (!EXECUTE) { console.log('\nDRY-RUN — nada gravado. Rode com --execute para aplicar.\n'); return }

  let criados = 0, natsSet = 0
  for (const a of setNat) {
    await prisma.produtoFinanceiro.update({ where: { id: a.configId }, data: { naturezaFin: a.valor } })
    natsSet++
  }
  for (const a of criar) {
    const cfg = configs.find((c) => c.id === a.configId)!
    await prisma.tabelaValor.create({
      data: {
        name: `${cfg.nome} · ${canonicalNaturezaPreco(a.natureza)} (migrado)`.slice(0, 200),
        configuracaoFinanceiraItemId: a.configId,
        natureza: a.natureza,
        moeda: a.moeda,
        valor: a.valor,
        modoCalculo: 'fixed',
        prioridade: 0,
        arquivado: false,
        legadoPendente: false,
        migradoDeCampoLegado: true,
      },
    })
    criados++
  }
  console.log(`\nAPLICADO: ${natsSet} naturezaFin definidas, ${criados} preços criados (migradoDeCampoLegado=true).\n`)
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
