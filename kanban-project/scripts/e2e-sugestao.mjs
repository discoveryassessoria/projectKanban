// scripts/e2e-sugestao.mjs
// ============================================================================
// "SUGERIR RESPONSÁVEL" PELO NAVEGADOR.
//
//   node scripts/e2e-sugestao.mjs <base> <saida> <tokGestor> <tokFunc>
//
// A recomendação é uma opinião com consequências: o gestor vai confiar nela. O
// teste faz o caminho dele — vê a ação, lê a explicação, confere a conta, e
// então prova a coisa mais importante: DEPOIS DE TUDO ISSO, nada mudou.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_GESTOR, TOK_FUNC] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()
async function sessao(tokPath) {
  const token = readFileSync(tokPath, "utf8").trim()
  const user = readFileSync(tokPath + ".user", "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem("authToken", t); localStorage.setItem("user", u)
  }, [token, user])
  return { page, token }
}
const gestor = await sessao(TOK_GESTOR)
const func = await sessao(TOK_FUNC)
const api = async (s, url) => {
  const r = await s.page.request.get(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}` } })
  return { status: r.status(), body: r.ok() ? await r.json() : null }
}
const CTX = JSON.parse(process.env.CTX_GERENCIAL ?? "{}")
const SEM_DONO = CTX.tarefas?.["sem-dono"]

console.log("E2E — SUGERIR RESPONSÁVEL (simulação)\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§14 · A ação existe onde deve existir — e só lá")
// ═══════════════════════════════════════════════════════════════════════════
await gestor.page.goto(`${BASE}/tarefas`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(3500)
await gestor.page.locator('input[placeholder="Buscar tarefa, pessoa ou processo…"]').fill("GERENCIAL")
await gestor.page.waitForTimeout(2500)

const linhas = gestor.page.locator("table tbody tr")
const semDonoRow = linhas.filter({ hasText: "Sem responsável" }).first()
await semDonoRow.hover()
await gestor.page.waitForTimeout(500)
ok("§14) a linha sem responsável oferece 'Sugerir'",
  await semDonoRow.locator("button").filter({ hasText: "Sugerir" }).count() > 0)
const comDonoRow = linhas.filter({ hasText: "Daniela Brait" }).first()
await comDonoRow.hover()
await gestor.page.waitForTimeout(400)
ok("§11) a linha JÁ atribuída não oferece sugestão — redistribuir é outro problema",
  await comDonoRow.locator("button").filter({ hasText: "Sugerir" }).count() === 0)

// ═══════════════════════════════════════════════════════════════════════════
secao("§4/§13 · O painel mostra a conta inteira")
// ═══════════════════════════════════════════════════════════════════════════
await semDonoRow.locator("button").filter({ hasText: "Sugerir" }).first().click()
await gestor.page.waitForTimeout(3000)
const painel = await gestor.page.locator("body").innerText()
// Os rótulos de seção são maiúsculos por CSS e `innerText` devolve o texto
// RENDERIZADO — comparar com a string do código falha por caixa, não por defeito.
ok("§14) o painel abre", /sugerir respons[áa]vel/i.test(painel))
ok("§4) com uma recomendação ou uma abstenção explícita",
  /Recomendação:/.test(painel) || /Sem recomendação automática/.test(painel))
ok("§4) explica que a pessoa tem permissão", /tem permissão para executar/.test(painel))
ok("§13) mostra os elegíveis", /eleg[íi]veis\s*·\s*\d/i.test(painel))
ok("§13) com a carga de cada um", /executáveis/.test(painel) && /aguardando terceiro/.test(painel))
ok("§13) e o custo operacional", /custo\s+\d/i.test(painel))
await gestor.page.screenshot({ path: `${OUT}/sug-1-painel.png` })

await gestor.page.getByRole("button", { name: /Como esta conta foi feita/ }).click()
await gestor.page.waitForTimeout(1200)
const auditor = await gestor.page.locator("body").innerText()
ok("§13) o modo auditor decompõe o score", /× \d/.test(auditor))
ok("§1) e declara o que o sistema NÃO sabe", /não existem no cadastro/.test(auditor))
ok("§1) inclusive férias e afastamentos", /férias/i.test(auditor))
ok("§12) e a ausência de capacidade cadastrada", /capacidade máxima/i.test(auditor))
ok("§1) e que equipe não restringe", /não concede permissão/i.test(auditor))
await gestor.page.screenshot({ path: `${OUT}/sug-2-auditor.png`, fullPage: true })

// ═══════════════════════════════════════════════════════════════════════════
secao("§15 · O gestor continua sendo quem confirma")
// ═══════════════════════════════════════════════════════════════════════════
ok("§15) o painel diz que nada foi alterado", /Nada foi alterado/.test(painel))
await gestor.page.getByRole("button", { name: "Atribuir…" }).click()
await gestor.page.waitForTimeout(2000)
const seletor = await gestor.page.locator("body").innerText()
ok("§15) confirmar abre o MESMO seletor canônico, não uma porta nova",
  /Atribuir tarefa/.test(seletor) && /ativa/.test(seletor))
await gestor.page.getByRole("button", { name: "Cancelar" }).click()
await gestor.page.waitForTimeout(1200)

// ═══════════════════════════════════════════════════════════════════════════
secao("§7/§8 · Simulação individual e em lote")
// ═══════════════════════════════════════════════════════════════════════════
const ind = await api(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
ok("§7) a simulação individual responde", ind.status === 200)
ok("§7) para a tarefa pedida", ind.body?.simulacao?.taskId === SEM_DONO)
ok("§7) com elegíveis e inelegíveis", Array.isArray(ind.body?.simulacao?.avaliacoes))
const lote = await api(gestor, "/api/operacao/sugestao?lote=1")
ok("§8) o lote responde por várias tarefas", (lote.body?.recomendacoes?.length ?? 0) > 0,
  `${lote.body?.recomendacoes?.length} tarefa(s)`)
ok("§8) com resumo por usuário", Array.isArray(lote.body?.resumo?.porUsuario))
ok("§8) e o total bate", lote.body?.resumo?.total === lote.body?.recomendacoes?.length)
const semRec = (lote.body?.recomendacoes ?? []).filter((r) => !r.recomendado)
ok("§5) quando não há recomendação segura, vem o motivo",
  semRec.every((r) => r.abstencao?.codigo && r.abstencao?.texto),
  semRec.length ? semRec.map((r) => r.abstencao.codigo).join(", ") : "todas tiveram recomendação")

// ═══════════════════════════════════════════════════════════════════════════
secao("§19 · Ver a carga alheia é ato de gestão")
// ═══════════════════════════════════════════════════════════════════════════
const proibido = await api(func, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
ok("§19) funcionário sem permissão gerencial recebe 403", proibido.status === 403, `HTTP ${proibido.status}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§I · A PROVA: depois de tudo isso, nada mudou")
// ═══════════════════════════════════════════════════════════════════════════
const estado = async () => {
  const r = await api(gestor, "/api/operacao/visao-global?busca=GERENCIAL&incluirEncerradas=1")
  return JSON.stringify((r.body?.linhas ?? []).map((l) => [l.taskId, l.responsavelId, l.statusTarefa]))
}
const antes = await estado()
await api(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
await api(gestor, "/api/operacao/sugestao?lote=1")
await gestor.page.reload({ waitUntil: "domcontentloaded" })
await gestor.page.waitForTimeout(2500)
const depois = await estado()
ok("§I) nenhum responsavelId mudou, nenhum status mudou", antes === depois)
ok("§I) a tarefa sugerida continua SEM responsável",
  (await api(gestor, `/api/operacao/tarefas/${SEM_DONO}`)).body?.tarefa?.responsavelId == null)

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
