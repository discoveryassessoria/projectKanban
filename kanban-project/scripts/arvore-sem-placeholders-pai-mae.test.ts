// scripts/arvore-sem-placeholders-pai-mae.test.ts
// ============================================================================
// CANVAS DA ÁRVORE SEM OS CARTÕES TRACEJADOS "ADICIONAR PAI" / "ADICIONAR MÃE" (01/10/2026).
//
// Pedido do usuário: "o único lugar de adicionar pai e mãe é dentro do card". O canvas deixa de desenhar os dois
// placeholders (e as arestas tracejadas deles) — para qualquer pessoa. Os de FILHO e CÔNJUGE não mudam. A capacidade de
// adicionar pai/mãe CONTINUA dentro do cartão: painel operacional, página de detalhes e barra lateral.
//
//   node scripts/ci/gate-build.mjs --so arvore-sem-placeholders-pai-mae
// ============================================================================
import { readFileSync } from "node:fs"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
/** Tira comentários de linha e de bloco — o que sobra é CÓDIGO (um comentário que cita "Adicionar Pai" não conta). */
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const canvas = codigo(ler("src/components/arvore/react-flow-tree.tsx"))

secao("1) O canvas não desenha mais pai/mãe ausentes")
ok("nenhum nó `add-pai-…` / `add-mae-…`", !/add-pai-|add-mae-/.test(canvas))
ok("nenhuma aresta tracejada `edge-add-pai` / `edge-add-mae`", !/edge-add-pai|edge-add-mae/.test(canvas))
ok("nenhum rótulo 'Adicionar Pai' / 'Adicionar Mãe' no canvas", !/Adicionar Pai|Adicionar Mãe/.test(canvas))
ok("o cartão tracejado só existe para 'filho' e 'conjuge' (tipo fechado)", /type: 'filho' \| 'conjuge'/.test(canvas) && !/type: 'pai'|type: 'mae'/.test(canvas) && !/'pai' \| 'mae'/.test(canvas))
ok("a árvore continua ligando pai/mãe EXISTENTES (arestas reais)", /edge-pai-\$\{pessoa\.id\}/.test(canvas) && /edge-mae-\$\{pessoa\.id\}/.test(canvas))

secao("2) Filho e cônjuge NÃO mudam")
ok("'Adicionar Filho(a)' e 'Adicionar Cônjuge' seguem no canvas", /Adicionar Filho\(a\)/.test(canvas) && /Adicionar Cônjuge/.test(canvas))
ok("o recuo de foco continua tratando os convites de filho/cônjuge", /\^add-\(\?:filho\|conjuge\)-\(\\d\+\)\$/.test(canvas))

secao("3) A adição de pai/mãe CONTINUA dentro do cartão da pessoa")
const detalhes = codigo(ler("src/components/arvore/pessoa-details-page.tsx"))
const lateral = codigo(ler("src/components/arvore/pessoa-sidebar.tsx"))
const painel = codigo(ler("src/components/kanban/PessoaOperacionalDrawer.tsx"))
ok("página de detalhes: botões de adicionar pai e mãe", /onAddPai\?\.\(pessoa\.id\)/.test(detalhes) && /onAddMae\?\.\(pessoa\.id\)/.test(detalhes))
ok("barra lateral: 'Adicionar Pai' e 'Adicionar Mãe'", /Adicionar Pai/.test(lateral) && /Adicionar Mãe/.test(lateral))
ok("painel operacional: ações 'Pai' e 'Mãe'", /onAddPai\(pessoa\.id\)/.test(painel) && /onAddMae\(pessoa\.id\)/.test(painel))
const view = codigo(ler("src/components/arvore/arvore-genealogica-view.tsx"))
ok("a tela da árvore continua ligando os dois handlers (handleAddPai / handleAddMae) aos cartões", /onAddPai=\{pode\('arvore\.criar'\) \? handleAddPai : undefined\}/.test(view) && /onAddMae=\{pode\('arvore\.criar'\) \? handleAddMae : undefined\}/.test(view))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
