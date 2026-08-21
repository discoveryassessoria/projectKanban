// scripts/baseline-retrocesso-reabertura.test.ts
//
// ══════════════════════════════════════════════════════════════════════════════
// BASELINE CONGELADA — RETROCESSO E REABERTURA
// ══════════════════════════════════════════════════════════════════════════════
//
// Este arquivo NÃO testa funcionalidade: ele CONGELA um comportamento aprovado em
// produção. Cada asserção aqui existe porque a alternativa dela já esteve no código e
// custou caro.
//
// A primeira implementação deste motor perguntava, no modal de movimentação, quais
// tarefas reabrir — e reabria as marcadas junto com o retrocesso. A suíte passava.
// Mesmo assim estava errada, porque provava o MECANISMO e não a SEMÂNTICA: mover a
// fase é um fato sobre a posição do processo, refazer é um fato sobre uma unidade de
// trabalho, e numa Emissão com cinquenta certidões a diferença entre as duas coisas é
// a distância entre reposicionar e destruir quarenta e nove trabalhos corretos.
//
// Por isso as asserções abaixo são ESTRUTURAIS: elas cobram a forma do código, não só
// o resultado de uma execução. Um acoplamento futuro entre retrocesso e reabertura
// falha aqui antes de chegar a um banco.
//
// ─── COMO LER UMA FALHA DESTE ARQUIVO ───────────────────────────────────────
// Uma falha aqui não é "o teste está desatualizado". É uma mudança de comportamento
// num contrato aprovado. Se a mudança for deliberada, ela precisa ser discutida e o
// invariante reescrito com o motivo — não silenciado.
//
//   npm run test:baseline-retrocesso

import { readFileSync, existsSync } from "fs"
import { join } from "path"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

let ok = 0
const falhas: Array<{ inv: string; detalhe: string }> = []
/** `inv` é o número do invariante congelado; ele aparece na falha para dar rastro. */
function inv(numero: string, nome: string, cond: boolean, detalhe = "") {
  if (cond) { ok++; console.log(`  ✅ INV-${numero}  ${nome}`) }
  else { falhas.push({ inv: numero, detalhe: detalhe || nome }); console.log(`  ❌ INV-${numero}  ${nome}${detalhe ? ` — ${detalhe}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// ── OS ARQUIVOS QUE SUSTENTAM O COMPORTAMENTO ───────────────────────────────
//
// Estar nesta lista significa: mexer aqui muda um comportamento aprovado. O arquivo
// sumir também é falha — a baseline não pode ser desfeita por remoção.
const PROTEGIDOS: Array<{ caminho: string; papel: string }> = [
  { caminho: "src/services/retrocesso-de-fase.ts", papel: "retroceder: move a fase, e só isso" },
  { caminho: "src/services/reabertura-de-execucao.ts", papel: "reabrir: por instância operacional" },
  { caminho: "src/services/dependencias-do-passo.ts", papel: "quem depende de quem, pelo cadastro" },
  { caminho: "src/services/execucao-do-passo.ts", papel: "a tentativa: append-only" },
  { caminho: "src/services/operacao-da-etapa.ts", papel: "o que foi preenchido, por execução e através das visitas" },
  { caminho: "src/services/task-step-sync.ts", papel: "a máquina de estados do passo" },
  { caminho: "lib/operacional/tarefa-canonica.ts", papel: "o escopo da unidade operacional" },
  { caminho: "src/app/api/processos/[processoId]/phase/rollback/route.ts", papel: "porta HTTP do retrocesso" },
  { caminho: "src/app/api/workflow-step-instances/[id]/reabrir/route.ts", papel: "porta HTTP da reabertura" },
  { caminho: "src/components/kanban/MovimentarFaseModal.tsx", papel: "tela do retrocesso" },
  { caminho: "src/components/kanban/workflow/ReabrirEtapaModal.tsx", papel: "tela da reabertura" },
  { caminho: "src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx", papel: "cadastro da política de reabertura" },
]

console.log("\n══ BASELINE: RETROCESSO E REABERTURA ══")
secao("(0) OS ARQUIVOS PROTEGIDOS EXISTEM")
for (const p of PROTEGIDOS) {
  inv("00", `${p.caminho} — ${p.papel}`, ler(p.caminho).length > 0, "arquivo protegido ausente")
}

const retro = semComentarios(ler("src/services/retrocesso-de-fase.ts"))
const reab = semComentarios(ler("src/services/reabertura-de-execucao.ts"))
const rotaRetro = semComentarios(ler("src/app/api/processos/[processoId]/phase/rollback/route.ts"))
const rotaReab = semComentarios(ler("src/app/api/workflow-step-instances/[id]/reabrir/route.ts"))
const modalRetro = semComentarios(ler("src/components/kanban/MovimentarFaseModal.tsx"))
const modalReab = semComentarios(ler("src/components/kanban/workflow/ReabrirEtapaModal.tsx"))
const canonica = semComentarios(ler("lib/operacional/tarefa-canonica.ts"))
const sync = semComentarios(ler("src/services/task-step-sync.ts"))
const execucao = semComentarios(ler("src/services/execucao-do-passo.ts"))
const operacao = semComentarios(ler("src/services/operacao-da-etapa.ts"))
const deps = semComentarios(ler("src/services/dependencias-do-passo.ts"))

// ══════════════════════════════════════════════════════════════════════════════
secao("(1) RETROCEDER FASE APENAS REPOSICIONA")
// ══════════════════════════════════════════════════════════════════════════════

inv("01", "retroceder move a fase pela porta canônica", retro.includes("movePhaseManual("))
inv("02", "retroceder NÃO reabre — não chama a porta de reabertura nem o serviço",
  !retro.includes("reabrirPassoTx") && !retro.includes("executarReabertura"),
  "reabrir a partir do retrocesso é o acoplamento que esta baseline existe para impedir")
inv("03", "retroceder NÃO cancela", !/cancelar[A-Z]|status:\s*"CANCELADO"/.test(retro))
inv("04", "retroceder NÃO invalida", !/invalidar[A-Z]|INVALIDATE_/.test(retro))
inv("05", "retroceder NÃO conclui", !/concluirPasso|concluirTarefa/.test(retro))
inv("06", "retroceder NÃO cria tentativa", !/abrirTentativa|garantirTentativa/.test(retro))
inv("07", "retroceder NÃO escreve estado de passo", !/phaseWorkflowStepInstance\.(update|updateMany|create)/.test(retro))
inv("08", "retroceder NÃO escreve tarefa", !/tarefa\.(update|updateMany|create)/.test(retro))

// A ASSINATURA É O CONTRATO. Um parâmetro de seleção aqui seria o convite para o
// acoplamento voltar — e voltaria sem que nenhum teste de comportamento notasse,
// porque o padrão continuaria sendo "não reabrir nada".
inv("09", "o pedido de retrocesso NÃO tem campo de seleção de tarefas",
  !/interface PedidoDeRetrocesso[\s\S]{0,600}?(reabrir|comDependentes|stepInstanceId)/.test(retro),
  "PedidoDeRetrocesso não pode aceitar quais tarefas reabrir")
inv("10", "o plano do retrocesso devolve RETRATO, não lista selecionável",
  retro.includes("RetratoDaFaseDestino") && !/podeReabrir|alcancaSeReaberta/.test(retro))
inv("11", "a rota de retrocesso não lê seleção do corpo", !rotaRetro.includes("reabrir"))

// ══════════════════════════════════════════════════════════════════════════════
secao("(2) REABRIR É COMANDO SEPARADO, E É POR INSTÂNCIA")
// ══════════════════════════════════════════════════════════════════════════════

inv("12", "existe serviço próprio de reabertura", reab.includes("export async function executarReabertura"))
inv("13", "o pedido de reabertura identifica UMA instância",
  /interface PedidoDeReabertura[\s\S]{0,400}?stepInstanceId: number/.test(reab))
inv("14", "reabrir NÃO move fase", !reab.includes("movePhaseManual"))
inv("15", "a rota de reabertura é por instância", rotaReab.includes("params: Promise<{ id: string }>"))
inv("16", "o plano da reabertura carrega a identidade completa",
  reab.includes("pessoaId") && reab.includes("documentoId") && reab.includes("necessidadeId") &&
  reab.includes("stepInstanceId") && reab.includes("stepDefinitionId"),
  "processo + pessoa + documento + necessidade + passo + instância")
inv("17", "e diz quantas outras unidades NÃO serão tocadas", reab.includes("outrasUnidadesNaFase"))
inv("18", "reabrir passa pela porta canônica do motor", reab.includes("reabrirPassoTx("))

// ══════════════════════════════════════════════════════════════════════════════
secao("(3) O ESCOPO DA UNIDADE OPERACIONAL")
// ══════════════════════════════════════════════════════════════════════════════

// A regressão mais perigosa deste motor: com `OR`, dois documentos que atendem à mesma
// necessidade — o que uma nova via produz — caem na mesma unidade, e reabrir um alcança
// o outro. Com cinquenta certidões isso é invisível até acontecer.
inv("19", "a unidade é a CONJUNÇÃO das âncoras",
  canonica.includes("AND: conjuncao") && !/OR: porObrigacao/.test(canonica),
  "com OR, uma certidão alcança outra que compartilhe a necessidade")
inv("20", "a cadeia da reabertura é escopada pela unidade", reab.includes("escopoDaUnidade("))
inv("21", "a propagação do motor também é escopada pela unidade",
  /descendentes\(grafoDaUnidade/.test(sync) && /escopoDaUnidade\(\{[\s\S]{0,240}?documentoId: step\.documentoId/.test(sync))
inv("22", "dependência vem do cadastro, nunca da ordem da lista",
  deps.includes("dependeDeStepKeys") && !/ordem\s*[><]=?\s*\w+\s*\)/.test(deps.replace(/sort\([^)]*\)/g, "")),
  "ordem decide apresentação e desempate, não liberação")

// ══════════════════════════════════════════════════════════════════════════════
secao("(4) A EXECUÇÃO ANTERIOR NÃO É SOBRESCRITA")
// ══════════════════════════════════════════════════════════════════════════════

inv("23", "a tentativa vigente é a NÃO substituída — não sai de ORDER BY",
  execucao.includes("supersededAt: null") && !/orderBy: \{ criadoEm: "desc" \}/.test(execucao))
inv("24", "abrir tentativa cria a nova ANTES de substituir a anterior",
  execucao.indexOf("createMany") < execucao.indexOf("supersededAt: agora"))
inv("25", "substituir preserva o completedAt da anterior",
  !/supersededAt: agora[\s\S]{0,200}completedAt: null/.test(execucao))
inv("26", "registrar nunca reescreve completedAt já gravado",
  execucao.includes("vigente.completedAt == null"))
inv("27", "reabrir arquiva a execução e abre outra",
  /reabrirPassoTx[\s\S]{0,4000}?abrirTentativa\(/.test(sync))
inv("28", "o que foi preenchido é legível através das visitas",
  operacao.includes("historicoDaOperacaoDaUnidade") && operacao.includes("visitaAtual"),
  "sem isto o preenchimento anterior some da Central depois do retrocesso")

// ══════════════════════════════════════════════════════════════════════════════
secao("(5) A ESCOLHA DO ADMINISTRADOR MANDA")
// ══════════════════════════════════════════════════════════════════════════════

inv("29", "existe a opção de alcançar ou não os concluídos", sync.includes("alcancarConcluidos"))
inv("30", "e a reabertura a liga à escolha do administrador",
  reab.includes("alcancarConcluidos: p.comDependentes"))
inv("31", "reabrir respeita a política cadastrada no passo",
  reab.includes("reaberturaPermitida") && reab.includes("reaberturaExigeJustificativa"))
inv("32", "a rota cobra a permissão declarada no cadastro", rotaReab.includes("plano.permissaoExigida"))

// ══════════════════════════════════════════════════════════════════════════════
secao("(6) A INTERFACE NÃO REACOPLA")
// ══════════════════════════════════════════════════════════════════════════════

inv("33", "o modal de retrocesso NÃO lista obrigações", !modalRetro.includes("obrigacoes.map"))
inv("34", "NÃO tem checkbox de tarefa", !/setSelecionadas|selecionadas\[/.test(modalRetro))
inv("35", "NÃO oferece cadeia dependente", !modalRetro.includes("cadeia dependente"))
inv("36", "NÃO envia seleção ao servidor", !/reabrir[,:]/.test(modalRetro))
inv("37", "diz que nada será reaberto", modalRetro.includes("Nenhuma tarefa foi reaberta"))
inv("38", "o modal de reabertura mostra pessoa, documento e passo",
  modalReab.includes("Pessoa") && modalReab.includes("Documento") && modalReab.includes("Passo"))
inv("39", "mostra a execução anterior com data e autor",
  modalReab.includes("Execução anterior") && modalReab.includes("executadoPorNome"))
inv("40", "oferece as duas estratégias como escolha explícita",
  modalReab.includes("Reabrir somente esta tarefa") && modalReab.includes("Reabrir esta tarefa e as que dependem dela"))
inv("41", "mostra o preview exato do que será criado", modalReab.includes("Será criada nova execução para"))
inv("42", "e garante o isolamento por escrito", modalReab.includes("Nenhuma outra unidade será alterada"))

// ══════════════════════════════════════════════════════════════════════════════
secao("(7) AUDITORIA: DOIS FATOS, DOIS EVENTOS")
// ══════════════════════════════════════════════════════════════════════════════

inv("43", "o retrocesso emite PROCESS_PHASE_ROLLED_BACK", retro.includes("PROCESS_PHASE_ROLLED_BACK"))
inv("44", "e diz que nada foi reaberto", retro.includes("Nenhuma tarefa foi reaberta"))
inv("45", "a reabertura emite STEP_EXECUTION_REOPENED", reab.includes("STEP_EXECUTION_REOPENED"))
inv("46", "os dois eventos não se fundem",
  !retro.includes("STEP_EXECUTION_REOPENED") && !reab.includes("PROCESS_PHASE_ROLLED_BACK"),
  "12:00 processo retrocedido; 12:08 tarefa reaberta — fatos distintos")

// ══════════════════════════════════════════════════════════════════════════════
secao("(8) A SUÍTE DE REGRESSÃO É OBRIGATÓRIA")
// ══════════════════════════════════════════════════════════════════════════════

const pkg = JSON.parse(ler("package.json")) as { scripts: Record<string, string> }
const OBRIGATORIOS = [
  "test:retrocesso", "test:isolamento", "test:execucao-passo",
  "test:cadastro-canonico", "test:e2e-master", "test:concorrencia",
]
for (const s of OBRIGATORIOS) {
  inv("47", `o script ${s} existe`, typeof pkg.scripts[s] === "string", "a regressão não pode depender de memória")
}
const arquivosDeTeste = [
  "scripts/retrocesso-de-fase.test.ts",
  "scripts/isolamento-50-certidoes.test.ts",
]
for (const f of arquivosDeTeste) {
  inv("48", `${f} existe`, ler(f).length > 0)
}
// O teste de isolamento precisa continuar sendo em ESCALA: com uma certidão, qualquer
// implementação passa, e o teste deixaria de proteger justamente o que importa.
const isolamento = ler("scripts/isolamento-50-certidoes.test.ts")
inv("49", "o teste de isolamento roda com 10 pessoas e 50 certidões",
  /const PESSOAS = 10/.test(isolamento) && /const DOCS_POR_PESSOA = 5/.test(isolamento),
  "reduzir a massa aqui é desativar o teste sem apagá-lo")
inv("50", "e compara as instâncias das outras unidades byte a byte",
  isolamento.includes("estão IDÊNTICAS") && isolamento.includes("JSON.stringify(outrasInstancias) === JSON.stringify(outrasAntes)"))

console.log(`\n${falhas.length === 0 ? "✅ BASELINE ÍNTEGRA" : "❌ BASELINE VIOLADA"}: ${ok} invariantes, ${falhas.length} violação(ões)`)
if (falhas.length) {
  console.log("\nUma violação aqui é mudança de comportamento num contrato aprovado em produção.")
  console.log("Se for deliberada, reescreva o invariante com o motivo — não o silencie.\n")
  for (const f of falhas) console.log(`  · INV-${f.inv}: ${f.detalhe}`)
  process.exit(1)
}
