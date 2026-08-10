/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — A TAREFA É A UNIDADE OPERACIONAL.
 * Rodar: npm run test:guard-tarefa   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA
 * ═══════════════════════════════════════════════════════════════════════════
 *   UMA obrigação real  =  UMA Tarefa  =  UM workflow interno  =  N etapas
 *
 * ETAPA NÃO É TAREFA. "Preparar pedido", "Enviar ao cartório", "Aguardar
 * cartório", "Receber", "Validar" são passos do MESMO trabalho.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Em 10/08/2026 a auditoria do caso Ademir encontrou: workflow ATIVO, etapa
 * DISPONÍVEL, responsável no documento, equipe declarada — e ZERO tarefas no
 * sistema inteiro. A causa era uma linha:
 *
 *     geraTarefa: false     (materializar-genealogia.ts:201)
 *
 * Uma decisão de negócio escrita dentro de um materializador local, divergindo
 * do cadastro publicado. Toda a camada que depende de Tarefa — fila, prazo,
 * SLA, notificação, cobrança — ficou estruturalmente cega, sem erro e sem
 * aviso.
 *
 * O outro lado do mesmo risco é o desenho antigo voltar: "passo humano → uma
 * tarefa". Sete etapas viravam sete tarefas para a mesma certidão, com sete
 * prazos e sete responsáveis, e concluir "enviar ao cartório" fechava uma
 * tarefa sem que nada tivesse sido obtido.
 */
import { readFileSync } from "node:fs"
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

const schema = ler("prisma/schema.prisma")
const canonica = ler("lib/operacional/tarefa-canonica.ts")
const reconciler = ler("lib/operacional/reconciliar-tarefas.ts")
const genealogia = ler("src/services/genealogia/materializar-genealogia.ts")

console.log("GUARD — A TAREFA É A UNIDADE OPERACIONAL\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) A tarefa é dona do workflow — 1:1 no BANCO, não por convenção")
// ═══════════════════════════════════════════════════════════════════════════
const modeloTarefa = schema.slice(schema.indexOf("model Tarefa {"))
const corpoTarefa = modeloTarefa.slice(0, modeloTarefa.indexOf("\n}"))
ok("workflowInstanceId é @unique", /workflowInstanceId\s+Int\?\s+@unique/.test(corpoTarefa),
  "sem isto, N tarefas podem apontar para a mesma instância e 'etapa vira tarefa' volta")
const modeloInst = schema.slice(schema.indexOf("model PhaseWorkflowInstance {"))
ok("a instância tem UMA tarefa (back-relation singular)",
  /\n\s+tarefa\s+Tarefa\?/.test(modeloInst.slice(0, modeloInst.indexOf("\n}"))))
ok("a etapa corrente NÃO é @unique (é projeção, não identidade)",
  !/workflowStepInstanceId\s+Int\?\s+@unique/.test(corpoTarefa))

// ═══════════════════════════════════════════════════════════════════════════
secao("2) Nenhum materializador decide sozinho se gera tarefa")
// ═══════════════════════════════════════════════════════════════════════════
// O literal proibido. `geraTarefa` continua no modelo (descreve a ETAPA), mas
// ninguém pode fixá-lo no código para decidir se o trabalho entra em fila.
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/\/\/[^\n"']*$/gm, "")
ok("a genealogia não escreve mais geraTarefa: false",
  !/geraTarefa:\s*false/.test(semComentarios(genealogia)))
ok("e converge a tarefa ao final da materialização",
  /await reconciliarTarefas\(\{ processoId \}\)/.test(genealogia))

// ═══════════════════════════════════════════════════════════════════════════
secao("3) Uma porta só cria tarefa operacional")
// ═══════════════════════════════════════════════════════════════════════════
ok("existe o serviço canônico", /export async function materializarTarefaOperacional/.test(canonica))
ok("ele é idempotente pela chave", /findUnique\(\{ where: \{ chaveIdempotencia: chave \}/.test(canonica))
ok("e recusa uma segunda tarefa para a mesma instância",
  /where: \{ workflowInstanceId: nova\.workflowInstanceId \}/.test(canonica))
ok("a identidade não usa o título", !/chaveDaTarefa[\s\S]{0,400}titulo/.test(canonica))
ok("nem a etapa corrente", !/chaveDaTarefa[\s\S]{0,400}step/i.test(canonica))
ok("a criação é auditada", /acao: 'TAREFA_CRIADA'/.test(canonica))

// ═══════════════════════════════════════════════════════════════════════════
secao("4) Concluir etapa intermediária não conclui a tarefa")
// ═══════════════════════════════════════════════════════════════════════════
ok("a conclusão exige TODAS as obrigatórias",
  /obrigatorios\.every\(\(s\) => s\.status === 'CONCLUIDO'\)/.test(canonica))
ok("aguardando terceiro é estado da TAREFA, não fim dela",
  /'AGUARDANDO_TERCEIRO'/.test(canonica) && /há etapa aguardando terceiro/.test(canonica))
ok("bloqueio não encerra a tarefa", /status: 'BLOQUEADA'/.test(canonica))

// ═══════════════════════════════════════════════════════════════════════════
secao("5) Responsabilidade e prazo têm fonte única")
// ═══════════════════════════════════════════════════════════════════════════
ok("a tarefa tem equipe e responsável", /equipeKey/.test(corpoTarefa) && /responsavelId/.test(corpoTarefa))
ok("o prazo é da tarefa", /dataPrazo/.test(corpoTarefa))
// A fonte concorrente que produziu "Daniela numa tela e Equipe Documental na
// outra": o responsável do DOCUMENTO nunca pode virar o responsável da tarefa.
// O casamento é sobre CONSULTAR o documento pedindo o responsável dele — não
// sobre as duas palavras aparecerem no arquivo, que é o que acontece quando
// `documentoId` e `responsavelId` são campos vizinhos da mesma tarefa.
ok("o reconciliador NÃO lê Documento.responsavelId",
  !/prisma\.documento\.find\w+\([\s\S]{0,200}responsavelId/.test(semComentarios(reconciler)))
ok("o responsável vem da etapa ou fica na fila da equipe",
  /vivos\.find\(\(s\) => s\.responsavelId != null\)/.test(reconciler))
ok("o SLA do trabalho é o maior das obrigatórias, não a soma",
  /Math\.max\(\.\.\.dias\)/.test(reconciler))
ok("sem SLA não se inventa prazo", /if \(slaDays == null[\s\S]{0,80}return null/.test(canonica))

// ═══════════════════════════════════════════════════════════════════════════
secao("6) Reconciliação é convergente e não deixa órfã")
// ═══════════════════════════════════════════════════════════════════════════
ok("existe o reconciliador", /export async function reconciliarTarefas/.test(reconciler))
ok("ele tem dry-run", /dryRun/.test(reconciler))
ok("tarefa sem causa sai da fila SEM ser apagada",
  /statusTarefa: 'CANCELADA'/.test(reconciler) && !/tarefa\.delete/.test(reconciler))
ok("e o encerramento é auditado", /acao: 'TAREFA_CANCELADA'/.test(reconciler))
ok("o reconciliador não cria etapa nem avança fase",
  !/phaseWorkflowStepInstance\.(create|update)/.test(reconciler) && !/avancarFase|phase\.entered/.test(reconciler))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  console.log("\nA regra: uma obrigação = uma tarefa = um workflow = N etapas.")
  process.exit(1)
}
console.log("Uma obrigação, uma tarefa, um workflow, N etapas.\n")
