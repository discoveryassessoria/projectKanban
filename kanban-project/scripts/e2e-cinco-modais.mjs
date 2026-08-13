// scripts/e2e-cinco-modais.mjs
// ============================================================================
// OS CINCO MODAIS, POR CLIQUE — do pedido à validação, na mesma tarefa.
//
//   node scripts/e2e-cinco-modais.mjs <base> <saida> <token> <taskId>
//
// A rodada anterior provou o MOTOR: o caminho de servidor que os cinco modais
// disparam mantém o taskId e conclui o workflow. O que ficou por provar foi o
// FORMULÁRIO — se as validações de tela, os campos condicionais por canal e as
// ações terminais realmente levam o operador do início ao fim.
//
// Este teste não simula: abre o navegador, entra pela Minha Fila, clica na
// tarefa, abre cada etapa pelo executor especializado e opera. Falhar aqui
// significa que o trabalho humano não passa, mesmo com o motor correto.
//
// Roda contra o banco de TESTE, com servidor local. Não toca em produção.
// ============================================================================
import { chromium } from "playwright"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [BASE, OUT, TOK, TASK_ID] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const token = readFileSync(TOK, "utf8").trim()
const user = readFileSync(TOK + ".user", "utf8").trim()

let passou = 0, falhou = 0
const falhas = []
const ok = (nome, cond, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t) => console.log(`\n${t}`)

/** Um PDF mínimo de verdade — o upload precisa de arquivo, não de string. */
function pdfDeTeste(dir, nome) {
  const caminho = join(dir, nome)
  writeFileSync(caminho, Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "utf8"))
  return caminho
}

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e).slice(0, 160)))
// Toda resposta de escrita que falha é registrada: se a etapa não concluir,
// o motivo tem de aparecer aqui, e não virar "não sei".
page.on("response", async (r) => {
  const m = r.request().method()
  if ((m === "POST" || m === "PATCH" || m === "PUT") && r.url().includes("/api/") && r.status() >= 400) {
    let corpo = ""
    try { corpo = (await r.text()).slice(0, 220) } catch {}
    const linha = `${r.status()} ${m} ${r.url().split("/api/")[1]} :: ${corpo}`
    erros.push(linha)
    console.log(`     ⚠ ${linha}`)
  }
})
await page.addInitScript(([t, u]) => {
  localStorage.setItem("authToken", t); localStorage.setItem("user", u)
}, [token, user])

// O ÚNICO STUB DESTE TESTE: o bucket externo.
//
// O upload segue o caminho real — a tela pede o presign à API do Discovery, que
// responde de verdade, e só o PUT final vai para o Cloudflare R2. Esse PUT é
// recusado a partir de localhost (é o comportamento esperado fora do ambiente
// publicado), e sem ele o requerimento nunca fica anexado e a etapa não pode
// ser concluída — travando o teste num problema de infraestrutura, não de
// produto. Aqui ele é respondido com 200; todo o resto (presign, registro do
// arquivo, validação de evidência, conclusão da etapa) roda de verdade.
await page.route(/r2\.cloudflarestorage\.com/, (route) => route.fulfill({ status: 200, body: "" }))
// O bucket pode estar atrás de um domínio próprio: o que define "é o bucket" é
// ser um PUT para fora do Discovery, não o nome do host. Sem esta rede, o teste
// falha por infraestrutura e finge que é defeito de produto.
await page.route("**/*", async (route) => {
  const req = route.request()
  const paraFora = !req.url().startsWith(BASE) && !req.url().startsWith("http://localhost")
  if (req.method() === "PUT" && paraFora) return route.fulfill({ status: 200, body: "" })
  return route.fallback()
})

// FALHA DE REDE É DIAGNÓSTICO, NÃO RUÍDO. Sem isto, um upload recusado aparece
// como "o requerimento não foi aceito" e some a causa.
page.on("response", (r) => {
  if (r.status() >= 400 && !/_next|\.(css|js|png|woff2?)$/.test(r.url())) {
    console.log(`    ✗ ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`)
  }
})
page.on("console", (m) => { if (m.type() === "error") console.log(`    ! ${m.text().slice(0, 200)}`) })

/** Lê o estado real do servidor — a verdade não é o que a tela desenhou. */
async function estado() {
  const r = await page.request.get(`${BASE}/api/operacao/tarefas/${TASK_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await r.json()).tarefa
}

/**
 * Abre a tarefa pela FILA — o caminho do funcionário, não uma URL direta.
 *
 * A Minha Fila não executa mais nada: a ação principal INICIA (quando é o caso)
 * e navega para a Central Operacional do processo, que se posiciona sozinha no
 * documento certo e na aba Workflow. O executor especializado é montado lá, num
 * lugar só — antes existia um painel local aqui, e eram dois caminhos para a
 * mesma etapa.
 */
async function abrirTarefaPelaFila() {
  // O TÍTULO VEM DO SERVIDOR. A fila tem várias certidões "Inteiro Teor", e
  // clicar na primeira que casa com o texto abre a tarefa de outra pessoa — o
  // teste passaria a medir outro trabalho, sem avisar.
  const titulo = (await estado())?.titulo ?? ""
  await page.goto(`${BASE}/operacao`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(3500)
  const aba = page.getByRole("button", { name: /^Minha fila$/ }).first()
  if (await aba.count()) { await aba.click(); await page.waitForTimeout(2500) }

  const corpoDoCartao = page.locator("button.cursor-pointer").filter({ hasText: titulo }).first()
  await corpoDoCartao.waitFor({ timeout: 30000 })
  // A ação principal DESTE cartão — não a do primeiro da lista. Ela é irmã do
  // corpo dentro da mesma linha; é ela que inicia e leva ao trabalho, enquanto
  // clicar no corpo apenas navega (abrir não é iniciar).
  const linha = corpoDoCartao.locator("xpath=..")
  const acao = linha.getByRole("button", { name: /^(Iniciar tarefa|Continuar|Ver etapa)$/ }).first()
  if (await acao.count()) await acao.click()
  else await corpoDoCartao.click()
  await page.waitForTimeout(6000)
}

/**
 * Clica no CTA da etapa corrente e espera o EXECUTOR ESPECIALIZADO montar.
 *
 * São dois gestos, e eles significam coisas diferentes: "Central da Etapa" abre
 * o contexto do passo (anexos, observações, timeline, ações de gestão), e
 * "Abrir editor" abre o formulário do trabalho — os oito canais, o protocolo, a
 * conferência. O teste precisa do segundo, mas passa pelo primeiro porque é por
 * ele que o operador passa.
 */
async function abrirEtapaAtual() {
  const cta = page.getByRole("button", { name: /^(Central da Etapa|Abrir etapa|Continuar etapa)/ }).first()
  if (await cta.count()) { await cta.click(); await page.waitForTimeout(3000) }
  const editor = page.getByRole("button", { name: /^Abrir editor$/ }).first()
  if (!(await editor.count())) return false
  await editor.click()
  await page.waitForTimeout(3500)
  return true
}

/**
 * Preenche os campos AINDA VAZIOS do modal aberto.
 *
 * O placeholder de alguns campos é um EXEMPLO derivado do caso ("ex: Eduardo
 * Almeida"), então procurar por ele acerta num palco e erra em todos os outros
 * — o campo fica vazio, a ação terminal continua bloqueada, e o teste reporta
 * "não liberou" sem dizer que foi ele quem não preencheu.
 *
 * O que não está vazio não é tocado: valor que a tela já trouxe é decisão dela.
 */
async function preencherCamposDoModal(valorTexto = "Registro conferido pela operação") {
  const modal = page.locator("div.fixed.inset-0").last()
  const campos = modal.locator('input:not([type="file"]):not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), textarea')
  const n = await campos.count()
  for (let i = 0; i < n; i++) {
    const c = campos.nth(i)
    if (!(await c.isVisible().catch(() => false))) continue
    if (!(await c.isEditable().catch(() => false))) continue
    if ((await c.inputValue().catch(() => "x")) !== "") continue
    const tipo = await c.getAttribute("type")
    await c.fill(tipo === "date" ? "1970-03-14" : tipo === "number" ? "1" : valorTexto).catch(() => {})
  }
  await page.waitForTimeout(1000)
}

/** Preenche pelo placeholder — é o que o operador vê dentro do campo. */
async function preencherPorPlaceholder(placeholder, valor) {
  const c = page.locator(`input[placeholder="${placeholder}"]`).first()
  if (!(await c.count())) return false
  await c.fill(valor)
  return true
}

/** A ação terminal do MODAL é sempre a que fecha a etapa. */
// A ação terminal não tem um texto só: "Confirmar envio · concluir etapa",
// "Confirmar recebimento · concluir etapa", "Confirmar decisão · FINALIZAR
// etapa". Cada executor nomeia o próprio gesto — o que elas têm em comum é
// fechar a etapa.
// E ela vive DENTRO do modal. A Central da Etapa, aberta por baixo, também tem
// um "Concluir etapa": pegar o primeiro do documento clicava no de trás, que a
// sobreposição do modal (z-10005) bloqueia — o teste travava mirando o botão
// errado. O do modal é o último a entrar no DOM.
const acaoTerminal = () => page.locator("button").filter({ hasText: /(concluir|finalizar) etapa/i }).last()
const acaoTerminalHabilitada = async () =>
  (await acaoTerminal().count()) > 0 && (await acaoTerminal().isEnabled().catch(() => false))
/** Diagnóstico: quantas ações terminais o documento tem, e em que estado. */
async function mapearAcoesTerminais(rotulo) {
  const todas = page.locator("button").filter({ hasText: /(concluir|finalizar) etapa/i })
  const n = await todas.count()
  const linhas = []
  for (let i = 0; i < n; i++) {
    const b = todas.nth(i)
    linhas.push(`[${i}] "${(await b.innerText().catch(() => "?")).replace(/\n/g, " ")}" visível=${await b.isVisible().catch(() => false)} habilitado=${await b.isEnabled().catch(() => false)}`)
  }
  console.log(`    · ${rotulo}: ${n} ação(ões) terminal(is)\n      ${linhas.join("\n      ")}`)
}

/** Motivo do bloqueio, quando houver — sem derrubar o teste se o botão sumiu. */
const impedimento = async () =>
  (await acaoTerminal().count()) === 0
    ? "ação terminal não encontrada no modal"
    : (await acaoTerminal().getAttribute("title").catch(() => null)) ?? "sem título de impedimento"
async function clicarAcaoTerminal() {
  if (!(await acaoTerminalHabilitada())) return false
  await acaoTerminal().click()
  await page.waitForTimeout(5500)
  return true
}

/**
 * Marca a primeira opção de cada bloco OBRIGATÓRIO que ainda não tem escolha e
 * preenche observações visíveis. É o mínimo que um operador faria para poder
 * concluir — não substitui a operação, apenas atravessa as exigências de cada
 * executor sem precisar conhecê-las de antemão.
 */
/** Preenche o primeiro campo de texto visível do modal. */
async function preencherPrimeiroTextoVisivel(valor) {
  const campos = page.locator('input[type="text"], input:not([type])')
  const n = await campos.count()
  for (let i = 0; i < n; i++) {
    const c = campos.nth(i)
    if (await c.isVisible().catch(() => false)) { await c.fill(valor).catch(() => {}); return true }
  }
  return false
}

async function satisfazerExigenciasVisiveis() {
  const opcoes = page.locator('[role="radio"], input[type="radio"]')
  const n = await opcoes.count()
  for (let i = 0; i < n; i++) {
    const o = opcoes.nth(i)
    if (await o.isVisible().catch(() => false)) { await o.click().catch(() => {}); break }
  }
  const areas = page.locator("textarea")
  const m = await areas.count()
  for (let i = 0; i < m; i++) {
    const a = areas.nth(i)
    if (await a.isVisible().catch(() => false)) await a.fill("Conferido pela operação — teste automatizado.").catch(() => {})
  }
  await page.waitForTimeout(1200)
}

async function fecharSobreposicoes() {
  for (const nome of [/^Cancelar$/, /^Fechar$/]) {
    const b = page.getByRole("button", { name: nome }).first()
    if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(800) }
  }
}

console.log("E2E — OS CINCO MODAIS, POR CLIQUE\n")

// ═══════════════════════════════════════════════════════════════════════════
secao("1 · SOLICITAR CERTIDÃO")
// ═══════════════════════════════════════════════════════════════════════════
await abrirTarefaPelaFila()
const inicial = await estado()
ok("a tarefa abriu pela fila", inicial?.taskId === Number(TASK_ID), `taskId ${inicial?.taskId}`)
ok("com 5 etapas", inicial?.etapas?.length === 5, `${inicial?.etapas?.length}`)

// Iniciar, se ainda não começou.
const iniciar = page.getByRole("button", { name: /^Iniciar tarefa$/ })
if (await iniciar.count()) { await iniciar.click(); await page.waitForTimeout(2500) }

ok("o CTA da etapa especializada apareceu", await abrirEtapaAtual())
await page.screenshot({ path: `${OUT}/e2e-1-solicitar.png` })

const corpo1 = await page.locator("body").innerText()
ok("o modal trouxe os 8 canais",
  ["CRC Nacional", "E-cartório", "E-mail", "WhatsApp", "Balcão", "Comune", "Correios", "Consulado"]
    .every((c) => corpo1.includes(c)))

// O canal recomendado JÁ vem selecionado. Clicar nele de novo o DESMARCA — e
// foi o que aconteceu na primeira execução: a seção de evidências sumia e a
// ação terminal desaparecia junto. Comportamento correto do modal; o teste é
// que estava agindo como um usuário distraído.
if (!/EVID[ÊE]NCIAS OBRIGAT[ÓO]RIAS PARA CANAL/i.test(corpo1)) {
  await page.getByText("Pedido por e-mail direto ao cartório").click()
  await page.waitForTimeout(1200)
}
const exigenciasEmail = await page.locator("body").innerText()
ok("as evidências se ajustam ao canal escolhido",
  /EVID[ÊE]NCIAS OBRIGAT[ÓO]RIAS PARA CANAL/i.test(exigenciasEmail) && /REQUERIMENTO PDF/i.test(exigenciasEmail))

// Anexar o requerimento — evidência obrigatória do canal.
const pdf = pdfDeTeste(OUT, "requerimento-inteiro-teor.pdf")
// O executor abre POR CIMA da Central da Etapa, e a Central também tem o seu
// "Anexar arquivo". Pegar o primeiro input da página anexava no lugar errado —
// sem erro nenhum, e a evidência do canal continuava faltando. O input do
// modal é o ÚLTIMO a entrar no DOM.
const inputs = page.locator('input[type="file"]')
if (await inputs.count()) {
  await inputs.last().setInputFiles(pdf)
  await page.waitForTimeout(4000)
}
// A prova de que o anexo "pegou" não é o texto na tela — é a ação terminal
// deixar de estar bloqueada por falta dele.
const tituloBotao = await page.locator("button").filter({ hasText: "Confirmar envio" }).first().getAttribute("title")
ok("o requerimento foi aceito como evidência", !/Requerimento/i.test(tituloBotao ?? ""), tituloBotao ?? "sem impedimento")

// Preencher os campos do envio. O rótulo é o âncora — o campo fica logo
// depois dele no DOM, e é assim que um operador o encontra na tela.
await preencherPorPlaceholder("ex: 2º Registro Civil de São Paulo", "1º Ofício de Registro Civil")
await preencherPorPlaceholder("ex: João Silva", "Sr. Almeida")
await preencherPorPlaceholder("ex: 380,00", "120,00")
await page.screenshot({ path: `${OUT}/e2e-1-solicitar-preenchido.png` })

const confirmar = page.locator("button").filter({ hasText: "Confirmar envio" }).first()
ok("a ação terminal existe", await confirmar.count() > 0)
ok("e o modal só a libera com tudo preenchido", await confirmar.isEnabled(),
  (await confirmar.getAttribute("title")) ?? "")
await confirmar.click()
await page.waitForTimeout(5000)

const dep1 = await estado()
ok("Solicitar certidão CONCLUÍDA", dep1?.etapas?.[0]?.status === "CONCLUIDO", dep1?.etapas?.[0]?.status)
ok("a etapa 2 virou a atual", dep1?.etapas?.[1]?.atual === true, dep1?.etapas?.[1]?.status)
ok("MESMO taskId", dep1?.taskId === Number(TASK_ID))
ok("a tarefa NÃO foi encerrada", !["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(dep1?.statusTarefa), dep1?.statusTarefa)

// ═══════════════════════════════════════════════════════════════════════════
secao("2 · AGUARDAR RETORNO DO CARTÓRIO")
// ═══════════════════════════════════════════════════════════════════════════
await fecharSobreposicoes()
await abrirTarefaPelaFila()
ok("o executor da etapa 2 abriu", await abrirEtapaAtual())
await page.screenshot({ path: `${OUT}/e2e-2-aguardar.png` })
const corpo2 = await page.locator("body").innerText()
ok("é o acompanhamento de retorno, não um botão genérico",
  /retorno|protocolo|rastrei/i.test(corpo2), corpo2.slice(0, 60).replace(/\n/g, " "))

const concluir2 = page.locator("button").filter({ hasText: /Confirmar|Concluir|Registrar retorno|Marcar recebimento/i }).last()
if (await concluir2.count()) { await concluir2.click(); await page.waitForTimeout(5000) }
const dep2 = await estado()
ok("Aguardar retorno CONCLUÍDA", dep2?.etapas?.[1]?.status === "CONCLUIDO", dep2?.etapas?.[1]?.status)
ok("MESMO taskId", dep2?.taskId === Number(TASK_ID))

// ═══════════════════════════════════════════════════════════════════════════
secao("3 · RECEBER CERTIDÃO")
// ═══════════════════════════════════════════════════════════════════════════
await fecharSobreposicoes()
await abrirTarefaPelaFila()
ok("o executor da etapa 3 abriu", await abrirEtapaAtual())
const fileIn3 = page.locator('input[type="file"]')
// O input do MODAL, não o da Central da Etapa que está aberta por baixo.
if (await fileIn3.count()) { await fileIn3.last().setInputFiles(pdfDeTeste(OUT, "certidao-recebida.pdf")); await page.waitForTimeout(4000) }
// TIPO DE MÍDIA é exigência do recebimento: o cartório devolve papel, PDF
// assinado ou os dois, e isso muda o que acontece com o documento depois.
// EXIGÊNCIAS REAIS DO RECEBIMENTO: arquivo (já anexado acima) e TIPO DE MÍDIA
// — o cartório devolve papel, PDF assinado ou os dois, e isso muda o que
// acontece com o documento depois.
// O alvo é o BOTÃO da opção — clicar pelo texto solto acertava o fundo do
// drawer e fechava o modal.
await page.locator("button").filter({ hasText: "Digital (PDF eletrônico)" }).last().click()
await page.waitForTimeout(1200)
await preencherPorPlaceholder("Recebido por correios em 28/05/2026, sem avarias...", "Recebido por e-mail, PDF assinado, sem avarias.")
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/e2e-3-receber.png` })
ok("3) a ação terminal liberou com anexo + tipo de mídia", await acaoTerminalHabilitada(),
  await impedimento())
await clicarAcaoTerminal()
const dep3 = await estado()
ok("Receber certidão CONCLUÍDA", dep3?.etapas?.[2]?.status === "CONCLUIDO", dep3?.etapas?.[2]?.status)
ok("MESMO taskId", dep3?.taskId === Number(TASK_ID))

// ═══════════════════════════════════════════════════════════════════════════
secao("4 · CONFERIR CERTIDÃO")
// ═══════════════════════════════════════════════════════════════════════════
await fecharSobreposicoes()
await abrirTarefaPelaFila()
ok("o executor da etapa 4 abriu", await abrirEtapaAtual())
await page.screenshot({ path: `${OUT}/e2e-4-conferir.png` })
// EXIGÊNCIAS REAIS DA CONFERÊNCIA: o nome do titular COMO ESTÁ no documento
// (é o que permite comparar com o cadastro) e o resultado da conferência.
// O campo do titular tem o próprio placeholder. `primeiro campo visível`
// pegava a BUSCA DO CABEÇALHO — fora do modal, e sem efeito nenhum aqui.
await preencherCamposDoModal("Maria Ferreira")
await page.locator("button").filter({ hasText: /Aprovar/ }).last().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/e2e-4-conferir.png` })
ok("4) a ação terminal liberou", await acaoTerminalHabilitada(), await impedimento())
await clicarAcaoTerminal()
const dep4 = await estado()
ok("Conferir certidão CONCLUÍDA", dep4?.etapas?.[3]?.status === "CONCLUIDO", dep4?.etapas?.[3]?.status)
ok("MESMO taskId", dep4?.taskId === Number(TASK_ID))

// ═══════════════════════════════════════════════════════════════════════════
secao("5 · VALIDAR CERTIDÃO — a etapa terminal")
// ═══════════════════════════════════════════════════════════════════════════
await fecharSobreposicoes()
await abrirTarefaPelaFila()
ok("o executor da etapa 5 abriu", await abrirEtapaAtual())
await page.screenshot({ path: `${OUT}/e2e-5-validar.png` })
// EXIGÊNCIA REAL DA VALIDAÇÃO: a decisão jurídica. "Aprovado" dispensa
// parecer; qualquer outra decisão exige o parecer escrito.
await page.locator("button").filter({ hasText: /Aprovado/ }).first().click().catch(() => {})
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/e2e-5-validar.png` })
ok("5) a ação terminal liberou", await acaoTerminalHabilitada(), await impedimento())
await clicarAcaoTerminal()
const fim = await estado()
ok("Validar certidão CONCLUÍDA", fim?.etapas?.[4]?.status === "CONCLUIDO", fim?.etapas?.[4]?.status)
ok("as 5 etapas concluídas", fim?.etapas?.every((e) => e.status === "CONCLUIDO"),
  fim?.etapas?.map((e) => e.status).join(","))
ok("a TAREFA foi encerrada pela última etapa",
  ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"].includes(fim?.statusTarefa), fim?.statusTarefa)
ok("MESMO taskId do começo ao fim", fim?.taskId === Number(TASK_ID), `${TASK_ID}`)
ok("o título continua sendo o do TRABALHO", !/^Solicitar/.test(fim?.titulo ?? ""), fim?.titulo)

await fecharSobreposicoes()
await abrirTarefaPelaFila().catch(() => {})
await page.screenshot({ path: `${OUT}/e2e-final.png` })

console.log(`\n${"═".repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
if (erros.length) console.log(`\nERROS DE PÁGINA: ${erros.slice(0, 5).join(" | ")}`)
await b.close()
process.exit(falhou > 0 ? 1 : 0)
