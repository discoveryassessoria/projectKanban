// scripts/passo2-abre-confirmacao-passo3-recebimento.test.ts
// Defeito (08/10/2026): o passo 2 «Receber confirmação do pedido» abria «Registrar recebimento» (janela do passo 3). Cada passo abre SÓ a janela do próprio passo,
// em todos os pontos de entrada. PURO + varredura do código.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { janelaDaSubtarefa, podeAbrirRegistrarRecebimento } from "../lib/operacional/janela-do-passo"

let n = 0, falhou = 0
const ok = (nome: string, c: boolean, d = "") => { n++; if (c) console.log(`  ✅ ${nome}`); else { falhou++; console.log(`  ❌ ${nome}${d ? ` — ${d}` : ""}`) } }
const ler = (f: string) => readFileSync(f, "utf8")
const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === "node_modules" || f === ".next" ? [] : arquivos(p)) : /\.(ts|tsx)$/.test(f) ? [p] : [] })
const comentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

console.log("\n1) A janela de cada passo (regra única)")
ok("passo 1, 2 e 4 abrem a Central da etapa", ["enviar_requerimento_cartorio", "receber_confirmacao_pedido", "conferir_validar_certidao"].every((k) => janelaDaSubtarefa(k) === "CENTRAL_DA_ETAPA"))
ok("SÓ o passo 3 abre «Registrar recebimento»", janelaDaSubtarefa("receber_certidao") === "REGISTRAR_RECEBIMENTO")
const S = (c: string, d: string, r: string) => ({ enviar_requerimento_cartorio: c, receber_confirmacao_pedido: d, receber_certidao: r })
ok("«Registrar recebimento» só com o passo 2 concluído e o 3 por concluir", podeAbrirRegistrarRecebimento(S("CONCLUIDO", "CONCLUIDO", "DISPONIVEL")) && !podeAbrirRegistrarRecebimento(S("CONCLUIDO", "AGUARDANDO_EXTERNO", "BLOQUEADO")) && !podeAbrirRegistrarRecebimento(S("CONCLUIDO", "CONCLUIDO", "CONCLUIDO")) && !podeAbrirRegistrarRecebimento(null))

console.log("\n2) Pontos de entrada: nenhum abre a janela do passo 3 a partir do passo 2")
const todos = [...arquivos("src"), ...arquivos("lib")]
const usam = todos.filter((f) => { const c = comentarios(ler(f)); return /<RegistrarRecebimentoModal|\/registrar-recebimento`/.test(c) && !/RegistrarRecebimentoModal\.tsx$|registrar-recebimento\/route\.ts$/.test(f) })
ok("a janela «Registrar recebimento» só é aberta pelo WorkflowTab (o componente que todas as telas usam)", JSON.stringify(usam) === JSON.stringify(["src/components/kanban/workflow/WorkflowTab.tsx"]), usam.join(", "))
const wf = comentarios(ler("src/components/kanban/workflow/WorkflowTab.tsx"))
ok("o WorkflowTab decide pela regra única (janelaDaSubtarefa) e nunca pela chave do passo 2", /janelaDaSubtarefa\(s\.key\) === "REGISTRAR_RECEBIMENTO"/.test(wf) && !/SUBTAREFA_CONFIRMACAO[^\n]*setRecebimentoAberto|setRecebimentoAberto[^\n]*SUBTAREFA_CONFIRMACAO/.test(wf))
ok("o passo 2 abre a Central (onOpenCentral) — a tela de confirmação do pedido", /onClick=\{\(\) => onOpenCentral\(s\.key\)\}/.test(wf))
const hospedeiros = todos.filter((f) => /<WorkflowTab\b/.test(comentarios(ler(f))))
ok("o WorkflowTab é montado num lugar só (a gaveta da certidão)", hospedeiros.length === 1 && /DocumentoOperationalDrawer\.tsx$/.test(hospedeiros[0]), hospedeiros.join(", "))
const gavetaUsadaPor = todos.filter((f) => /DocumentoOperationalDrawer/.test(comentarios(ler(f))) && !/DocumentoOperationalDrawer\.tsx$/.test(f)).sort()
console.log(`    (a gaveta é aberta por: ${gavetaUsadaPor.join(", ")})`)
ok("a gaveta só é montada por 3 hospedeiros — Operação (operacao-v3), Torre (TorreTarefas) e Central do processo (ProcessoCentralOperacional, que a árvore e a aba Documentos da pessoa abrem por callback) — e todos chegam ao mesmo componente", JSON.stringify(gavetaUsadaPor) === JSON.stringify(["src/components/kanban/ProcessoCentralOperacional.tsx", "src/components/operacao/operacao-v3.tsx", "src/components/torre/TorreTarefas.tsx"]), gavetaUsadaPor.join(", "))

console.log("\n3) A tela de confirmação do pedido tem os campos do pedido")
const ed = ler("src/components/kanban/workflow/StepEditors.tsx")
ok("o editor do passo 2 tem protocolo, valor (custo), anexos e observações", /numeroProtocolo/.test(ed) && /custoProtocolo/.test(ed) && /Anexos e comprovantes/.test(ed) && /Observações/.test(ed) && /function FormAguardarRetorno/.test(ed))

console.log("\n4) O servidor: o recebimento conclui SÓ o passo 3 e só depois do 2")
const rec = comentarios(ler("src/services/registrar-recebimento.ts"))
ok("conclui apenas a subtarefa do passo 3", /subtarefaKeyEsperada: SUBTAREFA_CERTIDAO_RECEBIDA/.test(rec) && !/subtarefaKeyEsperada: SUBTAREFA_CONFIRMACAO/.test(rec) && !/confirmadoSemProtocolo/.test(rec))
ok("recusa com CONFIRMACAO_PENDENTE se o passo 2 não foi concluído", /CONFIRMACAO_PENDENTE/.test(rec) && /SUBTAREFA_CONFIRMACAO\)\?\.status !== 'CONCLUIDO'/.test(rec))
ok("o vigia 'r' existe", /detectarRegraR/.test(ler("lib/saude/verificacoes/regras-do-marco.ts")))

console.log(`\n${n - falhou}/${n} verificações`)
if (falhou > 0) process.exit(1)
