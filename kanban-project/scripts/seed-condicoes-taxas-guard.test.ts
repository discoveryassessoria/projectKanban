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
// 3 condições LÓGICAS (não por parcela), idempotente por CÓDIGO fixo.
ok('idempotente por código (não sobrescreve admin)', s.includes('codigosExist.has(c.codigo)') && s.includes('não sobrescreve'))
ok('À Vista COND-AVISTA (sem cartão de crédito)', s.includes("codigo: 'COND-AVISTA'") && !s.includes("'CARTAO_CREDITO'], sugerida: 'PIX'") && s.includes("['PIX', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO_DEBITO', 'WISE']"))
ok('Cartão de Crédito COND-CARTAO-CREDITO 1–12x', s.includes("codigo: 'COND-CARTAO-CREDITO'") && s.includes('min: 1, max: 12') && s.includes("formas: ['CARTAO_CREDITO']"))
ok('Boleto Parcelado COND-BOLETO 1–12x + multa/juros', s.includes("codigo: 'COND-BOLETO'") && s.includes('multaPercent: 2') && s.includes('jurosMesPercent: 1') && s.includes('carenciaDias: 3'))
ok('NÃO cria condição por parcela (sem loop 2..12)', !s.includes('n <= 12') && !s.includes('Cartão de crédito — ${n}x'))
ok('inativa legadas por-parcela SEM USO (reversível, sem delete)', s.includes('inativada') && s.includes('ativo: false') && !s.includes('.delete('))
ok('preserva legada EM USO (histórico)', s.includes('EM USO') && s.includes('condicaoPagamentoId: l.id'))
ok('cronograma 1ª no ato + mês de calendário (IMEDIATA/MENSAL)', s.includes("inicioCronograma: 'IMEDIATA'") && s.includes("periodicidade: 'MENSAL'"))
ok('taxas de boleto R$5 emissão + pagamento (FIXA)', s.includes('Taxa de Emissão') && s.includes('Taxa de Pagamento') && s.includes('fixedFee: 5'))
ok('não gera receitas/cobranças/parcelas', !s.includes('receita.create') && !s.includes('cobranca.create') && !s.includes('parcelaFinanceira.create'))
ok('seed no build', pkg.includes('prod-seed-condicoes-taxas.mjs'))

console.log(`\nSeed Condições + Taxas: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
