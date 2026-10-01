// Utilitários compartilhados dos roteiros Playwright da Nova Torre (contra o PALCO em localhost; FORA da suíte crítica).
import { chromium, type Page, type BrowserContext, type Browser } from "playwright"
import { readFileSync, mkdirSync } from "node:fs"

export const d = JSON.parse(readFileSync("/private/tmp/claude-501/torre-nova-dev.json", "utf8"))
export const base = `http://localhost:${d.porta}`
if (!/^http:\/\/localhost:\d+$/.test(base)) throw new Error("só contra o palco local")
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(d.urlBanco)) throw new Error("banco do palco não é local")
export const IMPL = "prototipo-torre/impl"
mkdirSync(IMPL, { recursive: true })
export { chromium }
export type { Page, BrowserContext, Browser }

export async function novoContexto(browser: Browser, w = 1440, h = 900): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true })
  await ctx.addCookies([{ name: "authToken", value: d.tokenAdmin, url: base }])
  await ctx.addInitScript(([t, u]: any) => { localStorage.setItem("authToken", t); localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)) }, [d.tokenAdmin, d.usuarioAdmin])
  await ctx.addInitScript("window.__name = window.__name || ((f) => f)") // tsx injeta __name nas arrow functions de page.evaluate
  return ctx
}

export type Eventos = { erros: string[]; escritas: string[]; downloads: string[] }
export function vigiar(page: Page): Eventos {
  const ev: Eventos = { erros: [], escritas: [], downloads: [] }
  page.on("pageerror", (e) => ev.erros.push("pageerror: " + e.message))
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|_next\/image/.test(m.text())) ev.erros.push("console.error: " + m.text().slice(0, 200)) })
  page.on("response", (r) => {
    const u = r.url(); const m = r.request().method()
    if (r.status() >= 400 && u.startsWith(base) && !/_next\/(image|static)|favicon|\/__nextjs/.test(u)) ev.erros.push(`HTTP ${r.status()} ${m} ${u.replace(base, "")}`)
    if (m !== "GET" && u.includes("/api/") && r.status() < 400) ev.escritas.push(`${m} ${u.replace(base, "").split("?")[0]}`)
  })
  page.on("download", (dl) => ev.downloads.push(dl.suggestedFilename()))
  return ev
}

export async function abrir(page: Page, caminho: string) {
  await page.goto(`${base}${caminho}`, { waitUntil: "domcontentloaded", timeout: 240000 })
  await page.locator(".tor, [role=tablist], button:has-text('Revisar o dia')").first().waitFor({ timeout: 90000 })
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(900)
}
export const aba = (a: string) => `/torre?aba=${a}`
export const txt = async (page: Page) => (await page.locator("body").innerText()).replace(/[ \t]+/g, " ")
export const n = (s: string) => Number(s.replace(/[^\d]/g, ""))

export const PROIBIDOS: Array<[RegExp, string]> = [
  [/\bundefined\b/i, "undefined"], [/\bNaN\b/, "NaN"], [/\[object/i, "[object"], [/\bTODO\b/, "TODO"], [/\bexemplo\b/i, "exemplo"], [/em breve/i, "em breve"],
  [/com o cart[óo]rio/i, "Com o cartório"], [/\bning[uú][eé]m\b/i, "ninguém"], [/sem ningu[ée]m/i, "Sem ninguém"], [/Equipe e Terceiros/i, "Equipe e Terceiros"],
  [/Aguardando (o |a )?(cart[óo]rio|ju[íi]zo|consulado)/i, "Aguardando cartório/juízo/consulado"],
  [/\b[A-Z]{3,}_[A-Z_]{2,}\b/, "enum cru"], [/\b(EMAIL|TELEFONE|WHATSAPP|OFICIO|PRESENCIAL)\b/, "canal em código cru"],
]
/** Lista as ocorrências de texto proibido (rótulo + contexto). */
export function proibidosEm(corpo: string): string[] {
  const out: string[] = []
  for (const [re, nome] of PROIBIDOS) { const m = re.exec(corpo); if (m) out.push(`"${nome}": …${corpo.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ")}…`) }
  return out
}

export async function toastTexto(page: Page): Promise<string> { return (await page.locator(".tor-toast, .tpr-toast").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim() }
export async function fecharToast(page: Page) { await page.locator(".tor-toast button[aria-label='Fechar aviso'], .tpr-toast button[aria-label='Fechar aviso']").first().click({ timeout: 800 }).catch(() => {}) }
export async function dialogos(page: Page): Promise<number> { return page.locator("[role=dialog]").count() }
/** Posição de rolagem somada de todos os contêineres (a página do layout rola num div, não na janela). */
export async function rolagem(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll("div,main,body,html")).reduce((a, e) => a + (e as HTMLElement).scrollTop, 0))
}
