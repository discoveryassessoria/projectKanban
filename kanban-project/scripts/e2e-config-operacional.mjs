// scripts/e2e-config-operacional.mjs
// ============================================================================
// O GESTOR CONFIGURA A ESTRUTURA DA EMPRESA — sem banco, terminal ou código.
//
//   node scripts/e2e-config-operacional.mjs <base> <saida> <tokGestor> <tokFunc>
//
// A promessa desta rodada é operacional, não técnica: alguém que nunca abriu um
// terminal precisa conseguir criar a equipe, colocar gente nela, dizer quem faz
// o quê, marcar férias e definir um teto. O teste faz exatamente isso — pelos
// mesmos cliques — e depois confere as três coisas que dão sentido ao esforço:
//
//   • a configuração REFLETE no recomendador imediatamente;
//   • funcionário comum NÃO consegue alterá-la, nem por chamada direta;
//   • toda alteração deixa RASTRO de quem fez e quando.
//
// O palco é criado e desfeito aqui. Roda contra o banco de TESTE.
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
  // O /administrator é protegido por MIDDLEWARE, que lê o COOKIE.
  await ctx.addCookies([{ name: "authToken", value: token, url: BASE }])
  const page = await ctx.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem("authToken", t); localStorage.setItem("user", u)
  }, [token, user])
  return { page, token }
}
const gestor = await sessao(TOK_GESTOR)
const func = await sessao(TOK_FUNC)
const get = async (s, url) => {
  const r = await s.page.request.get(`${BASE}${url}`, { headers: { Authorization: `Bearer ${s.token}` } })
  return { status: r.status(), body: r.ok() ? await r.json() : null }
}
const patch = async (s, corpo) => {
  const r = await s.page.request.patch(`${BASE}/api/operacao/capacidade`, {
    headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }, data: corpo,
  })
  return { status: r.status(), body: await r.json().catch(() => ({})) }
}

const CTX = JSON.parse(process.env.CTX_GERENCIAL ?? "{}")
const DANI = CTX.dani?.id
const SEM_DONO = CTX.tarefas?.["sem-dono"]
const NOME_EQUIPE = `E2E Emissão ${Date.now().toString().slice(-5)}`

console.log("E2E — CONFIGURAÇÃO OPERACIONAL PELO GESTOR\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("§1 · Criar uma EQUIPE pela tela — sem banco, sem terminal")
// ═══════════════════════════════════════════════════════════════════════════
await gestor.page.goto(`${BASE}/administrator?screen=teams`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(4000)
const telaEquipes = await gestor.page.locator("body").innerText()
ok("§1) o cadastro de Equipes abre", /equipe/i.test(telaEquipes))

const botaoNova = gestor.page.getByRole("button", { name: /nova equipe/i }).first()
ok("§1) e oferece criar equipe", await botaoNova.count() > 0)
await botaoNova.click()
await gestor.page.waitForTimeout(1500)

// Os campos do cadastro genérico são rotulados por um <label> IRMÃO do input —
// mirar por posição quebra assim que alguém acrescenta um campo. O xpath segue
// o rótulo, que é o que o gestor lê na tela.
const campo = (rotulo, tag = "input") =>
  gestor.page.locator(`xpath=//label[starts-with(normalize-space(), "${rotulo}")]/following-sibling::${tag}[1]`).first()

await campo("Nome da equipe").fill(NOME_EQUIPE)
await campo("Código").fill("e2e_emissao")
await campo("Descrição", "textarea").fill("equipe criada pelo E2E de configuração")
ok("§1) o formulário tem os campos que o gestor precisa",
  await campo("Nome da equipe").count() > 0 && await campo("Código").count() > 0)

// MEMBROS — o multiselect é a associação funcionário↔equipe (§2).
// Pelo E-MAIL: dois funcionários homônimos existem no banco de teste, e clicar
// no primeiro "Daniela Brait" associaria a pessoa errada — exatamente o erro
// silencioso que o rótulo com e-mail passou a evitar.
const membro = gestor.page.locator("label").filter({ hasText: "daniela@gerencial.test" }).first()
ok("§2) e oferece escolher os membros", await membro.count() > 0)
await membro.click()
await gestor.page.waitForTimeout(400)
await gestor.page.screenshot({ path: `${OUT}/cfg-1-nova-equipe.png` })

await gestor.page.getByRole("button", { name: /^(Salvar|Criar|Adicionar)$/i }).first().click()
await gestor.page.waitForTimeout(3000)
await gestor.page.screenshot({ path: `${OUT}/cfg-2-equipe-salva.png` })

const equipes = await get(gestor, "/api/gerenciamento/cadastros/grupos")
const criada = (equipes.body?.registros ?? []).find((r) => r.nome === NOME_EQUIPE)
ok("§1) a equipe foi criada pelo formulário", !!criada, criada ? `#${criada.id} ${criada.nome}` : "não encontrada")
ok("§2) e com o funcionário associado como membro",
  (criada?.membros ?? []).includes(String(DANI)), JSON.stringify(criada?.membros ?? []))

// ═══════════════════════════════════════════════════════════════════════════
secao("§1 · A equipe criada aparece na Capacidade Operacional")
// ═══════════════════════════════════════════════════════════════════════════
await gestor.page.goto(`${BASE}/administrator?screen=opcapacity`, { waitUntil: "domcontentloaded", timeout: 60000 })
await gestor.page.waitForTimeout(4000)
const telaCap = await gestor.page.locator("body").innerText()
ok("§1) a tela mostra a equipe recém-criada", telaCap.includes(NOME_EQUIPE))
ok("§1) e diz onde se define quem pertence a cada equipe", /cadastro de Equipes/i.test(telaCap))

// ═══════════════════════════════════════════════════════════════════════════
secao("§3/§4/§5 · Configurar aptidão, indisponibilidade e capacidade PELA TELA")
// ═══════════════════════════════════════════════════════════════════════════
const linhaDani = gestor.page.locator("tr").filter({ hasText: "Daniela Brait" }).first()
await linhaDani.locator("button").filter({ hasText: "Configurar" }).first().click()
await gestor.page.waitForTimeout(2000)
const painel = await gestor.page.locator("body").innerText()
ok("§3) o painel de configuração abre",
  /aptid[õo]es/i.test(painel) && /capacidade/i.test(painel) && /disponibilidade/i.test(painel))

// APTIDÃO — marcar "Emissão documental" e salvar
await gestor.page.locator("label").filter({ hasText: "Emissão documental" }).first().click()
await gestor.page.getByRole("button", { name: /salvar aptidões/i }).click()
await gestor.page.waitForTimeout(3000)
const apos = await get(gestor, "/api/operacao/capacidade")
const dani = (apos.body?.linhas ?? []).find((l) => l.usuarioId === DANI)
ok("§3) a aptidão foi gravada pela tela", (dani?.aptidoes ?? []).some((a) => /Emiss/i.test(a)),
  (dani?.aptidoes ?? []).join(", ") || "nenhuma")

// CAPACIDADE — definir teto pela tela
await gestor.page.locator('input[type=number]').first().fill("3")
await gestor.page.locator("section").filter({ hasText: "Capacidade" }).getByRole("button", { name: /^Salvar$/ }).first().click()
await gestor.page.waitForTimeout(3000)
const comTeto = await get(gestor, "/api/operacao/capacidade")
ok("§5) a capacidade foi gravada pela tela",
  (comTeto.body?.linhas ?? []).find((l) => l.usuarioId === DANI)?.limiteExecutaveis === 3)

// DISPONIBILIDADE — registrar férias pela tela
await gestor.page.locator('input[placeholder="motivo (opcional)"]').fill("férias de janeiro")
await gestor.page.getByRole("button", { name: /^Registrar$/ }).click()
await gestor.page.waitForTimeout(3000)
const comFerias = await get(gestor, "/api/operacao/capacidade")
const daniFerias = (comFerias.body?.linhas ?? []).find((l) => l.usuarioId === DANI)
ok("§4) a indisponibilidade foi registrada pela tela", daniFerias?.indisponivelPor != null,
  daniFerias?.indisponivelPor?.tipo ?? "nenhuma")
await gestor.page.screenshot({ path: `${OUT}/cfg-3-configurado.png` })

// ═══════════════════════════════════════════════════════════════════════════
secao("§9 · A configuração REFLETE no recomendador imediatamente")
// ═══════════════════════════════════════════════════════════════════════════
const sim = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
const avaliacao = (sim.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)
ok("§9) quem está de férias ficou inelegível na hora", avaliacao?.elegivel === false)
ok("§9) com o critério de disponibilidade reprovado",
  avaliacao?.criterios?.find((c) => c.chave === "DISPONIBILIDADE")?.veredito === "reprovado")
ok("§9) e a aptidão declarada é reconhecida",
  avaliacao?.criterios?.find((c) => c.chave === "APTIDAO")?.veredito !== "nao_aplicavel",
  avaliacao?.criterios?.find((c) => c.chave === "APTIDAO")?.detalhe ?? "—")

// encerrar as férias PELA TELA e ver voltar
await gestor.page.getByRole("button", { name: /encerrar agora/i }).first().click()
await gestor.page.waitForTimeout(3000)
const depois = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
const dep = (depois.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)
ok("§9) encerrar pela tela devolve a DISPONIBILIDADE",
  dep?.criterios?.find((c) => c.chave === "DISPONIBILIDADE")?.veredito === "ok")
// Ela continua inelegível — e por um motivo CERTO: o teto de 3 que acabamos de
// configurar, contra a carga real dela. Um teste que exigisse "elegível" aqui
// estaria pedindo que a capacidade fosse ignorada.
ok("§5) mas segue barrada pelo TETO que o gestor configurou",
  dep?.motivos?.some((m) => m.codigo === "CAPACIDADE_ESGOTADA") === true,
  dep?.criterios?.find((c) => c.chave === "CAPACIDADE")?.detalhe ?? "—")
await patch(gestor, { acao: "capacidade", usuarioId: DANI, limiteExecutaveis: null })
const semTeto = await get(gestor, `/api/operacao/sugestao?taskId=${SEM_DONO}`)
ok("§9) e remover o teto a devolve elegível — a configuração manda de ponta a ponta",
  (semTeto.body?.simulacao?.avaliacoes ?? []).find((a) => a.usuarioId === DANI)?.elegivel === true)

// ═══════════════════════════════════════════════════════════════════════════
secao("§6 · Histórico: quem mudou o quê, e quando")
// ═══════════════════════════════════════════════════════════════════════════
const comHistorico = await get(gestor, "/api/operacao/capacidade")
const h = (comHistorico.body?.linhas ?? []).find((l) => l.usuarioId === DANI)?.historico ?? []
ok("§6) as alterações deixaram rastro", h.length >= 4, `${h.length} registro(s)`)
ok("§6) com autor", h.every((x) => !!x.por), h[0]?.por ?? "—")
ok("§6) e em português", /Aptidões|Capacidade|indisponível|encerrada/i.test(h[0]?.descricao ?? ""),
  h[0]?.descricao?.slice(0, 70) ?? "—")
for (const esperado of ["Aptidões", "Capacidade", "indisponível", "encerrada"]) {
  ok(`§6) registra "${esperado}"`, h.some((x) => new RegExp(esperado, "i").test(x.descricao)))
}
const naTela = await gestor.page.locator("body").innerText()
ok("§6) e o histórico aparece no painel", /Histórico desta configuração/i.test(naTela))
await gestor.page.screenshot({ path: `${OUT}/cfg-4-historico.png`, fullPage: true })

// ═══════════════════════════════════════════════════════════════════════════
secao("§7/§8 · Funcionário comum não configura nada disso")
// ═══════════════════════════════════════════════════════════════════════════
ok("§8) não lê a camada", (await get(func, "/api/operacao/capacidade")).status === 403)
ok("§8) não altera aptidão por chamada direta",
  (await patch(func, { acao: "aptidoes", usuarioId: DANI, faseKeys: [] })).status === 403)
ok("§8) não altera capacidade", (await patch(func, { acao: "capacidade", usuarioId: DANI, limiteExecutaveis: 99 })).status === 403)
ok("§8) não registra indisponibilidade",
  (await patch(func, { acao: "indisponibilizar", usuarioId: DANI, tipo: "FERIAS" })).status === 403)
ok("§8) e não cria equipe", (await func.page.request.post(`${BASE}/api/gerenciamento/cadastros/grupos`, {
  headers: { Authorization: `Bearer ${func.token}`, "Content-Type": "application/json" },
  data: { nome: "equipe pirata" },
})).status() === 403)
await func.page.goto(`${BASE}/administrator?screen=opcapacity`, { waitUntil: "domcontentloaded", timeout: 60000 })
await func.page.waitForTimeout(3000)
ok("§7) e a tela nem abre para ele", !/capacidade operacional/i.test(await func.page.locator("body").innerText()),
  func.page.url().replace(BASE, ""))

// ═══════════════════════════════════════════════════════════════════════════
secao("§0 · Limpeza — o teste não deixa estrutura fabricada para trás")
// ═══════════════════════════════════════════════════════════════════════════
await patch(gestor, { acao: "aptidoes", usuarioId: DANI, faseKeys: [] })
await patch(gestor, { acao: "capacidade", usuarioId: DANI, limiteExecutaveis: null })
if (criada) {
  const r = await gestor.page.request.delete(`${BASE}/api/gerenciamento/cadastros/grupos/${criada.id}`, {
    headers: { Authorization: `Bearer ${gestor.token}` },
  })
  ok("§1) e a equipe pode ser EXCLUÍDA pela mesma área", r.ok(), `HTTP ${r.status()}`)
}
const fim = await get(gestor, "/api/operacao/capacidade")
ok("§0) o palco saiu inteiro",
  !(fim.body?.linhas ?? []).some((l) => l.equipes.some((e) => e.nome === NOME_EQUIPE)))

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
await b.close()
process.exit(falhou > 0 ? 1 : 0)
