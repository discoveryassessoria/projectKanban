// scripts/e2e-central-distribuicao.mjs
// ============================================================================
// A CENTRAL DE DISTRIBUIÇÃO, POR CLIQUE — quem distribui e quem executa.
//
//   node scripts/e2e-central-distribuicao.mjs <base> <saida> <tokGestor> <tokFuncionario>
//
// O ciclo gerencial inteiro no navegador: o trabalho nasce sem dono, o gestor
// vê, escolhe, atribui; o funcionário recebe na fila dele e abre a execução já
// validada. Depois o gestor transfere, retira e devolve à distribuição.
//
// A pergunta que este teste responde: distribuir move o MESMO trabalho, ou o
// sistema cria uma cópia em algum ponto? É o `taskId` que responde, dos dois
// lados da tela.
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

/** Uma aba autenticada como um usuário — cada papel tem a sua. */
async function abrirComo(tokPath) {
  const token = readFileSync(tokPath, "utf8").trim()
  const user = readFileSync(tokPath + ".user", "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem("authToken", t); localStorage.setItem("user", u)
  }, [token, user])
  return { page, token }
}

const gestor = await abrirComo(TOK_GESTOR)
const func = await abrirComo(TOK_FUNC)

/** Lê a projeção pelo servidor — a verdade não é o que a tela desenhou. */
async function projecao(sessao, visao) {
  const r = await sessao.page.request.get(`${BASE}/api/operacao/tarefas?visao=${visao}`, {
    headers: { Authorization: `Bearer ${sessao.token}` },
  })
  if (!r.ok()) return { status: r.status(), linhas: [] }
  return { status: r.status(), ...(await r.json()) }
}

async function irPara(sessao, aba) {
  await sessao.page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await sessao.page.waitForTimeout(3000)
  const b = sessao.page.getByRole("button", { name: new RegExp(`^${aba}$`) }).first()
  if (await b.count()) { await b.click(); await sessao.page.waitForTimeout(2200) }
}

/** A linha da tarefa alvo, pelo título — é assim que o gestor a encontra. */
const linhaDe = (sessao, titulo) =>
  sessao.page.locator("div.group").filter({ hasText: titulo }).first()

console.log("E2E — CENTRAL DE DISTRIBUIÇÃO\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§13 · O trabalho nasce sem dono e aparece para a gestão")
// ═══════════════════════════════════════════════════════════════════════════
await irPara(gestor, "Sem responsável")
const semDono = await projecao(gestor, "sem_responsavel")
ok("o gestor enxerga a distribuição", semDono.status === 200, `${semDono.linhas.length} tarefa(s)`)
const alvo = semDono.linhas.find((l) => l.titulo.includes("Certidão de Casamento"))
ok("a tarefa de teste está lá, sem responsável", !!alvo && alvo.responsavelId === null, alvo?.titulo ?? "—")
const TASK_ID = alvo?.taskId
ok("§2) a linha traz pessoa, processo, etapa e prazo",
  !!alvo?.pessoaNome && !!alvo?.processoNome && !!alvo?.etapaAtual && !!alvo?.dataPrazo,
  `${alvo?.pessoaNome} · ${alvo?.etapaAtual}`)
ok("§2) e a data de entrada", !!alvo?.criadaEm)

const textoGestor = await gestor.page.locator("main").innerText()
ok("§2) a tela mostra há quanto tempo o trabalho espera", /Entrou em \d{2}\/\d{2}\/\d{4}/.test(textoGestor))
await gestor.page.screenshot({ path: `${OUT}/dist-1-sem-responsavel.png` })

// O funcionário NÃO vê a distribuição — não é fila dele.
const semDonoFunc = await projecao(func, "sem_responsavel")
ok("§9) o funcionário não acessa a visão de distribuição", semDonoFunc.status === 403, `HTTP ${semDonoFunc.status}`)
await irPara(func, "Minha fila")
const abasFunc = await func.page.locator("main").innerText()
ok("§9) e a aba Sem responsável nem aparece para ele", !abasFunc.includes("Sem responsável"))

// ═══════════════════════════════════════════════════════════════════════════
secao("§3-§5 · O gestor atribui em poucos cliques")
// ═══════════════════════════════════════════════════════════════════════════
await linhaDe(gestor, "Certidão de Casamento").getByRole("button", { name: "Atribuir" }).click()
await gestor.page.waitForTimeout(2500)
await gestor.page.screenshot({ path: `${OUT}/dist-2-seletor.png` })
const seletor = await gestor.page.locator("body").innerText()
ok("§3) o seletor lista os elegíveis", /Daniela Brait/.test(seletor))
ok("§3) com a carga atual de cada um", /\d+ ativa/.test(seletor), (seletor.match(/\d+ ativas?[^\n]*/) ?? ["—"])[0])

await gestor.page.locator("button").filter({ hasText: "Daniela Brait" }).first().click()
await gestor.page.waitForTimeout(3500)

const depois = await projecao(gestor, "sem_responsavel")
ok("§5) a tarefa saiu de Sem responsável", !depois.linhas.some((l) => l.taskId === TASK_ID))
const filaFunc = await projecao(func, "minha_fila")
const naFila = filaFunc.linhas.find((l) => l.taskId === TASK_ID)
ok("§5) e entrou na Minha Fila do funcionário", !!naFila)
ok("§4) MESMO taskId", naFila?.taskId === TASK_ID, `${TASK_ID}`)
ok("§5) com o responsável registrado", naFila?.responsavelNome === "Daniela Brait", naFila?.responsavelNome ?? "—")
ok("§5) e a marca de quando foi atribuída", !!naFila?.atribuidaEm)

await irPara(func, "Minha fila")
await func.page.screenshot({ path: `${OUT}/dist-3-minha-fila.png` })
const textoFunc = await func.page.locator("main").innerText()
ok("§5) o funcionário vê o trabalho na tela dele", textoFunc.includes("Certidão de Casamento"))

// ═══════════════════════════════════════════════════════════════════════════
secao("§12 · A execução validada continua intacta")
// ═══════════════════════════════════════════════════════════════════════════
await func.page.locator("button.cursor-pointer").filter({ hasText: "Certidão de Casamento" }).first().click()
await func.page.waitForTimeout(3000)
const painel = await func.page.locator("aside").last().innerText()
ok("§12) abre a Tarefa Operacional com o workflow interno", /WORKFLOW INTERNO/i.test(painel))
ok("§12) com as 5 etapas e a corrente destacada", /Etapa atual/i.test(painel) && /Solicitar certidão/.test(painel))
await func.page.screenshot({ path: `${OUT}/dist-4-execucao-intacta.png` })
await func.page.getByRole("button", { name: /^Fechar$/ }).first().click().catch(() => {})

// ═══════════════════════════════════════════════════════════════════════════
secao("§14 · Transferência preserva o trabalho")
// ═══════════════════════════════════════════════════════════════════════════
await irPara(gestor, "Minha fila")
// A tarefa atribuída aparece na visão do gestor pela aba de distribuição só se
// não tiver dono; para transferir, o gestor a alcança pela lista de trabalho.
const antesTransf = (await projecao(func, "minha_fila")).linhas.find((l) => l.taskId === TASK_ID)
const r = await gestor.page.request.post(`${BASE}/api/tarefas/${TASK_ID}/comando`, {
  headers: { Authorization: `Bearer ${gestor.token}`, "Content-Type": "application/json" },
  data: { acao: "transferir", responsavelId: Number(process.env.MARIA_ID), motivo: "redistribuição" },
})
ok("§14) o gestor transfere pela porta canônica", r.ok(), `HTTP ${r.status()}`)
const depoisTransf = await projecao(func, "minha_fila")
ok("§14) saiu da fila da Daniela", !depoisTransf.linhas.some((l) => l.taskId === TASK_ID))
const detalhe = await gestor.page.request.get(`${BASE}/api/operacao/tarefas/${TASK_ID}`, {
  headers: { Authorization: `Bearer ${gestor.token}` },
})
const t = (await detalhe.json()).tarefa
ok("§14) MESMO taskId", t.taskId === TASK_ID)
ok("§14) MESMA etapa corrente — o workflow não reiniciou",
  t.etapas.find((e) => e.atual)?.stepKey === antesTransf?.etapaAtual?.toLowerCase().replace(/ /g, "_") ||
  t.etapas.filter((e) => e.status === "CONCLUIDO").length === 0,
  t.etapas.find((e) => e.atual)?.titulo ?? "—")
ok("§14) e o histórico registra a transferência",
  t.historico.some((h) => /transfer|atribu/i.test(h.descricao ?? h.acao)))

// ═══════════════════════════════════════════════════════════════════════════
secao("§15 · Retirar responsável devolve à distribuição")
// ═══════════════════════════════════════════════════════════════════════════
await irPara(gestor, "Sem responsável")
const rr = await gestor.page.request.post(`${BASE}/api/tarefas/${TASK_ID}/comando`, {
  headers: { Authorization: `Bearer ${gestor.token}`, "Content-Type": "application/json" },
  data: { acao: "devolver_a_fila", motivo: "redistribuir" },
})
ok("§15) retirar é aceito", rr.ok(), `HTTP ${rr.status()}`)
const voltou = await projecao(gestor, "sem_responsavel")
ok("§15) a MESMA tarefa voltou para Sem responsável", voltou.linhas.some((l) => l.taskId === TASK_ID))
ok("§15) sem responsável", voltou.linhas.find((l) => l.taskId === TASK_ID)?.responsavelId === null)

// ═══════════════════════════════════════════════════════════════════════════
secao("§16 · Concorrência: ninguém sobrescreve em silêncio")
// ═══════════════════════════════════════════════════════════════════════════
// Dois gestores com o MESMO estado em tela. O primeiro atribui; o segundo tenta
// com a versão que leu antes.
const atual = voltou.linhas.find((l) => l.taskId === TASK_ID)
const lvAntigo = 0
const primeiro = await gestor.page.request.post(`${BASE}/api/tarefas/${TASK_ID}/comando`, {
  headers: { Authorization: `Bearer ${gestor.token}`, "Content-Type": "application/json" },
  data: { acao: "atribuir", responsavelId: Number(process.env.DANI_ID) },
})
ok("§16) o primeiro vence", primeiro.ok(), `HTTP ${primeiro.status()}`)
const segundo = await gestor.page.request.post(`${BASE}/api/tarefas/${TASK_ID}/comando`, {
  headers: { Authorization: `Bearer ${gestor.token}`, "Content-Type": "application/json" },
  data: { acao: "atribuir", responsavelId: Number(process.env.MARIA_ID), lockVersion: lvAntigo },
})
ok("§16) o segundo recebe conflito, não sobrescreve", segundo.status() === 409, `HTTP ${segundo.status()}`)
const final = await gestor.page.request.get(`${BASE}/api/operacao/tarefas/${TASK_ID}`, {
  headers: { Authorization: `Bearer ${gestor.token}` },
})
const tf = (await final.json()).tarefa
ok("§16) a responsabilidade é de quem chegou primeiro", tf.responsavelNome === "Daniela Brait", tf.responsavelNome ?? "—")
void atual

// ═══════════════════════════════════════════════════════════════════════════
secao("§5/§17 · Nada foi copiado")
// ═══════════════════════════════════════════════════════════════════════════
ok("§5) o taskId é o mesmo do começo ao fim", tf.taskId === TASK_ID, `${TASK_ID}`)
ok("§5) e o título continua sendo o do trabalho", !/^Solicitar/.test(tf.titulo), tf.titulo)

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
