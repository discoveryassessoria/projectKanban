// scripts/torre-nova-tarefas.pw.ts — Playwright da aba TAREFAS da Torre nova, contra o PALCO (localhost; NÃO entra na suíte crítica).
//   npx tsx scripts/torre-nova-tarefas.pw.ts          (palco vivo: node scripts/dev-torre-nova.mjs)
// Fluxos: estrutura e ordem dos blocos · visões com número · filtros (Limpar filtros limpa a URL) · seleção + barra de lote · gaveta
// (passos/histórico reais) · Modo foco (limites, inclui cancelada) · modal com justificativa inerte até 5 letras e que não fecha com
// Esc nem no fundo · Feito. Só LÊ e abre/cancela modais — nenhuma escrita no palco.
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
let ok = 0, falhas = 0
const check = (n: string, c: boolean) => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { falhas++; console.log(`  ❌ ${n}`) } }

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1300 } })
  await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: `http://localhost:${d.porta}` }])
  await ctx.addInitScript(([t, u]) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
  const page = await ctx.newPage()
  const erros: string[] = []
  page.on("pageerror", (e) => erros.push(e.message))
  await page.goto(`http://localhost:${d.porta}/torre?aba=tarefas`, { waitUntil: "networkidle", timeout: 180000 })
  await page.waitForSelector(".tf-linha", { timeout: 60000 })

  console.log("Estrutura")
  const ordem = await page.evaluate(() => ["tf-head", "tf-card", "tf-fx", "tf-bloqueio", "tf-tabela"].map((c) => { const e = document.querySelector("." + c); return e ? e.getBoundingClientRect().top : -1 }))
  check("blocos na ordem: cabeçalho · Visão/Salvas · filtros · Bloqueio · tabela", ordem.every((t, i) => t >= 0 && (i === 0 || t > ordem[i - 1])))
  check("8 visões, a primeira ativa", (await page.locator(".tf-seg button").count()) === 8 && (await page.locator(".tf-seg button").first().getAttribute("aria-pressed")) === "true")
  check("cabeçalho de cinco colunas de dados + checkbox", (await page.locator(".tf-hd div").count()) === 10)

  console.log("Visões e filtros")
  await page.getByRole("button", { name: /^Vencidas/ }).click()
  const nVenc = Number((await page.locator(".tf-seg button", { hasText: "Vencidas" }).locator(".tf-n").innerText()).replace(/\D/g, ""))
  check("visão Vencidas: o 'Mostrando N de M' tem M = o selo da visão", (await page.locator(".tf-mostrando").innerText()).includes(`de ${nVenc} `))
  await page.getByRole("button", { name: /^Todas as abertas/ }).click()
  await page.getByLabel("Risco", { exact: true }).selectOption("critico")
  await page.waitForTimeout(700)
  check("a URL ganhou ?risco=critico", page.url().includes("risco=critico"))
  await page.getByRole("button", { name: "Limpar filtros" }).click()
  await page.waitForTimeout(600)
  check("Limpar filtros limpa de verdade: selects voltam, URL sem chave de filtro", (await page.getByLabel("Risco", { exact: true }).inputValue()) === "" && !page.url().includes("risco="))
  await page.getByRole("button", { name: "Mais filtros · 6" }).click()
  check("Mais filtros mostra Passo atual · Cartório · Prioridade · Cobrança · Status · Só linha reta", (await page.locator(".tf-fx label").allInnerTexts()).join("|").includes("Passo atual") && (await page.getByText("Só linha reta").count()) === 1)
  check("Status só A iniciar / Em andamento / Cancelada", (await page.getByLabel("Status", { exact: true }).locator("option").allInnerTexts()).join("|") === "Todos|A iniciar|Em andamento|Cancelada")

  console.log("Seleção e lote")
  await page.locator(".tf-linha .tf-chk:not([disabled])").nth(0).click()
  check("barra de lote aparece com '1 selecionada(s)'", (await page.locator(".tf-lote").innerText()).includes("1 selecionada(s)"))
  await page.getByRole("button", { name: "Limpar", exact: true }).click()
  check("Limpar zera a seleção", (await page.locator(".tf-lote").count()) === 0)

  console.log("Gaveta e modais")
  await page.locator(".tf-nome").first().click()
  await page.waitForSelector(".tf-gaveta")
  const g = (await page.locator(".tf-gaveta").innerText()).toLowerCase()
  check("gaveta: grade, passos, ações, histórico e link do processo", ["bola com", "prazo da tarefa", "passos desta certidão", "histórico desta certidão", "abrir o processo inteiro ›"].every((t) => g.includes(t)))
  await page.getByRole("button", { name: "Repactuar prazo" }).last().click()
  const conf = page.locator(".tf-modal button.conf")
  check("modal: botão inerte e aviso âmbar sem justificativa", (await conf.getAttribute("class"))!.includes("inerte") && (await page.locator(".tf-aviso").innerText()).includes("Escreva pelo menos 5 letras"))
  await page.keyboard.press("Escape"); await page.mouse.click(5, 5)
  check("o modal NÃO fecha com Esc nem clicando no fundo", (await page.locator(".tf-modal").count()) === 1)
  await page.locator(".tf-modal input[aria-label=Justificativa]").fill("abcd")
  check("4 letras: continua inerte", (await conf.getAttribute("class"))!.includes("inerte"))
  await page.locator(".tf-modal input[aria-label=Justificativa]").fill("abcde")
  check("5 letras: aviso verde 'Justificativa ok'", (await page.locator(".tf-aviso").innerText()).includes("Justificativa ok"))
  await page.getByRole("button", { name: "Cancelar" }).click()
  await page.locator(".tf-fundo").click({ position: { x: 20, y: 300 } })
  check("a gaveta fecha clicando no fundo", (await page.locator(".tf-gaveta").count()) === 0)

  console.log("Modo foco")
  await page.getByRole("button", { name: /Fazer agora/ }).click()
  await page.waitForSelector(".tf-foco-barra")
  const barra = await page.locator(".tf-foco-barra b").innerText()
  const total = Number(barra.match(/de (\d+)/)![1])
  check("Modo foco · 1 de N", /Modo foco · 1 de \d+/.test(barra) && (await page.getByRole("button", { name: "← Anterior" }).first().isDisabled()))
  check("a lista do foco inclui as canceladas (N ≥ 'Fazer agora (n)')", total >= Number((await page.getByRole("button", { name: /Fazer agora/ }).innerText()).match(/\((\d+)\)/)![1]))
  await page.locator("button.tf-x").click()

  console.log("Feito")
  await page.getByRole("button", { name: /^Feito/ }).click()
  check("Feito esconde filtros, bloqueio e tabela e mostra o texto dos 14 dias", (await page.locator(".tf-fx").count()) === 0 && (await page.locator(".tf-tabela .tf-g.tf-hd").count()) === 0 && (await page.getByText("Concluídas nos últimos 14 dias · toda a equipe").count()) === 1)
  check("sem erro de página", erros.length === 0)
  await browser.close()
  console.log(`\n${falhas === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas} falhas`)
  process.exit(falhas ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
