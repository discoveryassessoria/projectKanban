import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
const [BASE, PROC, OUT, TOK] = process.argv.slice(2)
mkdirSync(OUT, { recursive: true })
const token = readFileSync(TOK, 'utf8').trim()
const user = readFileSync(TOK + '.user', 'utf8').trim()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 2000, height: 1200 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const erros = []
page.on('pageerror', (e) => erros.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
await page.addInitScript(([t, u]) => { localStorage.setItem('authToken', t); localStorage.setItem('user', u) }, [token, user])
await page.goto(`${BASE}/financeiro/v3/processo-preview?processoId=${PROC}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForTimeout(6000)
const custos = page.getByRole('button', { name: /^Custos$/ }).first()
if (await custos.count()) { await custos.click(); await page.waitForTimeout(2500) }
const aba = page.getByRole('button', { name: /Planilha documental/ }).first()
if (!(await aba.count())) { console.log('SEM ABA. corpo:', (await page.locator('body').innerText()).slice(0, 400)); process.exit(1) }
await aba.click()
await page.waitForTimeout(3000)
try { await page.waitForSelector('table', { timeout: 20000 }) } catch { console.log('SEM TABELA apos 20s') }
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/planilha.png`, fullPage: true })
// A referência é uma folha inteira. Na tela a planilha rola dentro do painel;
// em IMPRESSÃO ela abre por completo — é essa a vista comparável ao arquivo.
await page.emulateMedia({ media: 'print' })
await page.waitForTimeout(600)
const folha = page.locator('table').first().locator('xpath=ancestor::div[contains(@style,"min-width")]')
if (await folha.count()) await folha.first().screenshot({ path: `${OUT}/folha.png` })
await page.emulateMedia({ media: 'screen' })
console.log('TEXTO:\n' + (await page.locator('body').innerText()).slice(0, 1800))
if (erros.length) console.log('\nERROS:', erros.slice(0, 5).join(' | '))
await b.close()
