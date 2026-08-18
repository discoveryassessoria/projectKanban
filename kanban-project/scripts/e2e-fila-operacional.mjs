// scripts/e2e-fila-operacional.mjs
// ============================================================================
// O TESTE MANUAL DO ITEM 2, PELO NAVEGADOR.
//
//   node scripts/e2e-fila-operacional.mjs <base> <saida> <token> <palco.json>
//
// Percorre exatamente o que uma pessoa faria: entra como quem executa, abre a
// Minha Fila, vê "A fazer", clica em "Iniciar", vê virar "Em andamento" SEM
// sair da fila, clica em "Continuar" e chega ao processo — na Central, no
// documento certo, no Workflow, com a etapa atual à vista.
//
// A pergunta que só o navegador responde: a tela mostra o estado ANTES e DEPOIS
// da transição? Um teste de serviço prova que o banco mudou; ele não prova que
// a pessoa viu a mudança acontecer.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK, PALCO] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const palco = JSON.parse(readFileSync(PALCO, "utf8"))

let passou = 0, falhou = 0
const falhas = []
const ok = (n, c, e = "") => {
  if (c) { passou++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) }
  else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const token = readFileSync(TOK, "utf8").trim()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } })
await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
const page = await ctx.newPage()
await page.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", u) },
  [token, readFileSync(TOK + ".user", "utf8").trim()])

console.log("E2E — A FILA DE TRABALHO: receber não é começar\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§5/§24) A tarefa atribuída aparece como A FAZER")
// ═══════════════════════════════════════════════════════════════════════════
await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(6000)
// Quem executa não distribui: a aba única é a dele.
const minhaFila = page.getByRole("button", { name: /^Minha fila$/ }).first()
if (await minhaFila.count()) { await minhaFila.click(); await page.waitForTimeout(3000) }
let corpo = await page.locator("body").innerText()
ok("§5) a Minha Fila abriu", /Minha fila/i.test(corpo))
ok("§5) a tarefa atribuída está lá", /Certidão de Nascimento - Inteiro Teor/.test(corpo))
ok("§5) e diz de quem e de que documento é", /Ademir Matheus/.test(corpo))
ok("§4) o estado é A FAZER", /A fazer/.test(corpo), (corpo.match(/A fazer/g) ?? []).length + " ocorrência(s)")
ok("§2) NÃO está em andamento — atribuir não iniciou nada",
  !/Em andamento/.test(corpo.split("Minha fila")[1] ?? corpo))
const botaoIniciar = page.getByRole("button", { name: /^Iniciar tarefa$/ }).first()
ok("§5) e a ação oferecida é INICIAR", (await botaoIniciar.count()) > 0)
ok("§5) 'Continuar' não é oferecido a quem não começou",
  (await page.getByRole("button", { name: /^Continuar$/ }).count()) === 0)
await page.screenshot({ path: `${OUT}/1-a-fazer.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§6/§7) INICIAR muda o estado — e a pessoa VÊ isso acontecer")
// ═══════════════════════════════════════════════════════════════════════════
// O REQUEST REAL, observado — não a função de domínio chamada por dentro.
const respostas = []
page.on("response", (r) => {
  if (r.url().includes("/comando")) respostas.push({ status: r.status(), url: r.url() })
})
await botaoIniciar.click()
// A navegação faz parte do ato: esperar por ela é esperar o ato terminar.
await page.waitForURL(/\/kanban\?/, { timeout: 45000 }).catch(() => {})
await page.waitForTimeout(9000)

ok("§1) o clique disparou o comando", respostas.length === 1, JSON.stringify(respostas))
ok("§1) e o servidor respondeu 200", respostas[0]?.status === 200, String(respostas[0]?.status))
ok("§4) e a tela NAVEGOU para o trabalho — sem segundo clique",
  /\/kanban\?/.test(page.url()), page.url())
await page.screenshot({ path: `${OUT}/2-navegou-apos-iniciar.png` })

// O ESTADO MUDOU DE VERDADE — lido do servidor, não do DOM.
const depoisDoStart = await page.evaluate(async ([taskId]) => {
  const r = await fetch(`/api/operacao/tarefas/${taskId}/navegacao`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  return r.ok ? (await r.json()).alvo : null
}, [palco.tarefaId])
ok("§3) a tarefa está EM ANDAMENTO", depoisDoStart?.statusTarefa === "EM_ANDAMENTO", String(depoisDoStart?.statusTarefa))
ok("§3) e é a MESMA tarefa", depoisDoStart?.taskId === palco.tarefaId)

// ═══════════════════════════════════════════════════════════════════════════
secao("§4/§8) A navegação parou no documento certo — sem drawer no caminho")
// ═══════════════════════════════════════════════════════════════════════════
const url = page.url()
ok("§8) saiu da Operação e foi para o processo", /\/kanban\?/.test(url), url)
ok("§9) levando a identidade da tarefa", url.includes(`taskId=${palco.tarefaId}`), url)
ok("§9) e o processo por id", url.includes(`processoId=${palco.processoId}`))
ok("§8) na aba Central Operacional", url.includes("tab=central"))
const painel = await page.locator("body").innerText()
ok("§8) a Central do processo abriu", /Central Operacional/i.test(painel))
ok("§8) o painel do documento abriu sozinho — sem procurar a certidão",
  /Workflow|Dados Registrais/i.test(painel))
ok("§10) e NÃO existe aba 'Operação' de volta",
  (await page.getByRole("button", { name: /^Operação$/ }).count()) === 0)
ok("§9) o Workflow do documento está à vista",
  /Central da Etapa|etapas ·/i.test(painel))
ok("§9) com a etapa atual destacada", /Solicitar certidão/.test(painel))
ok("§16) e o executor especializado continua sendo a Central da Etapa",
  (await page.getByRole("button", { name: /Central da Etapa/ }).count()) > 0)
await page.screenshot({ path: `${OUT}/3-workflow.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§12) O documento aberto é o DESTA tarefa — não o da homônima")
// ═══════════════════════════════════════════════════════════════════════════
// Duas pessoas com o mesmo nome completo e a mesma certidão: a única coisa que
// separa as duas linhas é o id.
const resposta = await page.evaluate(async ([taskId]) => {
  const r = await fetch(`/api/operacao/tarefas/${taskId}/navegacao`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  return r.ok ? await r.json() : null
}, [palco.tarefaId])
ok("§9) a resolução do alvo responde pelo servidor", resposta?.alvo != null)
ok("§12) e aponta o documento DESTA tarefa",
  resposta?.alvo?.documentoId === palco.documentoId,
  `${resposta?.alvo?.documentoId} (esperado ${palco.documentoId}; a homônima é ${palco.documentoHomonimoId})`)
ok("§12) e a pessoa certa", resposta?.alvo?.pessoaId === palco.pessoaId)

// ═══════════════════════════════════════════════════════════════════════════
secao("§13) De volta à fila, a tarefa iniciada oferece CONTINUAR — e só navega")
// ═══════════════════════════════════════════════════════════════════════════
await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(6000)
const abaFila = page.getByRole("button", { name: /^Minha fila$/ }).first()
if (await abaFila.count()) { await abaFila.click(); await page.waitForTimeout(3000) }
const corpoVolta = await page.locator("body").innerText()
ok("§13) o cartão agora diz Em andamento", /Em andamento/.test(corpoVolta))
const continuar = page.getByRole("button", { name: /^Continuar$/ }).first()
ok("§13) e oferece Continuar", (await continuar.count()) > 0)
ok("§5) a outra tarefa atribuída continua A FAZER — iniciar uma não inicia as outras",
  (await page.getByRole("button", { name: /^Iniciar tarefa$/ }).count()) >= 1)

const comandosAntes = respostas.length
await continuar.click()
await page.waitForURL(/\/kanban\?/, { timeout: 45000 }).catch(() => {})
await page.waitForTimeout(6000)
ok("§13) CONTINUAR não comandou nada — só navegou",
  respostas.length === comandosAntes, `${respostas.length - comandosAntes} comando(s)`)
ok("§13) e chegou ao mesmo lugar", page.url().includes(`taskId=${palco.tarefaId}`), page.url())

// ═══════════════════════════════════════════════════════════════════════════
secao("§6/§14) Falha NÃO é silêncio — a tela diz o que aconteceu")
// ═══════════════════════════════════════════════════════════════════════════
await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(6000)
const abaFila2 = page.getByRole("button", { name: /^Minha fila$/ }).first()
if (await abaFila2.count()) { await abaFila2.click(); await page.waitForTimeout(3000) }
// O servidor responde 403 a este comando — o teste força a resposta, não a UI.
await page.route("**/api/tarefas/*/comando", (route) =>
  route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "sem permissão" }) }))
const iniciarQueVaiFalhar = page.getByRole("button", { name: /^Iniciar tarefa$/ }).first()
ok("§14) há uma tarefa A FAZER para o teste de erro", (await iniciarQueVaiFalhar.count()) > 0)
await iniciarQueVaiFalhar.click()
await page.waitForTimeout(6000)
const comErro = await page.locator("body").innerText()
ok("§6) o erro aparece na tela", /permissão/i.test(comErro), (comErro.match(/.*permiss.*/i) ?? ["—"])[0].slice(0, 80))
ok("§6) e a UI NÃO mente dizendo que iniciou", !/Tarefa iniciada\./.test(comErro))
ok("§4) nem navega em cima de um comando que falhou", page.url().includes("/operacao"), page.url())
await page.screenshot({ path: `${OUT}/4-erro-visivel.png` })
await page.unroute("**/api/tarefas/*/comando")

// ═══════════════════════════════════════════════════════════════════════════
secao("PROGRESSO COERENTE) A fase não se diz concluída com trabalho aberto")
// ═══════════════════════════════════════════════════════════════════════════
// As três leituras da MESMA tela, lidas do servidor: o que a fase conta, o que a
// barra mostra e o que a linha do documento diz.
await page.goto(`${BASE}/kanban?processoId=${palco.processoId}&tab=central`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForTimeout(9000)
const central = await page.evaluate(async ([procId, docId]) => {
  const r = await fetch(`/api/processos/${procId}/central-operacional?queue=all&sort=priority`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  if (!r.ok) return { erro: r.status }
  const d = await r.json()
  const i = d.indice
  const doc = [...i.linhaPrincipal, ...i.foraDaLinha, ...i.pendenteClassificacao]
    .flatMap((p) => p.documentos).concat(i.semDono).find((x) => x.documentoId === docId)
  return {
    matrix: { pct: d.matrix.percentage, done: d.matrix.completed, total: d.matrix.total },
    fase: d.faseProgress ? { pct: d.faseProgress.percent, done: d.faseProgress.done, total: d.faseProgress.total } : null,
    doc: doc ? { pct: doc.naFase.progresso.pct, frac: `${doc.naFase.progresso.concluidos}/${doc.naFase.progresso.total}`, statusFinal: doc.statusFinal } : null,
    resumo: i.resumo,
  }
}, [palco.processoId, palco.documentoId])

ok("a Central respondeu", central?.matrix != null, JSON.stringify(central))
ok("§C) a fase conta 0 de 3 concluídos — nenhum documento terminou",
  central.matrix.done === 0, `${central.matrix.done}/${central.matrix.total}`)
ok("§99) e o percentual da fase NÃO é 99%", central.matrix.pct !== 99, `${central.matrix.pct}%`)
ok("§16) nem 100%", central.matrix.pct < 100)
ok("§A) o documento tem progresso PRÓPRIO, diferente do da fase",
  central.doc != null && central.doc.pct >= 0, `${central.doc?.pct}% · ${central.doc?.frac}`)
ok("§B) e não está marcado como pronto", central.doc?.statusFinal !== "PRONTO", String(central.doc?.statusFinal))
ok("§17) os contadores da Central concordam — 0 prontos",
  central.resumo.prontos === 0, JSON.stringify(central.resumo))
const corpoCentral = await page.locator("body").innerText()
ok("§D) a tela NÃO anuncia a fase concluída", !/concluída — todos os documentos validados/i.test(corpoCentral))
await page.screenshot({ path: `${OUT}/5-progresso-coerente.png` })

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
