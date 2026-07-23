// scripts/motor-financeiro-fase3.test.ts
// GUARDA — Motor Financeiro V3 · Fase 3 (fundação PURA): Data de Corte / Saldo de
// Abertura. abertura = max(0, contratado − recebido no legado); idempotente
// (não reabre quem já tem abertura); balanceado ao virar lançamento (D 1.1/C 9.9).
import { resolverAbertura, planoDeCorte, resolverCorte } from '../lib/financeiro/dominio/data-corte'
import { lancAbertura, lancReconciliacaoCorte, lancObrigacaoCriada, somas } from '../lib/financeiro/ledger/lancamentos'
import { projetar, type EntryProjecao } from '../lib/financeiro/ledger/projecao'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }

console.log('\nData de Corte — saldo de abertura')
{
  const semPagto = resolverAbertura({ obrigacaoId: 1, valorContratado: 4000, recebidoLegado: 0 })
  ok('sem pagamento legado: abre pelo contratado (4000)', semPagto.precisaAbertura && semPagto.valorAbertura === 4000)

  const parcial = resolverAbertura({ obrigacaoId: 2, valorContratado: 4000, recebidoLegado: 1500 })
  ok('com pagamento parcial no legado: abre o remanescente (2500)', parcial.valorAbertura === 2500)

  const quitado = resolverAbertura({ obrigacaoId: 3, valorContratado: 4000, recebidoLegado: 4000 })
  ok('quitado no legado: NÃO abre (saldo 0)', !quitado.precisaAbertura && quitado.valorAbertura === 0)

  const excedente = resolverAbertura({ obrigacaoId: 4, valorContratado: 4000, recebidoLegado: 5000 })
  ok('recebido > contratado: nunca negativo, não abre', !excedente.precisaAbertura && excedente.valorAbertura === 0)

  const jaTem = resolverAbertura({ obrigacaoId: 5, valorContratado: 4000, recebidoLegado: 0, jaTemAbertura: true })
  ok('idempotência: já tem abertura → não reabre', !jaTem.precisaAbertura)
}

console.log('\nPlano de corte (lote) + lançamento balanceado')
{
  const plano = planoDeCorte([
    { obrigacaoId: 1, valorContratado: 4000, recebidoLegado: 0 },
    { obrigacaoId: 2, valorContratado: 4000, recebidoLegado: 1500 },
    { obrigacaoId: 3, valorContratado: 4000, recebidoLegado: 4000 },
    { obrigacaoId: 5, valorContratado: 4000, recebidoLegado: 0, jaTemAbertura: true },
  ])
  ok('plano: só 2 obrigações abrem (4000 + 2500)', plano.quantasAbrem === 2 && plano.totalAbertura === 6500)

  const l = lancAbertura(2500, true)
  ok('lançamento de abertura é balanceado (Σd=Σc)', somas(l.pernas).debitos === somas(l.pernas).creditos && l.tipo === 'ABERTURA')
  ok('abertura debita Clientes a Receber (1.1) e credita Saldo de Abertura (9.9)', l.pernas.some((p) => p.conta === '1.1' && p.direcao === 'DEBITO') && l.pernas.some((p) => p.conta === '9.9' && p.direcao === 'CREDITO'))
}

console.log('\nCorte limpo (opção C) — abertura nova × reconciliação do espelho')
{
  const nova = resolverCorte({ obrigacaoId: 1, valorContratado: 4000, recebidoLegado: 0, temLedger: false })
  ok('sem ledger, nada recebido → ABERTURA_NOVA (4000)', nova.acao === 'ABERTURA_NOVA' && nova.saldoAlvo === 4000 && nova.valorReconcilia === 0)

  const espelhoLimpo = resolverCorte({ obrigacaoId: 2, valorContratado: 4000, recebidoLegado: 0, temLedger: true })
  ok('espelho sem recebimento no legado → NENHUMA (já reflete o contratado)', espelhoLimpo.acao === 'NENHUMA')

  const espelhoParcial = resolverCorte({ obrigacaoId: 3, valorContratado: 4000, recebidoLegado: 1500, temLedger: true })
  ok('espelho com recebido 1500 → RECONCILIA_ESPELHO (alvo 2500, reduz 1500)', espelhoParcial.acao === 'RECONCILIA_ESPELHO' && espelhoParcial.saldoAlvo === 2500 && espelhoParcial.valorReconcilia === 1500)

  const jaAberta = resolverCorte({ obrigacaoId: 4, valorContratado: 4000, recebidoLegado: 0, temLedger: true, jaTemAbertura: true })
  ok('idempotência: já tem abertura → NENHUMA', jaAberta.acao === 'NENHUMA')

  const rec = lancReconciliacaoCorte(1500)
  ok('reconciliação balanceada (D 9.9 / C 1.1)', somas(rec.pernas).debitos === somas(rec.pernas).creditos && rec.pernas.some((p) => p.conta === '9.9' && p.direcao === 'DEBITO') && rec.pernas.some((p) => p.conta === '1.1' && p.direcao === 'CREDITO'))

  // Replay: espelho (D1.1 4000) + reconciliação (C1.1 1500) → saldo remanescente 2500 (sem dupla contagem)
  let seq = 0
  const ent = (...l: { pernas: { conta: string; direcao: 'DEBITO' | 'CREDITO'; valor: number }[] }[]): EntryProjecao[] =>
    l.flatMap((x) => x.pernas.map((p) => ({ conta: p.conta, direcao: p.direcao, valor: p.valor, sequencia: ++seq })))
  const saldo = projetar(ent(lancObrigacaoCriada(4000, true), lancReconciliacaoCorte(1500))).saldo
  ok('replay pós-corte: espelho 4000 − recebido 1500 = 2500 (sem dupla contagem)', saldo === 2500)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Motor Financeiro V3 · Fase 3 (fundação): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
