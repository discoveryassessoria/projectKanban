// prisma/dry-run-config-financeira.ts
// ============================================================================
// DRY-RUN da consolidação para Configuração Financeira (Lote F1/M1) — SOMENTE
// LEITURA. Relata o que o backfill FARIA, sobre o schema ATUAL, SEM depender do
// novo model e SEM escrever nada. Não decide/aplica — apenas planeja.
//
// Reaproveita o adaptador puro (configuracao-financeira-view) — não duplica lógica.
//
// Rodar (após o freeze): npx tsx prisma/dry-run-config-financeira.ts [--json]
// ============================================================================

import { PrismaClient } from '@prisma/client'
import {
  paraConfiguracaoView,
  agruparPorItemMestre,
  type ProdutoFinanceiroLike,
  type ConfiguracaoFinanceiraView,
} from '../src/lib/financeiro/configuracao-financeira-view'

const prisma = new PrismaClient()
const JSON_OUT = process.argv.includes('--json')
const n = (v: unknown): number | null => (v == null ? null : Number(v))

async function main() {
  const [produtos, itens, precos] = await Promise.all([
    prisma.produtoFinanceiro.findMany({
      select: {
        id: true, codigo: true, nome: true, naturezaFinanceira: true, itemCatalogoId: true,
        categoriaId: true, planoContaId: true, moedaPadrao: true, valorPadrao: true,
        cobravelDoCliente: true, custoInterno: true, repasse: true, reembolsavel: true, ativo: true,
      },
    }),
    prisma.itemCatalogo.findMany({ select: { id: true, code: true, name: true } }),
    prisma.tabelaValor.findMany({ select: { itemCatalogoId: true, natureza: true, arquivado: true } }),
  ])

  const nomeItem = new Map(itens.map((i) => [i.id, `${i.code} — ${i.name}`]))
  // preços já existentes por (item, natureza) → evitar propor duplicado
  const precoExistente = new Set(
    precos.filter((p) => !p.arquivado && p.itemCatalogoId != null && p.natureza != null).map((p) => `${p.itemCatalogoId}::${p.natureza}`),
  )

  const views: ConfiguracaoFinanceiraView[] = produtos.map((p) =>
    paraConfiguracaoView({ ...p, valorPadrao: n(p.valorPadrao) } as ProdutoFinanceiroLike),
  )
  const { porItem, orfaos } = agruparPorItemMestre(views)

  // Plano por item mestre: papéis presentes + colapsos (papel repetido)
  const planoItens: {
    itemCatalogoId: number; item: string; configs: { codigo: string; papel: string }[]; papelDuplicado: string[]
  }[] = []
  for (const [itemId, configs] of porItem) {
    const contagemPapel = new Map<string, number>()
    for (const c of configs) contagemPapel.set(c.papel, (contagemPapel.get(c.papel) ?? 0) + 1)
    planoItens.push({
      itemCatalogoId: itemId,
      item: nomeItem.get(itemId) ?? `item#${itemId}`,
      configs: configs.map((c) => ({ codigo: c.codigo, papel: c.papel })),
      papelDuplicado: [...contagemPapel.entries()].filter(([, q]) => q > 1).map(([papel, q]) => `${papel}×${q}`),
    })
  }

  // Plano de preço default: valorPadrao>0 e sem TabelaValor equivalente ainda
  const planoPrecos: { codigo: string; itemCatalogoId: number; natureza: string; valor: number; moeda: string; acao: string }[] = []
  const semPreco: { codigo: string; motivo: string }[] = []
  for (const c of views) {
    if (c.itemCatalogoId == null) { semPreco.push({ codigo: c.codigo, motivo: 'órfão (sem item mestre) — vincular antes' }); continue }
    if (c.valorPadrao == null || c.valorPadrao <= 0) { semPreco.push({ codigo: c.codigo, motivo: 'valorPadrao ausente/<=0 — revisar preço na TabelaValor' }); continue }
    const chave = `${c.itemCatalogoId}::${c.papel}`
    planoPrecos.push({
      codigo: c.codigo, itemCatalogoId: c.itemCatalogoId, natureza: c.papel, valor: c.valorPadrao, moeda: c.moedaPadrao,
      acao: precoExistente.has(chave) ? 'JÁ EXISTE TabelaValor (não recriar)' : 'CRIARIA TabelaValor default',
    })
  }

  const resumo = {
    produtos: produtos.length,
    itensComConfig: porItem.size,
    configsOrfas: orfaos.length,
    itensComPapelDuplicado: planoItens.filter((p) => p.papelDuplicado.length > 0).length,
    precosACriar: planoPrecos.filter((p) => p.acao.startsWith('CRIARIA')).length,
    precosJaExistentes: planoPrecos.filter((p) => p.acao.startsWith('JÁ EXISTE')).length,
    semPrecoDefault: semPreco.length,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ resumo, planoItens, planoPrecos, orfaos: orfaos.map((o) => o.codigo), semPreco }, null, 2))
    return
  }

  console.log('\n=== DRY-RUN — Configuração Financeira (Lote F1/M1) — SOMENTE LEITURA ===\n')
  console.log('Resumo:', JSON.stringify(resumo))
  console.log('\n--- Itens mestre com múltiplos papéis (1 entidade, N papéis — correto) ---')
  for (const p of planoItens) {
    const flag = p.papelDuplicado.length ? `  ⚠️ COLAPSAR: ${p.papelDuplicado.join(', ')}` : ''
    console.log(`  · ${p.item}: ${p.configs.map((c) => `${c.codigo}[${c.papel}]`).join(', ')}${flag}`)
  }
  console.log('\n--- Configs órfãs (precisam de item mestre no M1) ---')
  for (const o of orfaos) console.log(`  ⛔ ${o.codigo} (${o.nome})`)
  console.log('\n--- Plano de preço default (valorPadrao → TabelaValor) ---')
  for (const p of planoPrecos) console.log(`  · ${p.codigo} → item ${p.itemCatalogoId} ${p.natureza} ${p.valor} ${p.moeda} — ${p.acao}`)
  console.log('\n--- Sem preço default (revisar) ---')
  for (const s of semPreco) console.log(`  ⚠️ ${s.codigo}: ${s.motivo}`)
  console.log('\nDRY-RUN: NADA foi escrito. O backfill real só no Lote F1, após liberação do schema.')
}

main()
  .catch((e) => { console.error('ERRO no dry-run (somente leitura):', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
