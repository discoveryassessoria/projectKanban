// scripts/arvore-layout-congelado.test.ts
// ============================================================================
// O LAYOUT DA ÁRVORE GENEALÓGICA ESTÁ CONGELADO.
//
// Por que este guarda existe: em 30/07 a Árvore foi RECONSTRUÍDA por uma sessão
// paralela (motor de layout próprio, sem reactflow), entrou em produção e ficou
// ~17h no ar até o usuário ver e REPROVAR. Nada quebrou — lint, tsc, build e
// testes passavam. O layout mudou por completo sem que um único sinal automático
// disparasse.
//
// A decisão do usuário é explícita e permanente: o visual restaurado é o
// DEFINITIVO. Este arquivo transforma essa decisão em falha de build.
//
// O que ele trava: a IDENTIDADE ESTRUTURAL do desenho — quais componentes
// existem, qual motor de layout é usado, e os elementos que compõem o card e o
// canvas. Não trava cor exata nem pixel: trava o que, se mudar, faz o usuário
// olhar a tela e dizer "isso não é a minha Árvore".
//
// O que ele NÃO impede: melhorias de dados e comportamento (dedup, permissões,
// validação de parentesco, desempenho, persistência de posições). É justamente a
// fronteira acordada — melhorar por dentro, sem mexer no desenho.
//
// Se algum dia a decisão mudar, é o USUÁRIO que muda: apagar este guarda é uma
// escolha consciente, não um efeito colateral de outra tarefa.
// ============================================================================

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const RAIZ = join(process.cwd(), "src", "components", "arvore")
let falhas = 0
let passos = 0

function ok(desc: string) {
  passos++
  console.log(`  ✅ ${desc}`)
}
function falhar(desc: string, detalhe: string) {
  falhas++
  console.log(`  ❌ ${desc}`)
  console.log(`     ${detalhe}`)
}
function conteudo(arquivo: string): string {
  const caminho = join(RAIZ, arquivo)
  return existsSync(caminho) ? readFileSync(caminho, "utf-8") : ""
}

console.log("\n══ ÁRVORE GENEALÓGICA — LAYOUT CONGELADO ══\n")

// ── 1) Os componentes do desenho aprovado existem ───────────────────────────
console.log("1) componentes do layout aprovado")
const OBRIGATORIOS = [
  "arvore-genealogica-view.tsx",
  "react-flow-tree.tsx",
  "pessoa-card.tsx",
  "pessoa-sidebar.tsx",
  "pessoa-icon.tsx",
  "couple-card.tsx",
  "person-card-simple.tsx",
]
for (const arquivo of OBRIGATORIOS) {
  if (existsSync(join(RAIZ, arquivo))) ok(arquivo)
  else falhar(`${arquivo} AUSENTE`, "faz parte do layout aprovado — restaurar de 51d790c")
}

// ── 2) O motor de layout é o reactflow ──────────────────────────────────────
// Foi exatamente isto que a reconstrução trocou: um motor próprio no lugar do
// reactflow. Trocar o motor é trocar o desenho, por mais fiel que se tente ser.
console.log("\n2) motor de layout")
const arvore = conteudo("react-flow-tree.tsx")
if (/from ["']reactflow["']/.test(arvore)) ok("react-flow-tree usa reactflow")
else falhar("reactflow não é mais o motor", "a reconstrução reprovada substituiu o motor de layout")

const MOTOR_PROIBIDO = join(RAIZ, "motor")
if (!existsSync(MOTOR_PROIBIDO)) ok("a pasta motor/ (layout reconstruído) não voltou")
else falhar("pasta motor/ presente", "é o layout REPROVADO — ver tag arvore-reconstruida-796c746")

// ── 3) Os elementos do card do requerente ───────────────────────────────────
// O card aprovado tem: nome, o selo de papel (ex.: "Requerente maior de idade"),
// a data com estrela, e a borda colorida à esquerda. Some qualquer um e o card
// deixa de ser o que foi aprovado.
// O nó desenhado no canvas vive em react-flow-tree.tsx (é ele que define o node
// do reactflow); pessoa-card.tsx é o card usado fora do canvas. Os dois entram.
console.log("\n3) elementos do card")
const no = conteudo("react-flow-tree.tsx")
const card = conteudo("pessoa-card.tsx")
const ELEMENTOS: [string, RegExp, string][] = [
  ["Handle de conexão (reactflow)", /<Handle/, no],
  ["selo de papel do requerente", /Requerente/, no],
  ["conector tracejado", /dashed|strokeDasharray/, no],
  ["borda lateral colorida no card", /border-l|borderLeft/, card],
]
for (const [desc, padrao, alvo] of ELEMENTOS) {
  if (padrao.test(alvo)) ok(desc)
  else falhar(`layout sem ${desc}`, "o desenho aprovado perdeu um elemento")
}

// ── 4) Canvas claro ─────────────────────────────────────────────────────────
// Regra permanente do usuário: o canvas é CLARO. O visual escuro já foi
// reprovado uma vez.
console.log("\n4) superfície do canvas")
const view = conteudo("arvore-genealogica-view.tsx")
const fundoEscuro = /background:\s*["'`]#(0|1|2)[0-9a-f]{5}/i.test(view)
if (!fundoEscuro) ok("canvas não voltou a ser escuro")
else falhar("canvas escuro", "o visual escuro foi REPROVADO — o canvas é claro")

// ── 5) As dependências que o layout exige ───────────────────────────────────
// A reconstrução removeu reactflow e dagre do package.json. Sem elas o layout
// aprovado nem monta — e o build só reclamaria bem mais adiante.
console.log("\n5) dependências do layout")
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
for (const dep of ["reactflow", "dagre"]) {
  if (pkg.dependencies?.[dep]) ok(`${dep} declarada`)
  else falhar(`${dep} ausente do package.json`, "o layout aprovado depende dela")
}

// ── veredito ────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60))
if (falhas === 0) {
  console.log(`${passos} verificações · layout da Árvore ÍNTEGRO ✅\n`)
  process.exit(0)
}
console.log(`${passos - falhas} passaram, ${falhas} falharam`)
console.log(`
O LAYOUT DA ÁRVORE FOI ALTERADO.

Ele está congelado por decisão explícita do usuário (30/07): a versão atual é a
DEFINITIVA. Se você chegou aqui por causa de outra tarefa, a mudança no layout é
efeito colateral — desfaça. Se é uma mudança pedida, é o usuário quem libera.

A versão reconstruída e reprovada está em: tag arvore-reconstruida-796c746
`)
process.exit(1)
