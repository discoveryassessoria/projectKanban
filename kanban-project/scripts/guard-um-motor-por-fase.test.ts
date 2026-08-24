// scripts/guard-um-motor-por-fase.test.ts
//
// UMA FASE, UM MOTOR.
//
// Seis fases têm tela própria, escrita antes do Workflow Interno existir: Análise,
// Tradução, Apostilamento, Emissão Retificada, Fase Final e Retificação. Cada uma
// conduz a fase por fora, com máquina de estados em JSON, e avisa o motor de que
// terminou chamando `concluirFaseBespokeEAvancar`.
//
// Esse aviso CONCLUI À FORÇA todos os passos obrigatórios — sem requisito, sem campo
// preenchido, sem ação escolhida. Enquanto os passos publicados estão vazios, é o
// certo: não há o que executar, e sem o atalho a fase nunca fecharia. No instante em
// que a fase ganha cadastro operacional, vira o oposto — o atalho dá por feito, em
// silêncio, exatamente o trabalho que o motor está pedindo.
//
// Este guard é de CÓDIGO. Ele não deixa a próxima rota bespoke nascer sem recusa, e
// não deixa o ponto de estrangulamento perder a última linha de defesa.
//
//   npx tsx scripts/guard-um-motor-por-fase.test.ts

import { readFileSync, existsSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"

const ROOT = join(__dirname, "..")
const read = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

function varrer(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next") continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) varrer(p, out)
    else if (nome === "route.ts") out.push(p)
  }
  return out
}

console.log("\nUMA FASE, UM MOTOR")

// ── 1. TODA ROTA QUE USA O ATALHO PRECISA RECUSAR ANTES ─────────────────────
const rotas = varrer(join(ROOT, "src/app/api"))
  .map((abs) => ({ rel: relative(ROOT, abs).replace(/\\/g, "/"), txt: readFileSync(abs, "utf8") }))
  .filter((r) => r.txt.includes("concluirFaseBespokeEAvancar("))

check("existem rotas que usam o atalho (senão o guard não guarda nada)", rotas.length > 0, `${rotas.length}`)
for (const r of rotas) {
  check(`recusa antes de usar o atalho: ${r.rel.split("processoId]/")[1] ?? r.rel}`,
    r.txt.includes("recusarSeCanonicoAssumiu("),
    "chama concluirFaseBespokeEAvancar sem perguntar de quem é a fase")
}

// ── 2. O PONTO DE ESTRANGULAMENTO É A ÚLTIMA LINHA ──────────────────────────
const alinhar = read("src/services/alinhar-workflow-fase.ts")
check("o atalho recusa por conta própria quando o motor canônico assumiu",
  alinhar.includes("motorVigenteDaFase(faseMacroKey)") && alinhar.includes("MOTOR_CANONICO_ASSUMIU"))
check("e a recusa é REPORTADA a quem chamou, não engolida",
  /recusado\??: "MOTOR_CANONICO_ASSUMIU"/.test(alinhar))

// ── 3. O ÁRBITRO É POR FASE, E NENHUMA FASE ESTÁ ESCRITA NELE ───────────────
const arbitro = read("src/services/motor-da-fase.ts")
check("o árbitro pergunta por fase, e não por uma lista fixa",
  arbitro.includes("export async function motorVigenteDaFase(phaseKey: string)"))
const corpo = arbitro.split("export async function motorVigenteDaFase")[1] ?? ""
check("ele exige as DUAS coisas: a decisão declarada no cadastro da fase…",
  arbitro.includes("conduzidaPeloWorkflowInterno"))
check("…e a versão publicada com cadastro operacional de verdade",
  arbitro.includes("lerVersaoPublicada(wf.id, wf.versao)") && arbitro.includes("comCadastro > 0"))
// A DERIVAÇÃO SOZINHA JÁ QUASE DESLIGOU UMA FASE VIVA. A Análise tinha 5/5 passos
// com cadastro publicado e ZERO ações canônicas executadas: o cadastro existia, a
// operação nunca migrou. Trocar de motor é decisão, não consequência.
// A comparação é DENTRO DA FUNÇÃO: `lerVersaoPublicada` aparece antes só porque o
// import está no topo do arquivo.
check("a decisão vem ANTES do cadastro na ordem da pergunta",
  corpo.indexOf("conduzidaPeloWorkflowInterno") >= 0 &&
  corpo.indexOf("conduzidaPeloWorkflowInterno") < corpo.indexOf("lerVersaoPublicada"))
// A ÚNICA fase citada no árbitro é a constante de compatibilidade — e ela não decide.
check("nenhuma fase decide nada dentro do árbitro",
  !/phaseKey === "|faseMacroKey === "/.test(corpo))

// ── 4. NINGUÉM MAIS CONCLUI PASSO À FORÇA POR FORA ──────────────────────────
const AUTORIZADOS_A_CONCLUIR_EM_LOTE: Record<string, string> = {
  "src/services/alinhar-workflow-fase.ts":
    "é o atalho, e o único — agora com a recusa dentro dele. Some quando as seis telas anteriores saírem.",
}
const arquivos: string[] = []
for (const dir of ["src/services", "src/lib", "src/app"]) {
  const base = join(ROOT, dir)
  if (!existsSync(base)) continue
  for (const abs of varrerTudo(base)) {
    const rel = relative(ROOT, abs).replace(/\\/g, "/")
    const txt = readFileSync(abs, "utf8")
    // Concluir passo DENTRO DE UM LAÇO sobre os passos da fase é a assinatura do
    // atalho. Concluir um passo escolhido pelo operador é o motor funcionando.
    if (/for \(const s of inst\.steps\)|for \(const s of .*\.steps\)/.test(txt) && txt.includes("concluirPasso(")) {
      arquivos.push(rel)
    }
  }
}
function varrerTudo(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next") continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) varrerTudo(p, out)
    else if (/\.tsx?$/.test(nome)) out.push(p)
  }
  return out
}
for (const arq of arquivos) {
  check(`autorizado a concluir passos em lote: ${arq}`, !!AUTORIZADOS_A_CONCLUIR_EM_LOTE[arq],
    "conclui todos os passos da fase de uma vez, fora do atalho conhecido")
}
const mortas = Object.keys(AUTORIZADOS_A_CONCLUIR_EM_LOTE).filter((k) => !arquivos.includes(k))
check("nenhuma exceção morta na allowlist", mortas.length === 0, mortas.join(", "))

// ── 5. A SAÚDE ENXERGA O CASO ───────────────────────────────────────────────
const saude = read("lib/saude/verificacoes/cadastro-execucao.ts")
check("existe verificação para fase que virou canônica com a tela anterior no ar",
  saude.includes("MTR-001") && saude.includes("motorVigenteDaFase"))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
