/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — O TRABALHO DA ETAPA TEM SUPERFÍCIE PRÓPRIA.
 * Rodar: npm run test:guard-executor   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS DUAS REGRAS
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. ETAPA COM EXECUTOR ESPECIALIZADO NÃO É SUBSTITUÍDA POR CONCLUSÃO GENÉRICA.
 *   2. O EXECUTOR NÃO ESCREVE ESTADO OPERACIONAL DIRETO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * "Solicitar certidão" é escolher o canal, reunir as evidências que AQUELE
 * canal exige, anexar o requerimento de inteiro teor, registrar cartório,
 * atendente, custo cobrado e forma de pagamento. Um botão "Concluir etapa" no
 * lugar disso não simplifica a tela: ele pede que alguém declare feito um
 * trabalho que o sistema não viu acontecer, e o pedido nunca chega ao cartório.
 *
 * A tentação é real e barata — a porta canônica de conclusão existe, funciona e
 * cabe num clique. Este guard existe para que a superfície especializada não
 * seja trocada por ela em nome de uniformidade.
 *
 * O outro lado: o executor conhece a operação, não a máquina de estados. Ele
 * persiste solicitação, protocolo, anexo e observação nos domínios canônicos —
 * e a conclusão do passo sai pela porta, nunca por um `update` de status.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue
    const rel = join(dir, nome)
    if (statSync(join(RAIZ, rel)).isDirectory()) arquivos(rel, acc)
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.ts$/.test(nome)) acc.push(rel)
  }
  return acc
}

console.log("GUARD — O EXECUTOR DA ETAPA É ONDE O TRABALHO ACONTECE\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) Existe UM registry, e o binding vem dele")
// ═══════════════════════════════════════════════════════════════════════════
const registry = semComentarios(ler("src/lib/process-stage/step-editor-registry.ts"))
ok("o registry resolve o executor por stepKey publicado",
  /const EDITOR_POR_STEP_KEY: Record<string/.test(registry))
ok("e é TOTAL — toda etapa tem superfície montável",
  /kind: especifico \?\? "padrao"/.test(registry),
  "'sem editor específico' é caso de uso do editor padrão, não erro")

const router = semComentarios(ler("src/components/kanban/workflow/StepEditors.tsx"))
for (const [kind, editor] of [
  ["solicitacao_cartorio", "EditorSolicitarCertidao"],
  ["acompanhamento_retorno", "EditorAguardarRetorno"],
  ["recebimento_documento", "EditorReceberCertidao"],
  ["conferencia_documento", "EditorConferirCertidao"],
  ["validacao_juridica", "EditorValidarCertidao"],
] as const) {
  ok(`${kind} monta ${editor}`, new RegExp(`case "${kind}":[\\s\\S]{0,120}${editor}`).test(router))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("2) A fase NÃO decide o executor")
// ═══════════════════════════════════════════════════════════════════════════
/**
 * `if (fase === "Emissão Documental") abrirModalSolicitar` amarraria a operação
 * a uma fase e deixaria qualquer fase futura sem superfície. O binding é do
 * registry, por stepKey.
 */
// UMA ENTRADA, e é a canônica: o executor é alcançado pela Central Operacional
// do processo. O painel que a Minha Fila montava saiu — era um segundo lugar
// para executar a mesma etapa, e dois lugares divergem.
const CONSUMIDORES = [
  "src/components/kanban/workflow/CentralDaEtapaDrawer.tsx",
]
for (const arq of CONSUMIDORES) {
  const src = semComentarios(ler(arq))
  const nome = arq.split("/").pop()
  ok(`${nome} não escolhe editor por nome de fase`,
    !/faseMacroKey\s*===\s*["'][^"']*emissao|fase\s*===\s*["']Emiss/i.test(src),
    "o binding é do registry, por stepKey")
  ok(`${nome} monta o router compartilhado`, /StepEditorRouter/.test(src))
}

// ═══════════════════════════════════════════════════════════════════════════
secao("3) UMA implementação do executor — duas entradas")
// ═══════════════════════════════════════════════════════════════════════════
const TODOS = [...arquivos("src"), ...arquivos("lib")]
const definemEditor = TODOS.filter((a) => /export function Editor(Solicitar|Aguardar|Receber|Conferir|Validar)/.test(ler(a)))
ok("os editores estão definidos num lugar só", definemEditor.length === 1,
  definemEditor.join(", ") || "nenhum")
const montamRouter = TODOS.filter((a) => /<StepEditorRouter/.test(semComentarios(ler(a))))
ok("existe UM lugar que monta o router — a Central", montamRouter.length === 1,
  montamRouter.map((a) => a.split("/").pop()).join(" + ") || "nenhum")
ok("e a Minha Fila NÃO monta executor",
  !montamRouter.some((a) => a.includes("/operacao/")),
  "priorizar não é executar")

// ═══════════════════════════════════════════════════════════════════════════
secao("4) Conclusão genérica NÃO substitui operação especializada")
// ═══════════════════════════════════════════════════════════════════════════
// A etapa especializada abre o executor pela Central da Etapa — a mesma porta
// de sempre, agora a ÚNICA.
const central = semComentarios(ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx"))
// Ela distingue pelo REGISTRY (kind do editor), que é o binding canônico —
// não por nome de fase nem por texto do passo.
ok("a Central da Etapa distingue etapa especializada de simples",
  /resolveWorkflowStepEditor/.test(central) && /StepEditorKind/.test(central),
  "sem isso, a superfície especializada some atrás de um botão")
ok("o executor recebe stepId e documentoId canônicos",
  /stepId=\{/.test(central) && /documentoId=\{/.test(central),
  "nada de inferir por título ou estado global")

// ═══════════════════════════════════════════════════════════════════════════
secao("5) O executor não escreve estado operacional")
// ═══════════════════════════════════════════════════════════════════════════
const editores = semComentarios(ler("src/components/kanban/workflow/StepEditors.tsx"))
ok("os editores não tocam em Prisma", !/prisma\./.test(editores),
  "são componentes de tela: falam com o servidor por rota")
ok("nem escrevem status de tarefa direto",
  !/statusTarefa\s*:/.test(editores))
ok("a conclusão sai pela rota do passo, que delega ao motor",
  /workflow\/steps\//.test(editores),
  "PATCH do passo → atualizarPassoV2 → transicionarPassoTx")

// ═══════════════════════════════════════════════════════════════════════════
secao("6) A projeção da tarefa declara o executor de cada etapa")
// ═══════════════════════════════════════════════════════════════════════════
const proj = semComentarios(ler("lib/operacional/tarefa-projecoes.ts"))
ok("a projeção resolve o executor pelo registry",
  /resolveWorkflowStepEditor\(\{ stepKey: s\.stepKey/.test(proj))
ok("e leva o documento da etapa junto", /documentoId: s\.documentoId/.test(proj),
  "o executor é documental: sem documento não há o que operar")

// ═══════════════════════════════════════════════════════════════════════════
secao("7) A TAREFA se chama pelo TRABALHO — nunca pela primeira etapa")
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Em produção nasceu uma tarefa chamada "Solicitar certidão" — o nome do
 * primeiro passo de um workflow de cinco. Na fila, ela sugeria que o modelo
 * etapa-é-tarefa tinha voltado, logo depois de ser eliminado.
 */
const nomeador = semComentarios(ler("lib/operacional/nome-da-tarefa.ts"))
ok("existe UMA regra de nomeação", /export function nomeDaTarefa/.test(nomeador))
ok("a etapa só nomeia quando a unidade tem UMA etapa",
  /o\.etapasDaUnidade <= 1/.test(nomeador),
  "com duas ou mais, o nome do primeiro passo é sempre a resposta errada")
ok("a obrigação tem precedência sobre o documento",
  nomeador.indexOf("itemDaNecessidade") < nomeador.indexOf("nomeDoDocumento"))

for (const arq of ["src/services/passo-tarefa.ts", "lib/operacional/reconciliar-tarefas.ts"]) {
  const src = semComentarios(ler(arq))
  const nome = arq.split("/").pop()
  ok(`${nome} usa a regra compartilhada`, /nomeDaTarefa\(/.test(src))
  ok(`${nome} não batiza a tarefa pelo snapshot do passo`,
    !/titulo = String\(snap\?\.titulo/.test(src),
    "era a assinatura do desenho em que a tarefa ERA o passo")
}

// ═══════════════════════════════════════════════════════════════════════════
secao("8) Selecionar dentro do executor NÃO fecha o painel")
// ═══════════════════════════════════════════════════════════════════════════
/**
 * O BUG QUE ESTE BLOCO TRANCA.
 *
 * O executor é montado por `createPortal`. No React, o evento sobe pela árvore
 * de COMPONENTES, não pela do DOM — então um clique dentro do modal chega aos
 * handlers de quem o renderizou, mesmo o modal estando em `document.body`.
 *
 * Com o executor renderizado DENTRO do overlay do painel (que tem
 * `onClick={aoFechar}`), marcar "Digital (PDF eletrônico)" fechava a tarefa
 * inteira por baixo do operador. As etapas 3, 4 e 5 eram inconcluíveis pela
 * tela — e o backend estava certo o tempo todo.
 *
 * A correção é estrutural: o executor é IRMÃO do overlay, não filho.
 */
// A lição vale para quem MONTA o executor hoje: a Central da Etapa. O executor
// não pode ser filho do fundo clicável que fecha a superfície — foi assim que,
// em produção, clicar numa opção obrigatória fechava a etapa inteira.
const centralSrc = ler("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")
const posExecutorCentral = centralSrc.indexOf("<StepEditorRouter")
ok("quem monta o executor hoje é a Central da Etapa", posExecutorCentral > 0)
ok("e ela não fecha a superfície ao clicar dentro do executor",
  !/onClick=\{[^}]*fechar[^}]*\}[\s\S]{0,200}<StepEditorRouter/.test(centralSrc),
  "portal propaga evento pela árvore de COMPONENTES, não pela do DOM")

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(70)}`)
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) {
  console.log("\nFALHAS:")
  for (const f of falhas) console.log(`  • ${f}`)
  console.log("\nO trabalho humano de uma etapa não pode virar um botão de conclusão.")
  process.exit(1)
}
console.log("A tarefa organiza; o workflow sequencia; o executor é onde o trabalho acontece.")
