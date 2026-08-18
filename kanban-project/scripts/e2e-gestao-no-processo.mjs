// scripts/e2e-gestao-no-processo.mjs
// ============================================================================
// O PROCESSO É O LOCAL DE GESTÃO INDIVIDUAL DA TAREFA — pelo navegador.
//
//   node scripts/e2e-gestao-no-processo.mjs <base> <saida> <tokenGestor> <tokenExecutor> <palco.json>
//
// Percorre os três cenários do enunciado:
//
//   A) o gestor vê uma certidão SEM DONO dentro do processo, atribui ali mesmo,
//      e a tarefa some da fila "Sem responsável" e aparece na fila de quem
//      recebeu — sem que ninguém tenha saído do processo;
//   B) a atribuição feita pela OPERAÇÃO aparece na Central;
//   C) quem só EXECUTA vê o responsável e não ganha o poder de trocá-lo.
//
// A pergunta que só o navegador responde: as duas telas mostram a mesma pessoa
// depois da mudança? Um teste de serviço prova o banco; ele não prova que as
// duas superfícies leem a mesma coisa.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

const [BASE, OUT, TOK_GESTOR, TOK_EXEC, PALCO] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const palco = JSON.parse(readFileSync(PALCO, "utf8"))

let passou = 0, falhou = 0
const falhas = []
const ok = (n, c, e = "") => {
  if (c) { passou++; console.log(`  ✅ ${n}${e ? ` — ${e}` : ""}`) }
  else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e ? ` — ${e}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

const b = await chromium.launch()

/** Uma aba autenticada como alguém — o token é a identidade, como na app. */
async function abaDe(tokenPath) {
  const token = readFileSync(tokenPath, "utf8").trim()
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } })
  await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("user", u) },
    [token, readFileSync(tokenPath + ".user", "utf8").trim()])
  return page
}

/** A Central do processo, com a pessoa do documento já aberta. */
async function abrirCentral(page) {
  await page.goto(`${BASE}/kanban?processoId=${palco.processoId}&tab=central`, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForTimeout(9000)
  // Com poucos documentos os cards já nascem abertos. Clicar por via das dúvidas
  // FECHA o que já estava aberto — então só abre quem ainda não mostrou linha.
  const semDono = page.locator("button").filter({ hasText: /Tereza Matheus/ }).first()
  const jaAberto = await page.getByText("Sem responsável").count()
  if (jaAberto === 0 && (await semDono.count())) {
    await semDono.click().catch(() => {})
    await page.waitForTimeout(2500)
  }
}

/** O responsável que a Central mostra para um documento, lido pelo servidor. */
async function responsavelNaCentral(page, documentoId) {
  return page.evaluate(async ([procId, docId]) => {
    const r = await fetch(`/api/processos/${procId}/central-operacional?queue=all&sort=priority`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    })
    if (!r.ok) return { erro: r.status }
    const d = await r.json()
    const i = d.indice
    const todos = [...i.linhaPrincipal, ...i.foraDaLinha, ...i.pendenteClassificacao]
      .flatMap((p) => p.documentos).concat(i.semDono)
    const doc = todos.find((x) => x.documentoId === docId)
    return doc ? { taskId: doc.naFase.taskId, responsavelId: doc.naFase.responsavelId, nome: doc.naFase.responsavelNome, estado: doc.naFase.estado } : null
  }, [palco.processoId, documentoId])
}

const filaDe = (page, visao) => page.evaluate(async ([v]) => {
  const r = await fetch(`/api/operacao/tarefas?visao=${v}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  if (!r.ok) return { erro: r.status }
  return (await r.json()).linhas ?? []
}, [visao])

console.log("E2E — O PROCESSO GERE A TAREFA; A OPERAÇÃO VÊ TUDO\n")

const gestor = await abaDe(TOK_GESTOR)
const executor = await abaDe(TOK_EXEC)
// A aba precisa ESTAR na origem antes de qualquer leitura: `localStorage` não
// existe em `about:blank`, e o token vive nele.
await executor.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 90000 })
await executor.waitForTimeout(3000)

// ═══════════════════════════════════════════════════════════════════════════
secao("CENÁRIO A) O gestor atribui DENTRO do processo, sem sair dele")
// ═══════════════════════════════════════════════════════════════════════════
await abrirCentral(gestor)
let corpo = await gestor.locator("body").innerText()
ok("a Central abriu", /Central Operacional/i.test(corpo))
ok("há uma certidão SEM RESPONSÁVEL", /Sem responsável/.test(corpo))
const antes = await responsavelNaCentral(gestor, palco.documentoSemDonoId)
ok("e o servidor confirma que ela não tem dono", antes?.responsavelId == null, JSON.stringify(antes))
const naFilaSemDono = await filaDe(gestor, "sem_responsavel")
ok("ela está na fila 'Sem responsável' da Operação",
  Array.isArray(naFilaSemDono) && naFilaSemDono.some((l) => l.taskId === palco.tarefaSemDonoId))
await gestor.screenshot({ path: `${OUT}/1-sem-dono.png` })

// O gesto: a própria coluna Responsável oferece "atribuir".
const atribuir = gestor.getByRole("button", { name: /^atribuir$/ }).first()
ok("§6) a coluna Responsável oferece a ação de atribuir", (await atribuir.count()) > 0)
await atribuir.click()
await gestor.waitForTimeout(1200)
const seletor = gestor.getByLabel("Responsável pela tarefa").first()
ok("§19) e o seletor traz quem pode receber trabalho", (await seletor.count()) > 0)
await seletor.selectOption(String(palco.gabrielId))
await gestor.waitForTimeout(6000)

const depois = await responsavelNaCentral(gestor, palco.documentoSemDonoId)
ok("§24) a Central passa a mostrar o novo responsável",
  depois?.responsavelId === palco.gabrielId, `${depois?.nome}`)
ok("§7/§21) e o estado NÃO mudou — atribuir não inicia",
  depois?.estado === antes?.estado, `${antes?.estado} → ${depois?.estado}`)
ok("§24) a URL continua no processo — ninguém saiu daqui",
  gestor.url().includes(`processoId=${palco.processoId}`), gestor.url())
await gestor.screenshot({ path: `${OUT}/2-atribuido-no-processo.png` })

const semDonoDepois = await filaDe(gestor, "sem_responsavel")
ok("§24) e a tarefa some da fila 'Sem responsável'",
  !semDonoDepois.some((l) => l.taskId === palco.tarefaSemDonoId))

// A OUTRA SUPERFÍCIE — a fila de quem recebeu, lida com o token DELE.
const filaGabriel = await executor.evaluate(async () => {
  const r = await fetch(`/api/operacao/tarefas?visao=minha_fila`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
  })
  return r.ok ? (await r.json()).linhas ?? [] : { erro: r.status }
})
ok("§12) a tarefa aparece na Minha Fila de quem recebeu",
  Array.isArray(filaGabriel) && filaGabriel.some((l) => l.taskId === palco.tarefaSemDonoId))
const naFila = Array.isArray(filaGabriel) ? filaGabriel.find((l) => l.taskId === palco.tarefaSemDonoId) : null
ok("§7) como A FAZER — receber não é começar", naFila?.coluna === "A_FAZER", String(naFila?.coluna))

// ═══════════════════════════════════════════════════════════════════════════
secao("CENÁRIO B) A atribuição feita pela OPERAÇÃO aparece na Central")
// ═══════════════════════════════════════════════════════════════════════════
const rOperacao = await gestor.evaluate(async ([taskId, userId]) => {
  const r = await fetch(`/api/tarefas/${taskId}/comando`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({ acao: "transferir", responsavelId: userId, motivo: "redistribuição" }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}, [palco.tarefaSemDonoId, palco.danielaId])
ok("§25) a Operação transferiu pela porta canônica", rOperacao.status === 200, JSON.stringify(rOperacao.body))
// A Central relê do servidor — não há cópia a sincronizar porque não há cópia.
const depoisDaOperacao = await responsavelNaCentral(gestor, palco.documentoSemDonoId)
ok("§12/§13) e a Central mostra o novo responsável",
  depoisDaOperacao?.responsavelId === palco.danielaId, `${depoisDaOperacao?.nome}`)
ok("§30) é a MESMA tarefa dos dois lados", depoisDaOperacao?.taskId === palco.tarefaSemDonoId)

// ═══════════════════════════════════════════════════════════════════════════
secao("CENÁRIO C) Quem executa VÊ o responsável e não ganha o poder de trocá-lo")
// ═══════════════════════════════════════════════════════════════════════════
await abrirCentral(executor)
const corpoExec = await executor.locator("body").innerText()
ok("§18) quem executa enxerga a Central", /Central Operacional/i.test(corpoExec))
ok("§18) e vê de quem é o trabalho", /Daniela Brait|Gabriel Souza/.test(corpoExec))
ok("§18) mas não recebe a ação de atribuir",
  (await executor.getByRole("button", { name: /^atribuir$/ }).count()) === 0
  && (await executor.getByRole("button", { name: /^alterar$/ }).count()) === 0)
// E O BACKEND RECUSA, que é o que de fato controla — esconder botão é desenho.
const tentativa = await executor.evaluate(async ([taskId, userId]) => {
  const r = await fetch(`/api/tarefas/${taskId}/comando`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    body: JSON.stringify({ acao: "atribuir", responsavelId: userId }),
  })
  return r.status
}, [palco.tarefaSemDonoId, palco.gabrielId])
ok("§18) e o servidor recusa a atribuição de quem não distribui", tentativa === 403, String(tentativa))
await executor.screenshot({ path: `${OUT}/3-executor.png` })

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
