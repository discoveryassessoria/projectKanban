// scripts/receitas-processo-view.test.ts
// ============================================================================
// GUARDA — view model da tela de Receitas por REQUERENTE (Fase→Requerente→
// Receita→Cobrança→Parcela). Puro: sem banco. Cobre agrupamento, totais,
// status, filtros e busca.
// ============================================================================
import { montarReceitasView, filtrarView, acoesReceita, type ReceitaRow, type Catalogos } from '../lib/financeiro/receitas-processo-view'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

const HOJE = new Date('2026-07-22T12:00:00Z').getTime()
const ONTEM = '2026-07-21T12:00:00Z'
const AMANHA = '2026-08-22T12:00:00Z'
const CAT: Catalogos = { fases: { genealogia: 'Genealogia', traducao: 'Tradução Juramentada' }, formas: { 1: 'PIX' }, condicoes: { 1: 'À vista' }, carteiras: { 1: 'Banco Inter' } }

const joao = { id: 1, nome: 'João', sobrenome: 'Kruger', createdAt: '2026-01-01T00:00:00Z' }
const maria = { id: 2, nome: 'Maria', sobrenome: 'Kruger', createdAt: '2026-02-01T00:00:00Z' }

function receita(over: Partial<ReceitaRow> = {}): ReceitaRow {
  return { id: 10, codigo: 'REC-10', descricao: 'Honorários', phaseKey: 'genealogia', valor: 2800, moeda: 'EUR', pessoa: joao, tipoServico: { nome: 'Honorários' }, cobrancas: [], ...over }
}
const cobranca = (over: any = {}) => ({ id: 27, status: 'ABERTA', valorTotal: 2800, formaPagamentoId: 1, condicaoPagamentoId: 1, carteiraId: 1, parcelas: [{ id: 1, numero: 1, vencimento: AMANHA, valor: 2800, status: 'PENDENTE' }], eventos: [], ...over })

sec('1 — agrupamento Fase → Requerente')
{
  const v = montarReceitasView([
    receita({ id: 10, valor: 2800, pessoa: joao }),
    receita({ id: 11, valor: 1800, pessoa: maria, descricao: 'Honorários adicional' }),
  ], CAT, HOJE)
  ok('uma fase Genealogia', v.fases.length === 1 && v.fases[0].faseLabel === 'Genealogia')
  ok('dois requerentes', v.fases[0].qtdRequerentes === 2)
  ok('João é principal, Maria adicional', v.fases[0].requerentes[0].nome === 'João Kruger' && v.fases[0].requerentes[0].papel === 'principal' && v.fases[0].requerentes[1].papel === 'adicional')
  ok('total da fase = 4600', v.fases[0].totalReceitas === 4600)
  ok('resumo total contratado 4600 / saldo 4600', v.resumo.totalContratado === 4600 && v.resumo.saldoAReceber === 4600)
}

sec('2 — requerente com 1 e com várias receitas')
{
  const v = montarReceitasView([
    receita({ id: 10, valor: 1000, pessoa: joao }),
    receita({ id: 11, valor: 500, pessoa: joao, descricao: 'Extra' }),
    receita({ id: 12, valor: 300, pessoa: maria }),
  ], CAT, HOJE)
  const req = v.fases[0].requerentes
  ok('João com 2 receitas soma 1500', req[0].qtdReceitas === 2 && req[0].totalReceitas === 1500)
  ok('Maria com 1 receita soma 300', req[1].qtdReceitas === 1 && req[1].totalReceitas === 300)
}

sec('3 — status por receita')
{
  const semCob = montarReceitasView([receita({ cobrancas: [] })], CAT, HOJE)
  ok('sem cobrança → SEM_COBRANCA', semCob.fases[0].requerentes[0].receitas[0].status === 'SEM_COBRANCA' && !semCob.fases[0].requerentes[0].receitas[0].temCobranca)

  const aVencer = montarReceitasView([receita({ cobrancas: [cobranca()] })], CAT, HOJE)
  ok('cobrança futura → A_VENCER', aVencer.fases[0].requerentes[0].receitas[0].status === 'A_VENCER')

  const vencido = montarReceitasView([receita({ cobrancas: [cobranca({ parcelas: [{ id: 1, numero: 1, vencimento: ONTEM, valor: 2800, status: 'PENDENTE' }] })] })], CAT, HOJE)
  ok('parcela vencida pendente → VENCIDO', vencido.fases[0].requerentes[0].receitas[0].status === 'VENCIDO')

  const recebido = montarReceitasView([receita({ cobrancas: [cobranca({ parcelas: [{ id: 1, numero: 1, vencimento: ONTEM, valor: 2800, status: 'RECEBIDA' }] })] })], CAT, HOJE)
  ok('todas pagas → RECEBIDO, recebido 2800', recebido.fases[0].requerentes[0].receitas[0].status === 'RECEBIDO' && recebido.fases[0].requerentes[0].recebido === 2800)
}

sec('4 — cobrança: parcelas, pago, saldo, próximo vencimento')
{
  const parcelada = cobranca({ valorTotal: 900, parcelas: [
    { id: 1, numero: 1, vencimento: ONTEM, valor: 300, status: 'RECEBIDA' },
    { id: 2, numero: 2, vencimento: AMANHA, valor: 300, status: 'PENDENTE' },
    { id: 3, numero: 3, vencimento: '2026-09-22T12:00:00Z', valor: 300, status: 'PENDENTE' },
  ] })
  const v = montarReceitasView([receita({ valor: 900, cobrancas: [parcelada] })], CAT, HOJE)
  const c = v.fases[0].requerentes[0].receitas[0].cobrancas[0]
  ok('cobrança rotulada #CBR-27', c.label === '#CBR-27')
  ok('forma/condição/carteira resolvidas', c.forma === 'PIX' && c.condicao === 'À vista' && c.carteira === 'Banco Inter')
  ok('1 de 3 pagas, pago 300 saldo 600', c.parcelasPagas === 1 && c.nParcelas === 3 && c.pago === 300 && c.saldo === 600)
  ok('pagamento parcial → PARCIAL', v.fases[0].requerentes[0].receitas[0].status === 'PARCIAL')
  ok('próxima parcela = 2', c.proximaParcela === 2)
}

sec('5 — cancelada não entra no saldo/status crítico')
{
  const v = montarReceitasView([
    receita({ id: 10, valor: 1000, pessoa: joao, cancelada: true }),
    receita({ id: 11, valor: 500, pessoa: joao, cobrancas: [cobranca({ valorTotal: 500, parcelas: [{ id: 1, numero: 1, vencimento: AMANHA, valor: 500, status: 'PENDENTE' }] })] }),
  ], CAT, HOJE)
  ok('receita cancelada marcada CANCELADO', v.fases[0].requerentes[0].receitas.find((r) => r.id === 10)!.status === 'CANCELADO')
  ok('status do requerente ignora cancelada (A_VENCER)', v.fases[0].requerentes[0].status === 'A_VENCER')
}

sec('6 — resumo agregado e contadores')
{
  const v = montarReceitasView([
    receita({ id: 10, valor: 2800, pessoa: joao, cobrancas: [cobranca({ valorTotal: 2800, parcelas: [{ id: 1, numero: 1, vencimento: AMANHA, valor: 2800, status: 'PENDENTE' }] })] }),
    receita({ id: 11, valor: 1800, pessoa: maria, cobrancas: [] }),
  ], CAT, HOJE)
  ok('resumo: 2 receitas, 1 cobrança, 1 parcela, 0 pagamentos', v.resumo.qtdReceitas === 2 && v.resumo.qtdCobrancas === 1 && v.resumo.qtdParcelas === 1 && v.resumo.qtdPagamentos === 0)
  ok('resumo: 1 sem cobrança, 1 parcela pendente', v.resumo.receitasSemCobranca === 1 && v.resumo.parcelasPendentes === 1)
  ok('status geral A_VENCER', v.resumo.statusGeral === 'A_VENCER')
}

sec('7 — filtros e busca')
{
  const v = montarReceitasView([
    receita({ id: 10, phaseKey: 'genealogia', pessoa: joao, descricao: 'Honorários João' }),
    receita({ id: 11, phaseKey: 'traducao', pessoa: maria, descricao: 'Tradução Maria', cobrancas: [cobranca({ parcelas: [{ id: 9, numero: 1, vencimento: ONTEM, valor: 2800, status: 'PENDENTE' }] })] }),
  ], CAT, HOJE)
  ok('filtro por fase genealogia', filtrarView(v, { fase: 'genealogia' }).length === 1 && filtrarView(v, { fase: 'genealogia' })[0].faseKey === 'genealogia')
  ok('filtro por status VENCIDO', (() => { const f = filtrarView(v, { status: 'VENCIDO' }); return f.length === 1 && f[0].requerentes[0].receitas[0].id === 11 })())
  ok('busca por requerente "maria"', (() => { const f = filtrarView(v, { busca: 'maria' }); return f.length === 1 && f[0].requerentes[0].nome === 'Maria Kruger' })())
  ok('busca sem match → vazio', filtrarView(v, { busca: 'zzz' }).length === 0)
}

sec('8 — ações contextuais do dossiê (nenhuma ação indevida)')
{
  const sem = acoesReceita({ status: 'SEM_COBRANCA', temCobrancaAtiva: false })
  ok('sem cobrança: gerar ✓, registrar ✗, recibo ✗', sem.gerarCobranca && !sem.registrarPagamento && !sem.emitirRecibo && !sem.enviarCobranca)
  const aberta = acoesReceita({ status: 'A_VENCER', temCobrancaAtiva: true })
  ok('com cobrança: registrar ✓, enviar ✓, gerar ✗', aberta.registrarPagamento && aberta.enviarCobranca && !aberta.gerarCobranca && aberta.cancelarCobranca)
  const quit = acoesReceita({ status: 'RECEBIDO', temCobrancaAtiva: false })
  ok('quitada: recibo ✓, registrar ✗, gerar ✗', quit.emitirRecibo && !quit.registrarPagamento && !quit.gerarCobranca)
  const canc = acoesReceita({ status: 'CANCELADO', temCobrancaAtiva: false })
  ok('cancelada: só reabrir; nada de gerar/registrar/cancelar', canc.reabrir && !canc.gerarCobranca && !canc.registrarPagamento && !canc.cancelarReceita && !canc.editarReceita)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Receitas do Processo (view model): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
