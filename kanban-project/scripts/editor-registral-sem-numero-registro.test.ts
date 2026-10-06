// scripts/editor-registral-sem-numero-registro.test.ts
// "Referência registral" do editor de "Localizar registro": o campo "Nº registro" saiu da tela e deixou de ser exigido para concluir a etapa
// (Livro, Folha e Termo continuam). O dado já gravado em `Documento.numero_registro` NÃO é apagado nem sobrescrito.
import { readFileSync } from 'node:fs'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const ed = readFileSync('src/components/kanban/workflow/EditorRegistralModal.tsx', 'utf8')
const resolver = readFileSync('src/services/processEngine/stepCompletionResolver.ts', 'utf8')

ok('não há campo "Nº registro" na tela', !/label="Nº registro"/.test(ed) && !/>\s*Nº registro\s*</.test(ed))
ok('não é mais exigido para concluir a etapa (nem na checagem, nem na lista de pendências, nem no aviso)', !/numeroRegistroOk/.test(ed) && !/"Nº registro"/.test(ed))
ok('Livro, Folha e Termo continuam obrigatórios', /const livroOk/.test(ed) && /const folhaOk/.test(ed) && /const termoOk/.test(ed) && /livroOk && folhaOk && termoOk && dataEventoOk/.test(ed))
ok('o salvamento não envia mais o número do registro (o valor já gravado não é tocado)', !/numero_registro: form\.numero_registro/.test(ed))
ok('a regra do servidor para "registro localizado" nunca dependeu dele (cartório + livro/folha/termo)', /naoVazio\(d\.cartorio\) && \(naoVazio\(d\.livro\) \|\| naoVazio\(d\.folha\) \|\| naoVazio\(d\.termo\)\)/.test(resolver))
console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
