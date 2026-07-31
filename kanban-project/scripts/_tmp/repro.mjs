import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:3399'
const TOKEN = readFileSync('/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/token.txt', 'utf8').trim()
const OUT = '/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/shots'
const PROC = process.argv[2] || '35'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 } })
const page = await ctx.newPage()
const consoleMsgs = []
const reqs = []
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${String(e)}`))
page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push({ t: Date.now(), url: r.url().replace(BASE,''), status: null }) })
page.on('response', (r) => { if (r.url().includes('/api/')) { const e = reqs.find(x => x.url === r.url().replace(BASE,'') && x.status === null); if (e) { e.status = r.status(); e.ms = Date.now() - e.t } } })

await page.addInitScript((t) => {
  localStorage.setItem('authToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, nome: 'Ator de Teste', email: 'ator-teste@local', tipo: 'admin' }))
}, TOKEN)

await page.goto(`${BASE}/kanban`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.screenshot({ path: `${OUT}/00-kanban.png` })
console.log('URL:', page.url())
const txt = await page.locator('body').innerText()
console.log('BODY head:', txt.slice(0, 600))
console.log('--- console:', consoleMsgs.slice(0, 30).join('\n'))
console.log('--- reqs:', reqs.map(r => `${r.status} ${r.ms ?? '?'}ms ${r.url}`).join('\n'))
await browser.close()
