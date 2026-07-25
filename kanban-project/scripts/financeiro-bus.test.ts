/** financeiro-bus — teste do núcleo puro de relevância de revalidação. */
import { mutacaoRelevante } from '../src/lib/financeiro-bus'
let p = 0, f = 0
const ok = (c: boolean, n: string) => { if (c) { p++; console.log('  ✅ ' + n) } else { f++; console.log('  ❌ ' + n) } }
console.log('financeiro-bus — relevância\n')
ok(mutacaoRelevante(['pagamentos'], ['tudo']) === true, 'assinante "tudo" recebe qualquer mutação')
ok(mutacaoRelevante(['tudo'], ['receita']) === true, 'mutação "tudo" atinge qualquer assinante')
ok(mutacaoRelevante(['pagamentos'], ['receita']) === false, 'escopos disjuntos → não revalida')
ok(mutacaoRelevante(['pagamentos', 'receita'], ['receita']) === true, 'interseção de escopo → revalida')
ok(mutacaoRelevante(['dashboard'], ['dashboard', 'central']) === true, 'dashboard atinge assinante dashboard/central')
console.log(`\n${p} passaram, ${f} falharam`)
if (f) process.exit(1)
