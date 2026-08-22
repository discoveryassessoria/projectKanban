// tests/ui/login.repro.spec.ts
//
// REPRODUZ O LOGIN TRAVADO EM "Entrando…".
//
// O relato: depois que a sessão cai sozinha, a nova tentativa de login fica presa no
// botão "Entrando…" e só volta a funcionar depois de recarregar a página. Um teste que
// só faz login feliz não vê isso — o caminho que quebra passa por uma sessão anterior
// encerrada, que é o que este arquivo encena.
//
//   PRISMA_DATABASE_URL=<banco de teste> npx playwright test tests/ui/login.repro.spec.ts
import { test, expect } from "@playwright/test"
import { BASE_URL } from "../../playwright.config"

const EMAIL = process.env.UI_LOGIN_EMAIL ?? ""
const SENHA = process.env.UI_LOGIN_SENHA ?? ""

test.skip(!EMAIL || !SENHA, "defina UI_LOGIN_EMAIL e UI_LOGIN_SENHA")

async function preencherEEntrar(page: import("@playwright/test").Page) {
  // ESPERA A TELA ASSENTAR ANTES DE DIGITAR.
  //
  // Ao abrir, o login descarta credencial pela metade e isso provoca um re-render. Um
  // clique disparado exatamente nesse instante cai num botão que está sendo
  // substituído e não vira requisição nenhuma — o robô é rápido o bastante para
  // acertar essa janela; uma pessoa digitando nunca. Esperar aqui mede o que
  // interessa (a tentativa termina) em vez de medir a corrida do próprio teste.
  // NADA DE `networkidle` AQUI: o provedor de sessão faz polling a cada 5 s, então a
  // rede nunca fica ociosa e a espera consumia o tempo do próprio teste.
  //
  // DOIS MODOS DE TELA. Na primeira visita o login pede e-mail e senha. Depois de uma
  // entrada bem-sucedida ele lembra a conta e pede SÓ a senha — o e-mail vira campo
  // oculto. Um teste que só conhece o primeiro modo trava no segundo, que é
  // justamente o caminho de quem volta depois da sessão cair.
  await page.locator('input[name="senha"]').waitFor({ state: "visible", timeout: 20_000 })
  await page.waitForTimeout(300)
  const email = page.locator('input[name="email"]')
  if (await email.isVisible().catch(() => false)) await email.fill(EMAIL)
  await page.fill('input[name="senha"]', SENHA)
  await page.click('button[type="submit"]')
}

test("a tela de login NÃO entra em laço de navegação", async ({ page }) => {
  // O DEFEITO MEDIDO: 1.853 navegações em 12 segundos entre /login e /dashboard,
  // porque cada tela tinha a sua definição de "estar logado" e mandava para a outra.
  // Uma abertura normal faz poucas navegações; dezenas já são o laço de volta.
  const navegacoes: string[] = []
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navegacoes.push(f.url()) })
  await page.goto(`${BASE_URL}/login`)
  await page.waitForTimeout(6000)
  expect(navegacoes.length,
    `a página navegou ${navegacoes.length} vezes em 6s — laço entre /login e /dashboard`)
    .toBeLessThan(10)
})

test("credencial pela metade é descartada, e o login NÃO manda para o dashboard", async ({ page }) => {
  // O ESTADO QUE O SISTEMA PRODUZ SOZINHO: a renovação reescreve `authToken` e o
  // cookie, e nunca reescreve `user`. Com `user` ausente, a tela de login achava que
  // estava logada e o dashboard achava que não.
  await page.goto(`${BASE_URL}/login`)
  await page.evaluate(() => {
    const falso = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.assinatura"
    localStorage.setItem("authToken", falso)
    localStorage.removeItem("user")
    document.cookie = `authToken=${falso}; path=/`
  })
  const navegacoes: string[] = []
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navegacoes.push(f.url()) })
  await page.reload()
  await page.waitForTimeout(4000)
  expect(page.url(), "continuou no login em vez de saltar para o dashboard").toContain("/login")
  expect(navegacoes.length, "houve laço de navegação").toBeLessThan(8)
  const sobrou = await page.evaluate(() => ({
    ls: localStorage.getItem("authToken"), cookie: document.cookie.includes("authToken=ey"),
  }))
  expect(sobrou.ls, "a credencial pela metade não foi descartada").toBeNull()
  expect(sobrou.cookie, "o cookie pela metade não foi descartado").toBeFalsy()
  await expect(page.locator('input[name="email"]')).toBeVisible()
})

/**
 * O CONTRATO DO LOGIN: toda tentativa termina em SUCESSO ou em ERRO VISÍVEL.
 *
 * Nunca em "Entrando…" para sempre. Sucesso é sair de /login; erro é a mensagem
 * aparecer com o botão de volta ao normal. Esperar apenas "o botão deixou de dizer
 * Entrando" é frágil: no sucesso o botão nem existe mais, porque a página navegou.
 */
async function tentativaTerminou(page: import("@playwright/test").Page, ms = 30_000) {
  // SAIU DO LOGIN = sucesso. Espera nativa do Playwright, que já lida com a navegação
  // em curso — um laço manual lendo `page.url()` perdia a transição.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: ms })
}

test("login limpo termina em sucesso — nunca fica em Entrando…", async ({ page }) => {
  const erros: string[] = []
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()) })
  await page.goto(`${BASE_URL}/login`)
  await preencherEEntrar(page)
  await tentativaTerminou(page)
  expect(page.url(), "o login não levou a lugar nenhum").not.toContain("/login")
  expect(erros.join(" | ")).not.toContain("ChunkLoadError")
})

test("senha errada termina em ERRO VISÍVEL — nunca fica em Entrando…", async ({ page }) => {
  await page.goto(`${BASE_URL}/login`)
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="senha"]', "senha-que-nao-e-a-certa")
  await page.click('button[type="submit"]')
  await expect(page.locator('button[type="submit"]'),
    'o botão continuou em "Entrando…" depois de credencial recusada')
    .not.toHaveText(/Entrando/, { timeout: 15_000 })
  expect(page.url()).toContain("/login")
})

test("depois de uma sessão encerrada, o login NÃO fica preso em Entrando…", async ({ page }) => {
  // 1. Entra normalmente.
  await page.goto(`${BASE_URL}/login`)
  await preencherEEntrar(page)
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 })

  // 2. A SESSÃO CAI SOZINHA — é o caminho real: o provedor de sessão encerra e manda
  //    para /login por navegação dura, deixando o marcador de encerramento no storage.
  await page.evaluate(async () => {
    const { encerrarSessao } = await import("/src/lib/sessao/cliente.ts" as string).catch(() => ({ encerrarSessao: null }) as never)
    if (encerrarSessao) return encerrarSessao("inatividade")
    // Sem acesso ao módulo, encena o mesmo efeito observável.
    localStorage.removeItem("authToken"); localStorage.removeItem("user")
    document.cookie = "authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
    localStorage.setItem("sessao:encerrada", `inatividade:${Date.now()}`)
    window.location.href = "/login"
  })
  await page.waitForURL(/\/login/, { timeout: 20_000 })

  // 3. Tenta entrar de novo — é AQUI que travava no relato.
  await preencherEEntrar(page)
  await tentativaTerminou(page)
  expect(page.url(), "a segunda entrada não saiu do login").not.toContain("/login")
})
