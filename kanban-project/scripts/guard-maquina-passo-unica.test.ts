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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
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
// JANELA DE CARACTERES NÃO É ESTRUTURA.
//
// Estas asserções mediam "existe X nos primeiros N caracteres depois do nome da
// função", e reprovaram duas vezes por a função ter crescido — sem que nada do que
// elas protegem tivesse mudado. O guard passa a ler o CORPO da função: cresça o
// quanto crescer, o que se cobra é que estas coisas estejam nele.
function corpoDaFuncao(codigo: string, nome: string): string {
  const i = codigo.indexOf(`export async function ${nome}`)
  if (i < 0) return ""
  const j = codigo.indexOf("\nexport ", i + 1)
  return codigo.slice(i, j < 0 ? codigo.length : j)
}
const corpoReabrir = corpoDaFuncao(syncCode, "reabrirPassoTx")
ok("reabrirPassoTx existe e é legível como uma função inteira", corpoReabrir.length > 0)
ok("reabrirPassoTx emite PASSO_REABERTO", /"PASSO_REABERTO"/.test(corpoReabrir),
  "reabrir sem evento apaga do histórico que o trabalho já tinha sido concluído")
ok("reabrirPassoTx abre uma TENTATIVA nova em vez de desconcluir a anterior", /abrirTentativa\(/.test(corpoReabrir),
  "sem tentativa nova, `completedAt = null` apaga a execução que aconteceu")
ok("reabrir alcança QUEM DEPENDE do passo reaberto", /descendentes\(grafoDaUnidade/.test(corpoReabrir),
  "sem propagação, um sucessor continua em execução dependendo do que voltou a estar aberto")
ok("reabrir respeita a dependência: não se reabre o sucessor sozinho", /DEPENDENCIA_PENDENTE/.test(corpoReabrir),
  "começar pelo fim é a forma exata do estado impossível que apareceu no Abellan")

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
/** Devolve o trecho entre parênteses balanceados a partir de `abre`. */
function argumentoBalanceado(src: string, abre: number): string {
  let nivel = 0
  let i = abre
  for (; i < src.length; i++) {
    if (src[i] === "(") nivel++
    else if (src[i] === ")") { nivel--; if (nivel === 0) break }
  }
  return src.slice(abre, i + 1)
}

/** Idem para chaves — usado para ler o corpo de um objeto declarado à parte. */
function objetoBalanceado(src: string, abre: number): string {
  let nivel = 0
  let i = abre
  for (; i < src.length; i++) {
    if (src[i] === "{") nivel++
    else if (src[i] === "}") { nivel--; if (nivel === 0) break }
  }
  return src.slice(abre, i + 1)
}

/**
 * O `data` PODE ESTAR NUMA VARIÁVEL — e estava.
 *
 * A versão anterior deste guard só olhava o texto passado para o `update`. Em
 * `documento-operacao.ts` o objeto era montado antes (`const data: ... = { status: novo, ... }`)
 * e passado por referência: a transição MAIS IMPORTANTE do sistema — a que a
 * Central usa para concluir etapa — ficava invisível para o guard que existe
 * justamente para encontrá-la. Um guard que não enxerga a indireção mais óbvia
 * do TypeScript dá uma garantia falsa, que é pior do que não dar nenhuma.
 *
 * Por isso, quando o argumento referencia um identificador, este resolvedor vai
 * atrás da declaração dele e lê o objeto literal.
 */
function escreveCampoEm(argumento: string, src: string, campos: RegExp): boolean {
  // SÓ O BLOCO `data:` CONTA. `where: { workflowStepInstanceId: { in: ids } }`
  // é filtro de leitura — acusar a delegação de responsável como se fosse
  // mudança de estado encheria a lista de ruído e mataria a confiança no guard.
  for (const m of argumento.matchAll(/\bdata\s*:\s*\{/g)) {
    const bloco = objetoBalanceado(argumento, argumento.indexOf("{", m.index + m[0].length - 1))
    if (campos.test(bloco)) return true
  }
  // `create:` / `update:` do upsert seguem a mesma lógica.
  for (const m of argumento.matchAll(/\b(?:create|update)\s*:\s*\{/g)) {
    const bloco = objetoBalanceado(argumento, argumento.indexOf("{", m.index + m[0].length - 1))
    if (campos.test(bloco)) return true
  }

  // `data: algumaVar`  |  `data,` (atalho de propriedade)  |  `data }`
  const nomes = new Set<string>()
  for (const m of argumento.matchAll(/\bdata\s*:\s*([A-Za-z_$][\w$]*)/g)) nomes.add(m[1])
  if (/\bdata\s*[,}]/.test(argumento)) nomes.add("data")

  for (const nome of nomes) {
    const decl = new RegExp(`(?:const|let|var)\\s+${nome}\\s*(?::[^=]+)?=\\s*\\{`, "g")
    let d: RegExpExecArray | null
    while ((d = decl.exec(src)) !== null) {
      const corpo = objetoBalanceado(src, src.indexOf("{", d.index + d[0].length - 1))
      if (campos.test(corpo)) return true
    }
  }
  return false
}

const CAMPO_STATUS = /(^|[{,\s])status\s*:/

function sitesDeStatusDePasso(src: string): number {
  const re = /phaseWorkflowStepInstance\s*\.\s*(update|updateMany|upsert|createMany|create)\s*\(/g
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(src)) !== null) {
    const argumento = argumentoBalanceado(src, m.index + m[0].length - 1)
    if (escreveCampoEm(argumento, src, CAMPO_STATUS)) n++
  }
  return n
}

const escreveStatusDePasso = (src: string) => sitesDeStatusDePasso(src) > 0

/**
 * MUDANÇA OPERACIONAL DA TAREFA — a outra metade da fronteira.
 *
 * Vigiar só o passo deixou passar `/api/tarefas/[id]/cobranca`, que concluía a
 * tarefa (e a tarefa-pai) com `prisma.tarefa.update` direto, sem tocar no passo,
 * sem evento e sem avanço de fase. Não era transição de passo, então o guard
 * não via — e era, ainda assim, uma segunda família de comandos de tarefa.
 *
 * Estes são os campos que definem o ESTADO OPERACIONAL do trabalho. Escrever
 * `observacoes`, `prioridade` ou `titulo` não é mover a tarefa pelo motor.
 */
const CAMPO_OPERACIONAL_TAREFA = /(^|[{,\s])(statusTarefa|concluida|dataConclusao|workflowStepInstanceId)\s*:/

function sitesOperacionaisDeTarefa(src: string): number {
  const re = /\b(?:prisma|tx|db)\s*\.\s*tarefa\s*\.\s*(update|updateMany|upsert)\s*\(/g
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(src)) !== null) {
    const argumento = argumentoBalanceado(src, m.index + m[0].length - 1)
    if (escreveCampoEm(argumento, src, CAMPO_OPERACIONAL_TAREFA)) n++
  }
  return n
}

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
ok("concluirEtapa aciona o avanço automático de fase — escopado à fase ATUAL",
  /tentarAvancoAutomatico(SeFaseAtual)?\(/.test(etapa),
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
ok("a rota concluir mantém o avanço automático de fase — escopado à fase ATUAL",
  /tentarAvancoAutomatico(SeFaseAtual)?\(/.test(rotaConcluir))

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
    // Três sites, todos DENTRO da máquina — que é o ponto: o guard existe para
    // impedir uma terceira família FORA daqui, não para congelar o dono.
    //   1. `aplicarPasso`      — a transição normal, com precedência e CAS
    //   2. `reabrirPassoTx`    — a descida de retrabalho do passo reaberto
    //   3. a CASCATA da reabertura — a descida do descendente JÁ CONCLUÍDO. Ela não
    //      pode passar por `aplicarPasso` porque a precedência recusa
    //      CONCLUIDO → BLOQUEADO, e recusa com razão: essa descida só é legítima
    //      quando alguém reabre. Aqui é o mesmo ato, propagado — a tentativa é
    //      arquivada antes, exatamente como na reabertura direta.
    teto: 3,
    motivo: "é o DONO da máquina de estados (aplicarPasso + reabrirPassoTx + cascata da reabertura)",
  },
  "src/services/genealogia/materializar-genealogia.ts": {
    teto: 1,
    motivo: "MATERIALIZAÇÃO — cria o passo já no status inicial",
  },
  "src/services/phase-workflow.ts": {
    teto: 1,
    motivo: "MATERIALIZAÇÃO — instancia os passos da fase",
  },
  "prisma/backfill-cp4-workflow.ts": {
    teto: 2,
    motivo:
      "BACKFILL de uma vez só (CP-4): materializa os passos por documento e superseda os " +
      "órfãos sem documento. Não é caminho de runtime — roda por comando, com guarda de escrita.",
  },
  "src/services/documento-operacao.ts": {
    teto: 1,
    motivo:
      "MATERIALIZAÇÃO — `iniciarOperacaoDocumentoV2` cria os passos do documento já no " +
      "status inicial (upsert com `update: {}`, nunca move um passo existente). As 6 " +
      "transições que este arquivo tinha foram migradas para o motor: a terceira família " +
      "deixou de existir.",
  },
}

// `prisma/` entra na varredura: backfills escrevem status de passo e ficavam
// fora do alcance do guard — invisível não é o mesmo que inexistente.
const TODOS = [...arquivosTs("src"), ...arquivosTs("lib"), ...arquivosTs("prisma")]
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

// ═══════════════════════════════════════════════════════════════════════════
secao("6) A TAREFA também tem uma família só de comandos")
// ═══════════════════════════════════════════════════════════════════════════
/**
 * QUEM PODE MOVER O ESTADO OPERACIONAL DA TAREFA.
 *
 * A regra é a mesma do passo, do outro lado: a tarefa se move pelas portas
 * canônicas (`lib/operacional/*`), pelo dono da máquina de estados
 * (`task-step-sync`) ou pela projeção oficial do passo — e por mais ninguém.
 *
 * Materialização entra na lista porque criar a tarefa não é movê-la.
 */
const DONOS_DA_TAREFA: Record<string, string> = {
  "src/services/task-step-sync.ts": "dono da máquina de estados; aplica a tarefa com CAS e evento",
  "src/services/passo-tarefa-projecao.ts": "projeção OFICIAL passo → tarefa, pelo mapeamento único",
  "lib/operacional/tarefa-canonica.ts": "materializa a tarefa e sincroniza o estado derivado",
  "lib/operacional/tarefa-comandos.ts": "portas: atribuir, transferir, iniciar",
  "lib/operacional/tarefa-ciclo.ts": "portas: manual, reabrir, bloquear, esperar, cancelar, prazo, prioridade",
  "lib/operacional/tarefa-etapa.ts": "porta: concluir etapa — escreve o ponteiro e as datas do trabalho",
  "lib/operacional/reconciliar-tarefas.ts": "reconciliação causal contra o workflow publicado",
}

const escritoresTarefa: string[] = []
for (const arq of TODOS) {
  if (sitesOperacionaisDeTarefa(semComentarios(ler(arq))) > 0) escritoresTarefa.push(arq.split("\\").join("/"))
}
/**
 * A ÁRVORE DE SUBTAREFAS NÃO EXISTE MAIS — nem como coluna.
 *
 * Houve um desenho anterior em que o trabalho se desdobrava em tarefa-pai →
 * tarefa-filha (`tarefaPaiId`, com tipos COBRANCA e CONFERENCIA e propagação de
 * conclusão para cima). A arquitetura do motor é outra, e é uma só:
 *
 *     TAREFA → WORKFLOW → PASSOS
 *
 * O desdobramento acontece nos PASSOS publicados do workflow. Uma tarefa nunca
 * é subordinada a outra tarefa. A coluna, o índice e a FK auto-referente foram
 * removidos do schema e de produção pela migration
 * `20260812140000_remover_arvore_subtarefas` — com zero linhas afetadas.
 *
 * O que este guard protege não é o nome `tarefaPaiId`: é a FORMA. Qualquer
 * relação auto-referente na Tarefa reintroduz a mesma dívida com outro nome.
 */
/**
 * ZERO EXCEÇÕES OPERACIONAIS.
 *
 * Esta lista já teve seis arquivos e vinte escritas diretas. A árvore de
 * subtarefas foi removida inteira; a Tarefa Transversal — a última — passou a
 * criar pela porta canônica, concluir por `concluirTarefaSemWorkflow` e
 * cancelar por `cancelarTarefa`.
 *
 * Ela fica vazia de propósito. Qualquer writer operacional novo, em qualquer
 * arquivo, reprova o build — não existe mais "dívida conhecida" para onde
 * empurrar a próxima exceção.
 *
 * O que continua PERMITIDO e não passa por aqui: escrever dado de DOMÍNIO
 * (vincular um documento, anotar metadata). O que a regra vigia é estado
 * operacional: `statusTarefa`, `concluida`, `dataConclusao`,
 * `workflowStepInstanceId`.
 */
const DIVIDA_TAREFA_LEGADA: Record<string, { teto: number; motivo: string }> = {
  "prisma/backfill-cp4-workflow.ts": {
    teto: 1,
    motivo: "BACKFILL de uma vez só, por comando e com guarda de escrita — não é caminho de runtime",
  },
}

const invasores = escritoresTarefa.filter((a) => !(a in DONOS_DA_TAREFA) && !(a in DIVIDA_TAREFA_LEGADA))
ok("nenhum escritor NOVO de estado operacional de tarefa", invasores.length === 0,
  invasores.length ? `FORA: ${invasores.join(", ")}` : `${escritoresTarefa.length} arquivos: donos legítimos + dívida legada nomeada`)

const estourouTarefa = escritoresTarefa
  .filter((a) => a in DIVIDA_TAREFA_LEGADA)
  .filter((a) => sitesOperacionaisDeTarefa(semComentarios(ler(a))) > DIVIDA_TAREFA_LEGADA[a].teto)
ok("nenhum writer operacional excepcionado sobrou", estourouTarefa.length === 0, estourouTarefa.join(", "))

const folgouTarefa = escritoresTarefa
  .filter((a) => a in DIVIDA_TAREFA_LEGADA)
  .filter((a) => sitesOperacionaisDeTarefa(semComentarios(ler(a))) < DIVIDA_TAREFA_LEGADA[a].teto)
  .map((a) => `${a}: ${sitesOperacionaisDeTarefa(semComentarios(ler(a)))} < teto ${DIVIDA_TAREFA_LEGADA[a].teto} — baixe o teto`)
ok("os tetos da árvore legada acompanham a dívida real", folgouTarefa.length === 0, folgouTarefa.join("; "))

ok("nenhuma rota legada conclui tarefa como CONCLUIDO_NAO_POSSUI",
  !TODOS.some((a) => /statusTarefa:\s*"CONCLUIDO_NAO_POSSUI"/.test(semComentarios(ler(a)))),
  "'não possui' é resultado da NECESSIDADE (NAO_LOCALIZADA), não conclusão do trabalho")

const donosMortos = Object.keys(DONOS_DA_TAREFA).filter((a) => !escritoresTarefa.includes(a))
ok("a lista de donos da tarefa não guarda entradas mortas", donosMortos.length === 0,
  donosMortos.length ? `já não escrevem: ${donosMortos.join(", ")}` : "")

/**
 * ZERO TOLERÂNCIA: os endpoints da árvore legada não voltam.
 *
 * Não basta que hoje não existam — o guard falha se alguém os recriar, com
 * qualquer nome. Eles eram a única forma de mudar responsabilidade e estado de
 * tarefa por fora das portas, e a única forma de criar etapa como subtarefa.
 */
const ROTAS_EXTINTAS = [
  "src/app/api/tarefas/[tarefaId]/cobranca/route.ts",
  "src/app/api/tarefas/[tarefaId]/toggle/route.ts",
  "src/app/api/tarefas/[tarefaId]/subtarefas/route.ts",
  "src/app/api/tarefas/[tarefaId]/route.ts",
  "src/app/activities/page.tsx",
  "src/components/kanban/TarefaDetailModal.tsx",
]
for (const r of ROTAS_EXTINTAS) {
  ok(`extinto e não voltou: ${r.split("/").slice(-2).join("/")}`, !existsSync(join(RAIZ, r)))
}
// ─── A FORMA PROIBIDA, no schema ────────────────────────────────────────────
// Não basta procurar o nome antigo. O que não pode voltar é a Tarefa apontar
// para outra Tarefa: é isso que produz hierarquia operacional.
const schema = ler("prisma/schema.prisma")
const modeloTarefa = (() => {
  const i = schema.search(/^model\s+Tarefa\s*\{/m)
  if (i < 0) return ""
  return schema.slice(i, schema.indexOf("\n}", i))
})()
ok("o modelo Tarefa existe no schema", modeloTarefa.length > 0)

// Um campo cujo TIPO é Tarefa (ou Tarefa[]) dentro do próprio model Tarefa é
// uma relação auto-referente. Nem toda auto-referência é a árvore: existe UMA
// permitida, e ela é nomeada aqui com o motivo.
//
//   TarefaSupersessao — uma tarefa SUBSTITUI outra (a anterior fica SUPERSEDIDA,
//   que não é o mesmo que cancelada). É uma linhagem de versões do MESMO
//   trabalho, 1:1 para trás. Não decompõe trabalho: a tarefa superseder não é
//   "parte de" nada, e ninguém executa pai e filha juntos.
//
// O que está proibido é a auto-referência que DECOMPÕE trabalho — pai que se
// conclui quando as filhas concluem. Esse papel é do WORKFLOW e dos PASSOS.
const AUTO_RELACAO_PERMITIDA = "TarefaSupersessao"
const autoReferencias = modeloTarefa
  .split("\n")
  .slice(1)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
  .filter((l) => /^\w+\s+Tarefa(\[\])?(\?)?(\s|$)/.test(l))
const decomposicao = autoReferencias.filter((l) => !l.includes(`"${AUTO_RELACAO_PERMITIDA}"`))
ok("§5) a Tarefa não se decompõe em Tarefas no schema", decomposicao.length === 0,
  decomposicao.join(" | ") || "TAREFA → WORKFLOW → PASSOS; nunca TAREFA → SUBTAREFA")
ok(`§5) a única auto-relação da Tarefa é ${AUTO_RELACAO_PERMITIDA}`,
  autoReferencias.length === 2 && decomposicao.length === 0,
  `${autoReferencias.length} campo(s) auto-referentes`)

for (const proibido of ["tarefaPaiId", "tipoSubtarefa"]) {
  ok(`§5) \`${proibido}\` não voltou ao schema`, !new RegExp(`\\b${proibido}\\b`).test(schema))
}
ok('§5) a relação "Subtarefas" não voltou ao schema', !/@relation\(\s*"Subtarefas"/.test(schema))

// ─── E no código: agora qualquer menção é reintrodução, não leitura ─────────
// Antes havia leitores legítimos (`where: { tarefaPaiId: { not: null } }`, para
// não listar a mesma tarefa duas vezes). A coluna não existe mais: um leitor
// hoje só pode significar que alguém a recriou.
//
// A REGRA É SOBRE A TAREFA, NÃO SOBRE A PALAVRA.
//
// O padrão pegava qualquer `subtarefas:` no código. Isso valia enquanto "subtarefa"
// só podia significar uma coisa: a Tarefa se decompondo em Tarefas, que é o que este
// guarda existe para impedir. Desde 22/08 a palavra também nomeia a subtarefa do
// PASSO (`StepSubtaskDefinition`) — que não é decomposição de tarefa nenhuma: ela
// pertence ao StepDefinition, tem execução própria e morre com o passo.
//
// Proibir a palavra proibiria o conceito certo junto com o errado. O que se cobra é a
// TAREFA se decompondo: as colunas que sumiram do schema, e `subtarefas` num contexto
// de tarefa. A auto-relação no schema continua sendo cobrada logo acima, que é onde a
// reintrodução teria de passar.
const CONTEXTO_DE_TAREFA = /\btarefaPaiId\b|\btipoSubtarefa\b|tarefa\.subtarefas\b|subtarefas\s*:\s*Tarefa/
const mencionamArvore = TODOS.filter((a) => !a.includes("prisma/"))
  .filter((arq) => CONTEXTO_DE_TAREFA.test(semComentarios(ler(arq))))
  .map((a) => a.split("\\").join("/").replace(RAIZ.split("\\").join("/") + "/", ""))
ok("§5) nenhum arquivo da aplicação menciona a árvore de subtarefas",
  mencionamArvore.length === 0,
  mencionamArvore.join(", ") || "etapa é etapa; subtarefa era etapa fingindo ser tarefa")

ok("nenhuma rota HTTP move o estado operacional da tarefa fora da dívida nomeada",
  !escritoresTarefa.some((a) => a.includes("src/app/api") && !(a in DIVIDA_TAREFA_LEGADA)),
  "a rota valida quem pode e delega — foi por aqui que /cobranca escapou")

/**
 * CRIAR TAREFA É PERMITIDO — mas não em segredo.
 *
 * Criar não é mover: a regra vigia mudança de ESTADO. Ainda assim, quem cria
 * tarefa define o desenho do trabalho, e hoje há duas origens: o materializador
 * canônico (uma obrigação = uma tarefa = um workflow) e a árvore legada
 * (tarefa-pai/subtarefa criada junto com o documento). Deixar a segunda sem
 * nome faria a árvore legada renascer sem que ninguém percebesse.
 */
const CRIADORES_DE_TAREFA: Record<string, string> = {
  "lib/operacional/tarefa-canonica.ts": "materializador CANÔNICO: uma obrigação real = uma tarefa",
  "lib/operacional/tarefa-ciclo.ts": "tarefa MANUAL, com motivo e aviso de duplicidade",
  "src/services/passo-tarefa.ts": "garante a tarefa do passo publicado (geraTarefa)",
  "src/app/api/documentos/route.ts": "LEGADO: cria a árvore pai/subtarefa junto com o documento",
  "src/app/api/documentos/[id]/route.ts": "LEGADO: idem, na criação avulsa de documento",
  "prisma/backfill-cp4-workflow.ts": "BACKFILL de uma vez só",
  "src/app/api/tarefas/route.ts": "LEGADO: criação avulsa de tarefa pela tela de atividades",
  "src/app/api/tarefas/[tarefaId]/subtarefas/route.ts": "LEGADO: subtarefa da árvore pai/filho",
  "src/app/api/tarefas/[tarefaId]/cobranca/route.ts": "LEGADO: nova cobrança nasce como irmã da anterior",
  "src/services/tarefa-transversal.ts": "Tarefa Transversal — substituída pela Operação Antecipada",
  "src/services/processEngine/taskEngine.ts": "motor legado de tarefas do processo",
}
const criadores: string[] = []
for (const arq of TODOS) {
  const src = semComentarios(ler(arq))
  const re = /\b(?:prisma|tx|db)\s*\.\s*tarefa\s*\.\s*(create|createMany)\s*\(/g
  if (re.test(src)) criadores.push(arq.split("\\").join("/"))
}
const criadoresNovos = criadores.filter((a) => !(a in CRIADORES_DE_TAREFA))
ok("nenhuma origem NOVA de tarefa", criadoresNovos.length === 0,
  criadoresNovos.length ? `NOVAS: ${criadoresNovos.join(", ")}` : `${criadores.length} origens, todas nomeadas`)

// ═══════════════════════════════════════════════════════════════════════════
secao("7) O dual-write legado não voltou")
// ═══════════════════════════════════════════════════════════════════════════
ok("sincronizarStatusPassoV2 não existe mais",
  !TODOS.some((a) => /sincronizarStatusPassoV2/.test(semComentarios(ler(a)))),
  "espelhava o passo legado no V2 — sem chamador desde o cutover")

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
