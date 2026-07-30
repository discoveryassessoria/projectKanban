/**
 * E2E DO FLUXO REAL DA ÁRVORE — aplicação autenticada, banco de teste.
 *
 * Sem harness, sem rota temporária, sem componente isolado: navega pela
 * aplicação como o usuário navega — dashboard → processo → aba Árvore — com
 * sessão autenticada e dados vindos do banco.
 *
 * O banco é o de TESTE (DB_ENV=test, host local). O segredo de sessão é gerado
 * localmente para este teste e vive fora do repositório. Nenhuma credencial de
 * usuário é pedida, usada ou registrada.
 *
 * Uso: node scripts/arvore-e2e.mjs [baseUrl]
 */
import { chromium } from "playwright"
import { mkdirSync, readFileSync } from "node:fs"

const BASE = process.argv[2] || "http://localhost:3399"
const SAIDA = "capturas/arvore-e2e"
const { token, processoId, usuarioTipo, usuarioId, usuarioEmail } = JSON.parse(
  readFileSync("/tmp/sessao.json", "utf8"),
)

let ok = 0
let falhou = 0
const falhas = []
const passos = []

function checa(cond, nome) {
  if (cond) {
    ok++
    console.log(`  ✅ ${nome}`)
  } else {
    falhou++
    falhas.push(nome)
    console.log(`  ❌ ${nome}`)
  }
}

async function foto(page, nome) {
  mkdirSync(SAIDA, { recursive: true })
  const caminho = `${SAIDA}/${nome}.png`
  await page.screenshot({ path: caminho })
  passos.push(caminho)
  return caminho
}

const navegador = await chromium.launch()
const contexto = await navegador.newContext({ viewport: { width: 1536, height: 900 } })

// Sessão COMPLETA, como o login real deixa o navegador:
//   · cookie httpOnly  → é o que o guard do servidor lê;
//   · localStorage      → é o que as telas leem no cliente para não redirecionar.
// Faltando o segundo, o servidor autoriza (200) e a tela manda para /login
// mesmo assim — foi exatamente o que aconteceu na primeira tentativa.
await contexto.addCookies([
  { name: "authToken", value: token, url: BASE, sameSite: "Lax" },
])
await contexto.addInitScript(
  ([t, u]) => {
    localStorage.setItem("authToken", t)
    localStorage.setItem("user", u)
  },
  [token, JSON.stringify({ id: usuarioId, email: usuarioEmail, tipo: usuarioTipo, nome: "Teste E2E" })],
)

const page = await contexto.newPage()
const errosConsole = []
page.on("console", (m) => {
  if (m.type() === "error") errosConsole.push(m.text().slice(0, 200))
})
page.on("pageerror", (e) => errosConsole.push(`pageerror: ${String(e).slice(0, 200)}`))

try {
  // ---------------------------------------------------------------
  console.log("\n1) Entrar no Discovery e abrir Processos")
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2500)
  checa(!page.url().includes("/login"), "sessão autenticada aceita")
  await foto(page, "01-dashboard-real")

  await page.getByRole("link", { name: /^Processos$/i }).first().click().catch(async () => {
    await page.getByText(/^Processos$/).first().click()
  })
  await page.waitForTimeout(3500)
  await foto(page, "02-lista-processos")
  console.log(`     rota: ${page.url()}`)

  // ---------------------------------------------------------------
  console.log("\n2) Abrir um processo real")
  // Vai direto pela LISTA: o quadro Kanban depende de colunas configuradas e
  // não dá âncora estável; a lista é o mesmo caminho do usuário, na mesma tela.
  await page.getByRole("button", { name: /^Processos$/ }).first().click().catch(() => {})
  await page.waitForTimeout(1200)
  await page.getByRole("button", { name: /^Lista$/ }).first().click().catch(() => {})
  await page.waitForTimeout(3000)
  await foto(page, "02b-lista-de-processos")

  const linhas = page.locator("table tbody tr")
  const qtd = await linhas.count()
  console.log(`     processos na lista: ${qtd}`)
  checa(qtd > 0, "a lista mostra processos reais do banco")

  if (qtd > 0) {
    await linhas.first().click()
    await page.waitForTimeout(3500)
  }
  const temAbas = (await page.getByRole("button", { name: /árvore/i }).count()) > 0
  checa(temAbas, "processo real aberto (modal com abas)")
  await foto(page, "03-processo-aberto")

  console.log("\n3) Abrir a Árvore Genealógica pela aba do processo")
  await page.getByRole("button", { name: /árvore/i }).first().click()
  await page.waitForTimeout(4000)
  await foto(page, "04-arvore-no-processo")
  console.log(`     rota: ${page.url()}`)

  // QUAL componente está de fato montado?
  const marcas = await page.evaluate(() => ({
    motorNovo: !!document.querySelector("[data-arvore]"),
    cardsNovos: document.querySelectorAll("[data-pessoa-id]").length,
    reactFlow: !!document.querySelector(".react-flow, [class*='react-flow']"),
    // O minimapa da REFERÊNCIA é nosso e é obrigatório. O que não pode voltar é
    // o minimapa do React Flow — biblioteca removida do projeto. Por isso o
    // teste passou a distinguir os dois em vez de proibir "minimapa".
    miniMapReactFlow: !!document.querySelector(".react-flow__minimap"),
    miniMapProprio: !!document.querySelector("[data-minimapa]"),
    controlesReferencia: !!document.querySelector("[data-arvore-controles='principal']"),
    grade: Array.from(document.querySelectorAll("div")).some((e) => {
      const b = getComputedStyle(e).backgroundImage || ""
      return b.includes("radial-gradient") || b.includes("repeating-")
    }),
  }))
  console.log("     componente montado:", JSON.stringify(marcas))
  checa(marcas.motorNovo, "a tela real monta o motor NOVO (data-arvore)")
  checa(marcas.cardsNovos > 0, "a tela real desenha cards com pessoas do BANCO")
  checa(!marcas.reactFlow, "nenhum vestígio de React Flow na tela real")
  checa(!marcas.miniMapReactFlow, "nenhum minimapa de biblioteca de grafo")
  checa(marcas.miniMapProprio, "o minimapa próprio está montado na tela real")
  checa(marcas.controlesReferencia, "os controles flutuantes da referência estão na tela real")
  checa(!marcas.grade, "nenhuma grade na tela real")

  // ---------------------------------------------------------------
  console.log("\n4) A REGRA ABSOLUTA do casal, na tela real")
  // Não basta o teste de layout: aqui os dados vêm do banco, e é aqui que um
  // card de casal reapareceria sem ninguém notar.
  const casal = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[data-cartao-pessoa]"))
    if (cards.length < 2) return { erro: `só ${cards.length} card(s) na tela` }
    // Dois cards que se sobrepõem no eixo horizontal e são vizinhos na vertical
    // são candidatos a casal na leitura deitada.
    const caixas = cards.map((el) => ({ el, r: el.getBoundingClientRect() }))
    const aninhado = caixas.some((a) =>
      caixas.some((b) => a.el !== b.el && a.el.contains(b.el)),
    )
    const comDoisNomes = cards.filter(
      (el) => el.querySelectorAll("[data-pessoa-id]").length > 1,
    ).length
    return {
      total: cards.length,
      aninhado,
      comDoisNomes,
      todosComId: cards.every((el) => !!el.getAttribute("data-pessoa-id")),
    }
  })
  if (casal.erro) {
    console.log(`     (${casal.erro} — processo sem família cadastrada)`)
  } else {
    console.log(`     cards na tela: ${casal.total}`)
    checa(!casal.aninhado, "nenhum card de pessoa está dentro de outro")
    checa(casal.comDoisNomes === 0, "nenhum card contém duas pessoas")
    checa(casal.todosComId, "todo card identifica UMA pessoa (seleção independente)")
  }

  // ---------------------------------------------------------------
  console.log("\n5) Gaveta, navegação e dados reais")
  const primeiro = page.locator("[data-cartao-pessoa]").first()
  if ((await primeiro.count()) > 0) {
    await primeiro.click()
    await page.waitForTimeout(1500)
    const gaveta = page.getByRole("complementary")
    checa((await gaveta.count()) > 0, "clicar num card abre a gaveta da pessoa")
    await foto(page, "05-gaveta-pessoa-real")

    // A gaveta leva à página completa — e ela não pode ser mock.
    const botaoPessoa = page.getByRole("button", { name: /^Pessoa$/ })
    if ((await botaoPessoa.count()) > 0 && (await botaoPessoa.first().isEnabled())) {
      await botaoPessoa.first().click()
      await page.waitForTimeout(1500)
      const abas = await page.getByRole("tab").count()
      checa(abas >= 4, `a página completa da pessoa abre com as abas (${abas})`)
      await foto(page, "06-pagina-pessoa-real")
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: /Voltar à árvore/i }).first().click().catch(() => {})
      await page.waitForTimeout(1200)
    }

    await page.keyboard.press("Escape")
    await page.waitForTimeout(800)
    checa((await page.getByRole("complementary").count()) === 0, "Esc fecha a gaveta")
  }

  // ---------------------------------------------------------------
  console.log("\n6) Busca de pessoa (⌘K) sobre dados reais")
  await page.keyboard.press("Slash")
  await page.waitForTimeout(900)
  const dialogoBusca = page.locator("[role='dialog'][aria-modal='true']")
  checa((await dialogoBusca.count()) > 0, "a busca abre por atalho")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(500)

  // ---------------------------------------------------------------
  console.log("\n7) Nada na tela real depende de fixture")
  const semMock = await page.evaluate(() => ({
    rotaHarness: location.pathname.includes("arvore-render"),
    textoFixture: document.body.innerText.includes("Marco Antônio Bianchi"),
  }))
  checa(!semMock.rotaHarness, "a árvore oficial NÃO é a rota de harness")
  checa(!semMock.textoFixture, "nenhum dado da fixture de testes aparece no fluxo oficial")

  console.log(`\n(erros de console: ${errosConsole.length})`)
  for (const e of errosConsole.slice(0, 6)) console.log(`     · ${e}`)
  checa(
    errosConsole.filter((e) => !/favicon|404|Speed Insights/i.test(e)).length === 0,
    "nenhum erro de console relevante na tela real",
  )
} catch (e) {
  console.log(`\n❌ INTERROMPIDO: ${String(e).split("\n")[0].slice(0, 220)}`)
  await foto(page, "99-falha")
  falhou++
  falhas.push("fluxo interrompido")
} finally {
  await navegador.close()
}

console.log(`\n${falhou === 0 ? "✅" : "❌"} E2E FLUXO REAL — ${ok} ok, ${falhou} falhas`)
console.log("Capturas:")
for (const p of passos) console.log(`  ${p}`)
if (falhou > 0) {
  console.log("Falhas: " + falhas.join("; "))
  process.exit(1)
}
