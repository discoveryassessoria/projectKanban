/**
 * TESTES — Financeiro Geral (projeção canônica + status). Puros, sem banco.
 * Rodar: npx tsx scripts/financeiro-geral.test.ts
 *
 * Cobre: receita de processo aparece 1x em Receber; custo de processo 1x em Pagar;
 * corporativo aparece; origem correta; projeção de processo não editável; chave de
 * projeção única (idempotência por construção); status padronizado + pode/deve.
 */
import { mapReceberPuro, mapPagarPuro, type ReceitaProjRow, type CustoProjRow, type ContaPagarProjRow } from '../lib/financeiro/financeiro-geral-projecao'
import { statusUi, rotuloStatus, podeCancelar, deveEstornar, contaNosTotaisAtivos } from '../lib/financeiro/status-financeiro'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }

const rec = (o: Partial<ReceitaProjRow> & { id: number }): ReceitaProjRow => ({ descricao: 'R', valor: 100, moeda: 'BRL', status: 'ATIVA', processoId: 1, estornoDeId: null, dataCompetencia: null, clienteNome: 'Proc X', ...o })
const cus = (o: Partial<CustoProjRow> & { id: number }): CustoProjRow => ({ descricao: 'C', valor: 50, moeda: 'BRL', status: 'ATIVA', processoId: 1, fornecedor: 'Forn', estornoDeId: null, dataCompetencia: null, ...o })
const cp = (o: Partial<ContaPagarProjRow> & { id: number }): ContaPagarProjRow => ({ descricao: 'Aluguel', valor: 3000, status: 'PENDENTE', processoId: null, dataCompetencia: null, fornecedorNome: 'Imobiliária', ...o })

console.log('\n§1 — Contas a Receber: receita de processo aparece UMA vez')
{
  const itens = mapReceberPuro([rec({ id: 10 }), rec({ id: 11 })])
  ok(itens.length === 2, 'duas receitas → duas linhas (uma por lançamento)')
  ok(itens.filter((i) => i.lancamentoOrigemId === 10).length === 1, 'receita 10 aparece exatamente 1x')
  ok(itens.every((i) => i.origem === 'PROCESSO' && i.natureza === 'RECEITA' && i.editavelEstrutural === false), 'origem PROCESSO, natureza RECEITA, não editável')
  ok(new Set(itens.map((i) => i.chaveProjecao)).size === itens.length, 'chaveProjecao única (idempotência por construção)')
}

console.log('\n§2 — Contas a Pagar: custo de processo + corporativa, cada UMA vez, sem duplicar')
{
  const itens = mapPagarPuro([cus({ id: 20 })], [cp({ id: 5 })])
  ok(itens.length === 2, 'um custo + uma corporativa → duas linhas')
  const proc = itens.find((i) => i.origem === 'PROCESSO')!
  const corp = itens.find((i) => i.origem === 'CORPORATIVA')!
  ok(proc.lancamentoOrigemTipo === 'custo' && proc.lancamentoOrigemId === 20 && proc.editavelEstrutural === false, 'custo de processo: origem/link corretos, não editável')
  ok(corp.lancamentoOrigemTipo === 'contaPagar' && corp.editavelEstrutural === true, 'corporativa aparece e é editável')
  ok(itens.filter((i) => i.lancamentoOrigemTipo === 'custo' && i.lancamentoOrigemId === 20).length === 1, 'custo 20 NÃO duplicado')
  ok(new Set(itens.map((i) => i.chaveProjecao)).size === 2, 'chaves de projeção distintas')
}

console.log('\n§11 — estorno aparece como movimento inverso vinculado')
{
  const itens = mapReceberPuro([rec({ id: 10 }), rec({ id: 99, valor: -100, estornoDeId: 10, descricao: 'Estorno de R-10' })])
  const inv = itens.find((i) => i.lancamentoOrigemId === 99)!
  ok(inv.estorno === true && inv.valor === -100, 'movimento inverso: estorno=true, valor negativo')
  ok(itens.reduce((s, i) => s + i.valor, 0) === 0, 'original + inverso somam zero (dupla entrada)')
}

console.log('\n§7 — status padronizado')
ok(statusUi({ statusBruto: 'RECEBIDA' }) === 'RECEBIDO', 'RECEBIDA → RECEBIDO')
ok(statusUi({ statusBruto: 'PAGA' }) === 'PAGO', 'PAGA → PAGO')
ok(statusUi({ canceladoEm: new Date() }) === 'CANCELADO', 'canceladoEm → CANCELADO')
ok(statusUi({ estornadoEm: new Date() }) === 'ESTORNADO', 'estornadoEm → ESTORNADO')
ok(statusUi({ vencida: true, statusBruto: 'PENDENTE' }) === 'VENCIDO', 'vencida → VENCIDO')
ok(rotuloStatus(statusUi({ statusBruto: 'PENDENTE' })) === 'Pendente', 'rótulo pt-BR')
ok(!contaNosTotaisAtivos('CANCELADO'), 'cancelado não conta nos totais ativos')

console.log('\n§5/§6 — pode cancelar / deve estornar')
ok(podeCancelar({ statusBruto: 'PENDENTE', liquidada: false }), 'aberto → pode cancelar')
ok(!podeCancelar({ statusBruto: 'RECEBIDA', liquidada: true }), 'liquidado → NÃO pode cancelar')
ok(deveEstornar({ statusBruto: 'RECEBIDA', liquidada: true }), 'liquidado → deve estornar')
ok(!deveEstornar({ statusBruto: 'PENDENTE', liquidada: false }), 'aberto → não precisa estornar')
ok(!podeCancelar({ canceladoEm: new Date() }) && !deveEstornar({ estornadoEm: new Date() }), 'cancelado/estornado não reprocessam')

console.log(`\n=== ${passed} passaram, ${failed} falharam ===`)
if (failed) { console.log('FALHAS:', falhas.join('; ')); process.exit(1) }
