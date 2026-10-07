// scripts/atribuir-so-na-torre.test.ts
// ============================================================================
// LEI DA TORRE (L4) — SÓ a aba Tarefas da Torre atribui/transfere/redistribui responsável de tarefa.
//
//   npx tsx scripts/atribuir-so-na-torre.test.ts   (estático, sem banco)
//
// Fora de src/components/torre e de src/app/api (as portas de escrita continuam existindo), nenhuma tela chama a porta de
// atribuição. No lugar: o responsável (somente leitura) + o link "Atribuir na Torre" (/torre?aba=tarefas[&processo|&tarefa]).
// ============================================================================
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n)
    if (statSync(f).isDirectory()) arquivos(f, acc)
    else if (/\.(tsx?|jsx?)$/.test(n)) acc.push(f)
  }
  return acc
}

// Os lugares nomeados na decisão do dono.
const LUGARES = [
  "src/components/kanban/ProcessoCentralOperacional.tsx",
  "src/components/kanban/PainelDaFase.tsx",
  "src/components/kanban/DocumentoOperationalDrawer.tsx",
  "src/components/operacao/operacao-v3.tsx",
  "src/components/operacao/tabela-familia.tsx",
  "src/components/operacao/processo-expandido.tsx",
  "src/app/tarefas/page.tsx",
  "src/app/operacao/distribuicao/page.tsx",
]

const PROIBIDOS: Array<[string, RegExp]> = [
  ["comando atribuir", /acao\s*:\s*["'`]atribuir["'`]/],
  ["comando transferir", /acao\s*:\s*["'`]transferir["'`]/],
  ["comando devolver_a_fila", /acao\s*:\s*["'`]devolver_a_fila["'`]/],
  ["atribuir|transferir por ternário", /["'`]atribuir["'`]\s*:\s*["'`]transferir["'`]/],
  ["/api/tarefas/redistribuir", /\/api\/tarefas\/redistribuir/],
  ["/api/tarefas/${...}/atribuir", /\/api\/tarefas\/\$\{[^}]*\}\/atribuir/],
  ["remover-responsavel", /remover-responsavel/],
  ["texto 'Delegar'", /Delegar/],
  ["SeletorResponsavel", /SeletorResponsavel/],
]

secao("1) Os lugares nomeados não atribuem, não transferem e não devolvem à fila")
for (const arq of LUGARES) {
  const s = semComentarios(ler(arq))
  for (const [nome, re] of PROIBIDOS) ok(`${arq}: sem ${nome}`, !re.test(s))
}

secao("2) Nenhum outro arquivo de UI (fora da Torre e das rotas /api) chama as portas de atribuição")
const demais = [...arquivos("src/components"), ...arquivos("src/app")].filter((f) => !f.includes("/components/torre/") && !f.startsWith("src/app/api/"))
for (const f of demais) {
  const s = semComentarios(ler(f))
  for (const [nome, re] of PROIBIDOS.slice(0, 6)) {
    if (re.test(s)) ok(`${f}: sem ${nome}`, false)
  }
}
ok("varridos todos os arquivos de UI fora da Torre", demais.length > 100)

secao("3) As telas antigas de distribuição foram removidas (não ficam órfãs com a capacidade dentro)")
ok("visao-global.tsx não existe mais", !existsSync("src/components/operacao/visao-global.tsx"))
ok("distribuicao-tarefas.tsx não existe mais", !existsSync("src/components/operacao/distribuicao-tarefas.tsx"))

secao("4) As rotas antigas só redirecionam para a aba Tarefas da Torre")
for (const arq of ["src/app/tarefas/page.tsx", "src/app/operacao/distribuicao/page.tsx"]) {
  const s = semComentarios(ler(arq))
  ok(`${arq}: redirect("/torre?aba=tarefas")`, /redirect\("\/torre\?aba=tarefas"\)/.test(s))
  ok(`${arq}: não renderiza tela própria`, !/<HeaderBarApp|<VisaoGlobal|<DistribuicaoTarefas/.test(s))
}

secao("5) No lugar: responsável somente leitura + link 'Atribuir na Torre'")
const gaveta = ler("src/components/kanban/DocumentoOperationalDrawer.tsx")
ok("gaveta da certidão: link para /torre?aba=tarefas&tarefa=<id>", /href=\{`\/torre\?aba=tarefas&tarefa=\$\{tarefa\.taskId\}`\}/.test(gaveta) && /Atribuir na Torre/.test(gaveta))
ok("gaveta da certidão: o responsável continua à vista", /tarefa\?\.responsavelNome \|\| "Não atribuído"/.test(gaveta))
const painel = ler("src/components/kanban/PainelDaFase.tsx")
ok("Central Operacional (coluna Responsável): link para /torre?aba=tarefas&tarefa=<id>", /href=\{`\/torre\?aba=tarefas&tarefa=\$\{taskId\}`\}/.test(painel) && /Atribuir na Torre/.test(painel))
const exp = ler("src/components/operacao/processo-expandido.tsx")
ok("processo expandido: link para /torre?aba=tarefas&processo=<id>", /href=\{`\/torre\?aba=tarefas&processo=\$\{processo\.processoId\}`\}/.test(exp) && /Atribuir na Torre/.test(exp))
ok("fila (operacao-v3): link para /torre?aba=tarefas", /href="\/torre\?aba=tarefas"[^>]*>Atribuir na Torre/.test(ler("src/components/operacao/operacao-v3.tsx")))
ok("tabela da família: link para /torre?aba=tarefas", /href="\/torre\?aba=tarefas"/.test(ler("src/components/operacao/tabela-familia.tsx")))

secao("6) O que NÃO muda: escolher executor ao iniciar operação")
ok("InitOperationModal continua existindo", existsSync("src/components/kanban/InitOperationModal.tsx"))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou) console.log("Falhas:", falhas.join("; "))
process.exit(falhou ? 1 : 0)
