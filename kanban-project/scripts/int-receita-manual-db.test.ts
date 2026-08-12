/**
 * int-receita-manual-db — criação MANUAL de Receita CANÔNICA (Cadastro Mestre), persistência real.
 * Prova: item ativo/elegível; Receita (não obrigação "nativo"); freeze; consolidação por
 * participante; câmbio EUR; espelho; idempotência (duplo clique); snapshot preservado;
 * item inativo/SOMENTE_CUSTO rejeitado; override sem permissão rejeitado.
 */
import { prisma } from '@/lib/prisma'
import { criarReceitaManualCanonica } from '@/lib/financeiro/receitas/criar-receita-manual'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let passed = 0, failed = 0
const bugs: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; bugs.push(nome); console.log(`  ❌ ${nome}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02

async function limparCatalogo(code: string) {
  const item = await prisma.itemCatalogo.findUnique({ where: { code }, select: { id: true } })
  if (item) {
    const cfg = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: item.id }, select: { id: true } })
    if (cfg) await prisma.tabelaValor.deleteMany({ where: { OR: [{ itemCatalogoId: item.id }, { itemCatalogoId: cfg.id }] } }).catch(() => {})
    await prisma.produtoFinanceiro.deleteMany({ where: { itemCatalogoId: item.id } }).catch(() => {})
    await prisma.itemCatalogo.delete({ where: { id: item.id } }).catch(() => {})
  }
}
async function limparReceitasProc(pid: number) {
  const recs = await prisma.receita.findMany({ where: { processoId: pid }, select: { id: true } })
  const ids = recs.map((r) => r.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: ids } }, select: { id: true } })
  const oid = obrs.map((o) => o.id)
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: oid } } }).catch(() => {})
  await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: oid } } }).catch(() => {})
  await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: ids } } }).catch(() => {})
  await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: ids } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
}

async function main() {
  console.log('int-receita-manual-db — criação manual CANÔNICA\n')
  await limparCatalogo('HOM-ALEMA-TST'); await limparCatalogo('CUSTO-TST'); await limparCatalogo('INATIVO-TST')
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-MANUAL' } }).catch(() => {})
  await prisma.requerente.deleteMany({ where: { cpf: 'MAN' } }).catch(() => {})
  const proc = await prisma.processo.create({ data: { nome: 'TESTE-MANUAL', pais: 'Alemanha' } })
  await limparReceitasProc(proc.id)
  const reqA = await prisma.requerente.create({ data: { nome: 'Marco Kruger', cpf: 'MAN' } })
  const reqB = await prisma.requerente.create({ data: { nome: 'Matheus Kruger', cpf: 'MAN' } })

  // Cadastro Mestre: item HONORARIO ativo, EUR, preço 4600 (valorPadrao)
  const item = await prisma.itemCatalogo.create({ data: { code: 'HOM-ALEMA-TST', name: 'Honorários Assessoria Alemã', natureza: 'HONORARIO' as never, ativo: true } })
  await prisma.produtoFinanceiro.create({ data: { codigo: 'CFG-HOM-TST', nome: 'Config Honorários Alemã', itemCatalogoId: item.id, moedaPadrao: 'EUR' as never, naturezaFin: 'SOMENTE_RECEITA', valorPadrao: 4600 } })
  // item SOMENTE_CUSTO
  const itemCusto = await prisma.itemCatalogo.create({ data: { code: 'CUSTO-TST', name: 'Item Custo', natureza: 'SERVICO' as never, ativo: true } })
  await prisma.produtoFinanceiro.create({ data: { codigo: 'CFG-CUSTO', nome: 'Config Custo', itemCatalogoId: itemCusto.id, moedaPadrao: 'BRL' as never, naturezaFin: 'SOMENTE_CUSTO', valorPadrao: 100 } })
  // item INATIVO
  const itemInativo = await prisma.itemCatalogo.create({ data: { code: 'INATIVO-TST', name: 'Item Inativo', natureza: 'SERVICO' as never, ativo: false } })

  // ── 1) criação por PARTICIPANTES (Marco 1800 + Matheus 2800 = 4600 EUR) ──
  const r1 = await criarReceitaManualCanonica({ processoId: proc.id, itemCatalogoId: item.id, vinculo: 'PARTICIPANTES', quantidade: 1,
    participantes: [{ requerenteId: reqA.id, nome: 'Marco Kruger', valor: 1800 }, { requerenteId: reqB.id, nome: 'Matheus Kruger', valor: 2800 }],
    idempotencyKey: 'manual-teste-1', criadoPorId: null })
  ok(r1.ok && r1.receitaIds.length === 2, `cria 2 Receitas (uma por participante) — não 1 obrigação "nativo" (ok=${r1.ok})`)
  ok(r1.moeda === 'EUR' && near(r1.totalContratado, 4600), `moeda EUR e total 4600 do Cadastro Mestre (${r1.moeda} ${r1.totalContratado})`)

  const recs = await prisma.receita.findMany({ where: { id: { in: r1.receitaIds } }, select: { origem: true, configFinanceiraId: true, valorTotalCongelado: true, moeda: true, fxData: true, contextoAplicado: true, phaseKey: true } })
  ok(recs.every((r) => r.origem === 'manual'), 'Receitas com origem=manual (contrato canônico, não legado)')
  ok(recs.every((r) => r.configFinanceiraId != null), 'Receitas congelam configFinanceiraId (vínculo ao Cadastro Mestre)')
  ok(recs.every((r) => r.contextoAplicado && (r.contextoAplicado as any).itemCatalogoId === item.id), 'contextoAplicado guarda o itemCatalogoId canônico (snapshot)')
  ok(recs.every((r) => String(r.moeda) === 'EUR' && r.fxData != null), 'moeda contratual EUR + data de fixação de câmbio persistidas')

  // consolidação: as 2 Receitas viram 1 linha na leitura
  const lista = await listarReceitas(proc.id)
  const grupoDoItem = lista.receitas.filter((g: any) => g.participantes?.some((p: any) => r1.obrigacaoIds.includes(p.obrigacaoId)))
  ok(grupoDoItem.length === 1 && grupoDoItem[0].participantesCount === 2, `consolida em 1 Receita com 2 participantes na leitura (grupos=${grupoDoItem.length})`)

  // ── 2) idempotência (duplo clique com a MESMA chave) ──
  const r2 = await criarReceitaManualCanonica({ processoId: proc.id, itemCatalogoId: item.id, vinculo: 'PARTICIPANTES', quantidade: 1,
    participantes: [{ requerenteId: reqA.id, nome: 'Marco Kruger', valor: 1800 }, { requerenteId: reqB.id, nome: 'Matheus Kruger', valor: 2800 }],
    idempotencyKey: 'manual-teste-1', criadoPorId: null })
  const totalRecs = await prisma.receita.count({ where: { processoId: proc.id, origem: 'manual' } })
  ok(r2.ok && r2.idempotente && totalRecs === 2, `duplo clique (mesma chave) NÃO duplica — segue 2 Receitas (total=${totalRecs})`)

  // ── 3) snapshot preservado após alteração posterior do Cadastro Mestre ──
  await prisma.produtoFinanceiro.update({ where: { itemCatalogoId: item.id }, data: { valorPadrao: 9999 } })
  const congeladoDepois = await prisma.receita.findUnique({ where: { id: r1.receitaIds[0] }, select: { valorTotalCongelado: true } })
  ok(near(Number(congeladoDepois?.valorTotalCongelado), 1800), 'snapshot: alterar preço do Cadastro Mestre NÃO reescreve Receita já criada')

  // ── 4) item SOMENTE_CUSTO e item INATIVO são REJEITADOS ──
  const rc = await criarReceitaManualCanonica({ processoId: proc.id, itemCatalogoId: itemCusto.id, vinculo: 'PROCESSO', quantidade: 1, criadoPorId: null })
  ok(!rc.ok, `item SOMENTE_CUSTO rejeitado (ok=${rc.ok})`)
  const ri = await criarReceitaManualCanonica({ processoId: proc.id, itemCatalogoId: itemInativo.id, vinculo: 'PROCESSO', quantidade: 1, criadoPorId: null })
  ok(!ri.ok, `item INATIVO rejeitado (ok=${ri.ok})`)

  // ── 5) override de valor SEM permissão é REJEITADO ──
  const ro = await criarReceitaManualCanonica({ processoId: proc.id, itemCatalogoId: item.id, vinculo: 'PROCESSO', quantidade: 1, valorUnitarioOverride: 1, podeOverridePreco: false, idempotencyKey: 'ovr', criadoPorId: null })
  ok(!ro.ok, `override de valor sem permissão rejeitado (ok=${ro.ok})`)

  console.log(`\n${passed} passaram, ${failed} falharam`)
  await limparReceitasProc(proc.id)
  await limparCatalogo('HOM-ALEMA-TST'); await limparCatalogo('CUSTO-TST'); await limparCatalogo('INATIVO-TST')
  await prisma.requerente.deleteMany({ where: { cpf: 'MAN' } }).catch(() => {})
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-MANUAL' } }).catch(() => {})
  await prisma.$disconnect()
  if (failed) { console.log('FALHAS:', bugs.join(' | ')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
