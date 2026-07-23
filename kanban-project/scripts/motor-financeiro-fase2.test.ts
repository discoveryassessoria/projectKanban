// scripts/motor-financeiro-fase2.test.ts
// GUARDA — Motor Financeiro V3 · Fase 2 (núcleo PURO): aplicação de pagamento,
// distribuição × pagador (independentes), posição por requerente (informativa),
// câmbio/diferença, estorno, replay. Cobre os cenários obrigatórios §22.
import { aplicar } from '../lib/financeiro/dominio/aplicacao'
import { resolverDistribuicao } from '../lib/financeiro/dominio/obrigacao-economica'
import { posicaoPorRequerente } from '../lib/financeiro/dominio/posicao-requerente'
import { lancObrigacaoCriada, lancPagamento, lancDesconto, lancEncargo, lancEstorno, somas } from '../lib/financeiro/ledger/lancamentos'
import { projetar, type EntryProjecao } from '../lib/financeiro/ledger/projecao'
import type { Perna } from '../lib/financeiro/ledger/lancamentos'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
let seqG = 0
const ent = (...l: { pernas: Perna[] }[]): EntryProjecao[] => l.flatMap((x) => x.pernas.map((p) => ({ conta: p.conta, direcao: p.direcao, valor: p.valor, sequencia: ++seqG })))
const parc = (n: number, saldo: number, dia: number) => ({ parcelaId: n, saldoAberto: saldo, numero: n, vencimento: `2026-0${dia}-10` })

sec('Aplicação — parcial, múltiplas, específica, proporcional, manual, excedente')
{
  const ps = [parc(1, 400, 1), parc(2, 400, 2), parc(3, 200, 3)]
  const parcial = aplicar(300, ps, 'FIFO')
  ok('8 · parcial: 300 na 1ª (saldo parcela vira 100)', parcial.totalAplicado === 300 && parcial.aplicacoes.length === 1 && parcial.aplicacoes[0].valor === 300)
  const varias = aplicar(700, ps, 'FIFO')
  ok('9 · cobre múltiplas parcelas (400+300)', varias.totalAplicado === 700 && varias.aplicacoes.length === 2)
  const exc = aplicar(1200, ps, 'FIFO')
  ok('10 · pagamento > saldo → excedente 200 (não aplicado)', exc.totalAplicado === 1000 && exc.excedente === 200)
  const esp = aplicar(500, ps, 'PARCELA_ESPECIFICA', { parcelaId: 2 })
  ok('específica: aplica na parcela 2 (400) + excedente 100', esp.aplicacoes[0].parcelaId === 2 && esp.aplicacoes[0].valor === 400 && esp.excedente === 100)
  const prop = aplicar(500, ps, 'PROPORCIONAL')
  ok('proporcional: soma 500, centavos fecham', prop.totalAplicado === 500)
  const man = aplicar(300, ps, 'MANUAL', { manual: [{ parcelaId: 1, valor: 100 }, { parcelaId: 3, valor: 200 }] })
  ok('manual: 100+200 nas escolhidas', man.totalAplicado === 300 && man.aplicacoes.length === 2)
}

sec('Distribuição × Pagador (independentes) — cenários 1..7')
{
  const quatro = resolverDistribuicao(1000, 'IGUAL', [{ pessoaId: 1 }, { pessoaId: 2 }, { pessoaId: 3 }, { pessoaId: 4 }])
  const pos1 = posicaoPorRequerente(quatro.cotas, [{ pessoaId: 1, valor: 1000 }])
  const r1 = pos1.find((p) => p.pessoaId === 1)!
  ok('1 · 4 req/1 paga: req1 participa 250, pagou 1000, em nome de 3os 750', r1.participacao === 250 && r1.pago === 1000 && r1.pagoEmNomeDeTerceiros === 750)
  ok('1 · SEM dívida interna (outros: participa 250, pago 0)', pos1.filter((p) => p.pessoaId !== 1).every((p) => p.participacao === 250 && p.pago === 0))

  const umReq = resolverDistribuicao(1000, 'IGUAL', [{ pessoaId: 5 }])
  const pos2 = posicaoPorRequerente(umReq.cotas, [{ pessoaId: 6, valor: 1000 }])
  ok('2 · 1 req pago por outro: req5 participa 1000/pago 0; req6 pago 1000/participa 0', pos2.find((p) => p.pessoaId === 5)!.pago === 0 && pos2.find((p) => p.pessoaId === 6)!.pagoEmNomeDeTerceiros === 1000)

  const pos3 = posicaoPorRequerente([{ pessoaId: 7, valor: 1000 }], [{ pessoaId: 999, valor: 1000 }]) // 999 = externo
  ok('3 · terceiro externo paga: externo participa 0, pago 1000', pos3.find((p) => p.pessoaId === 999)!.participacao === 0 && pos3.find((p) => p.pessoaId === 999)!.pago === 1000)

  const pos4 = posicaoPorRequerente([{ pessoaId: 8, valor: 1000 }], [{ pessoaId: 8, valor: 600 }, { pessoaId: 9, valor: 400 }])
  ok('4 · dois pagadores mesma obrigação (600+400)', pos4.find((p) => p.pessoaId === 8)!.pago === 600 && pos4.find((p) => p.pessoaId === 9)!.pago === 400)

  ok('5 · extra IGUAL', resolverDistribuicao(900, 'IGUAL', [{ pessoaId: 1 }, { pessoaId: 2 }, { pessoaId: 3 }]).cotas.every((c) => c.valor === 300))
  ok('6 · extra PERCENTUAL 20/80', (() => { const r = resolverDistribuicao(1000, 'PERCENTUAL', [{ pessoaId: 1, percentual: 20 }, { pessoaId: 2, percentual: 80 }]); return r.cotas[0].valor === 200 && r.cotas[1].valor === 800 })())
  ok('7 · extra a um único requerente', resolverDistribuicao(500, 'IGUAL', [{ pessoaId: 1 }]).cotas[0].valor === 500)
}

sec('Ledger — desconto, encargos, estorno, câmbio, replay (11..17, 20)')
{
  const criada = lancObrigacaoCriada(1000, true)
  ok('14 · desconto reduz saldo (1000→900)', projetar(ent(criada, lancDesconto(100))).saldo === 900)
  ok('15 · multa/juros aumentam saldo (1000→1050)', projetar(ent(criada, lancEncargo(50, 'JUROS'))).saldo === 1050)
  const pg = lancPagamento({ valorQuitado: 400 })
  ok('12 · estorno PARCIAL: paga 400 (saldo 600) e estorna 400 → volta 1000', projetar(ent(criada, pg, lancEstorno(pg.pernas))).saldo === 1000)
  const pgTot = lancPagamento({ valorQuitado: 1000 })
  ok('13 · estorno TOTAL: quita e estorna → saldo 1000', projetar(ent(criada, pgTot, lancEstorno(pgTot.pernas))).saldo === 1000)
  // 16/17 · pagamento BRL de obrigação EUR com diferença cambial
  const pagDif = lancPagamento({ valorQuitado: 1000, diferencaCambial: -25 }) // recebeu 25 a menos
  ok('16/17 · diferença cambial vira perna balanceada', somas(pagDif.pernas).debitos === somas(pagDif.pernas).creditos)
  // 20 · replay integral com várias ocorrências
  const rep = projetar(ent(criada, lancDesconto(100), lancEncargo(50), lancPagamento({ valorQuitado: 500 })))
  ok('20 · replay integral: 1000 −100 +50 −500 = 450', rep.saldo === 450)
  ok('18 · idempotência: mesmos insumos → mesma projeção', projetar(ent(lancObrigacaoCriada(1000, true))).saldo === projetar(ent(lancObrigacaoCriada(1000, true))).saldo)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Motor Financeiro V3 · Fase 2: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
