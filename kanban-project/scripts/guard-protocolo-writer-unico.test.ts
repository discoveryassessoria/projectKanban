// scripts/guard-protocolo-writer-unico.test.ts
//
// QUEM PODE CRIAR UM PROTOCOLO.
//
// `Protocolo` é o dono do fato "protocolo": número, data, órgão, responsável,
// comprovantes e o vínculo com os documentos. Enquanto três lugares diferentes
// criavam a linha por conta própria, cada um decidia sua própria idempotência — e
// protocolar duas vezes pelo caminho A não encontrava o que o caminho B tinha
// gravado.
//
// Este guard é de CÓDIGO: lê os arquivos e recusa um writer novo que não passe pela
// porta. Não substitui o teste de comportamento; impede a regressão silenciosa.
//
//   npx tsx scripts/guard-protocolo-writer-unico.test.ts

import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"

const ROOT = join(__dirname, "..")
const PORTA = "src/services/protocolo-canonico.ts"

/**
 * Escritas fora da porta, cada uma com o motivo e o que falta para sair daqui.
 * Uma entrada sem motivo não existe: allowlist sem razão escrita vira depósito.
 */
const AUTORIZADOS: Record<string, string> = {
  [PORTA]:
    "é a porta. Único lugar que executa `protocolo.create`; todos os outros caminhos passam por ela.",
  "src/app/api/protocolos/[protocoloId]/route.ts":
    "EDITA e APAGA um protocolo que já existe, pelo id. Não é um segundo caminho de criação — " +
    "é a manutenção do registro que a porta criou.",
  "src/app/api/gerenciamento/executor-motor/route.ts":
    "DESFAZ o que uma automação criou (`targetTable === 'Protocolo'` → delete). É rollback de " +
    "artefato, não criação.",
  "src/lib/motor/executor.ts":
    "DÍVIDA CONHECIDA: a automação legada de protocolo cria um placeholder sem número e sem data " +
    "(`consulado: OUTROS`, observação 'Criado pelo motor'). Não é o fato 'protocolo' — é um artefato " +
    "de automação, e as automações legadas já estão neutralizadas para tarefa, documento e avanço de " +
    "fase. SAÍDA: neutralizar também a regra de protocolo, junto das outras.",
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

function varrer(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next" || nome === ".git") continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) varrer(p, out)
    else if (/\.(ts|tsx)$/.test(nome)) out.push(p)
  }
  return out
}

const ESCRITA = /(?:prisma|tx|db)\s*\.\s*protocolo\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/

console.log("\nQUEM ESCREVE `Protocolo`")
const arquivos = [...varrer(join(ROOT, "src")), ...varrer(join(ROOT, "lib"))]
const escritores = new Map<string, string[]>()
for (const abs of arquivos) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/")
  const linhas = readFileSync(abs, "utf8").split("\n")
  const achadas = linhas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => ESCRITA.test(l) && !l.trim().startsWith("//"))
    .map(({ l, i }) => `${i + 1}: ${l.trim().slice(0, 90)}`)
  if (achadas.length) escritores.set(rel, achadas)
}

for (const [arq, linhas] of escritores) {
  const motivo = AUTORIZADOS[arq]
  check(`autorizado: ${arq}`, !!motivo,
    motivo ? undefined : `escreve Protocolo fora da porta:\n       ${linhas.join("\n       ")}\n       Use registrarProtocoloTx de ${PORTA}, ou declare a exceção com motivo.`)
}

// A PORTA PRECISA CONTINUAR SENDO A PORTA. Se ela deixar de criar, a allowlist
// inteira vira ficção.
check("a porta é quem cria", (escritores.get(PORTA) ?? []).some((l) => l.includes(".create(")))

// ENTRADA MORTA na allowlist é pior que ausência: dá a impressão de que alguém
// revisou aquele arquivo recentemente.
const mortas = Object.keys(AUTORIZADOS).filter((k) => !escritores.has(k))
check("nenhuma exceção morta na allowlist", mortas.length === 0, mortas.join(", "))

// OS DOIS CAMINHOS QUE EXISTIAM passam pela porta agora.
const solic = readFileSync(join(ROOT, "src/services/solicitacao-documento.ts"), "utf8")
check("a solicitação de documento protocola pela porta", solic.includes("registrarProtocoloTx("))
const rota = readFileSync(join(ROOT, "src/app/api/protocolos/route.ts"), "utf8")
check("a protocolização do dossiê protocola pela porta", rota.includes("registrarProtocoloTx("))
const efeitos = readFileSync(join(ROOT, "src/services/efeitos-de-dominio.ts"), "utf8")
check("o efeito da etapa protocola pela porta", efeitos.includes("registrarProtocoloTx("))

// E A ETAPA GUARDA REFERÊNCIA, NÃO CÓPIA.
check("o efeito grava o protocoloId na tentativa", /protocoloId: r\.protocoloId/.test(efeitos))
const catalogo = readFileSync(join(ROOT, "src/lib/motor/catalogo-de-efeitos.ts"), "utf8")
check("o efeito declara os campos que consome", /camposConsumidos: \["numero_protocolo"/.test(catalogo))
const exec = readFileSync(join(ROOT, "src/services/executar-acao-cadastrada.ts"), "utf8")
check("e o que foi consumido sai do payload", /for \(const k of def\.camposConsumidos \?\? \[\]\) delete valores\[k\]/.test(exec))

// O ÓRGÃO NÃO É ACHADO PELO NOME DO CAMPO — é achado pela estrutura.
check("o órgão do protocolo vem do campo de referência, não de um nome combinado",
  efeitos.includes('alvoDoCampo(c.opcoes) !== "ORGANIZACAO"') && !/valores\.(cartorio|orgao)\b/.test(efeitos))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
