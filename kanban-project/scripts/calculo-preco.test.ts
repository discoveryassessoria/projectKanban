/**
 * calcularPreco — ALGORITMO ÚNICO de cálculo (lib/financeiro/calculo-preco).
 * Rodar: npx tsx scripts/calculo-preco.test.ts
 *
 * GARANTE que existe UM só algoritmo e que todos os fluxos batem nele:
 *  • fixo → valor uma vez;
 *  • por unidade (só valor) → valor × quantidade;
 *  • primeiro + adicional → valorBase + max(qtd-1,0) × valorAdicional;
 *  • guarda de arquitetura: nem executor nem resolver têm fórmula própria.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calcularPreco } from '../lib/financeiro/calculo-preco'

let passed = 0
let failed = 0
const falhas: string[] = []
const ok = (cond: boolean, nome: string) => {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}
const RAIZ = join(__dirname, '..')

console.log('\nAlgoritmo único de preço')

// ── FIXO ─────────────────────────────────────────────────────────────────────
{
  const r = calcularPreco({ modoCalculo: 'fixed', valor: 1500 })
  ok(r.total === 1500 && r.quantidade === 1 && r.estrategia === 'fixo', 'fixo: valor uma vez')
  const r2 = calcularPreco({ modoCalculo: 'fixed', valor: 1500, quantidade: 5 })
  ok(r2.total === 1500, 'fixo: ignora quantidade')
  // base/adicional presentes mas modo fixo → NÃO aplica primeiro+adicional
  const r3 = calcularPreco({ modoCalculo: 'fixed', valor: 800, valorBase: 800, valorAdicional: 200, quantidade: 4 })
  ok(r3.total === 800 && r3.estrategia === 'fixo', 'fixo: base/adicional não multiplicam')
}

// ── POR UNIDADE (só valor) ───────────────────────────────────────────────────
{
  const r = calcularPreco({ modoCalculo: 'per_document', valor: 100, quantidade: 3 })
  ok(r.total === 300 && r.quantidade === 3 && r.estrategia === 'por_unidade', 'por unidade: valor × qtd')
  const r1 = calcularPreco({ modoCalculo: 'per_document', valor: 100, quantidade: 1 })
  ok(r1.total === 100, 'por unidade: qtd 1')
  const r0 = calcularPreco({ modoCalculo: 'per_document', valor: 100, quantidade: 0 })
  ok(r0.total === 100 && r0.quantidade === 1, 'por unidade: qtd 0 vira 1 (piso)')
}

// ── PRIMEIRO + ADICIONAL (honorários por requerente e QUALQUER outro) ─────────
{
  // 1 requerente → só o primeiro
  const r1 = calcularPreco({ modoCalculo: 'per_applicant', valor: 6800, valorBase: 6800, valorAdicional: 1200, quantidade: 1 })
  ok(r1.total === 6800 && r1.estrategia === 'primeiro_e_adicional', 'primeiro+adic: 1 requerente = base')
  // 3 requerentes → 6800 + 2×1200 = 9200
  const r3 = calcularPreco({ modoCalculo: 'per_applicant', valor: 6800, valorBase: 6800, valorAdicional: 1200, quantidade: 3 })
  ok(r3.total === 9200, 'primeiro+adic: 3 requerentes = base + 2×adic')
  // aliases legados devem cair no MESMO algoritmo
  const rAlias = calcularPreco({ modoCalculo: 'honorario_por_requerente', valor: 6800, valorBase: 6800, valorAdicional: 1200, quantidade: 3 })
  ok(rAlias.total === 9200, 'primeiro+adic: alias honorario_por_requerente = mesmo resultado')
  // unitário = base; quantidade preservada
  ok(r3.unitario === 6800 && r3.quantidade === 3, 'primeiro+adic: unitário=base, qtd preservada')
  // adicional zero → sempre o primeiro
  const rZero = calcularPreco({ modoCalculo: 'per_applicant', valor: 500, valorBase: 500, valorAdicional: 0, quantidade: 9 })
  ok(rZero.total === 500, 'primeiro+adic: adicional 0 → só o primeiro')
  // arredondamento a centavos
  const rCent = calcularPreco({ modoCalculo: 'per_applicant', valor: 100.005, valorBase: 100.005, valorAdicional: 0.335, quantidade: 3 })
  ok(rCent.total === 100.68, 'primeiro+adic: arredonda a centavos')
}

// ── EQUIVALÊNCIA: base+adic só multiplica no modo por-quantidade ──────────────
{
  // sem base/adicional em modo por-unidade → cai no valor×qtd
  const r = calcularPreco({ modoCalculo: 'per_applicant', valor: 300, quantidade: 4 })
  ok(r.total === 1200 && r.estrategia === 'por_unidade', 'sem base/adic: por_unidade')
}

// ── GUARDA DE ARQUITETURA: nenhum caminho tem fórmula própria ─────────────────
console.log('\nGuarda de arquitetura (fonte única)')
{
  const executor = readFileSync(join(RAIZ, 'src/lib/motor/executor.ts'), 'utf8')
  ok(executor.includes("from '@/lib/financeiro/calculo-preco'"), 'executor importa calcularPreco')
  ok(!/\(\s*base\s*\+\s*\(\s*n\s*-\s*1\s*\)\s*\*\s*adic\s*\)/.test(executor), 'executor NÃO tem fórmula inline base+(n-1)*adic')

  const resolver = readFileSync(join(RAIZ, 'src/lib/motor/resolver-preco-financeiro.ts'), 'utf8')
  ok(resolver.includes("from '@/lib/financeiro/calculo-preco'"), 'resolver importa calcularPreco')
  ok(!/perUnit\s*\?\s*escolhida\.valor\s*\*\s*quantidade/.test(resolver), 'resolver NÃO tem valor×quantidade inline')
}

console.log(`\n${'='.repeat(56)}`)
console.log(`calcularPreco: ${passed} passaram, ${failed} falharam`)
if (falhas.length) console.log('Falhas:\n  - ' + falhas.join('\n  - '))
console.log('='.repeat(56))
if (failed > 0) process.exit(1)
