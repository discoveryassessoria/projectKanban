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

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
