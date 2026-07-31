import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const BASE = 'http://localhost:3399'
const TOKEN = readFileSync('/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/token.txt', 'utf8').trim()
const OUT = '/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/shots'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 } })
const page = await ctx.newPage()
const msgs = [], reqs = []
page.on('console', (m) => msgs.push(`[${m.type()}] ${m.text().slice(0,300)}`))
page.on('pageerror', (e) => msgs.push(`[pageerror] ${String(e).slice(0,500)}`))
page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push({ t: Date.now(), url: r.url().replace(BASE,''), status: null }) })
page.on('response', (r) => { if (r.url().includes('/api/')) { const e = reqs.find(x => x.url === r.url().replace(BASE,'') && x.status === null); if (e) { e.status = r.status(); e.ms = Date.now() - e.t } } })
await page.addInitScript((t) => {
  localStorage.setItem('authToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, nome: 'Ator de Teste', email: 'ator-teste@local', tipo: 'admin' }))
}, TOKEN)
await page.goto(`${BASE}/kanban`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
// abre o card do processo
await page.getByText('Teste', { exact: true }).first().click()
await page.waitForTimeout(3000)
await page.screenshot({ path: `${OUT}/01-modal-geral.png` })
console.log('ABAS:', (await page.locator('body').innerText()).slice(0,400))
const aba = page.getByText('Central Operacional', { exact: true }).first()
console.log('aba encontrada:', await aba.count())
await aba.click()
for (const s of [2000, 5000, 10000, 15000]) {
  await page.waitForTimeout(s === 2000 ? 2000 : 3000)
  await page.screenshot({ path: `${OUT}/02-central-${s}.png` })
}
const body = await page.locator('body').innerText()
console.log('=== BODY CENTRAL ===')
console.log(body.slice(0, 1500))
console.log('=== CONSOLE ===')
console.log(msgs.join('\n').slice(0, 4000))
console.log('=== REQS ===')
console.log(reqs.map(r => `${r.status ?? 'PENDENTE'} ${r.ms ?? '?'}ms ${r.url}`).join('\n'))
await browser.close()
