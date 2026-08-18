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
const urlAntes = page.url()
// A OUTRA certidão da Daniela continua A FAZER — o palco tem duas de propósito.
// O que a transição muda é UM cartão, não a fila inteira.
const iniciarAntes = await page.getByRole("button", { name: /^Iniciar tarefa$/ }).count()
await botaoIniciar.click()
await page.waitForTimeout(5000)
ok("§7) continuou na fila — iniciar não teleporta ninguém", page.url() === urlAntes, page.url())
corpo = await page.locator("body").innerText()
ok("§6) a tela confirma o início", /Tarefa iniciada/i.test(corpo))
ok("§4) o estado virou EM ANDAMENTO", /Em andamento/.test(corpo))
const botaoContinuar = page.getByRole("button", { name: /^Continuar$/ }).first()
ok("§11) e agora a ação é CONTINUAR", (await botaoContinuar.count()) > 0)
const iniciarDepois = await page.getByRole("button", { name: /^Iniciar tarefa$/ }).count()
ok("§11) 'Iniciar tarefa' saiu DAQUELE cartão — e só dele",
  iniciarDepois === iniciarAntes - 1, `${iniciarAntes} → ${iniciarDepois}`)
ok("§2) a outra tarefa atribuída continua A FAZER — iniciar uma não inicia as outras",
  iniciarDepois >= 1)
await page.screenshot({ path: `${OUT}/2-em-andamento.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§8/§9) CONTINUAR leva ao documento certo — sem drawer no caminho")
// ═══════════════════════════════════════════════════════════════════════════
await botaoContinuar.click()
await page.waitForTimeout(11000)
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

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
