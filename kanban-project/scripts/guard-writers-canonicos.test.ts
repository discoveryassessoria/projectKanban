// scripts/guard-writers-canonicos.test.ts
//
// PARA CADA COISA QUE MUDA DE ESTADO, UMA PORTA SÓ.
//
// A pergunta que este guard responde é sempre a mesma: se dois lugares escrevem o
// mesmo estado, qual deles está certo? A resposta correta é que a pergunta não deve
// poder ser feita. Foi tendo duas máquinas de passo que este sistema produziu passo
// concluído com tarefa não iniciada; foi tendo dois caminhos de conclusão que a
// mesma etapa aparecia no histórico por um e sumia pelo outro.
//
// Cada regra abaixo declara: o ESTADO, quem é o DONO, e quem mais pode tocar — pelo
// nome, com o motivo. Arquivo que escreve sem estar na lista reprova. Nome na lista
// que não escreve mais também reprova: allowlist com entrada morta é allowlist que
// ninguém lê.

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

function arquivos(...dirs: string[]): string[] {
  const saida: string[] = []
  for (const dir of dirs) {
    const base = join(ROOT, dir)
    if (!existsSync(base)) continue
    const andar = (d: string) => {
      for (const nome of readdirSync(d)) {
        const p = join(d, nome)
        if (nome === "node_modules" || nome === ".next") continue
        if (statSync(p).isDirectory()) andar(p)
        else if (nome.endsWith(".ts") || nome.endsWith(".tsx")) saida.push(relative(ROOT, p))
      }
    }
    andar(base)
  }
  return saida
}

const RUNTIME = arquivos("src", "lib").filter((f) => !f.includes("/scripts/"))

interface Regra {
  estado: string
  /** Como o estado é escrito, em regex sobre o código sem comentários. */
  escrita: RegExp
  dono: string
  porQue: string
  /** Outros arquivos autorizados, com o motivo de cada um. */
  tambem: Record<string, string>
}

const REGRAS: Regra[] = [
  {
    // MUDAR o estado de um passo que já existe. Criar é outra coisa, logo abaixo.
    estado: "ESTADO DO PASSO (transição de uma etapa existente)",
    escrita: /phaseWorkflowStepInstance\.(update|updateMany)\(\{[\s\S]{0,400}?status:/,
    dono: "src/services/task-step-sync.ts",
    porQue: "é a máquina de estados do passo: valida precedência, dependência, faz CAS e emite o evento",
    tambem: {},
  },
  {
    // CRIAR a instância de um passo — materializar o roteiro. É construção do grafo,
    // não execução dentro dele, e por isso tem dono próprio.
    //
    // `reconciliar-fase.ts` NÃO aparece aqui, e é o resultado certo: ele converge
    // chamando as portas, sem escrever passo por conta própria. Foi este guard que
    // mostrou isso — a suspeita inicial era de que ele escrevesse.
    estado: "CRIAÇÃO DE PASSO (materialização do roteiro)",
    escrita: /phaseWorkflowStepInstance\.(create|createMany|upsert)\(/,
    dono: "src/services/phase-workflow.ts",
    porQue: "a materialização é o único lugar que decide quantas instâncias um passo publicado gera e presas a qual entidade",
    tambem: {
      "src/services/genealogia/materializar-genealogia.ts":
        "MATERIALIZAÇÃO DA GENEALOGIA: cria os passos por registro a localizar, pela mesma regra de cardinalidade",
      "src/services/documento-operacao.ts":
        "INICIAR OPERAÇÃO por documento: materializa (upsert idempotente) o roteiro documental da visita atual",
    },
  },
  {
    estado: "FASE ATUAL DO PROCESSO",
    escrita: /processo\.(update|updateMany)\(\{[\s\S]{0,300}?faseAtualKey:/,
    dono: "src/lib/motor/phase-advance.ts",
    porQue: "é o único que faz CAS por lockVersion e registra PhaseAdvanceLog — mudar fase sem rastro é o que impede reconstruir por que um processo está onde está",
    tambem: {},
  },
  {
    estado: "TENTATIVA DE EXECUÇÃO",
    escrita: /stepExecution\.(create|createMany|update|updateMany)/,
    dono: "src/services/execucao-do-passo.ts",
    porQue: "é onde a substituição preserva o que a execução anterior registrou; escrever fora daqui é reabrir a porta para desconcluir o passado",
    tambem: {
      "src/services/operacao-da-etapa.ts":
        "PAYLOAD OPERACIONAL: grava o que foi preenchido na tentativa vigente, sem tocar em status nem em substituição",
    },
  },
  {
    estado: "CONFIGURAÇÃO PUBLICADA (versão congelada)",
    escrita: /phaseInternalWorkflowVersao\.(create|createMany|update|updateMany|delete|deleteMany)/,
    dono: "src/services/versao-publicada.ts",
    porQue: "versão congelada é fato passado: nada no runtime escreve numa linha dessas depois de criada",
    tambem: {},
  },
  {
    estado: "LINHAGEM DOCUMENTAL (derivação e substituição)",
    escrita: /documento\.(update|updateMany|create)\(\{[\s\S]{0,400}?(derivadoDeId|substituidoEm):/,
    dono: "src/services/efeitos-de-dominio.ts",
    porQue: "nova via e retificação passam pelo efeito, que preserva o documento anterior e mantém a necessidade única",
    tambem: {},
  },
]

console.log("\nWRITERS CANÔNICOS — uma porta por estado\n")

for (const r of REGRAS) {
  const escrevem = RUNTIME.filter((f) => r.escrita.test(semComentarios(ler(f))))
  const autorizados = new Set([r.dono, ...Object.keys(r.tambem)])
  const invasores = escrevem.filter((f) => !autorizados.has(f))
  const donoEscreve = escrevem.includes(r.dono)

  console.log(`  ${r.estado}`)
  console.log(`     dono: ${r.dono}`)
  check(`  o dono realmente escreve ${r.estado}`, donoEscreve,
    donoEscreve ? "" : "a regra aponta para um dono que não escreve — regra desatualizada")
  check(`  ninguém escreve ${r.estado} fora das portas`, invasores.length === 0,
    invasores.length ? `${invasores.join(", ")} — ${r.porQue}` : "")
  for (const [arquivo, motivo] of Object.entries(r.tambem)) {
    const escreve = escrevem.includes(arquivo)
    check(`  autorização viva: ${arquivo}`, escreve, escreve ? "" : `não escreve mais — ${motivo} (remova a autorização)`)
  }
  console.log("")
}

// ════════════════════════════════════════════════════════════════
console.log("NENHUM CAMINHO LEGADO ATIVO")
// ════════════════════════════════════════════════════════════════

// Marcas de legado que já foram desligadas neste sistema. Se voltarem a ser chamadas
// do runtime, é regressão — e regressão silenciosa, porque o código continua lá.
const DESLIGADOS: Array<{ marca: RegExp; oQueEra: string }> = [
  { marca: /\bgerarDocumentosGenealogia\b/, oQueEra: "gerador documental antigo da genealogia" },
  { marca: /\bexecutarAutomacaoTask\b/, oQueEra: "automação de tarefa legada" },
  { marca: /\bexecutarAutomacaoPhaseAdvance\b/, oQueEra: "avanço de fase por automação legada" },
]
for (const d of DESLIGADOS) {
  const chamam = RUNTIME.filter((f) => d.marca.test(semComentarios(ler(f))))
  check(`${d.oQueEra} continua desligado`, chamam.length === 0, chamam.join(", "))
}

// A operação da etapa: o blob antigo não pode voltar a ser escrito por ninguém.
const escrevemBlob = RUNTIME.filter((f) => /metadata:\s*\{\s*operacao:/.test(semComentarios(ler(f))))
check("o blob `metadata.operacao` não é escrito por ninguém", escrevemBlob.length === 0, escrevemBlob.join(", "))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
