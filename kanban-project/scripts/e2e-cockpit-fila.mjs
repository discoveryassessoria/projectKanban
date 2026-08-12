// scripts/e2e-cockpit-fila.mjs
// ============================================================================
// A MINHA FILA COMO COCKPIT — e as invariantes pelos cliques reais.
//
//   node scripts/e2e-cockpit-fila.mjs <base> <saida> <tokGestor> <tokFunc>
//
// Prova o caminho do funcionário: ele abre a fila e sabe o que fazer sem abrir
// tarefa nenhuma. E prova as invariantes onde elas realmente falharam — na tela:
// atribuir não inicia, abrir não inicia, clicar duas vezes não duplica início.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_GESTOR, TOK_FUNC] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
let passou = 0, falhou = 0
const falhas = []
const ok = (n, c, e = "") => { if (c) { passou++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) } }
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()
async function sessao(tokPath) {
  const token = readFileSync(tokPath, "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } })
  await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", u) },
    [token, readFileSync(tokPath + ".user", "utf8").trim()])
  return { page, token }
}
const gestor = await sessao(TOK_GESTOR)
const func = await sessao(TOK_FUNC)
const get = async (s, url) => {
  const r = await s.page.request.get(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}` } })
  return { status: r.status(), body: r.ok() ? await r.json() : null }
}
const CTX = JSON.parse(process.env.CTX_GERENCIAL ?? "{}")
const T = CTX.tarefas ?? {}
const detalhe = async (id) => (await get(gestor, `/api/operacao/tarefas/${id}`)).body?.tarefa

console.log("E2E — MINHA FILA COMO COCKPIT\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§33/§37 · Atribuir e abrir NÃO iniciam — pela tela")
// ═══════════════════════════════════════════════════════════════════════════
const SEM_DONO = T["sem-dono"]
await gestor.page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(4000)
// A LINHA CERTA, não a primeira: o palco tem várias tarefas sem dono, e
// clicar no primeiro "Atribuir" atribuía outra tarefa — o teste então media o
// trabalho errado. Miramos pela pessoa da tarefa alvo.
const linhaAlvo = gestor.page.locator("div.group").filter({ hasText: "João da Silva" }).first()
ok("§1) a tarefa alvo está na aba Sem responsável", await linhaAlvo.count() > 0)
const atribuir = linhaAlvo.locator("button").filter({ hasText: "Atribuir" }).first()
if (await atribuir.count()) {
  await atribuir.click()
  await gestor.page.waitForTimeout(1800)
  await gestor.page.locator("button").filter({ hasText: "daniela@gerencial.test" }).first().click()
  await gestor.page.waitForTimeout(3000)
}
const posAtribuir = await detalhe(SEM_DONO)
ok("§33) atribuir pela tela NÃO inicia", posAtribuir?.statusTarefa === "NAO_INICIADA", posAtribuir?.statusTarefa)
ok("§33) e não preenche data de início", posAtribuir?.tempos?.iniciadaEm == null)

// abrir o dossiê três vezes
await func.page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
await func.page.waitForTimeout(4000)
for (let i = 0; i < 3; i++) {
  const card = func.page.locator("button.cursor-pointer").filter({ hasText: "João da Silva" }).first()
  if (await card.count()) { await card.click(); await func.page.waitForTimeout(2200)
    const fechar = func.page.getByRole("button", { name: "Fechar" }).first()
    if (await fechar.count()) { await fechar.click(); await func.page.waitForTimeout(1200) } }
}
const posAbrir = await detalhe(SEM_DONO)
ok("§37) abrir a tarefa três vezes NÃO inicia", posAbrir?.statusTarefa === "NAO_INICIADA", posAbrir?.statusTarefa)
const hist = (posAbrir?.timeline ?? []).filter((f) => f.tipo === "tarefa" && /iniciad/i.test(f.texto))
ok("§37) e nenhum evento de início foi criado", hist.length === 0, `${hist.length}`)

// ═══════════════════════════════════════════════════════════════════════════
secao("§16/§17/§24 · O cartão diz o que fazer sem abrir a tarefa")
// ═══════════════════════════════════════════════════════════════════════════
await func.page.reload({ waitUntil: "domcontentloaded" })
await func.page.waitForTimeout(4000)
const fila = await func.page.locator("body").innerText()
ok("§16) mostra o estado operacional", /Não iniciada|Em andamento|Aguardando/i.test(fila))
ok("§16) mostra a etapa em nome de gente", /Solicitar certidão|Receber certidão|Localizar registro/i.test(fila))
ok("§9) e NÃO mostra chave técnica", !/solicitar_certidao|receber_certidao|aguardar_retorno/i.test(fila))
ok("§17) o prazo vem derivado, não só a data",
  /Vence em \d+ dias|Vence hoje|Vence amanhã|Atrasada há \d+ dia|Sem prazo/i.test(fila))
ok("§24) e existe uma ação principal", /Iniciar tarefa|Continuar/i.test(fila))
ok("§23) com filtros por recorte", /A fazer/i.test(fila) && /Em andamento/i.test(fila))
ok("§21) bloqueio mostra o motivo no cartão", !/Bloqueada/i.test(fila) || /Bloqueio:/i.test(fila))
ok("§20) espera mostra há quanto tempo", !/Aguardando terceiro/i.test(fila) || /há \d+ dia/i.test(fila))
await func.page.screenshot({ path: `${OUT}/fila-cockpit.png`, fullPage: true })

// ═══════════════════════════════════════════════════════════════════════════
secao("§34 · Iniciar pela tela — explícito e idempotente")
// ═══════════════════════════════════════════════════════════════════════════
// O cartão DA TAREFA ALVO — clicar no primeiro "Iniciar tarefa" da fila
// iniciaria o trabalho de outra pessoa e o teste mediria a tarefa errada.
const cartaoAlvo = func.page.locator("div.border-b").filter({ hasText: "João da Silva" }).first()
const botaoIniciar = cartaoAlvo.getByRole("button", { name: /^Iniciar tarefa$/ })
ok("§11) a tarefa A FAZER oferece INICIAR", await botaoIniciar.count() > 0)
if (await botaoIniciar.count()) {
  await botaoIniciar.click()
  await func.page.waitForTimeout(3500)
  const fechar = func.page.getByRole("button", { name: "Fechar" }).first()
  if (await fechar.count()) { await fechar.click(); await func.page.waitForTimeout(1500) }
}
const iniciada = await detalhe(SEM_DONO)
ok("§34) status virou EM ANDAMENTO", iniciada?.statusTarefa === "EM_ANDAMENTO", iniciada?.statusTarefa)
const inicioDaTarefa = (t) => (t?.timeline ?? []).filter((f) => f.tipo === "tarefa" && /iniciad/i.test(f.texto))
const umInicio = inicioDaTarefa(iniciada)
ok("§34) UM evento de início da TAREFA", umInicio.length === 1, `${umInicio.length}`)
ok("§29) e a etapa tem o evento dela, separado",
  (iniciada?.timeline ?? []).some((f) => f.tipo === "etapa" && /iniciad/i.test(f.texto)))

// repetir pelo comando, como um duplo-clique faria
for (let i = 0; i < 3; i++) {
  await func.page.request.post(`${BASE}/api/tarefas/${SEM_DONO}/comando`, {
    headers: { Authorization: `Bearer ${func.token}`, "Content-Type": "application/json" },
    data: { acao: "iniciar" },
  })
}
const depoisDeRepetir = await detalhe(SEM_DONO)
const inicios = inicioDaTarefa(depoisDeRepetir)
ok("§34) repetir NÃO duplica o histórico", inicios.length === 1, `${inicios.length} evento(s)`)
ok("§34) e a data de início não mudou",
  depoisDeRepetir?.tempos?.iniciadaEm === iniciada?.tempos?.iniciadaEm)

// ═══════════════════════════════════════════════════════════════════════════
secao("§32 · A mesma tarefa nas quatro projeções")
// ═══════════════════════════════════════════════════════════════════════════
const naFila = ((await get(func, "/api/operacao/tarefas?visao=minha_fila")).body?.linhas ?? []).find((l) => l.taskId === SEM_DONO)
const naGlobal = ((await get(gestor, "/api/operacao/visao-global?busca=GERENCIAL")).body?.linhas ?? []).find((l) => l.taskId === SEM_DONO)
const noDossie = await detalhe(SEM_DONO)
ok("§32) mesmo taskId na fila, no dossiê e na visão global",
  naFila?.taskId === SEM_DONO && naGlobal?.taskId === SEM_DONO && noDossie?.taskId === SEM_DONO)
ok("§32) MESMO status", naFila?.statusTarefa === naGlobal?.statusTarefa && naFila?.statusTarefa === noDossie?.statusTarefa,
  `${naFila?.statusTarefa} · ${naGlobal?.statusTarefa} · ${noDossie?.statusTarefa}`)
ok("§32) MESMA etapa atual", naFila?.etapaAtual === naGlobal?.etapaAtual, `"${naFila?.etapaAtual}"`)
ok("§7) e fase, status e etapa continuam três coisas distintas",
  naFila?.faseMacroKey != null && naFila?.statusTarefa != null && naFila?.etapaAtual != null)

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
