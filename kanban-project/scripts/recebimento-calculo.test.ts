/**
 * recebimento-calculo — testes puros da fonte única de cálculo do recebimento.
 * Rodar: npx tsx scripts/recebimento-calculo.test.ts
 * Cobre estados INICIAL/PARCIAL/QUITADO/EXCEDENTE + arredondamento (centavos).
 */
import { calcularRecebimento, totaisConsistentes } from '../lib/financeiro/dominio/calculo-recebimento'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

console.log('recebimento-calculo — fonte única\n')

// Estado INICIAL — total 0 nunca é parcial (cenário 4)
{
  const r = calcularRecebimento({ saldoSelecionado: 10981.08, linhas: [] })
  ok(r.situacao === 'INICIAL', 'total 0 → INICIAL (não PARCIAL)')
  ok(r.totalInformado === 0 && r.excedente === 0, 'INICIAL: total e excedente zerados')
  ok(r.saldoRestante === 10981.08, 'INICIAL: saldo restante = líquido devido')
}

// Estado PARCIAL — 5.000 em 10.981,08 (cenário 5)
{
  const r = calcularRecebimento({ saldoSelecionado: 10981.08, linhas: [{ valor: 5000 }] })
  ok(r.situacao === 'PARCIAL', '5.000 em 10.981,08 → PARCIAL')
  ok(r.saldoRestante === 5981.08, 'PARCIAL: saldo restante 5.981,08')
  ok(r.excedente === 0, 'PARCIAL: sem excedente')
}

// Estado QUITADO — exato
{
  const r = calcularRecebimento({ saldoSelecionado: 10981.08, linhas: [{ valor: 5000 }, { valor: 5981.08 }] })
  ok(r.situacao === 'QUITADO', '5.000 + 5.981,08 → QUITADO')
  ok(r.saldoRestante === 0 && r.excedente === 0, 'QUITADO: saldo e excedente zerados')
}

// Estado EXCEDENTE — 12.000 em 10.981,08 (cenário 6)
{
  const r = calcularRecebimento({ saldoSelecionado: 10981.08, linhas: [{ valor: 12000 }] })
  ok(r.situacao === 'EXCEDENTE', '12.000 em 10.981,08 → EXCEDENTE')
  ok(r.excedente === 1018.92, 'EXCEDENTE: excedente 1.018,92')
  ok(r.saldoRestante === 0, 'EXCEDENTE: saldo restante zero')
}

// Ajustes: desconto reduz o líquido; crédito reduz o líquido; encargos aumentam
{
  const r = calcularRecebimento({ saldoSelecionado: 1000, linhas: [{ valor: 900 }], desconto: 100 })
  ok(r.valorLiquidoDevido === 900 && r.situacao === 'QUITADO', 'desconto 100 → líquido 900, quita com 900')
  const r2 = calcularRecebimento({ saldoSelecionado: 1000, linhas: [{ valor: 1000 }], juros: 50, multa: 20 })
  ok(r2.valorLiquidoDevido === 1070 && r2.saldoRestante === 70, 'juros+multa aumentam o líquido devido')
  const r3 = calcularRecebimento({ saldoSelecionado: 1000, linhas: [{ valor: 800 }], creditoUtilizado: 200 })
  ok(r3.valorLiquidoDevido === 800 && r3.situacao === 'QUITADO', 'crédito utilizado 200 → líquido 800')
}

// Arredondamento: múltiplas linhas com centavos
{
  const r = calcularRecebimento({ saldoSelecionado: 100, linhas: [{ valor: 33.33 }, { valor: 33.33 }, { valor: 33.34 }] })
  ok(r.totalInformado === 100 && r.situacao === 'QUITADO', 'somatório de centavos fecha 100 exato (sem drift)')
}

// Validação backend: totais enviados batendo/divergindo
{
  const entrada = { saldoSelecionado: 10981.08, linhas: [{ valor: 5000 }] }
  ok(totaisConsistentes(entrada, { totalInformado: 5000, saldoRestante: 5981.08 }) === true, 'totais consistentes → true')
  ok(totaisConsistentes(entrada, { totalInformado: 9999 }) === false, 'totais divergentes → false (backend rejeita)')
}

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed) { console.log('Falhas:', falhas.join(', ')); process.exit(1) }
