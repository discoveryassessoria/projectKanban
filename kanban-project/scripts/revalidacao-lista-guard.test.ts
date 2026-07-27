// Regressão (homologação final): toda AÇÃO RÁPIDA da lista de Receitas deve emitir
// emitirMutacaoFinanceira no onDone, senão outras telas ficam com dados velhos após a
// mutação (bug encontrado na homologação e corrigido). Guarda estática de fonte.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const src = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitasTab.tsx'), 'utf8')

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

chk(/import\s*\{[^}]*emitirMutacaoFinanceira[^}]*\}\s*from\s*["']@\/src\/lib\/financeiro-bus["']/.test(src),
  'importa emitirMutacaoFinanceira do financeiro-bus')

// Todo onDone dos modais de ação rápida deve conter emitirMutacaoFinanceira().
const onDones = src.match(/onDone=\{\([^)]*\)\s*=>\s*\{[^}]*\}\}/g) ?? []
chk(onDones.length >= 8, `há ${onDones.length} handlers onDone de ação rápida (>=8)`)
const semEmit = onDones.filter((h) => !h.includes('emitirMutacaoFinanceira'))
chk(semEmit.length === 0, `todos os onDone emitem o bus (${semEmit.length} sem emitir)`)
if (semEmit.length) semEmit.forEach((h) => console.log('     ⚠ sem emit:', h.slice(0, 80)))

// carregar() também presente (revalida a própria lista).
chk(onDones.every((h) => h.includes('carregar()')), 'todos os onDone recarregam a lista local')

console.log(`\n${ok} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
