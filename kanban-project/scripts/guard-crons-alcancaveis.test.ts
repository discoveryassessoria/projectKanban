// scripts/guard-crons-alcancaveis.test.ts
//
// UM CRON AGENDADO E INALCANÇÁVEL É PIOR QUE UM CRON AUSENTE.
//
// Ausente, alguém percebe: o efeito nunca acontece e a falta aparece. Agendado e
// bloqueado, o sistema PARECE ter a garantia — o `vercel.json` diz que roda de hora
// em hora — enquanto a Vercel bate na porta e recebe 401, todas as vezes, sem que
// ninguém veja. Foi o que houve com três crons deste projeto durante três meses:
// o diagnóstico automático, os avisos de prazo e o reconciliador de fases.
//
// Este guard fecha o circuito: agendou, tem de estar alcançável; alcançável, tem de
// se auto-verificar. As duas coisas, para todo cron, sempre.

import { readFileSync, existsSync } from "fs"
import { join } from "path"

const ROOT = join(__dirname, "..")
const ler = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const vercel = JSON.parse(ler("vercel.json")) as { crons: Array<{ path: string; schedule: string }> }
const middleware = ler("middleware.ts")

console.log("\nCRONS ALCANÇÁVEIS E AUTOVERIFICADOS\n")
check("o vercel.json declara crons", (vercel.crons?.length ?? 0) > 0)

for (const cron of vercel.crons ?? []) {
  console.log(`  ${cron.path}  (${cron.schedule})`)

  // 1. A ROTA EXISTE.
  const arquivo = `src/app${cron.path}/route.ts`
  const src = ler(arquivo)
  check(`    a rota existe`, src.length > 0, arquivo)

  // 2. O MIDDLEWARE DEIXA CHEGAR. Sem isto, a Vercel recebe 401 e nada acontece —
  // e o silêncio é indistinguível de "rodou e não tinha o que fazer".
  check(`    o middleware deixa a Vercel chegar`, middleware.includes(`"${cron.path}"`),
    `acrescente "${cron.path}" a API_PUBLICA — e confira antes que o handler se auto-verifique`)

  // 3. O HANDLER SE AUTOVERIFICA. Estar em API_PUBLICA é abrir a porta; quem decide
  // quem entra continua sendo o handler.
  // O que se cobra são os DOIS caminhos de máquina — o header que a Vercel injeta e o
  // segredo. O caminho do operador é opcional: `cambio` é job só-de-máquina e não
  // precisa de um, e exigi-lo reprovaria um handler correto.
  const seVerifica = src.includes("x-vercel-cron") && src.includes("CRON_SECRET")
  check(`    o handler se autoverifica (header da Vercel + segredo)`, seVerifica,
    seVerifica ? "" : "rota pública sem gate próprio é rota aberta")

  // 4. RESPONDE A GET. A Vercel chama por GET.
  check(`    responde a GET`, /export\s+(async\s+)?function\s+GET/.test(src) || /export\s+const\s+GET/.test(src))
}

// 5. NENHUMA ROTA DE CRON FICOU ABERTA SEM ESTAR AGENDADA — o inverso também importa:
// abrir uma rota que ninguém agenda é superfície sem propósito.
const agendados = new Set((vercel.crons ?? []).map((c) => c.path))
const abertos = [...middleware.matchAll(/"(\/api\/cron\/[\w-]+)"/g)].map((m) => m[1])
const semAgenda = [...new Set(abertos)].filter((p) => !agendados.has(p))
check("nenhuma rota de cron aberta sem agendamento", semAgenda.length === 0, semAgenda.join(", "))

console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
