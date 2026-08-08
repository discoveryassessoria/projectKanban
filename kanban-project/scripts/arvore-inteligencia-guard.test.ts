// scripts/arvore-inteligencia-guard.test.ts
// ============================================================================
// GUARDA DA INTELIGÊNCIA DA ÁRVORE.
//
// A evolução de 07/08 deu à Árvore linhagem, foco, dossiê operacional e
// respostas determinísticas. O acordo com o usuário foi explícito: modernizar a
// INTELIGÊNCIA, não o design. Este arquivo transforma esse acordo em falha de
// build, e complementa `arvore-layout-congelado.test.ts` — aquele trava o que o
// desenho TEM; este trava o que a inteligência NÃO PODE fazer.
//
// Os quatro compromissos que ele protege:
//
//  1. O FOCO NÃO MEXE NO LAYOUT. Ele é aplicado depois do dagre e só decide
//     opacidade e visibilidade. No dia em que alguém recalcular posição para
//     "compactar a linhagem", a árvore muda de desenho — e foi exatamente essa
//     a mudança reprovada em 30/07.
//
//  2. A ÁRVORE NÃO É DONA DO DOCUMENTO. Ela consome NecessidadeDocumental e
//     nunca decide obrigatoriedade, status ou ciclo de vida documental.
//
//  3. A ÁRVORE NÃO INVENTA PRAZO NEM CONVERTE MOEDA. Prazo vem da engine única
//     de SLA; valor fica na moeda do lançamento. Uma segunda engine de prazo ou
//     uma taxa embutida seriam duas verdades na mesma tela.
//
//  4. A INTELIGÊNCIA É DETERMINÍSTICA E LOCAL. Nenhuma resposta da árvore sai
//     de um modelo de linguagem nem envia a genealogia do cliente para fora.
// ============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const RAIZ = process.cwd()
let falhas = 0
let passos = 0

function ok(desc: string) {
  passos++
  console.log(`  ✅ ${desc}`)
}
function falhar(desc: string, detalhe: string) {
  falhas++
  console.log(`  ❌ ${desc}`)
  console.log(`     ${detalhe}`)
}
function ler(rel: string): string {
  const caminho = join(RAIZ, rel)
  return existsSync(caminho) ? readFileSync(caminho, "utf-8") : ""
}

/**
 * Remove comentários antes de procurar padrão proibido.
 *
 * Necessário porque estes arquivos EXPLICAM por escrito o que não fazem — e um
 * guarda ingênuo casa com a explicação e reprova justamente o código que está
 * certo e bem documentado.
 */
function semComentarios(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
    })
    .join("\n")
}

console.log("\n══ ÁRVORE GENEALÓGICA — INTELIGÊNCIA ══\n")

// ── 1) As peças da inteligência existem ─────────────────────────────────────
console.log("1) peças do motor")
const PECAS = [
  "src/lib/genealogia/motor/linhagens.ts",
  "src/lib/genealogia/navegacao/foco.ts",
  "src/lib/genealogia/operacional/dossie.ts",
  "src/lib/genealogia/operacional/perguntas.ts",
  "src/components/arvore/inteligencia/use-arvore-operacional.ts",
  "src/components/arvore/inteligencia/barra-linhagem.tsx",
  "src/app/api/processos/[processoId]/genealogia/operacional/route.ts",
]
for (const p of PECAS) {
  if (existsSync(join(RAIZ, p))) ok(p.replace("src/", ""))
  else falhar(`${p} AUSENTE`, "faz parte do motor operacional da Árvore")
}

// ── 2) O foco não recalcula layout ──────────────────────────────────────────
console.log("\n2) o foco não toca no desenho")
const canvas = ler("src/components/arvore/react-flow-tree.tsx")

if (/function aplicarFoco\(/.test(canvas)) ok("aplicarFoco existe como passada separada")
else falhar("aplicarFoco sumiu", "o foco voltou a ser decidido dentro do layout")

// A prova estrutural: `aplicarFoco` recebe nós JÁ posicionados e não chama o
// motor de layout. Se alguém acoplar os dois, esta verificação cai.
const corpoFoco = canvas.slice(
  canvas.indexOf("function aplicarFoco("),
  canvas.indexOf("// TIPOS EXPORTADOS PARA REF"),
)
if (corpoFoco && !/getLayoutedElements|dagre\.|new dagre/.test(corpoFoco)) {
  ok("aplicarFoco não chama o motor de layout")
} else {
  falhar(
    "o foco passou a recalcular posição",
    "entrar no modo linhagem tem de deixar todos os cards onde estavam",
  )
}
if (corpoFoco && !/position:\s*\{\s*x:/.test(corpoFoco.replace(/position: posicao/g, ""))) {
  ok("aplicarFoco não fabrica coordenada nova")
} else {
  falhar("o foco escreve posição", "posição é do dagre e das posições salvas, não do filtro")
}

const foco = ler("src/lib/genealogia/navegacao/foco.ts")
if (/OPACIDADE_ESMAECIDA\s*=\s*0\.2/.test(foco)) ok("o esmaecido é 20%, como acordado")
else falhar("a opacidade do esmaecido mudou", "o acordo é ~20%")

// ── 3) A árvore não é dona do documento ─────────────────────────────────────
console.log("\n3) fronteira documental")
const dossie = ler("src/lib/genealogia/operacional/dossie.ts")
const rota = ler("src/app/api/processos/[processoId]/genealogia/operacional/route.ts")

if (/projetarIndicadores|indicadorDaPessoa/.test(dossie)) {
  ok("o dossiê CONSOME o indicador oficial em vez de reimplementá-lo")
} else {
  falhar("o dossiê deixou de usar documental/indicadores", "regra documental voltou para a árvore")
}
// Decidir documento é ATRIBUIR obrigatoriedade ou status a uma necessidade, e
// é ler o banco por conta própria. Contar o que já veio decidido, não.
const codigoDossie = dossie
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
  .join("\n")
if (
  !/from ["'].*prisma["']/.test(codigoDossie) &&
  !/\.obrigatoriedade\s*=/.test(codigoDossie) &&
  !/\.status\s*=\s*["'](ATENDIDA|PENDENTE|DISPENSADA|NAO_LOCALIZADA|EM_ATENDIMENTO)["']/.test(codigoDossie)
) {
  ok("o dossiê não atribui obrigatoriedade nem status documental")
} else {
  falhar("o dossiê passou a decidir documento", "quem decide é o Sistema Documental")
}
for (const proibido of ["create(", "update(", "delete(", "upsert("]) {
  if (!rota.includes(`prisma.`) || !rota.includes(proibido)) continue
  falhar(`a rota operacional escreve (${proibido})`, "um GET que escreve já apagou a planilha uma vez")
}
if (/findMany/.test(rota) && !/\.(create|update|delete|upsert)\(/.test(rota)) {
  ok("a rota operacional é somente leitura")
} else {
  falhar("a rota operacional deixou de ser somente leitura", "GET não escreve")
}
if (/temPermissao\(usuario\.permissoes,\s*["']financeiro\.ver["']\)/.test(rota)) {
  ok("o gate financeiro está na rota, não só na tela")
} else {
  falhar("o gate financeiro sumiu do servidor", "ver a árvore não é ver o dinheiro")
}

// ── 4) Sem prazo inventado, sem moeda convertida ────────────────────────────
console.log("\n4) prazo e moeda")
if (/resolveSlaProjection/.test(rota)) ok("o prazo vem da engine única de SLA")
else falhar("o prazo deixou de vir do SLA", "estimativa própria seria uma segunda engine de prazo")

if (/somarPorMoeda/.test(dossie) && !/(taxa|fx|cambio|conversao)\s*[*=]/i.test(dossie)) {
  ok("os valores somam por moeda, sem conversão embutida")
} else {
  falhar("a árvore passou a converter moeda", "taxa é do motor de câmbio")
}

// ── 5) Determinística e local ───────────────────────────────────────────────
console.log("\n5) inteligência determinística e local")
const perguntas = ler("src/lib/genealogia/operacional/perguntas.ts")
const MODELOS = /(anthropic|openai|gpt-|claude-|generativeai|\bllm\b)/i
if (!MODELOS.test(perguntas) || /NÃO é isso|não é isso que está aqui/i.test(perguntas)) {
  ok("as respostas não vêm de um modelo de linguagem")
} else {
  falhar("a árvore passou a consultar um modelo", "a genealogia do cliente não sai do processo")
}
for (const [arquivo, conteudo] of [
  ["linhagens.ts", ler("src/lib/genealogia/motor/linhagens.ts")],
  ["foco.ts", foco],
  ["dossie.ts", dossie],
  ["perguntas.ts", perguntas],
]) {
  if (/\bfetch\(|from ["']@\/lib\/prisma["']|Math\.random\(|Date\.now\(/.test(conteudo)) {
    falhar(`${arquivo} deixou de ser puro`, "rede, banco, relógio ou acaso quebram o determinismo")
  } else {
    ok(`${arquivo} é puro (sem rede, banco, relógio ou acaso)`)
  }
}
if (/fonte:/.test(perguntas)) ok("toda resposta declara a fonte")
else falhar("as respostas perderam a fonte", "resposta sem fonte não é resposta")

// ── 6) A tela continua sendo a mesma ────────────────────────────────────────
console.log("\n6) identidade da tela")
const barra = ler("src/components/arvore/inteligencia/barra-linhagem.tsx")
if (/border-gray-200 bg-white/.test(barra)) {
  ok("a barra de linhagem usa a casca dos botões que já existiam")
} else {
  falhar("a barra de linhagem inventou estilo próprio", "os controles novos usam a casca antiga")
}
if (/absolute/.test(barra)) ok("a barra é sobreposta — não entra no fluxo do canvas")
else falhar("a barra entrou no fluxo", "ela empurraria o canvas e mudaria o enquadramento")

const guardaCongelado = ler("scripts/arvore-layout-congelado.test.ts")
if (guardaCongelado.length > 0) ok("a guarda de layout congelado continua no lugar")
else falhar("a guarda de layout congelado sumiu", "ela é a trava do desenho aprovado")

// ── 7) A ÁRVORE NÃO ESCREVE NOS DOMÍNIOS ALHEIOS ────────────────────────────
// A trava mais importante do módulo. A árvore consome NecessidadeDocumental,
// Documento, Tarefa, Custo/Receita e WorkflowInstance — e nunca os escreve.
// Escrever aqui seria virar o segundo dono desses domínios, que é exatamente o
// que a Constituição proíbe e o que já custou uma planilha documental apagada.
console.log("\n7) a árvore não escreve nos domínios alheios")


const MODELOS_PROIBIDOS = [
  "necessidadeDocumental",
  "documento",
  "documentoArquivo",
  "tarefa",
  "custo",
  "receita",
  "obrigacaoEconomica",
  "ledgerFinanceiro",
  "phaseWorkflowInstance",
  "phaseWorkflowStepInstance",
  "distribuicaoEconomica",
]
const ESCRITAS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]

function arquivosDe(dir: string): string[] {
  const saida: string[] = []
  const caminho = join(RAIZ, dir)
  if (!existsSync(caminho)) return saida
  for (const nome of readdirSync(caminho)) {
    const cheio = join(caminho, nome)
    if (statSync(cheio).isDirectory()) {
      saida.push(...arquivosDe(join(dir, nome)))
    } else if (/\.tsx?$/.test(nome)) {
      saida.push(join(dir, nome))
    }
  }
  return saida
}

// O MÓDULO DA ÁRVORE: os componentes e os motores puros de genealogia.
// A rota `genealogia/operacional` é leitura e tem guarda própria (item 3);
// `simular-impacto` é a exceção EXPLÍCITA e está coberta pelo item 8.
const MODULO_ARVORE = [
  ...arquivosDe("src/components/arvore"),
  ...arquivosDe("src/lib/genealogia"),
]

const violacoes: string[] = []
for (const rel of MODULO_ARVORE) {
  const src = semComentarios(ler(rel))
  for (const modelo of MODELOS_PROIBIDOS) {
    for (const escrita of ESCRITAS) {
      // Casa `prisma.tarefa.create(`, `tx.custo.update(`, `db.documento.delete(`.
      const padrao = new RegExp(`\\b(prisma|tx|db)\\.${modelo}\\.${escrita}\\s*\\(`, "i")
      if (padrao.test(src)) violacoes.push(`${rel} → ${modelo}.${escrita}()`)
    }
  }
}
if (violacoes.length === 0) {
  ok(`${MODULO_ARVORE.length} arquivos da árvore, zero escrita em domínio alheio`)
} else {
  for (const v of violacoes) falhar(`escrita direta: ${v}`, "a árvore é consumidora, não dona")
}

// Nem sequer o cliente Prisma tem lugar dentro dos motores puros.
const puros = arquivosDe("src/lib/genealogia")
const comPrisma = puros.filter((f) => /from ["'][^"']*prisma["']/.test(ler(f)))
if (comPrisma.length === 0) ok("nenhum motor puro importa o cliente Prisma")
else falhar(`motor puro com prisma: ${comPrisma.join(", ")}`, "os motores são isomórficos")

// ── 8) O PREVIEW DE IMPACTO É READ-ONLY POR CONSTRUÇÃO ──────────────────────
console.log("\n8) o preview de impacto não grava")
const simulador = ler("src/services/genealogia/simular-impacto.ts")

if (/class RollbackDaSimulacao/.test(simulador) && /throw new RollbackDaSimulacao/.test(simulador)) {
  ok("a simulação termina sempre em rollback (sentinela lançada)")
} else {
  falhar(
    "o rollback da simulação sumiu",
    "sem o throw, a transação COMMITA — o preview passaria a gravar de verdade",
  )
}
if (/materializarGenealogia\(entrada\.processoId,\s*tx\)/.test(simulador)) {
  ok("a simulação roda o materializador OFICIAL, com o tx")
} else {
  falhar("a simulação deixou de usar o materializador oficial", "seria lógica documental duplicada")
}
// Só Pessoa e Uniao podem ser tocadas dentro da transação de simulação: são os
// cadastros cujos atributos as Regras Documentais leem.
const escritasNoSimulador = [...simulador.matchAll(/\bdb\.([a-zA-Z]+)\.(create|update|updateMany|delete|deleteMany|upsert)\s*\(/g)]
const modelosTocados = new Set(escritasNoSimulador.map((m) => m[1]))
const permitidos = new Set(["pessoa", "uniao"])
const excedentes = [...modelosTocados].filter((m) => !permitidos.has(m))
if (excedentes.length === 0) {
  ok("a simulação só toca Pessoa e Uniao (e reverte tudo)")
} else {
  falhar(`a simulação escreve em ${excedentes.join(", ")}`, "só Pessoa/Uniao entram na proposta")
}
// Só o CÓDIGO: o arquivo comenta longamente POR QUE não chama o motor
// financeiro, e um teste que casa com o próprio comentário reprova a explicação
// em vez do defeito.
const codigoSimulador = semComentarios(simulador)
if (/aplicarHonorarios\s*\(/.test(codigoSimulador)) {
  falhar(
    "a simulação chama o motor financeiro",
    "ele usa o prisma global: escreveria FORA da transação e o rollback não alcançaria",
  )
} else {
  ok("a simulação não chama o motor financeiro (escaparia do rollback)")
}

// ── 9) O EVENTO CANÔNICO DA UNIÃO ESTÁ LIGADO ───────────────────────────────
// Casar é mudança de estado civil, e é a união que produz a exigência de
// certidão de casamento. Este elo faltava e é o que fecha o §14.
console.log("\n9) união dispara o materializador oficial")
for (const rota of ["src/app/api/unioes/route.ts", "src/app/api/unioes/[id]/route.ts"]) {
  if (/dispararMaterializacaoPorArvore/.test(ler(rota))) ok(`${rota.split("/api/")[1]} conectada`)
  else falhar(`${rota} não dispara o materializador`, "casar deixaria a exigência sem nascer")
}

// ── veredito ────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60))
if (falhas === 0) {
  console.log(`${passos} verificações · inteligência da Árvore ÍNTEGRA ✅\n`)
  process.exit(0)
}
console.log(`${passos} passaram, ${falhas} falharam`)
console.log(`
A INTELIGÊNCIA DA ÁRVORE SAIU DO ACORDO.

O combinado é: modernizar a inteligência, preservar o design e não trazer para
dentro da árvore regra que pertence a outro módulo. Se a mudança foi pedida, é o
usuário quem libera — apagar uma verificação daqui é escolha consciente.
`)
process.exit(1)
