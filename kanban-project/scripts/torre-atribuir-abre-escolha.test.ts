// scripts/torre-atribuir-abre-escolha.test.ts
// GUARDA (06/10/2026): na Torre, «Atribuir» (da linha) ABRE a escolha do funcionário — nunca atribui sozinho à sugestão (Daniela) — E a escolha passa pela
// confirmação explícita no servidor (HTTP 428 → `confirmado: true` + `assinatura`). Só a aba Tarefas atribui (L4). Atribuir automaticamente é
// o botão «Distribuir» / «Atribuir a <nome sugerido>» do painel da tarefa, que diz o nome no próprio rótulo.
import { readFileSync } from "node:fs"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const pagina = semComentarios(ler("src/components/torre/TorreProcessoPagina.tsx")), tarefas = semComentarios(ler("src/components/torre/TorreTarefas.tsx"))
const rotaUma = semComentarios(ler("src/app/api/torre/tarefas/[tarefaId]/atribuir/route.ts")), rotaLote = semComentarios(ler("src/app/api/torre/tarefas/lote/route.ts"))
const confirmar = semComentarios(ler("src/components/torre/ConfirmarAtribuicao.tsx")), painel = semComentarios(ler("src/components/torre/PainelTorreTarefa.tsx"))

console.log("Página do processo (L1/L4: a tabela de tarefas É a da aba Tarefas — a página não atribui por conta própria)")
ok("a página embute TorreTarefas e não tem escolha/atribuição própria (nada de setEscolha, SeletorResponsavel, comando de atribuir)", /<TorreTarefas/.test(pagina) && !/setEscolha|SeletorResponsavel|acao: "atribuir"/.test(pagina))
ok("a página não chama atribuir-sugerido (só o «Distribuir», com confirmação)", !/api\/torre\/tarefas\/[^`]*atribuir-sugerido/.test(pagina) && /useConfirmarAtribuicao/.test(pagina) && /postarComConfirmacao[^(]*<[^>]*>\(`\/api\/torre\/processos\/\$\{processoId\}\/distribuir`\)/.test(pagina))

console.log("\nTorre › aba Tarefas (o ÚNICO lugar que atribui)")
ok("«Atribuir» da linha só ABRE a escolha (setEscolhaLinha) — não atribui à sugestão", /const atribuirRapido = \(l: LinhaTorre\) => \{ setErroEscolha\(null\); setEscolhaLinha\(l\) \}/.test(tarefas) && /case "Atribuir": void atribuirRapido\(l\)/.test(tarefas) && !/atribuir-sugerido/.test(tarefas))
ok("a escolha é a lista de funcionários da Operação (SeletorResponsavel), que só chama atribuirA ao escolher", /<SeletorResponsavel/.test(tarefas) && /aoEscolher=\{\(id\) => void atribuirA\(escolhaLinha, id\)\}/.test(tarefas) && /operacao\/kit-operacional/.test(tarefas))
ok("quem escolhe atribui pela porta da Torre (/api/torre/tarefas/[id]/atribuir) PASSANDO pela confirmação (postarComConfirmacao, 428)", /postarComConfirmacao<[^>]*>\(`\/api\/torre\/tarefas\/\$\{l\.taskId\}\/atribuir`, \{ responsavelId \}\)/.test(tarefas) && /useConfirmarAtribuicao\(\)/.test(tarefas) && /\{modalConfirmacao\}/.test(tarefas))
ok("o lote ATRIBUIR e REMOVER_RESPONSAVEL também passam pela confirmação (postarComConfirmacao em /api/torre/tarefas/lote); as demais ações seguem direto", /acao === "REMOVER_RESPONSAVEL" \|\| acao === "ATRIBUIR"\s*\? await postarComConfirmacao<RespLote>\("\/api\/torre\/tarefas\/lote", \{ acao, tarefaIds: selIds, \.\.\.extra \}\)\s*: await api<RespLote>/.test(tarefas) && /lote\("ATRIBUIR", \{ responsavelId: pessoaId \}\)/.test(tarefas))
ok("o lote atribui à pessoa ESCOLHIDA no seletor «Atribuir a» — nunca a uma sugestão", /aria-label="Atribuir a"/.test(tarefas) && !/atribuir-sugerido/.test(tarefas))
ok("depois de atribuir, fica no histórico e dá para desfazer", /Responsável atribuído · fica no histórico", \{ tipo: "ATRIBUICAO", tarefaIds: \[l\.taskId\] \}/.test(tarefas))
ok("falha na atribuição (inclusive «Ação não confirmada») mantém a escolha aberta com a mensagem", /if \(!r\.ok\) \{ setErroEscolha\(erroDe\(r\.data\)\); return \}\s*setEscolhaLinha\(null\)/.test(tarefas))

console.log("\nConfirmação (HTTP 428): 1ª chamada devolve a prévia, a 2ª reenvia `confirmado: true` + `assinatura`")
ok("servidor: a rota da tarefa e a do lote devolvem pedirConfirmacao(previa) enquanto não houver `confirmado` + assinatura", /if \(!confirmado \|\| assinatura == null\) return pedirConfirmacao\(previa\)/.test(rotaUma) && (rotaLote.match(/if \(!confirmado \|\| assinatura == null\) return pedirConfirmacao\(previa\)/g) ?? []).length === 2)
ok("cliente: status 428 → modal «Atribuir X a Y?» → reenvia com confirmado: true + a assinatura da prévia; «Cancelar» não grava nada", /r1\.status !== 428/.test(confirmar) && /confirmado: true, assinatura: previa\.assinatura/.test(confirmar) && /Ação não confirmada — nada foi gravado\./.test(confirmar) && /pend\.resolver\(false\)/.test(confirmar))
ok("o painel da tarefa («Atribuir a <sugerido>») também passa pela confirmação — sugestão nunca atribui sozinha", /useConfirmarAtribuicao\(\)/.test(painel) && /postar<[^>]*>\(`\/api\/torre\/tarefas\/\$\{linha\.taskId\}\/atribuir-sugerido`\)/.test(painel))
console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
