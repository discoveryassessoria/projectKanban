/**
 * GUARD ARQUITETURAL OBRIGATÓRIO — A FRONTEIRA EXPLÍCITA.
 * Rodar: npm run test:guard-passo   (obrigatório no CI)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AS DUAS REGRAS
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. EXISTE UMA ÚNICA MÁQUINA DE ESTADOS DE PASSO: task-step-sync.
 *   2. TODA PORTA DE TAREFA QUE ALTERA STEP DELEGA PARA task-step-sync.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE GUARD EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 * A reengenharia operacional de tarefas criou, sem que ninguém decidisse isso,
 * uma SEGUNDA família de transições. Havia duas maneiras de concluir o mesmo
 * passo:
 *
 *   • `task-step-sync.concluirPasso` — validava pela precedência, gravava com
 *     CAS por (status + lockVersion), emitia `WorkflowEvento`, publicava no
 *     `DomainOutbox` e drenava a projeção financeira;
 *   • `tarefa-etapa.concluirEtapa` — fazia `phaseWorkflowStepInstance.updateMany`
 *     direto: sem evento, sem outbox, sem avanço automático de fase.
 *
 * O resultado dependia do BOTÃO usado. Concluir a mesma etapa pela Central
 * fechava a fase; concluir pela porta de tarefa deixava o processo parado com
 * tudo pronto. E o histórico do workflow tinha buracos exatamente nas
 * conclusões feitas pela porta nova.
 *
 * É o mesmo padrão de todas as dívidas deste sistema: quando o MESMO fato tem
 * duas derivações no código, a segunda fica para trás. Este guard não deixa a
 * terceira nascer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE GUARD *NÃO* AFIRMA
 * ═══════════════════════════════════════════════════════════════════════════
 * Ele não diz que ninguém mais escreve na tabela. Escrever `responsavelId`,
 * `prazo` ou `metadata` de um passo não é mover a máquina de estados. O que ele
 * proíbe é escrever `status` — a transição — fora do dono.
 *
 * As exceções são NOMEADAS e CONTADAS abaixo. Uma exceção sem nome é uma
 * dívida que ninguém vê; uma exceção contada só pode diminuir.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

/**
 * Comentário não é código. Sem isto o guard se acusa a si mesmo — a explicação
 * de por que a regra existe cita justamente o padrão que ela proíbe.
 */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function arquivosTs(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue
    const rel = join(dir, nome)
    if (statSync(join(RAIZ, rel)).isDirectory()) arquivosTs(rel, acc)
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.ts$/.test(nome)) acc.push(rel)
  }
  return acc
}

console.log("GUARD — UMA ÚNICA MÁQUINA DE ESTADOS DE PASSO\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1) O dono existe e expõe a transição para quem já está numa transação")
// ═══════════════════════════════════════════════════════════════════════════
const sync = ler("src/services/task-step-sync.ts")
const syncCode = semComentarios(sync)

ok("task-step-sync exporta transicionarPassoTx",
  /export async function transicionarPassoTx\s*\(/.test(syncCode),
  "é por ela que a camada de tarefa compõe a transição do passo no mesmo commit")
ok("task-step-sync exporta reabrirPassoTx",
  /export async function reabrirPassoTx\s*\(/.test(syncCode),
  "a descida CONCLUIDO→DISPONIVEL tem porta própria, em vez de afrouxar podeAplicarPasso")
ok("transicionarPassoTx reaproveita aplicarPasso, não reimplementa",
  /export async function transicionarPassoTx[\s\S]{0,900}?return aplicarPasso\(/.test(syncCode),
  "reimplementar aqui seria criar a terceira máquina dentro do próprio dono")
ok("a tabela de eventos por alvo é única",
  /export const EVENTO_PASSO_POR_ALVO/.test(syncCode),
  "sem ela cada chamador escolhe o tipo do evento e o mesmo alvo vira dois nomes no histórico")
ok("reabrirPassoTx emite PASSO_REABERTO",
  /reabrirPassoTx[\s\S]{0,2000}?tipo:\s*"PASSO_REABERTO"/.test(syncCode),
  "reabrir sem evento apaga do histórico que o trabalho já tinha sido concluído")

// ═══════════════════════════════════════════════════════════════════════════
secao("2) O estado da TAREFA é derivado — o dono do passo não decide por ela")
// ═══════════════════════════════════════════════════════════════════════════
ok("concluirPasso deriva o estado da tarefa em vez de concluir sempre",
  /export async function concluirPasso[\s\S]{0,3000}?statusDerivadoDaTarefa\(/.test(syncCode),
  "concluir 'enviar ao cartório' não encerra o pedido de certidão — encerra uma etapa dele")
ok("concluirPasso NÃO conclui a tarefa incondicionalmente",
  !/export async function concluirPasso[\s\S]{0,3000}?aplicarTarefa\(tx,\s*tarefa\.id,\s*TAREFA_CONCLUIDA_STATUS/.test(syncCode),
  "era o desenho de quando passo e tarefa eram a mesma coisa")
ok("a conta de 'o trabalho acabou' é importada, não reescrita",
  /import\s*\{[^}]*estadoDerivado[^}]*\}\s*from\s*["']@\/lib\/operacional\/tarefa-canonica["']/.test(syncCode),
  "a mesma regra que a Central, o reconciliador e as filas usam")

// ═══════════════════════════════════════════════════════════════════════════
secao("3) A camada de TAREFA delega — sem exceção")
// ═══════════════════════════════════════════════════════════════════════════
const PORTAS_TAREFA = arquivosTs("lib/operacional")
// `status:` numa escrita de passo é a assinatura da transição. Procuramos a
// escrita, não a leitura: `findMany({ select: { status: true } })` é leitura.
const ESCRITA_STATUS_PASSO = /phaseWorkflowStepInstance\s*\.\s*(update|updateMany|upsert|createMany|create)\s*\(/

/**
 * ESCREVE `status` DE PASSO?
 *
 * A pergunta é sobre o ARGUMENTO da chamada, não sobre o arquivo. Delegar um
 * responsável (`data: { responsavelId }`) e vincular um documento
 * (`data: { documentoId }`) mexem na mesma tabela e não são transição — se o
 * guard olhasse o arquivo inteiro, acusaria os dois e a lista de dívida
 * encheria de ruído até ninguém mais lê-la.
 *
 * Por isso os parênteses são balanceados: a resposta vem do trecho exato que
 * foi passado para o `update`.
 */
function sitesDeStatusDePasso(src: string): number {
  const re = /phaseWorkflowStepInstance\s*\.\s*(update|updateMany|upsert|createMany|create)\s*\(/g
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length - 1
    let nivel = 0
    const inicio = i
    for (; i < src.length; i++) {
      if (src[i] === "(") nivel++
      else if (src[i] === ")") { nivel--; if (nivel === 0) break }
    }
    const argumento = src.slice(inicio, i + 1)
    if (/(^|[{,\s])status\s*:/.test(argumento)) n++
  }
  return n
}

const escreveStatusDePasso = (src: string) => sitesDeStatusDePasso(src) > 0

for (const arq of PORTAS_TAREFA) {
  const src = semComentarios(ler(arq))
  const escreve = ESCRITA_STATUS_PASSO.test(src)
  ok(`${relative("lib/operacional", arq)} não escreve status de passo direto`, !escreve,
    escreve ? "use transicionarPassoTx / reabrirPassoTx" : "")
}

const etapa = semComentarios(ler("lib/operacional/tarefa-etapa.ts"))
ok("concluirEtapa delega a conclusão do passo",
  /transicionarPassoTx\(tx,\s*alvo\.id,\s*'CONCLUIDO'/.test(etapa))
ok("concluirEtapa delega a ativação da próxima etapa",
  /ativarProximoPassoTx\(/.test(etapa))
ok("concluirEtapa emite o evento da TAREFA pelo mesmo aplicador da Central",
  /aplicarTarefaTx\(tx,\s*tarefa\.id,\s*status,/.test(etapa),
  "senão a conclusão aparecia no histórico do workflow só quando vinha da Central")
ok("concluirPasso também libera a etapa seguinte",
  /export async function concluirPasso[\s\S]{0,4000}?ativarProximoPassoTx\(/.test(syncCode),
  "concluir pela Central fechava a etapa e o roteiro travava com as seguintes PENDENTES")
ok("a regra de 'qual é a próxima etapa' mora num lugar só",
  /export async function ativarProximoPassoTx\(/.test(syncCode))
ok("concluirEtapa aciona o avanço automático de fase",
  /tentarAvancoAutomatico\(/.test(etapa),
  "sem isto, concluir a última etapa pela porta de tarefa deixava a fase aberta")
ok("concluirEtapa passa pela trava de coerência passo×tarefa",
  /assegurarCoerenciaPassoTarefa\(/.test(etapa))
ok("concluirEtapa drena o outbox de step.concluido",
  /processarOutbox\(\s*\{\s*tipos:\s*\['step\.concluido'\]/.test(etapa),
  "a projeção financeira documental sai no mesmo clique, como na Central")

const ciclo = semComentarios(ler("lib/operacional/tarefa-ciclo.ts"))
ok("reabrirTarefa delega a reabertura do passo", /reabrirPassoTx\(tx,/.test(ciclo))

const comandos = semComentarios(ler("lib/operacional/tarefa-comandos.ts"))
ok("iniciarTarefa move a etapa corrente pela porta canônica",
  /transicionarPassoTx\(tx,\s*step\.id,\s*'EM_ANDAMENTO'/.test(comandos),
  "iniciar a tarefa e deixar o passo parado não registrava que o trabalho começou")

// ═══════════════════════════════════════════════════════════════════════════
secao("4) As rotas antigas são cascas finas — nenhuma segunda conclusão")
// ═══════════════════════════════════════════════════════════════════════════
const ROTAS = [
  "src/app/api/tarefas/[tarefaId]/iniciar/route.ts",
  "src/app/api/tarefas/[tarefaId]/concluir/route.ts",
  "src/app/api/tarefas/[tarefaId]/bloquear/route.ts",
  "src/app/api/tarefas/[tarefaId]/desbloquear/route.ts",
  "src/app/api/tarefas/[tarefaId]/cancelar/route.ts",
  "src/app/api/tarefas/[tarefaId]/comando/route.ts",
]
for (const r of ROTAS) {
  const src = semComentarios(ler(r))
  const nome = r.replace("src/app/api/tarefas/[tarefaId]/", "")
  ok(`${nome} não altera statusTarefa direto`,
    !/prisma\.tarefa\.update|tx\.tarefa\.update/.test(src),
    "a rota valida quem pode e delega — quem move o estado é o motor")
  ok(`${nome} não escreve em passo`,
    !ESCRITA_STATUS_PASSO.test(src))
}
const rotaConcluir = semComentarios(ler("src/app/api/tarefas/[tarefaId]/concluir/route.ts"))
ok("a rota concluir não tem mais o ramo legado sob flag de runtime",
  !/runtimeV2Habilitado/.test(rotaConcluir),
  "o mesmo botão produzia históricos diferentes conforme uma flag")
ok("a rota concluir mantém o avanço automático de fase",
  /tentarAvancoAutomatico\(/.test(rotaConcluir))

// ═══════════════════════════════════════════════════════════════════════════
secao("5) Fora da camada de tarefa: a dívida é NOMEADA e CONTADA")
// ═══════════════════════════════════════════════════════════════════════════
/**
 * QUEM AINDA MOVE `status` DE PASSO POR FORA DO DONO — e QUANTAS VEZES.
 *
 * A contagem é parte da regra. "Este arquivo é exceção" vira licença para
 * crescer: bastaria acrescentar a oitava transição no mesmo arquivo já
 * autorizado para escapar do guard. Com o teto, a dívida só pode encolher —
 * quem consolidar um ponto baixa o número, quem criar um ponto novo quebra o
 * build.
 *
 * MATERIALIZAÇÃO não é transição: criar o passo já no status inicial é o ato
 * que traz o passo à existência, não um movimento dele.
 */
const DIVIDA_CONHECIDA: Record<string, { teto: number; motivo: string }> = {
  "src/services/task-step-sync.ts": {
    teto: 2,
    motivo: "é o DONO da máquina de estados (aplicarPasso + reabrirPassoTx)",
  },
  "src/services/genealogia/materializar-genealogia.ts": {
    teto: 1,
    motivo: "MATERIALIZAÇÃO — cria o passo já no status inicial",
  },
  "src/services/phase-workflow.ts": {
    teto: 1,
    motivo: "MATERIALIZAÇÃO — instancia os passos da fase",
  },
  "src/services/documento-operacao.ts": {
    teto: 7,
    motivo:
      "TERCEIRA FAMÍLIA, anterior à reengenharia: a operação por documento (Central/drawer) " +
      "move o passo com semântica própria — metadata da operação, prazo, responsável, " +
      "reabertura e cancelamento em lote. Consolidá-la exige decidir o que dessa carga " +
      "pertence ao passo e o que pertence à operação; enquanto isso não for decidido, " +
      "fica NOMEADA e com teto, não escondida.",
  },
}

const TODOS = [...arquivosTs("src"), ...arquivosTs("lib")]
const contagem = new Map<string, number>()
for (const arq of TODOS) {
  const n = sitesDeStatusDePasso(semComentarios(ler(arq)))
  if (n > 0) contagem.set(arq.split("\\").join("/"), n)
}
const escritores = [...contagem.keys()]

const novos = escritores.filter((a) => !(a in DIVIDA_CONHECIDA))
ok("nenhum escritor de status de passo fora da lista conhecida", novos.length === 0,
  novos.length ? `NOVOS: ${novos.join(", ")}` : `${escritores.length} arquivos, todos nomeados`)

const estourou = escritores
  .filter((a) => a in DIVIDA_CONHECIDA)
  .filter((a) => contagem.get(a)! > DIVIDA_CONHECIDA[a].teto)
  .map((a) => `${a}: ${contagem.get(a)} > teto ${DIVIDA_CONHECIDA[a].teto}`)
ok("nenhum arquivo da lista ganhou transição nova", estourou.length === 0, estourou.join("; "))

const folgou = escritores
  .filter((a) => a in DIVIDA_CONHECIDA)
  .filter((a) => contagem.get(a)! < DIVIDA_CONHECIDA[a].teto)
  .map((a) => `${a}: ${contagem.get(a)} < teto ${DIVIDA_CONHECIDA[a].teto} — baixe o teto`)
ok("os tetos acompanham a dívida real", folgou.length === 0, folgou.join("; "))

const sumiram = Object.keys(DIVIDA_CONHECIDA).filter((a) => !escritores.includes(a))
ok("a lista de dívida não guarda entradas mortas", sumiram.length === 0,
  sumiram.length ? `já não escrevem — remova da lista: ${sumiram.join(", ")}` : "")

ok("nenhuma rota HTTP escreve status de passo",
  !TODOS.filter((a) => a.includes(join("src", "app", "api"))).some((a) => {
    const s = semComentarios(ler(a))
    return escreveStatusDePasso(s)
  }),
  "a fronteira vale principalmente na borda: é por lá que a UI entra")

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(70)}`)
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) {
  console.log("\nFALHAS:")
  for (const f of falhas) console.log(`  • ${f}`)
  console.log("\nA fronteira foi rompida: alguma porta voltou a mover passo por fora do dono.")
  process.exit(1)
}
console.log("Fronteira íntegra: uma máquina de estados de passo, e as portas de tarefa delegam a ela.")
