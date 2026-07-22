// scripts/seed-condicoes-taxas-guard.test.ts
// GUARDA estrutural do seed idempotente de Condições + taxas de boleto.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const s = readFileSync(join(RAIZ, 'scripts/prod-seed-condicoes-taxas.mjs'), 'utf8')
const pkg = readFileSync(join(RAIZ, 'package.json'), 'utf8')

console.log('\nSeed Condições + Taxas de boleto')
ok('só production + trava PRODUCAO', s.includes("VERCEL_ENV !== 'production'") && s.includes('CLASSE.PRODUCAO'))
ok('idempotente (só INSERT do ausente; sem update/delete)', s.includes('existentes.has') && !s.includes('.delete(') && !s.includes('.update('))
ok('À vista (1x, todas as formas, sugerida PIX)', s.includes("name: 'À vista'") && s.includes('TODAS') && s.includes('sugerida: PIX'))
ok('Cartão 2x–12x (só cartão)', s.includes('Cartão de crédito — ${n}x') && s.includes('n = 2; n <= 12'))
ok('Boleto 1x–12x (só boleto)', s.includes('Boleto — ${n}x') && s.includes('n = 1; n <= 12'))
ok('primeira no ato + demais +30d (IMEDIATA/MENSAL)', s.includes("inicioCronograma: 'IMEDIATA'") && s.includes("periodicidade: 'MENSAL'"))
ok('taxas de boleto R$5 emissão + pagamento (FIXA)', s.includes('Taxa de Emissão') && s.includes('Taxa de Pagamento') && s.includes('fixedFee: 5'))
ok('código CPG/TXP pela CodeSequence', s.includes("proxCod(tx, 'CPG')") && s.includes("proxCod(tx, 'TXP')"))
ok('não gera receitas/cobranças/parcelas', !s.includes('receita.create') && !s.includes('cobranca.create') && !s.includes('parcelaFinanceira.create'))
ok('seed no build', pkg.includes('prod-seed-condicoes-taxas.mjs'))

console.log(`\nSeed Condições + Taxas: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
