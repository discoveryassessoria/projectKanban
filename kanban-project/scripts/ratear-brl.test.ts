// scripts/ratear-brl.test.ts — partição EXATA do total em BRL por base (SSOT câmbio).
// Roda: npx tsx scripts/ratear-brl.test.ts
import { ratearBrlPorBase, taxaDe } from '@/lib/financeiro/dominio/cambio'

let ok = 0, fail = 0
const cent = (v: number) => Math.round(v * 100) / 100
function assert(nome: string, cond: boolean, det = '') { if (cond) ok++; else { fail++; console.error(`✗ ${nome} ${det}`) } }

// 1) O CASO DO BUG: €4.600 → R$28.062,76 (taxa 6,1006), 1.800 + 2.800.
{
  const totalBrl = 28062.76
  const r = ratearBrlPorBase([1800, 2800], totalBrl)
  assert('bug: Marco 10.981,08', r[0] === 10981.08, `obtido ${r[0]}`)
  assert('bug: Matheus 17.081,68', r[1] === 17081.68, `obtido ${r[1]}`)
  assert('bug: soma EXATA = total', cent(r[0] + r[1]) === totalBrl, `soma ${cent(r[0] + r[1])}`)
  // a taxa efetiva NÃO é arredondada
  assert('taxa efetiva 6,1006…', Math.abs(taxaDe(totalBrl, 4600) - 6.1006) < 1e-9)
}

// 2) Resíduo: 3 participantes iguais de um total que não divide em centavos redondos.
{
  const totalBrl = 100.00
  const r = ratearBrlPorBase([1, 1, 1], totalBrl)
  assert('3x: soma EXATA = 100,00', cent(r.reduce((s, v) => s + v, 0)) === 100.00, `soma ${cent(r.reduce((s, v) => s + v, 0))}`)
  // resíduo (0,01) cai no maior; como são iguais, no primeiro (idx 0)
  assert('3x: nenhum negativo/absurdo', r.every((v) => v >= 33.3 && v <= 33.34), JSON.stringify(r))
}

// 3) Total que gera resíduo com bases desiguais → resíduo no MAIOR base.
{
  const r = ratearBrlPorBase([10, 20, 70], 100.01)
  const soma = cent(r.reduce((s, v) => s + v, 0))
  assert('desigual: soma EXATA = 100,01', soma === 100.01, `soma ${soma}`)
  const maiorIdx = 2
  // o maior base recebe o resíduo → seu valor ≥ proporção pura (70,007→70,01)
  assert('desigual: resíduo no maior', r[maiorIdx] >= 70.00, JSON.stringify(r))
}

// 4) Base total 0 → tudo 0 (sem divisão por zero).
{
  const r = ratearBrlPorBase([0, 0], 500)
  assert('base 0: tudo 0', r[0] === 0 && r[1] === 0)
}

// 5) BRL puro (moeda-base = BRL, taxa 1): partição idêntica à base.
{
  const r = ratearBrlPorBase([300, 700], 1000)
  assert('BRL: 300/700 exatos', r[0] === 300 && r[1] === 700 && cent(r[0] + r[1]) === 1000)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ratear-brl: ${ok} ok, ${fail} falhas`)
process.exit(fail === 0 ? 0 : 1)
