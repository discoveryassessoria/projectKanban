// scripts/torre-atribuir-abre-escolha.test.ts
// GUARDA (06/10/2026): na Torre, «Atribuir» (da linha e do lote) ABRE a escolha do funcionário — nunca atribui sozinho à sugestão (Daniela). Atribuir automaticamente é
// o botão «Distribuir» / «Atribuir a <nome sugerido>» do painel da tarefa, que diz o nome no próprio rótulo.
import { readFileSync } from "node:fs"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const pagina = semComentarios(ler("src/components/torre/TorreProcessoPagina.tsx")), tarefas = semComentarios(ler("src/components/torre/TorreTarefas.tsx"))

console.log("Página do processo (tabela de certidões)")
ok("«Atribuir» da linha e do lote só ABREM a escolha (setEscolha)", /const atribuir = \(tarefaId: number\) => \{ setErroEscolha\(null\); setEscolha\(\[tarefaId\]\) \}/.test(pagina) && /const atribuirVarias = \(ids: number\[\]\) => \{ setErroEscolha\(null\); setEscolha\(ids\) \}/.test(pagina))
ok("a escolha é a lista de funcionários da Operação (SeletorResponsavel)", /<SeletorResponsavel/.test(pagina) && /operacao\/kit-operacional/.test(pagina))
ok("quem escolhe atribui pela porta canônica de comando (atribuir) — não pela sugestão", /\/api\/tarefas\/\$\{id\}\/comando/.test(pagina) && /acao: "atribuir", responsavelId/.test(pagina))
ok("a página não chama mais atribuir-sugerido (só o «Distribuir» automático existe)", !/atribuir-sugerido/.test(pagina))
ok("depois de atribuir, fica no histórico e dá para desfazer", /fica no histórico/.test(pagina) && /desfazerAtribuicao\(\{ tipo: "ATRIBUICAO", tarefaIds: feitas \}\)/.test(pagina))
ok("falha na atribuição mantém a escolha aberta com a mensagem", /setErroEscolha\(primeiraFalha \?\? "Não foi possível atribuir\."\)/.test(pagina))

console.log("\nTorre › aba Tarefas")
ok("«Atribuir» da linha abre a escolha e não atribui à sugestão", /const atribuirRapido = \(l: LinhaTorre\) => \{ setErroEscolha\(null\); setEscolhaLinha\(l\) \}/.test(tarefas) && !/atribuir-sugerido/.test(tarefas) && /<SeletorResponsavel/.test(tarefas))
ok("a escolha atribui (ou transfere) pelo comando canônico", /\/api\/tarefas\/\$\{l\.taskId\}\/comando/.test(tarefas) && /"atribuir" : "transferir"/.test(tarefas))
console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
