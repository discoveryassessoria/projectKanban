// scripts/seletores-sem-pessoa-preselecionada.test.ts
// ============================================================================
// REGRA PERMANENTE DO MARCO (07/10/2026): em NENHUM seletor de atribuição vem pessoa pré-selecionada. Todo «Atribuir a» começa em
// «— escolha a pessoa —», e os botões ficam desabilitados até a pessoa ser escolhida (e, no lote, até haver tarefas selecionadas).
//   npx tsx scripts/seletores-sem-pessoa-preselecionada.test.ts
//
// Duas provas: (1) RENDER de verdade da barra de lote (a do processo e a da aba Tarefas são o MESMO componente): nenhuma <option> pessoa vem
// marcada e os botões nascem desabilitados; (2) VARREDURA do código: todo seletor de atribuição usa o rótulo/valor inicial compartilhados
// (`src/lib/ui/atribuicao.ts`), nenhum estado de responsável nasce com pessoa, e todo arquivo que carrega a lista de atribuíveis está na lista de
// seletores auditados — um seletor NOVO que apareça sem estar aqui QUEBRA o teste (e, pelo gate, o build).
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AcoesDeAtribuicaoEmLote, type LoteDeAtribuicao } from "../src/components/torre/lote-atribuicao"
import { ROTULO_ESCOLHA_DA_PESSOA, PESSOA_ESCOLHIDA_INICIAL } from "../src/lib/ui/atribuicao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

secao("1) RENDER — a barra de lote (a mesma no processo e na aba Tarefas)")
const loteVazio: LoteDeAtribuicao = {
  pessoas: [{ id: 1, nome: "Daniela Brait", tarefasAtivas: 3 }, { id: 2, nome: "Marco Rovatti", tarefasAtivas: 0 }],
  pessoaId: null, setPessoaId: () => {}, pessoa: undefined, ocupado: false, executar: async () => false, modal: null,
}
const html0 = renderToStaticMarkup(createElement(AcoesDeAtribuicaoEmLote, { lote: loteVazio, ids: [], comSugeridas: true }))
if (process.env.DEPURAR) console.log(html0)
ok("o seletor começa MARCADO em «— escolha a pessoa —» (valor vazio)", html0.includes(`<option value="" selected="">${ROTULO_ESCOLHA_DA_PESSOA}</option>`))
ok("nenhuma pessoa vem marcada (nenhuma <option> pessoa com selected)", !/<option[^>]*value="\d+"[^>]*selected/.test(html0))
const botoes = [...html0.matchAll(/<button[^>]*>/g)].map((m) => m[0])
ok("sem tarefa selecionada e sem pessoa: TODOS os botões nascem desabilitados (Atribuir, Remover, Atribuir às sugeridas)", botoes.length === 3 && botoes.every((b) => /disabled/.test(b)), `${botoes.length} botões`)
const htmlSoTarefas = renderToStaticMarkup(createElement(AcoesDeAtribuicaoEmLote, { lote: loteVazio, ids: [10, 11], comSugeridas: true }))
const btnAtribuir = [...htmlSoTarefas.matchAll(/<button[^>]*>Atribuir<\/button>/g)][0]?.[0] ?? ""
ok("com tarefas mas SEM pessoa escolhida, «Atribuir» continua desabilitado", /disabled/.test(btnAtribuir))
const btnSug = [...htmlSoTarefas.matchAll(/<button[^>]*>Atribuir às sugeridas<\/button>/g)][0]?.[0] ?? ""
ok("com tarefas selecionadas, «Atribuir às sugeridas» e «Remover responsável» habilitam (não dependem de pessoa)", !/disabled/.test(btnSug))
const htmlPessoa = renderToStaticMarkup(createElement(AcoesDeAtribuicaoEmLote, { lote: { ...loteVazio, pessoaId: 1, pessoa: loteVazio.pessoas[0] }, ids: [10] }))
ok("escolhida a pessoa E havendo tarefa, «Atribuir» habilita", !/disabled/.test([...htmlPessoa.matchAll(/<button[^>]*>Atribuir<\/button>/g)][0]?.[0] ?? "disabled"))
ok("o valor inicial compartilhado é «ninguém»", PESSOA_ESCOLHIDA_INICIAL === "")

secao("2) VARREDURA — todo seletor de atribuição do sistema")
const arquivos: string[] = []
const varrer = (dir: string) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) varrer(p); else if (/\.tsx$/.test(n)) arquivos.push(p) } }
varrer("src")

// Quem carrega a lista de quem pode receber trabalho tem um seletor de atribuição. Cada um precisa estar AUDITADO aqui.
const AUDITADOS: Record<string, string> = {
  "src/components/torre/lote-atribuicao.tsx": "barra de lote (processo e aba Tarefas) — «Atribuir a»",
  "src/components/torre/acoes-do-item.tsx": "«Escolher outro responsável» do Precisa de você",
  "src/components/operacao/distribuicao-tarefas.tsx": "Sucessão em massa (De / Para)",
  "src/components/operacao/kit-operacional.tsx": "SeletorResponsavel — lista para clicar (nada marcado; só mostra quem é o atual)",
  "src/components/kanban/InitOperationModal.tsx": "Responsável inicial da operação",
  "src/components/kanban/DocumentoOperationalDrawer.tsx": "Delegar na gaveta da certidão",
  "src/components/kanban/ProcessoCentralOperacional.tsx": "repassa a lista aos modais (Operação antecipada / Tarefa transversal)",
  "src/components/arvore/inteligencia/criar-tarefa-modal.tsx": "Responsável (opcional) ao criar tarefa — começa em «Sem responsável»",
  "src/components/gerenciamentoComponents/saude/SaudeAuditoria.tsx": "filtro de pessoa da auditoria (não atribui)",
  "src/components/torre/ProcessoComentarios.tsx": "menções (não atribui)",
  "src/app/financeiro/page.tsx": "só um comentário sobre a rota",
}
const carregamLista = arquivos.filter((f) => /\/api\/operacao\/atribuiveis/.test(semComentarios(ler(f))))
const naoAuditados = carregamLista.filter((f) => !(f in AUDITADOS))
ok("todo arquivo que carrega a lista de atribuíveis está auditado (seletor novo precisa entrar aqui)", naoAuditados.length === 0, naoAuditados.join(", "))

const compartilhado = ["src/components/torre/lote-atribuicao.tsx", "src/components/torre/acoes-do-item.tsx", "src/components/operacao/distribuicao-tarefas.tsx", "src/components/kanban/InitOperationModal.tsx", "src/components/kanban/DocumentoOperationalDrawer.tsx"]
for (const f of compartilhado) ok(`${f.split("/").pop()} usa o rótulo compartilhado «— escolha a pessoa —»`, /ROTULO_ESCOLHA_DA_PESSOA/.test(ler(f)) && /ui\/atribuicao/.test(ler(f)))

const PRE_SELECAO = /\bset(Pessoa|Responsavel|ResponsavelId|PessoaId|PessoaIdEstado|Destino|DestinoId|Origem|OrigemId|Sel|Assignee)\([^)]*(\[0\]|\.find\(|funcionarios\b|usuarios\b)/
const comPreSelecao = arquivos.filter((f) => PRE_SELECAO.test(semComentarios(ler(f))) && (f in AUDITADOS || /atribu|respons/i.test(f)))
ok("nenhum estado de pessoa é preenchido a partir da lista (primeiro item, find…)", comPreSelecao.length === 0, comPreSelecao.join(", "))

const ESTADO_COM_PESSOA = /useState(<[^>]*>)?\(\s*(?:\d+|"auto"|funcionarios|usuarios|pessoas|tarefa\??\.responsavelId|user\??\.id|usuario\??\.id)\b/
const estadoComPessoa = Object.keys(AUDITADOS).filter((f) => {
  const cod = semComentarios(ler(f))
  return /useState[^;\n]*(responsavel|Responsavel|pessoaId|PessoaId|destino|origem|sel)\w*/.test(cod) === false ? false : cod.split("\n").some((l) => /(responsavel|pessoaId|destinoId|origemId|\bsel\b)/i.test(l) && ESTADO_COM_PESSOA.test(l))
})
ok("nenhum estado de seletor de atribuição nasce com pessoa (useState de responsável/destino/origem/sel)", estadoComPessoa.length === 0, estadoComPessoa.join(", "))
ok("o hook do lote não tem mais opção de pré-escolher", !/preEscolher/.test(ler("src/components/torre/lote-atribuicao.tsx")) && !/preEscolher/.test(ler("src/components/torre/TorreProcessoPagina.tsx")) && !/preEscolher/.test(ler("src/components/torre/TorreTarefas.tsx")))
ok("o «Delegar» da gaveta começa em «— escolha a pessoa —», não no dono atual", /value=\{PESSOA_ESCOLHIDA_INICIAL\}/.test(ler("src/components/kanban/DocumentoOperationalDrawer.tsx")))
ok("o «Responsável inicial» da operação começa vazio (o Auto é uma escolha, não o padrão)", /useState<string>\(PESSOA_ESCOLHIDA_INICIAL\)/.test(ler("src/components/kanban/InitOperationModal.tsx")))
ok("os botões que gravam dependem da pessoa: Precisa de você (!sel) e Sucessão (!origemId || !destinoId)", /disabled=\{env \|\| !sel\}/.test(ler("src/components/torre/acoes-do-item.tsx")) && /disabled=\{ocupado \|\| !origemId \|\| !destinoId\}/.test(ler("src/components/operacao/distribuicao-tarefas.tsx")))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
