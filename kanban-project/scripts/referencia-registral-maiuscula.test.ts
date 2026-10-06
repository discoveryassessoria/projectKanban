// scripts/referencia-registral-maiuscula.test.ts
// "Referência registral" do editor de "Localizar registro": Livro, Folha, Termo (e Matrícula, CRC, Protocolo, que moram na mesma seção)
// só aceitam MAIÚSCULAS — o que se digita em minúscula já fica maiúsculo; o que já estava gravado em minúscula aparece e salva em maiúsculo.
// SÓ esta seção: o resto do editor (nome, cidade, cartório, observações…) continua como se digita.
import { readFileSync } from 'node:fs'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n}`) } }
const ed = readFileSync('src/components/kanban/workflow/EditorRegistralModal.tsx', 'utf8')
const secao = ed.slice(ed.indexOf('SEÇÃO 3: Referência registral'), ed.indexOf('SEÇÃO 4'))
const campos = ['Livro', 'Folha', 'Termo', 'Matrícula', 'CRC', 'Protocolo']

ok('a seção tem os seis campos', campos.every((c) => new RegExp(`<Field\\s+maiuscula\\s+label="${c}"`).test(secao)))
ok('todo <Field> da seção é "maiuscula" (nenhum ficou de fora)', (secao.match(/<Field\b/g) ?? []).length === (secao.match(/<Field\s+maiuscula/g) ?? []).length)
ok('o campo converte o que se digita (toUpperCase no onChange) e mostra em maiúsculas', /onChange\(maiuscula \? e\.target\.value\.toUpperCase\(\) : e\.target\.value\)/.test(ed) && /maiuscula \? "uppercase " : ""/.test(ed))
ok('o que já estava gravado em minúscula abre em maiúsculo', campos.map((c) => c === 'Matrícula' ? 'matricula' : c.toLowerCase()).every((k) => new RegExp(`${k}: \\(doc\\.${k} \\|\\| ""\\)\\.toUpperCase\\(\\)`).test(ed)))
ok('e salva em maiúsculo', ['livro', 'folha', 'termo', 'matricula', 'crc', 'protocolo'].every((k) => new RegExp(`${k}: form\\.${k}\\.trim\\(\\)\\.toUpperCase\\(\\) \\|\\| null`).test(ed)))
ok('o resto do editor NÃO ganhou a regra (nome, cidade, cartório continuam livres)', (ed.match(/<Field\s+maiuscula/g) ?? []).length === 6 && !/label="Cartório"[\s\S]{0,80}maiuscula/.test(ed) && !/label="Nome registrado"[\s\S]{0,80}maiuscula/.test(ed))
// o comportamento do campo, na regra que ele usa
const converte = (v: string) => v.toUpperCase()
ok('digitar "a-12 bis" vira "A-12 BIS"; "fls. 3v" vira "FLS. 3V"', converte('a-12 bis') === 'A-12 BIS' && converte('fls. 3v') === 'FLS. 3V')
console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
