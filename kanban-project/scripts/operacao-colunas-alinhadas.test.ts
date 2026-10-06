// scripts/operacao-colunas-alinhadas.test.ts
// As linhas da Operação (aba Feito) apareciam "desconfiguradas": cada linha é uma grade própria e `fr` puro deixa a coluna crescer com o conteúdo
// da linha — Pessoa, Concluída em, Prazo e Órgão ficavam em posições diferentes a cada linha. Toda grade da Operação usa `minmax(0, …)`.
import { readFileSync } from 'node:fs'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }
const abas = readFileSync('src/components/operacao/operacao-v3-abas.tsx', 'utf8')
const css = readFileSync('src/components/operacao/operacao-v3.css', 'utf8')

const templates = [...abas.matchAll(/gridTemplateColumns: "([^"]+)"/g)].map((m) => m[1])
const solto = templates.filter((t) => /(^|\s)[\d.]+fr(\s|$)/.test(t))
ok('nenhuma grade da Operação usa "fr" solto (que cresce com o conteúdo da linha)', solto.length === 0, solto.join(' | '))
ok('o cabeçalho e as linhas do Feito têm a MESMA grade (alinhadas), com larguras fixas por coluna', (() => { const f = templates.filter((t) => /minmax\(0,1\.4fr\) minmax\(0,1\.3fr\) minmax\(0,0\.8fr\) minmax\(0,1\.1fr\) minmax\(0,1\.6fr\) 90px/.test(t)); return f.length === 2 })())
ok('célula e rótulo de órgão não empurram as colunas vizinhas (min-width 0 + reticências)', /\.opv3-row > \*, \.opv3-hd > \* \{ min-width: 0; \}/.test(css) && /\.opv3-row \.opv3-pill \{[^}]*text-overflow: ellipsis/.test(css))
console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
