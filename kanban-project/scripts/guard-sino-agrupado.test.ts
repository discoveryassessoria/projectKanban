// scripts/guard-sino-agrupado.test.ts
// ============================================================================
// GUARD DE ARQUITETURA — o sino agrupado (redesenho de 29/09/2026). SEM banco.
// Rodar: npx tsx scripts/guard-sino-agrupado.test.ts
//
// O que este guard TRAVA (para o sino nunca voltar a ser um aviso por certidão):
//   1. UMA porta de escrita: só `notificacao-canonica.ts` cria/atualiza/apaga
//      `notificacaoOperacional` fora de testes/scripts de manutenção.
//   2. O emissor LEGADO `notificarAcontecimento` (um aviso por tarefa) não tem chamador
//      de produção.
//   3. O GET do sino lê SÓ a tabela: nenhum balde recalculado de `Tarefa`.
//   4. Nenhum link de aviso aponta para `/kanban`.
//   5. O resumo das 07:00 (São Paulo) está agendado como `0 10 * * *` (UTC), e a
//      varredura horária continua horária.
//   6. O texto do aviso: sempre "tarefa(s)"/nome da família, plural/singular certos.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { textoDoAviso, resumoTemConteudo } from "../lib/operacional/aviso-texto"

const RAIZ = join(__dirname, "..")
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8")
const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

let ok = 0
const falhas: string[] = []
const check = (nome: string, cond: boolean, extra = "") => {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(join(RAIZ, dir))) {
    if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue
    const rel = join(dir, n)
    const st = statSync(join(RAIZ, rel))
    if (st.isDirectory()) arquivos(rel, acc)
    else if (/\.(ts|tsx)$/.test(n)) acc.push(rel)
  }
  return acc
}
const producao = [...arquivos("lib"), ...arquivos("src")]

console.log("\nGUARD — SINO AGRUPADO\n")

// ── 1. UMA PORTA DE ESCRITA ────────────────────────────────────────────────
console.log("1. uma porta de escrita")
const ESCRITAS = /notificacaoOperacional\s*\.\s*(create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/
const escritores = producao.filter((f) => ESCRITAS.test(semComentarios(ler(f))))
check("só notificacao-canonica.ts escreve NotificacaoOperacional em produção",
  escritores.length === 1 && escritores[0] === join("lib", "operacional", "notificacao-canonica.ts"), escritores.join(", "))

// ── 2. O EMISSOR LEGADO NÃO TEM CHAMADOR ───────────────────────────────────
console.log("2. emissor legado sem chamador")
const chamadoresLegado = producao.filter((f) =>
  f !== join("lib", "operacional", "notificacao-canonica.ts") && /notificarAcontecimento\s*\(/.test(semComentarios(ler(f))))
check("ninguém em produção chama notificarAcontecimento (um aviso por tarefa)", chamadoresLegado.length === 0, chamadoresLegado.join(", "))
const removidos = ["avisarPrazosEAtrasos", "avisarAcontecimentosOperacionais", "avisarAtencaoConsolidada"]
const voltou = producao.filter((f) => removidos.some((n) => new RegExp(`\\b${n}\\b`).test(semComentarios(ler(f)))))
check("os três varredores por tarefa não existem mais", voltou.length === 0, voltou.join(", "))

// ── 3. O GET DO SINO LÊ SÓ A TABELA ────────────────────────────────────────
console.log("3. o sino lê só a tabela")
const rotaSino = semComentarios(ler("src/app/api/notificacoes/route.ts"))
check("GET /api/notificacoes não consulta Tarefa", !/prisma\s*\.\s*tarefa\b/.test(rotaSino) && !/\bSTATUS_TERMINAIS\b/.test(rotaSino))
check("nenhum balde recalculado (vencidas/hoje/proximos3Dias/novas)", !/\b(proximos3Dias|vencidas|hojeList|novas)\b/.test(rotaSino))
const sinoUI = semComentarios(ler("src/components/sino-notificacoes.tsx"))
check("a UI do sino não recalcula prazo", !/\b(dataPrazo|proximos3Dias|vencidas)\b/.test(sinoUI))
for (const h of ["src/components/header-bar.tsx", "src/components/header-bar-app.tsx"]) {
  const src = ler(h)
  check(`${h} usa o sino único`, src.includes("<SinoNotificacoes />") && !src.includes("/api/notificacoes"))
}

// ── 3b. UM SINO SÓ ─────────────────────────────────────────────────────────
console.log("3b. um sino só")
const opv3 = semComentarios(ler("src/components/operacao/operacao-v3.tsx"))
check("a Operação não tem sininho próprio (segunda fonte de avisos)", !/notifOpen|setNotifOpen|Notificações operacionais|🔔/.test(opv3))
check("a Operação não monta lista de avisos recalculada (notifs)", !/\bnotifs\b/.test(opv3))
const spec = ler("tests/ui/operacao-v3.spec.ts")
check("o teste de UI afirma que o sininho interno NÃO existe", /Notificações operacionais[^\n]*\)\)\.toHaveCount\(0\)/.test(spec))

// ── 4. NENHUM LINK PARA /kanban ────────────────────────────────────────────
console.log("4. links do sino")
for (const f of ["lib/operacional/avisos-fatos.ts", "lib/operacional/avisos-sino.ts", "lib/operacional/notificacao-canonica.ts"]) {
  check(`${f} não linka /kanban`, !/\/kanban/.test(semComentarios(ler(f))))
}
const nav = ler("lib/operacional/navegacao.ts")
check("link de fila: /operacao?processo=<id>&aba=fila", /urlOperacaoDaFamilia/.test(nav) && /'aba'/.test(nav))

// ── 5. AGENDAMENTO ─────────────────────────────────────────────────────────
console.log("5. agendamento")
const vercel = JSON.parse(ler("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
const diario = vercel.crons.find((c) => c.path === "/api/cron/resumo-diario")
check("resumo diário agendado às 10:00 UTC = 07:00 America/Sao_Paulo (sem horário de verão)", diario?.schedule === "0 10 * * *", diario?.schedule)
const horario = vercel.crons.find((c) => c.path === "/api/cron/avisos-prazo")
check("varredura horária continua de hora em hora", horario?.schedule === "0 * * * *", horario?.schedule)
check("o horário está documentado na rota do resumo diário", /07:00/.test(ler("src/app/api/cron/resumo-diario/route.ts")) && /horário de verão/.test(ler("src/app/api/cron/resumo-diario/route.ts")))

// ── 6. TEXTO ───────────────────────────────────────────────────────────────
console.log("6. texto do aviso")
check("1 tarefa atribuída", textoDoAviso("CHEGOU_TRABALHO", "Cibils", { contagem: 1 }) === "Cibils — 1 tarefa atribuída a você")
check("3 tarefas atribuídas", textoDoAviso("CHEGOU_TRABALHO", "Cibils", { contagem: 3 }) === "Cibils — 3 tarefas atribuídas a você")
check("1 tarefa saiu da fila", textoDoAviso("MUDOU_DE_MAO", "Cibils", { contagem: 1 }) === "Cibils — 1 tarefa saiu da sua fila")
check("N tarefas saíram da fila", textoDoAviso("MUDOU_DE_MAO", "Cibils", { contagem: 4 }) === "Cibils — 4 tarefas saíram da sua fila")
check("PRECISA_AGIR completo, partes zeradas omitidas",
  textoDoAviso("PRECISA_AGIR", "Antão", { contagem: 6, resumo: { vencidas: [1, 2], hoje: [3], amanha: [4], cobrancas: [5, 6], modo: "FOTO" } })
    === "Antão — 2 vencidas · 1 vence hoje · 1 vence amanhã · 2 cobranças a fazer")
check("PRECISA_AGIR só '1 vence amanhã'", textoDoAviso("PRECISA_AGIR", "Antão", { contagem: 1, resumo: { amanha: [9], modo: "FOTO" } }) === "Antão — 1 vence amanhã")
check("PRECISA_AGIR 'vencem hoje' no plural", textoDoAviso("PRECISA_AGIR", "X", { contagem: 3, resumo: { hoje: [1, 2, 3] } }) === "X — 3 vencem hoje")
check("fato novo: '1 nova vencida'",
  textoDoAviso("PRECISA_AGIR", "Cibils", { contagem: 3, resumo: { modo: "NOVOS", vencidas: [1, 2, 3], base: { vencidas: [1, 2], cobrancas: [] } } }) === "Cibils — 1 nova vencida")
check("fato novo: nova cobrança", textoDoAviso("PRECISA_AGIR", "Cibils", { contagem: 1, resumo: { modo: "NOVOS", cobrancas: [7], base: { vencidas: [], cobrancas: [] } } }) === "Cibils — 1 nova cobrança a fazer")
check("sem nome de família: 'Tarefas avulsas'", textoDoAviso("CHEGOU_TRABALHO", null, { contagem: 2 }).startsWith("Tarefas avulsas — 2 tarefas"))
check("gestor: sem responsável", textoDoAviso("SEM_RESPONSAVEL", "Cibils", { contagem: 7 }) === "Cibils — 7 tarefas sem responsável há mais de 1 dia")
check("gestor: escalada", textoDoAviso("ESCALADA", "Cibils", { contagem: 1 }) === "Cibils — 1 tarefa com 2ª cobrança sem resposta")
check("foto vazia não tem conteúdo", !resumoTemConteudo({ vencidas: [], hoje: [], amanha: [], cobrancas: [] }) && !resumoTemConteudo(null))
check("modo NOVOS sem novo não tem conteúdo", !resumoTemConteudo({ modo: "NOVOS", vencidas: [1], base: { vencidas: [1], cobrancas: [] } }))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
