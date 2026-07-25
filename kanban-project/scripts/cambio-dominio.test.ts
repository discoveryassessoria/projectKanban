/** cambio-dominio — fonte única de parsing/cálculo de câmbio. Casos do comando. */
import { parseTaxaCambio, converterParaBrl } from '../lib/financeiro/dominio/cambio'
let p=0,f=0; const bugs:string[]=[]
const ok=(c:boolean,n:string)=>{ if(c){p++;console.log('  ✅ '+n)}else{f++;bugs.push(n);console.log('  ❌ '+n)} }
const near=(a:number,b:number)=>Math.abs(a-b)<0.005
console.log('cambio-dominio\n')
// O BUG: "6.1006" (ponto decimal, de String(number)) NÃO pode virar 61006
ok(parseTaxaCambio('6.1006')===6.1006, 'parseTaxaCambio("6.1006") = 6.1006 (NÃO 61006)')
ok(parseTaxaCambio('6,1006')===6.1006, 'parseTaxaCambio("6,1006") = 6.1006 (vírgula decimal)')
ok(parseTaxaCambio('6.10')===6.10, '"6.10" = 6.10')
ok(parseTaxaCambio('6,10')===6.10, '"6,10" = 6.10')
ok(parseTaxaCambio(6.1006)===6.1006, 'número 6.1006 preservado')
ok(parseTaxaCambio('')===0 && parseTaxaCambio('abc')===0, 'vazio/inválido = 0')
// conversão
ok(near(converterParaBrl(4600, 6.10), 28060), '4600 × 6,10 = R$ 28.060,00')
ok(near(converterParaBrl(4600, 6.1006), 28062.76), '4600 × 6,1006 = R$ 28.062,76')
ok(converterParaBrl(4600, parseTaxaCambio('6.1006')) < 100000, 'via string "6.1006": SEM escala absurda (< 100k, não 280 milhões)')
ok(near(converterParaBrl(4600, parseTaxaCambio('6,1006')), 28062.76), 'fluxo completo string vírgula → 28.062,76')
// taxa 6 casas
ok(near(converterParaBrl(1800, 6.1006), 10981.08), '1800 × 6,1006 = R$ 10.981,08 (Marco)')
ok(near(converterParaBrl(2800, 6.1006), 17081.68), '2800 × 6,1006 = R$ 17.081,68 (Matheus)')
console.log(`\n${p} passaram, ${f} falharam`); if(f){console.log('FALHAS:',bugs.join(' | '));process.exit(1)}
