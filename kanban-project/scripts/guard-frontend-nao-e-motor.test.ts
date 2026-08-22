// scripts/guard-frontend-nao-e-motor.test.ts
//
// A UI PROJETA; O MOTOR DECIDE.
//
// Este guard existe porque a regressão é fácil e silenciosa: alguém precisa de "mais
// uma opção" numa tela, acrescenta um item ao array do componente, e o negócio volta
// a morar no React. Ninguém percebe até um processo real ir para a fase errada.
//
// O que ele cobra não é ausência de listas — é ausência de listas que sejam A FONTE.
// Semente comentada como semente, com o cadastro respondendo por cima, é legítima e
// está declarada abaixo pelo nome.

import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

function arquivos(dir: string, ext = [".ts", ".tsx"]): string[] {
  const base = join(ROOT, dir)
  if (!existsSync(base)) return []
  const saida: string[] = []
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome)
      if (nome === "node_modules" || nome === ".next") continue
      if (statSync(p).isDirectory()) andar(p)
      else if (ext.some((e) => nome.endsWith(e))) saida.push(relative(ROOT, p))
    }
  }
  andar(base)
  return saida
}

// ════════════════════════════════════════════════════════════════
console.log("\n(1) O executor não decide o que acontece com o domínio")
// ════════════════════════════════════════════════════════════════

const editores = semComentarios(ler("src/components/kanban/workflow/StepEditors.tsx"))

// O MAPA `decisão → status do documento` era a regra de negócio dentro da tela.
// Ele ainda existe para etapa SEM configuração cadastrada, e só pode existir atrás
// dessa condição — que é o que se cobra aqui.
check("o mapa decisão→status do documento só roda sem configuração cadastrada",
  editores.includes("if (!usandoCadastroConferencia) {") &&
  /if \(usandoCadastro\) \{[\s\S]{0,400}executarAcaoValidacao/.test(editores))
check("a validação executa a ação pela porta canônica", editores.includes("await executarAcaoValidacao(decisao"))
check("a conferência também", editores.includes("await executarAcaoConferencia(resultado"))
check("nenhum executor manda o processo para outra fase por conta própria",
  !/goToPhase|irParaFase|setFaseAtual|avancarFase\(/.test(editores))
// PROGRESSO DE DOMÍNIO, não barra de upload. `setProgress(p)` alimentado por
// `onProgress` de um upload é percentual de bytes — nada tem a ver com quanto da fase
// está feita, que é o que a projeção canônica responde.
check("nenhum executor calcula progresso DE DOMÍNIO",
  !/progressoDaFase|calcularProgresso\(|setProgressoWorkflow/.test(editores))
check("o progresso que existe na tela é de upload, e vem do próprio upload",
  !editores.includes("setProgress(") || editores.includes("onProgress: (_, p) => setProgress(p)"))

// ════════════════════════════════════════════════════════════════
console.log("\n(2) As listas de negócio vêm do cadastro")
// ════════════════════════════════════════════════════════════════

check("os canais vêm do cadastro quando ele responde", editores.includes("canaisDoCadastro(opcoesCanal)"))
check("o checklist vem do cadastro", editores.includes("cfgConferencia!.checklist.map"))
check("os resultados da validação vêm do cadastro", editores.includes("cfgValidacao!.acoes.map"))
check("as opções de mídia vêm do cadastro", editores.includes("opcoesMidia.map"))

// AS SEMENTES SÃO NOMEADAS. Um array que sobra sem esse nome é a fonte de novo.
const SEMENTES_DECLARADAS = ["CANAIS_SEMENTE", "MEDIUM_SEMENTE", "CHECKLIST_SEMENTE", "DECISAO_SEMENTE"]
for (const nome of SEMENTES_DECLARADAS) {
  check(`${nome} é semente declarada, não fonte`, editores.includes(`const ${nome}`))
}
// A COBRANÇA É ESTRUTURAL, não pelo nome da variável: toda lista de negócio precisa
// ou vir do cadastro, ou estar atrás de uma semente nomeada. `const CANAIS = ... ?
// canaisDoCadastro(...) : CANAIS_SEMENTE` é a forma correta — e é essa forma que se
// cobra, em vez de proibir o identificador.
for (const [lista, derivada] of [
  ["CANAIS", "canaisDoCadastro(opcoesCanal) : CANAIS_SEMENTE"],
  ["MEDIUM_OPTIONS", ": MEDIUM_SEMENTE"],
  ["CHECKLIST_ITEMS", ": CHECKLIST_SEMENTE"],
  ["DECISAO_OPTIONS", ": DECISAO_SEMENTE"],
] as const) {
  check(`${lista} é derivada do cadastro, com a semente atrás`, editores.includes(derivada))
}

// ════════════════════════════════════════════════════════════════
console.log("\n(3) Nenhum componente escreve estado de domínio direto")
// ════════════════════════════════════════════════════════════════

const componentes = arquivos("src/components").filter((f) => f.endsWith(".tsx"))
const escritaDireta: string[] = []
for (const f of componentes) {
  const t = semComentarios(ler(f))
  // `prisma.` num componente é escrita direta no banco a partir da tela.
  if (/\bprisma\.[a-zA-Z]+\.(create|update|delete|upsert)/.test(t)) escritaDireta.push(f)
}
check("nenhum componente chama prisma direto", escritaDireta.length === 0, escritaDireta.join(", "))

// ════════════════════════════════════════════════════════════════
console.log("\n(4) Efeito de domínio só pela porta")
// ════════════════════════════════════════════════════════════════

const efeitos = semComentarios(ler("src/services/efeitos-de-dominio.ts"))
check("os efeitos delegam ao motor de fases, não escrevem fase",
  efeitos.includes("reopenPhase(") && !/prisma\.processo\.update[\s\S]{0,200}faseAtualKey/.test(efeitos))
check("os efeitos não escrevem status de passo por conta própria",
  !/phaseWorkflowStepInstance\.update/.test(efeitos))
check("os efeitos não escrevem tarefa por conta própria",
  !/prisma\.tarefa\.update/.test(efeitos))

const porta = semComentarios(ler("src/services/executar-acao-cadastrada.ts"))
check("a porta confere competência da fase em tempo de execução", porta.includes("EFEITO_FORA_DE_COMPETENCIA"))
check("confere se o executor sabe disparar", porta.includes("EFEITO_SEM_SUPORTE"))
check("confere permissão", porta.includes("SEM_PERMISSAO"))
check("confere campo obrigatório", porta.includes("CAMPO_OBRIGATORIO"))
check("e lê a configuração HISTÓRICA, não a de hoje", porta.includes("definicaoHistoricaDoPasso"))

// ════════════════════════════════════════════════════════════════
console.log("\n(5) A operação da etapa tem uma fonte só")
// ════════════════════════════════════════════════════════════════

const docop = semComentarios(ler("src/services/documento-operacao.ts"))
check("a leitura da operação vem da tentativa", docop.includes("await lerOperacao(r.id)"))
check("a escrita da operação vai para a tentativa", docop.includes("await gravarOperacao(p.id, opPatch, tx)"))
check("o blob `metadata.operacao` deixou de ser escrito",
  !/metadata:\s*\{\s*operacao:/.test(docop),
  "duas fontes para o mesmo fato — a que sobrevive à reexecução é a tentativa")

const runtime = [...arquivos("src/services"), ...arquivos("src/app/api"), ...arquivos("src/lib")]
const escrevemBlob = runtime.filter((f) => /metadata:\s*\{\s*operacao:/.test(semComentarios(ler(f))))
check("nenhum arquivo de runtime escreve o blob antigo", escrevemBlob.length === 0, escrevemBlob.join(", "))

// ════════════════════════════════════════════════════════════════
console.log("\n(6) O hardcode operacional não volta pela porta dos fundos")
// ════════════════════════════════════════════════════════════════
//
// As regras acima cobram os pontos que JÁ foram migrados. Estas cobram o caminho de
// VOLTA: um executor novo, ou uma alteração num existente, reintroduzindo em código a
// lista que agora é cadastro. É a diferença entre provar que hoje está limpo e
// impedir que amanhã não esteja.

const EXECUTORES = [
  "src/components/kanban/workflow/StepEditors.tsx",
  "src/components/kanban/workflow/CentralDaEtapaDrawer.tsx",
  "src/components/kanban/workflow/PainelDeclarativoDaEtapa.tsx",
]

// 6.1 — CANAL LITERAL. As chaves de canal são dado; escrevê-las dentro de um array de
// tela recria a segunda lista que discordava da oficial.
const CHAVES_DE_CANAL = ["CRC", "ECARTORIO", "WHATSAPP", "BALCAO", "COMUNE", "CONSULADO"]
for (const f of EXECUTORES) {
  const t = semComentarios(ler(f))
  if (!t) continue
  // Um objeto literal com três ou mais chaves de canal É uma lista de canais.
  const literaisDeCanal = /\[[^\]]{0,4000}?\]/g
  let reincidente: string | null = null
  for (const bloco of t.match(literaisDeCanal) ?? []) {
    const quantas = CHAVES_DE_CANAL.filter((c) => bloco.includes(`"${c}"`) || bloco.includes(`'${c}'`)).length
    // `ICONE_DO_CANAL` e `DICA_OBSERVACAO` são mapas de APRESENTAÇÃO por canal — não
    // dizem quais canais existem nem o que cada um exige. Eles são objetos, não
    // arrays, e por isso não caem aqui.
    if (quantas >= 3) { reincidente = bloco.slice(0, 80); break }
  }
  check(`${f.split("/").pop()} não traz uma lista de canais em código`, reincidente === null, reincidente ?? "")
}

// 6.2 — EXIGÊNCIA POR CANAL EM CÓDIGO. "se o canal é X, exija Y" é cadastro desde que
// `StepChannel` existe; um `switch`/`if` sobre a chave do canal é a regra voltando.
for (const f of EXECUTORES) {
  const t = semComentarios(ler(f))
  if (!t) continue
  check(`${f.split("/").pop()} não ramifica exigência por chave de canal`,
    !/(switch\s*\(\s*[a-zA-Z_.]*canal|canal\s*===\s*["'](CRC|ECARTORIO|WHATSAPP|BALCAO|COMUNE|CONSULADO)["'])/i.test(t),
    "a exigência por canal vem do cadastro, somada à do catálogo")
}

// 6.3 — A TELA NÃO DECIDE QUE UM REQUISITO ESTÁ CUMPRIDO. Ela mostra o que o servidor
// calculou; a conta é uma só, e é a que recusa.
check("as pendências que a tela mostra vêm do servidor",
  editores.includes("pendencias: pendenciasDaEtapa") || editores.includes("pendenciasDaEtapa"),
  "o executor precisa consumir `pendencias` do hook, não recalcular requisitos")
check("o hook busca as pendências da rota de execução",
  semComentarios(ler("src/components/kanban/workflow/useConfiguracaoDaEtapa.ts")).includes("pendencias: j.pendencias"))

// 6.4 — AS OPÇÕES TÊM IDENTIDADE. O runtime resolve `StepFieldOption` antes do JSON;
// inverter a ordem faria a opção renomeada perder o vínculo com o que foi escolhido.
const rotaExec = semComentarios(ler("src/app/api/workflow-step-instances/[id]/execucao/route.ts"))
check("as opções cadastradas têm precedência sobre o JSON antigo",
  rotaExec.indexOf("opcoesCadastradas") < rotaExec.indexOf("Array.isArray(o) ? o : []"))
check("opção inativa não é oferecida", rotaExec.includes('filter((o) => o.ativo !== false)'))

// 6.5 — SALVAR NÃO PUBLICA. Se a rota de gravação voltar a congelar versão, três
// ajustes viram três versões e a prévia deixa de ter função.
const rotaAdmin = semComentarios(ler("src/app/api/gerenciamento/workflows-fase/[id]/route.ts"))
check("o PUT do cadastro grava rascunho, não publica", rotaAdmin.includes("marcarRascunho(id"))
check("publicar é um ato próprio, com trava de versão", rotaAdmin.includes("versaoEsperada"))
check("o PUT não congela versão por conta própria", !rotaAdmin.includes("congelarVersaoVigente("))

// 6.6 — IDA E VOLTA DO CANAL. A leitura devolve o canal ANINHADO (o vínculo junto com
// o catálogo) e a edição manda a CHAVE. Sem normalizar, abrir um passo já configurado
// mostraria nenhum canal marcado — e salvar apagaria os que estavam lá. O defeito é
// silencioso: some configuração sem erro nenhum na tela.
const modalCfg = semComentarios(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx"))
// O EDITOR NÃO EDITA MAIS CANAL DO PASSO — os canais são do fornecedor. O que ele
// precisa garantir é que os canais LEGADOS, publicados antes desta mudança, atravessem
// o salvamento sem se perder. Ele os carrega em `f` e os devolve intactos; quem aceita
// as duas formas é a rota, cobrada logo abaixo.
check("o editor preserva os canais legados do passo em vez de descartá-los",
  modalCfg.includes("canais?: Array<{ canalKey?: string; canal?: { key: string; label?: string }"),
  "descartá-los faria o primeiro save apagar a configuração de canal já publicada")
check("e a rota aceita as duas formas ao gravar",
  /canalKey:\s*String\(c\?\.canalKey\s*\?\?\s*c\?\.canal\?\.key/.test(rotaAdmin))

// 6.7 — TODA COLEÇÃO DO PASSO ATRAVESSA O SALVAMENTO. Uma coleção que a leitura
// devolve e o `buildFilhos` não regrava é uma coleção que o primeiro save apaga.
for (const colecao of ["acoes", "campos", "checkItens", "canais", "requisitos"]) {
  check(`o salvamento regrava "${colecao}"`, rotaAdmin.includes(`filhos.${colecao}`) || rotaAdmin.includes(`s?.${colecao}`))
}
check("e regrava as opções do campo", rotaAdmin.includes("filhos.opcoesPorCampo"))

// ════════════════════════════════════════════════════════════════
console.log("\n(7) A subtarefa é cadastro — nunca invenção do executor")
// ════════════════════════════════════════════════════════════════
//
// A regra que dá nome a esta seção: se para criar uma subtarefa de negócio for preciso
// escrever código, a arquitetura voltou ao ponto de partida. Estas verificações cobram
// o caminho de volta em cada uma das formas que ele já teve.

// 7.1 — NENHUM EXECUTOR RAMIFICA POR CHAVE DE PASSO OU DE FASE. Era assim que
// "solicitar_certidao mostra estas três coisas" existia: um `if` sobre o nome.
const CHAVES_DE_NEGOCIO = [
  "solicitar_certidao", "receber_certidao", "conferir_certidao", "validar_certidao",
  "aguardar_retorno_do_cartorio", "localizar_registro", "registrar_divergencias",
]
for (const f of EXECUTORES) {
  const t = semComentarios(ler(f))
  if (!t) continue
  const ramifica = CHAVES_DE_NEGOCIO.filter((k) =>
    new RegExp(`(===|!==|includes\\(|case\\s+)\\s*["'\`]${k}["'\`]`).test(t))
  check(`${f.split("/").pop()} não ramifica por chave de passo de negócio`,
    ramifica.length === 0, ramifica.join(", "))
  check(`${f.split("/").pop()} não ramifica por phaseKey`,
    !/(phaseKey|faseMacroKey)\s*(===|!==)\s*["'\`]/.test(t),
    "regra de negócio por fase é exatamente o que o motor universal desfaz")
}

// 7.2 — O PAINEL GENÉRICO CONSOME A PROJEÇÃO, não recalcula estado. Quem sabe por que
// uma subtarefa está bloqueada é quem tem o grafo — o servidor.
const painel = semComentarios(ler("src/components/kanban/workflow/PainelDeclarativoDaEtapa.tsx"))
check("o painel desenha as subtarefas que o servidor projetou", painel.includes("d.subtarefas"))
check("e mostra o motivo do bloqueio que veio pronto", painel.includes("st.bloqueioTexto"))
check("a tela não decide dependência de subtarefa por conta própria",
  !/dependeDe[\s\S]{0,80}(every|some|filter)\(/.test(painel),
  "o grafo é resolvido no servidor; recalcular aqui daria uma segunda resposta")
check("executar manda QUAL subtarefa — sem isso o servidor procuraria a ação no passo",
  painel.includes("subtarefa: subtarefa ?? null"))

// 7.3 — OS CANAIS VÊM DO FORNECEDOR. O workflow não tem mais cadastro próprio deles.
const resolvedor = semComentarios(ler("src/lib/motor/canais-do-fornecedor.ts"))
check("existe um resolvedor de canais por organização", resolvedor.includes("export async function canaisDaOrganizacao"))
check("a restrição por tipo é INTERSEÇÃO, nunca acréscimo",
  resolvedor.includes("doFornecedor.filter((c) => permitidos.has(c.key))"),
  "o passo pode proibir um canal que o fornecedor atende; não pode habilitar um que ele não atende")
check("a exigência da organização SÓ ACRESCENTA à do tipo",
  /exigeProtocolo:\s*l\.exigeProtocolo === true \|\| l\.canal\.protocoloObrigatorio/.test(resolvedor))
check("sem fornecedor, a lista é VAZIA — não é a lista global",
  /if \(!args\.fornecedorId\) return \[\]/.test(resolvedor))

// 7.4 — A PORTA RESOLVE A AÇÃO NO ESCOPO CERTO. Procurar no passo uma ação que é da
// subtarefa encontraria uma homônima e executaria outra coisa.
const porta7 = semComentarios(ler("src/services/executar-acao-cadastrada.ts"))
check("a porta procura a ação nas ações da subtarefa quando há subtarefa",
  porta7.includes("const acoesDisponiveis = subtarefa ? subtarefa.acoes : hist.passo.acoes"))
check("recusa executar subtarefa indisponível", porta7.includes("SUBTAREFA_INDISPONIVEL"))
check("recusa repetir subtarefa que não é repetível", porta7.includes("SUBTAREFA_JA_CONCLUIDA"))
check("e respeita a regra de conclusão cadastrada do passo", porta7.includes("SUBTAREFAS_PENDENTES"))
check("o fornecedor é resolvido no SERVIDOR, não aceito do cliente",
  semComentarios(ler("src/app/api/workflow-step-instances/[id]/execucao/route.ts"))
    .includes("alvo?.documento?.orgaoId ?? null"))

// 7.5 — A EXECUÇÃO DA SUBTAREFA É APPEND-ONLY, como a do passo.
const execSub = semComentarios(ler("src/services/execucao-da-subtarefa.ts"))
check("reabrir SUBSTITUI a execução vigente em vez de desconcluir",
  execSub.includes("supersededAt: agora, supersededPorId: nova.id"))
check("a vigente é a que não foi substituída", execSub.includes("supersededAt: null"))
check("bloqueio nasce com causa nomeada", execSub.includes("CAUSAS_DE_BLOQUEIO"))
check("cancelada e invalidada NÃO contam como cumpridas",
  semComentarios(ler("src/services/subtarefas-da-etapa.ts")).includes('porChave.get(d.key)?.status === ESTADOS_DA_SUBTAREFA.CONCLUIDO'),
  "liberar dependente por causa de uma subtarefa cancelada seria dar por feito o que não foi feito")

// 7.6 — O MENU NÃO TEM MAIS CADASTRO DE CANAL DENTRO DO WORKFLOW.
const nav = semComentarios(ler("src/components/gerenciamentoComponents/managementNavigation.tsx"))
const blocoWorkflow = nav.slice(nav.indexOf("grp_workflow"), nav.indexOf("grp_workflow") + 1800)
check("Workflow não tem mais cadastro de canais", !blocoWorkflow.includes('"canais"'),
  "canal é da organização; o workflow apenas referencia os do fornecedor")

// 7.7 — O EDITOR É O MESMO PARA PASSO E SUBTAREFA.
const modal7 = semComentarios(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx"))
check("o editor de peças é compartilhado entre passo e subtarefa",
  (modal7.match(/<EditorDePecasDoPasso/g) ?? []).length >= 2,
  "dois editores fariam a subtarefa oferecer menos que o passo, sem razão")
check("o editor tem a aba de subtarefas", modal7.includes('"subtarefas"'))
check("e a de evidências", modal7.includes('"evidencias"'))

// ════════════════════════════════════════════════════════════════
console.log("\n(8) Um passo, um configurador, zero editores concorrentes")
// ════════════════════════════════════════════════════════════════
//
// A tela tinha DOIS caminhos para editar a mesma entidade: "Configurar" abria o
// configurador completo e o lápis abria um modal curto com sete atributos. Os dois
// gravavam pelo MESMO endpoint — não havia persistência duplicada —, mas o curto só
// alcançava parte do passo e não conhecia a regra de conclusão em vocabulário fechado.
// Duas telas para uma entidade obrigam o administrador a saber por qual delas entrar
// para achar o que procura.

const tab8 = semComentarios(ler("src/components/gerenciamentoComponents/PhaseWorkflowsFasesTab.tsx"))
for (const morto of ["stepModal", "stepForm", "openAddStep", "openEditStep", "saveStep"]) {
  check(`o editor curto não voltou: \`${morto}\` não existe`, !new RegExp(`\\b${morto}\\b`).test(tab8))
}
check("não há um segundo modal de passo na tela",
  !/Editar passo|Adicionar passo/.test(tab8),
  "o título do modal curto era esse; se voltou, voltou o editor concorrente")
check("criar um passo abre o configurador nele",
  tab8.includes("setConfigModal({ wf: salvo, step: criado })"),
  "sem isso, criar um passo precisaria de um formulário próprio — o editor curto de volta")
check("e o passo criado vem do SERVIDOR, não do otimista",
  /const salvo = await putSteps\(/.test(tab8) && tab8.includes("salvo.passos.find"),
  "abrir a partir do otimista abriria um passo sem id")
check("há UM único ponto que abre o configurador",
  (tab8.match(/setConfigModal\(\{/g) ?? []).length === 2,
  "um para o botão Configurar, um para o passo recém-criado — mais que isso é caminho concorrente")

// A ABA GERAL É DONA DOS ATRIBUTOS DO PASSO. Se algum voltar a ser editável fora dela,
// volta a duplicidade — agora dentro do próprio configurador.
const modal8 = semComentarios(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx"))
for (const [attr, campo] of [
  ["nome", "value={f.label}"], ["descrição", "value={f.description"], ["chave", "value={f.key}"],
  ["cardinalidade", 'set("cardinalidade"'], ["prioridade", 'set("priority"'],
  ["executável", 'set("createsTask"'], ["obrigatório", 'set("required"'],
  ["condição de conclusão", 'set("regraDeConclusao"'],
] as const) {
  check(`${attr} é editado em UM lugar só`, (modal8.split(campo).length - 1) === 1, campo)
}
check("o SLA tem um campo só no configurador",
  (modal8.match(/set\("slaDays"/g) ?? []).length === 1,
  "ele estava em Geral E em Responsável/SLA — dois campos para o mesmo atributo na mesma tela")

// ════════════════════════════════════════════════════════════════
console.log("\n(9) O configurador é organizado como processo, não como banco de dados")
// ════════════════════════════════════════════════════════════════
//
// Eram onze abas de primeiro nível, uma por tabela do motor. Quem configura não
// pergunta "onde fica o requisito"; pergunta o que é o passo, o que se faz nele, o que
// precisa estar cumprido, o que pode acontecer e que regras especiais existem.

const vocab = semComentarios(ler("src/components/gerenciamentoComponents/tiposDoCadastroDoPasso.ts"))
const modal9 = semComentarios(ler("src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx"))
const pecas9 = semComentarios(ler("src/components/gerenciamentoComponents/EditorDePecasDoPasso.tsx"))

check("existem CINCO áreas de primeiro nível, nesta ordem",
  /AREAS = \[[\s\S]*?"geral"[\s\S]*?"execucao"[\s\S]*?"conclusao"[\s\S]*?"resultados"[\s\S]*?"avancado"/.test(vocab) &&
  (vocab.match(/\{ key: "(geral|execucao|conclusao|resultados|avancado)"/g) ?? []).length === 5)
check("as onze abas de primeiro nível não existem mais",
  !/const ABAS = \[/.test(modal9) && !/aba === "dependencias"|aba === "executor"|aba === "reabertura"/.test(modal9))
check("cada área traz o texto que explica o que ela responde",
  ["Defina o que é este passo", "Defina o que o operador precisa fazer",
   "Defina o que precisa estar cumprido", "Defina quais decisões",
   "Dependências, executor técnico"].every((t) => vocab.includes(t)))

// RESPONSÁVEL ≠ EXECUTOR. Um é quem faz; o outro é o mecanismo que desenha a tela.
check("o responsável fica em Geral", /area === "geral"[\s\S]{0,6000}Responsável padrão/.test(modal9))
check("o executor fica em Avançado, e não como área de primeiro nível",
  /area === "avancado"[\s\S]{0,4000}Executor técnico/.test(modal9) &&
  !/\{ key: "executor"/.test(vocab))
check("a tela diz que responsável e executor são coisas diferentes",
  modal9.includes("Não confundir com o"))

// O RÓTULO "Peso / SLA" inventava um segundo atributo: o modelo tem só `slaDays`.
check('o rótulo "Peso / SLA" não existe mais', !modal9.includes("Peso / SLA"))
check("o prazo é chamado de prazo", modal9.includes("Prazo interno (dias úteis)"))
check("e não existe `weight` no schema para justificar dois campos",
  !/^\s*weight\s+/m.test(ler("prisma/schema.prisma")),
  "se um dia existir, a tela precisa mostrar os dois separadamente")

// LINGUAGEM DE NEGÓCIO, não chave técnica.
check("os tipos de campo têm nome humano", vocab.includes("Texto longo") && vocab.includes("Arquivo/Evidência"))
check("a cardinalidade é explicada pelo que produz", vocab.includes("Será criada uma unidade deste passo para cada documento aplicável."))
check("a prioridade oferece só o que a enum admite",
  (vocab.match(/\{ key: "(low|medium|high)"/g) ?? []).length === 3 && !vocab.includes('key: "urgent"'))
check("effectKey não é a linguagem principal do seletor de resultado",
  !/\{a\.effectKey\} \(indisponível/.test(pecas9) && pecas9.includes("indisponivel?.label ?? a.effectKey"))
check("e o indisponível explica o MOTIVO", pecas9.includes("não tem competência para") && pecas9.includes("não sabe disparar"))

// REQUISITO E EVIDÊNCIA: uma fonte, dois grupos visuais.
check("evidência e requisito saem da MESMA lista",
  (pecas9.match(/aoMudar\(\{\s*requisitos:/g) ?? []).length === 1,
  "dois CRUDs sobre o mesmo registro é o que a UX anterior fazia")
check("e nenhuma das duas é área de primeiro nível",
  !/\{ key: "requisitos"/.test(vocab) && !/\{ key: "evidencias"/.test(vocab))

// ESTADO DA EDIÇÃO — não perder o que foi digitado.
check("o configurador avisa antes de fechar com alteração pendente", modal9.includes("Você tem alterações não salvas"))
check("e mostra que há alteração pendente", modal9.includes("Alterações não salvas"))
check("erro ao salvar NÃO fecha o modal nem apaga o que foi digitado",
  modal9.includes("setErroAoSalvar") && /catch \(e\)[\s\S]{0,200}setErroAoSalvar/.test(modal9))
check("o rascunho é anunciado como rascunho", modal9.includes("não afetam processos em andamento"))
check("cabeçalho e rodapé ficam fixos", (modal9.match(/flex-none/g) ?? []).length >= 3)

// SEM CASO ESPECIAL POR FASE OU POR PASSO.
for (const arquivo of [
  "src/components/gerenciamentoComponents/ConfiguracaoDoPassoModal.tsx",
  "src/components/gerenciamentoComponents/EditorDePecasDoPasso.tsx",
  "src/components/gerenciamentoComponents/PhaseWorkflowsFasesTab.tsx",
]) {
  const t = semComentarios(ler(arquivo))
  check(`${arquivo.split("/").pop()} não muda a UI por phaseKey`,
    !/phaseKey\s*(===|!==)\s*["'`]/.test(t))
  check(`${arquivo.split("/").pop()} não muda a UI por chave de passo`,
    !/(stepKey|\bkey)\s*===\s*["'`](solicitar_certidao|receber_certidao|conferir_certidao|localizar_registro)["'`]/.test(t))
}

// A PRÉVIA DE PUBLICAÇÃO fala o mesmo idioma.
const pub9 = semComentarios(ler("src/components/gerenciamentoComponents/PublicarWorkflowModal.tsx"))
check("a prévia agrupa pelas cinco áreas",
  pub9.includes("AREA_DO_ESCOPO") &&
  /ORDEM_DAS_AREAS = \["Geral", "Execução", "Conclusão", "Resultados", "Avançado"\]/.test(pub9))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
