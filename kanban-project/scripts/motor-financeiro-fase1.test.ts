// scripts/motor-financeiro-fase1.test.ts
// GUARDA — Motor Financeiro V3 · Fase 1 (núcleo PURO): Ledger double-entry
// balanceado, projeção/replay reconstrói saldo, agregado (natureza/estados/
// distribuição). Sem banco. Ver docs/motor-financeiro-discovery-spec.md
import { somas, balanceado, montarLancamento, lancObrigacaoCriada, lancAbertura, lancPagamento, lancDesconto, lancEncargo, lancEstorno, lancBaixa, type Perna } from '../lib/financeiro/ledger/lancamentos'
import { projetar, statusPorSaldo, type EntryProjecao } from '../lib/financeiro/ledger/projecao'
import { direcaoDe, aReceber, transicionar, podeTransicionar, resolverDistribuicao } from '../lib/financeiro/dominio/obrigacao-economica'
import { CONTA } from '../lib/financeiro/ledger/plano-contas'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
// entries de um lançamento → EntryProjecao (para o replay)
const asEntries = (...lancs: { pernas: Perna[] }[]): EntryProjecao[] => {
  let seq = 0
  return lancs.flatMap((l) => l.pernas.map((p) => ({ conta: p.conta, direcao: p.direcao, valor: p.valor, sequencia: ++seq })))
}

sec('1 — Double-entry: todo lançamento balanceado (Σd=Σc)')
{
  const criada = lancObrigacaoCriada(2800, true)
  ok('OBRIGACAO_CRIADA: D 1.1 2800 / C 4.1 2800', criada.pernas.length === 2 && somas(criada.pernas).debitos === 2800 && somas(criada.pernas).creditos === 2800)
  ok('pernas nas contas certas', criada.pernas[0].conta === CONTA.CLIENTES_A_RECEBER && criada.pernas[1].conta === CONTA.RECEITA_A_REALIZAR)
  const pag = lancPagamento({ valorQuitado: 1000, tarifa: 20 })
  ok('PAGAMENTO com tarifa balanceado (caixa 980 + taxa 20 / a receber 1000)', balanceado(pag.pernas) && somas(pag.pernas).debitos === 1000)
  const pagDif = lancPagamento({ valorQuitado: 1000, diferencaCambial: 15 })
  ok('PAGAMENTO com diferença cambial balanceado', balanceado(pagDif.pernas))
  ok('DESCONTO balanceado', balanceado(lancDesconto(100).pernas))
  ok('JUROS/encargo balanceado', balanceado(lancEncargo(50).pernas))
  ok('ABERTURA balanceada', balanceado(lancAbertura(500, true).pernas))
  ok('BAIXA balanceada', balanceado(lancBaixa(200).pernas))
  const est = lancEstorno(lancPagamento({ valorQuitado: 1000, tarifa: 20 }).pernas)
  ok('ESTORNO inverte e balanceia', balanceado(est.pernas) && est.pernas[0].direcao === 'CREDITO')
  let jogou = false
  try { montarLancamento('X', [{ conta: '1.0', direcao: 'DEBITO', valor: 100 }, { conta: '1.1', direcao: 'CREDITO', valor: 90 }]) } catch { jogou = true }
  ok('lançamento desbalanceado é REJEITADO', jogou)
}

sec('2 — Projeção/replay: saldo derivado do Ledger')
{
  const criada = lancObrigacaoCriada(2800, true)
  ok('só criada → saldo 2800', projetar(asEntries(criada)).saldo === 2800)
  const p1 = lancPagamento({ valorQuitado: 1000, tarifa: 20 })
  const proj = projetar(asEntries(criada, p1))
  ok('após pagar 1000 → saldo 1800', proj.saldo === 1800)
  ok('recebido líquido 980 · bruto 1000', proj.recebidoLiquido === 980 && proj.recebidoBruto === 1000)
  const p2 = lancPagamento({ valorQuitado: 1800 })
  const quit = projetar(asEntries(criada, p1, p2))
  ok('quitação total → saldo 0', quit.saldo === 0)
  ok('replay determinístico (idempotente)', projetar(asEntries(criada, p1)).saldo === projetar(asEntries(criada, p1)).saldo)
  ok('status: 1800 com pagamento → PARCIAL', statusPorSaldo(1800, true) === 'PARCIAL')
  ok('status: 0 → QUITADA', statusPorSaldo(0, true) === 'QUITADA')
  ok('status: cheio sem pagamento → ABERTA', statusPorSaldo(2800, false) === 'ABERTA')
}

sec('3 — Agregado: natureza → direção, estados')
{
  ok('RECEITA → A_RECEBER', direcaoDe('RECEITA') === 'A_RECEBER' && aReceber('RECEITA'))
  ok('CUSTO → A_PAGAR', direcaoDe('CUSTO') === 'A_PAGAR' && !aReceber('CUSTO'))
  ok('REEMBOLSO → A_PAGAR', direcaoDe('REEMBOLSO') === 'A_PAGAR')
  ok('JUROS/MULTA → A_RECEBER', aReceber('JUROS') && aReceber('MULTA'))
  ok('RASCUNHO → ATIVO ok', podeTransicionar('RASCUNHO', 'ATIVO') && transicionar('RASCUNHO', 'ATIVO').ok)
  ok('ATIVO → LIQUIDADO ok', transicionar('ATIVO', 'LIQUIDADO').ok)
  ok('LIQUIDADO → ATIVO inválido', !transicionar('LIQUIDADO', 'ATIVO').ok)
  ok('CANCELADO é terminal', !podeTransicionar('CANCELADO', 'ATIVO'))
}

sec('4 — Distribuição econômica (independe do pagador; menores manual)')
{
  const reqs = [{ pessoaId: 1 }, { pessoaId: 2 }, { pessoaId: 3 }, { pessoaId: 4 }]
  const ig = resolverDistribuicao(2800, 'IGUAL', reqs)
  ok('IGUAL 4× → 700 cada, soma 2800', ig.ok && ig.cotas.length === 4 && ig.cotas.every((c) => c.valor === 700) && ig.cotas.reduce((s, c) => s + c.valor, 0) === 2800)
  const centavos = resolverDistribuicao(1000, 'IGUAL', [{ pessoaId: 1 }, { pessoaId: 2 }, { pessoaId: 3 }])
  ok('centavos na última cota (333.33/333.33/333.34)', centavos.cotas[2].valor === 333.34 && centavos.cotas.reduce((s, c) => s + c.valor, 0) === 1000)
  const pct = resolverDistribuicao(1000, 'PERCENTUAL', [{ pessoaId: 1, percentual: 30 }, { pessoaId: 2, percentual: 70 }])
  ok('PERCENTUAL 30/70 → 300/700', pct.ok && pct.cotas[0].valor === 300 && pct.cotas[1].valor === 700)
  const pctErr = resolverDistribuicao(1000, 'PERCENTUAL', [{ pessoaId: 1, percentual: 30 }, { pessoaId: 2, percentual: 60 }])
  ok('PERCENTUAL ≠ 100% → erro', !pctErr.ok)
  const val = resolverDistribuicao(1000, 'VALOR', [{ pessoaId: 1, valor: 250 }, { pessoaId: 2, valor: 750 }])
  ok('VALOR 250/750 ok', val.ok && val.cotas.reduce((s, c) => s + c.valor, 0) === 1000)
  const excl = resolverDistribuicao(900, 'IGUAL', [{ pessoaId: 1 }, { pessoaId: 2 }, { pessoaId: 3, incluido: false }])
  ok('exclusão MANUAL: 2 incluídos → 450 cada', excl.cotas.length === 2 && excl.cotas.every((c) => c.valor === 450))
  ok('SEM_DIVISAO → sem cotas', resolverDistribuicao(1000, 'SEM_DIVISAO', reqs).cotas.length === 0)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Motor Financeiro V3 · Fase 1: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
