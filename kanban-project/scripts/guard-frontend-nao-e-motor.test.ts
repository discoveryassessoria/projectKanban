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
check("o editor normaliza o canal aninhado para a chave ao abrir",
  /canalKey:\s*c\.canalKey\s*\?\?[\s\S]{0,120}canal\?\.key/.test(modalCfg))
check("e a rota aceita as duas formas ao gravar",
  /canalKey:\s*String\(c\?\.canalKey\s*\?\?\s*c\?\.canal\?\.key/.test(rotaAdmin))

// 6.7 — TODA COLEÇÃO DO PASSO ATRAVESSA O SALVAMENTO. Uma coleção que a leitura
// devolve e o `buildFilhos` não regrava é uma coleção que o primeiro save apaga.
for (const colecao of ["acoes", "campos", "checkItens", "canais", "requisitos"]) {
  check(`o salvamento regrava "${colecao}"`, rotaAdmin.includes(`filhos.${colecao}`) || rotaAdmin.includes(`s?.${colecao}`))
}
check("e regrava as opções do campo", rotaAdmin.includes("filhos.opcoesPorCampo"))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
