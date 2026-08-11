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

// ═══════════════════════════════════════════════════════════════════════════
secao("7) Uma projeção só — o mesmo taskId em todas as visões")
// ═══════════════════════════════════════════════════════════════════════════
// A Central montava a linha direto do StepInstance e a tela de Tarefas lia
// Tarefa: duas telas, duas entidades, nenhuma identidade em comum. Não havia
// como afirmar que a linha do Ademir aqui e a linha lá eram o MESMO trabalho.
const central = ler("src/app/api/processos/[processoId]/central-operacional/route.ts")
ok("a Central lê a Tarefa canônica", /prisma\.tarefa\.findMany/.test(central))
ok("e devolve o taskId na linha", /taskId: tarefa\?\.id/.test(central))
ok("o responsável exibido vem da TAREFA", /responsavelId: tarefa\?\.responsavelId/.test(central))
ok("o prazo exibido vem da TAREFA", /tarefa\?\.dataPrazo \?\? s\?\.prazo/.test(central))
ok("'sem dono' é da tarefa, não do passo", /noOwner: tarefa != null \? tarefa\.responsavelId == null/.test(central))

// ═══════════════════════════════════════════════════════════════════════════
secao("8) Uma porta só muda a responsabilidade")
// ═══════════════════════════════════════════════════════════════════════════
const comandos = ler("lib/operacional/tarefa-comandos.ts")
ok("existem as portas canônicas",
  /export async function atribuirTarefa/.test(comandos) &&
  /export const transferirTarefa/.test(comandos) &&
  /export async function iniciarTarefa/.test(comandos))
ok("transferir REUTILIZA a porta de atribuir",
  /transferirTarefa = \(args[\s\S]{0,200}atribuirTarefa\(args\)/.test(comandos),
  "duas implementações da mesma regra deixariam uma delas para trás")
ok("nenhum comando cria tarefa", !/tarefa\.create/.test(comandos))
ok("nenhum comando cria workflow", !/phaseWorkflowInstance\.create/.test(comandos))
ok("a concorrência usa CAS otimista", /lockVersion: t\.lockVersion/.test(comandos) && /updateMany/.test(comandos))
ok("toda mudança de dono é auditada",
  /TAREFA_ATRIBUIDA/.test(comandos) && /TAREFA_TRANSFERIDA/.test(comandos))
ok("a auditoria registra de-para", /de: anterior, para: args\.responsavelId/.test(comandos))

// A rota HTTP não pode ser dona de regra — e não pode existir uma segunda.
const rotaAtrib = ler("src/app/api/tarefas/[tarefaId]/atribuir/route.ts")
ok("a rota delega à porta canônica", /atribuirTarefa\(/.test(rotaAtrib) && !/prisma\./.test(rotaAtrib))
ok("e valida permissão no backend", /verificarPermissao\(request, 'tarefas\./.test(rotaAtrib))

// ═══════════════════════════════════════════════════════════════════════════
secao("9) Notificação é marco da TAREFA — nunca da etapa")
// ═══════════════════════════════════════════════════════════════════════════
ok("a notificação tem entidade própria", /model NotificacaoOperacional \{/.test(schema))
const modeloNotif = schema.slice(schema.indexOf("model NotificacaoOperacional {"))
const corpoNotif = modeloNotif.slice(0, modeloNotif.indexOf("\n}"))
ok("ela aponta para a TAREFA, não para o passo",
  /tarefaId Int/.test(corpoNotif) && !/stepInstance/i.test(corpoNotif))
ok("e tem chave de idempotência", /chaveIdempotencia String @unique/.test(corpoNotif))
ok("o retry não duplica", /findUnique\(\{\s*where: \{ chaveIdempotencia: ev\.chave \}/.test(comandos))
ok("prazo e atraso são idempotentes POR DIA", /::\$\{dia\}`/.test(comandos),
  "sem o dia na chave, o aviso renasce a cada varredura e o sino vira ruído")
ok("a varredura distingue criada de reencontrada", /if \(r\.criada\)/.test(comandos))
// A notificação é da TAREFA. Avisar por etapa transformaria um pedido de
// certidão em seis avisos e devolveria, pelo sino, o desenho "etapa é tarefa"
// que o resto do guard proíbe.
// (`transicionarPassoTx` aparece aqui porque iniciar a tarefa move a etapa
// corrente — é delegação de transição, não tipo de notificação.)
ok("nenhum tipo de notificação é de etapa",
  !/tipo:\s*'(STEP|PASSO_|ETAPA_)/.test(comandos))
ok("o link do aviso é o link canônico da tarefa", /link: linkDaTarefa\(ev\.tarefaId\)/.test(comandos))

// ═══════════════════════════════════════════════════════════════════════════
secao("10) O motor atravessa fases sem destruir trabalho")
// ═══════════════════════════════════════════════════════════════════════════
// Avançar de fase parece um bom momento para "limpar" as pendências da fase
// anterior, e voltar parece um bom momento para "recomeçar". Os dois instintos
// destroem trabalho real — e nenhum deles pode existir no código.
const ciclo = ler("lib/operacional/tarefa-ciclo.ts")
const projecoes = ler("lib/operacional/tarefa-projecoes.ts")

// G/H — voltar não recria, avançar não conclui: só o RECONCILIADOR mexe em
// tarefa por causa de fase, e ele nem sequer lê a fase do processo.
ok("o reconciliador não lê a fase macro do processo para decidir",
  !/faseAtualKey/.test(reconciler),
  "se ele olhasse a fase, avançar ou voltar mudaria tarefa — e é exatamente o que não pode")
ok("nada conclui tarefa por mudança de fase",
  !/faseAtualKey[\s\S]{0,300}CONCLUID/.test(reconciler + ciclo))

// I — retry não duplica notificação (já coberto), e o reconciliador não notifica.
ok("o reconciliador não emite notificação", !/notificacaoOperacional\.create/.test(reconciler))

// J — tarefa automática sem provenance não nasce.
ok("tarefa sem causa não é materializada",
  /if \(!nome\)/.test(reconciler) && /semTitulo\+\+/.test(reconciler))
ok("o dossiê responde 'por que eu existo'", /porQueExisto/.test(projecoes))

// K — ativa sem responsável E sem equipe é o que a fila não consegue mostrar.
ok("a fila da equipe existe para o trabalho sem dono", /export async function filaDaEquipe/.test(projecoes))
ok("e Minha Fila é projeção, não entidade",
  /export async function minhaFila/.test(projecoes) && !/model MinhaFila/.test(schema))

// §19 — atraso é condição derivada, jamais um status.
ok("atraso NÃO é status", !/'ATRASADA'/.test(schema) && !/ATRASADA/.test(canonica))
ok("atraso é calculado na projeção", /atrasada: !terminal && t\.dataPrazo != null/.test(projecoes))

// §66 — carga conta tarefas, nunca etapas.
ok("a carga conta tarefas", /cargaPorResponsavel/.test(projecoes) &&
  !/phaseWorkflowStepInstance[\s\S]{0,200}cargaPorResponsavel/.test(projecoes))

// ═══════════════════════════════════════════════════════════════════════════
secao("11) Manual, reabertura e causa removida")
// ═══════════════════════════════════════════════════════════════════════════
// F — reabertura mantém o mesmo id; nenhuma porta do ciclo cria tarefa, exceto
// a criação manual, que é trabalho NOVO e por isso tem identidade própria.
const semCriarManual = ciclo.slice(ciclo.indexOf("// REABERTURA"))
ok("reabrir não cria tarefa", !/tarefa\.create/.test(semCriarManual))
ok("reabrir exige motivo", /codigo: 'SEM_MOTIVO'[\s\S]{0,200}reabertura/i.test(ciclo))
ok("reabrir só funciona em tarefa encerrada", /NAO_TERMINAL/.test(ciclo))
ok("a tarefa manual é marcada como MANUAL", /origem: 'MANUAL'/.test(ciclo))
ok("e o reconciliador NUNCA cancela tarefa manual", /origem: \{ not: 'MANUAL' \}/.test(reconciler))

// §50 — trabalho iniciado que perde a causa não é cancelado por robô.
ok("causa removida depois de iniciada exige decisão humana",
  /jaTrabalhou/.test(reconciler) && /TAREFA_CAUSA_REMOVIDA/.test(reconciler))
ok("e o trabalho já feito é preservado", !/jaTrabalhou[\s\S]{0,400}statusTarefa: 'CANCELADA'/.test(reconciler))
ok("tarefa concluída nunca é tocada por perda de causa",
  /statusTarefa: \{ notIn: STATUS_TERMINAIS \}/.test(reconciler))

// §54 — publicar versão nova não reescreve o roteiro de quem já trabalha.
ok("a instância guarda a versão com que nasceu",
  /workflowVersion/.test(schema) && /snapshot/.test(schema))
ok("e o dossiê expõe essa versão", /workflowVersao/.test(projecoes))

// §29/§30 — a política de SLA na espera é do cadastro, não do código.
ok("a pausa de SLA é configurável no workflow publicado",
  /pausarSlaEmEsperaExterna/.test(schema) && /pausarSlaEmBloqueio/.test(schema))
ok("e o código apenas OBEDECE a política", /politicaDeSla/.test(ciclo))
ok("sem workflow, o padrão é NÃO pausar",
  /workflowInstanceId == null\) return \{ pausaEspera: false/.test(ciclo))

// §35 — dependência é entre tarefas, não etapa disfarçada.
ok("dependência tem entidade própria", /model TarefaDependencia \{/.test(schema))
ok("com par único", /@@unique\(\[tarefaId, dependeDeId\]\)/.test(schema))
ok("ciclo direto é recusado", /criaria um ciclo/.test(ciclo))

// ═══════════════════════════════════════════════════════════════════════════
secao("12) A UI só pode operar pelas portas")
// ═══════════════════════════════════════════════════════════════════════════
// O objetivo é que nenhuma tela futura consiga alterar tarefa, etapa,
// responsável ou prazo por fora do motor. Se uma rota escrever direto, ela
// pula auditoria e notificação — e a pessoa nunca fica sabendo que recebeu o
// trabalho.
const comando = ler("src/app/api/tarefas/[tarefaId]/comando/route.ts")
const manual = ler("src/app/api/tarefas/manual/route.ts")
const lote = ler("src/app/api/tarefas/redistribuir/route.ts")
const dossieRota = ler("src/app/api/tarefas/[tarefaId]/dossie/route.ts")

for (const [rotulo, src] of [["comando", comando], ["manual", manual], ["lote", lote], ["dossiê", dossieRota]] as const) {
  // Comentário citando `prisma.tarefa.update` para EXPLICAR por que ele não
  // pode existir aqui é justamente o que evita que alguém o escreva.
  ok(`a rota de ${rotulo} não fala com o Prisma`, !/prisma\./.test(semComentarios(src)),
    "regra de negócio em rota é a segunda porta que sempre esquece a auditoria")
  ok(`a rota de ${rotulo} valida permissão no backend`, /verificarPermissao\(request,/.test(src))
}

// Toda ação exposta precisa de permissão declarada — não existe ação "aberta".
const acoes = [...comando.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1])
const declaradas = [...comando.matchAll(/^  ([a-z_]+): '/gm)].map((m) => m[1])
for (const a of acoes) {
  ok(`a ação "${a}" tem permissão declarada`, declaradas.includes(a))
}
ok("há ações expostas", acoes.length >= 12, `${acoes.length} ações`)

// As operações que a futura UI precisa — todas com porta.
for (const porta of [
  "atribuir", "transferir", "devolver_a_fila", "iniciar", "aguardar_terceiro", "retomar_espera",
  "bloquear", "desbloquear", "reabrir", "cancelar", "alterar_prazo", "alterar_prioridade",
  "adicionar_dependencia", "remover_dependencia",
]) {
  ok(`porta exposta: ${porta}`, comando.includes(`case '${porta}'`))
}
ok("porta exposta: criar tarefa manual", /criarTarefaManual\(/.test(manual))
ok("porta exposta: redistribuição em lote", /redistribuirTarefas\(/.test(lote))
ok("porta exposta: dossiê", /dossieDaTarefa\(/.test(dossieRota))

// O lote relata item a item — um "ok" global esconderia o que não passou.
// O 207 sai do `falha > 0`: a rota devolve o resultado do serviço, que já traz
// os itens — checar o literal "itens" aqui exigiria a rota reempacotar à mão.
ok("o lote responde item a item", /r\.falha > 0 \? 207/.test(lote) && /redistribuirTarefas\(/.test(lote))
// O aviso de duplicidade volta estruturado, para a UI poder oferecer reabrir.
ok("o aviso de duplicidade traz a lista", /semelhantes/.test(manual) && /409/.test(manual))

// ═══════════════════════════════════════════════════════════════════════════
secao("13) Estado terminal é irreversível sem decisão explícita")
// ═══════════════════════════════════════════════════════════════════════════
// Cancelar é decisão humana; concluir é fato. Sem esta guarda, cancelar e
// rodar o reconciliador devolvia a tarefa para EM_ANDAMENTO — a decisão de
// quem cancelou sumia sem erro e sem aviso.
ok("a sincronização não recalcula estado terminal",
  /if \(STATUS_TERMINAIS\.includes\(tarefa\.statusTarefa\)\)/.test(canonica))
ok("cancelar recusa tarefa já encerrada", /Tarefa já encerrada[\s\S]{0,120}reabra/.test(ciclo))
ok("reabrir é o único caminho de volta", /export async function reabrirTarefa/.test(ciclo))
ok("e a reabertura repõe a etapa corrente", /workflowStepInstanceId: etapaAtual/.test(ciclo))

// ═══════════════════════════════════════════════════════════════════════════
secao("14) Concluir etapa passa pela porta — nunca por escrita direta")
// ═══════════════════════════════════════════════════════════════════════════
// Sem esta porta, a tela concluiria etapa com `phaseWorkflowStepInstance.update`
// — e o passo mudaria sozinho, sem ativar o próximo, sem recalcular a tarefa,
// sem auditoria e, no último passo, sem concluir o trabalho. A tarefa ficaria
// eternamente aberta com todas as etapas prontas.
const etapa = ler("lib/operacional/tarefa-etapa.ts")
ok("existe a porta de conclusão de etapa", /export async function concluirEtapa/.test(etapa))
ok("e ela é exposta na rota de comandos", /case 'concluir_etapa'/.test(comando))
ok("com permissão de quem EXECUTA", /concluir_etapa: 'tarefas\.iniciar_concluir'/.test(comando))

// A CAMADA DE API não pode fechar etapa por conta própria. `responsavelId` na
// rota de delegação é outra coisa — atribuir executor de passo não é concluir.
const rotas: string[] = []
;(function varrer(dir: string) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) varrer(caminho)
    else if (nome.endsWith(".ts")) rotas.push(caminho)
  }
})(join(RAIZ, "src/app/api"))

const conclusoesDiretas = rotas.filter((f) => {
  const src = semComentarios(readFileSync(f, "utf8"))
  return /phaseWorkflowStepInstance\.(update|updateMany)\([\s\S]{0,300}status:\s*['"]CONCLUIDO['"]/.test(src)
})
ok("nenhuma rota conclui etapa escrevendo direto no passo",
  conclusoesDiretas.length === 0,
  conclusoesDiretas.map((f) => f.replace(RAIZ, "")).join(", ") || "—")

// O serviço faz o que a escrita direta não faria. A TRANSIÇÃO em si é delegada
// a `task-step-sync` — dono único da máquina de estados de passo — e é de lá que
// vêm o CAS por (status + lockVersion), o WorkflowEvento e o outbox. O que se
// exige aqui é que a porta CONTINUE fazendo a parte que é dela.
ok("a porta ativa a próxima etapa", /ativarProximoPassoTx\(/.test(etapa),
  "e por uma regra só: 'qual é a próxima' não pode ser respondida de dois jeitos")
ok("recalcula o estado da tarefa", /estadoDerivado\(depois/.test(etapa))
ok("e conclui a tarefa só no terminal", /concluiuAgora/.test(etapa))
ok("com CAS — delegado ao dono da máquina de estados",
  /transicionarPassoTx\(tx, alvo\.id, 'CONCLUIDO'/.test(etapa) && /transicao\.code === 'TRANSICAO_INVALIDA'/.test(etapa),
  "duas conclusões simultâneas: a segunda não casa o lockVersion lido e sai como conflito")
ok("retry devolve o estado sem repetir efeito", /jaEstavaConcluida: true/.test(etapa))
ok("tarefa terminal recusa conclusão de etapa", /TAREFA_TERMINAL/.test(etapa))
ok("bloqueio e espera barram, e só o admin força", /TAREFA_BLOQUEADA/.test(etapa) && /TAREFA_AGUARDANDO/.test(etapa) && /permiteForcar/.test(etapa))
ok("as evidências exigidas são validadas no backend", /evidenciasFaltando\(/.test(etapa))
ok("e a auditoria registra antes e depois", /etapaDe:/.test(etapa) && /tarefaPara:/.test(etapa))

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
