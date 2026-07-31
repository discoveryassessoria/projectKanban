import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const BASE = 'http://localhost:3399'
const TOKEN = readFileSync('/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/token.txt', 'utf8').trim()
const OUT = '/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/shots'
const PROC = process.argv[2] || 'Teste'
let ok = 0, fail = 0
const chk = (c, m) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 } })
const page = await ctx.newPage()
const erros = [], reqs = []
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0,200)) })
page.on('pageerror', (e) => erros.push('pageerror: ' + String(e).slice(0,200)))
page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push({ t: Date.now(), url: r.url().replace(BASE,''), status: null }) })
page.on('response', (r) => { if (r.url().includes('/api/')) { const e = reqs.find(x => x.url === r.url().replace(BASE,'') && x.status === null); if (e) { e.status = r.status(); e.ms = Date.now() - e.t } } })
await page.addInitScript((t) => {
  localStorage.setItem('authToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, nome: 'Ator de Teste', email: 'ator-teste@local', tipo: 'admin' }))
}, TOKEN)

await page.goto(`${BASE}/kanban`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)

// ── 1. criar processo pela UI (o erro do print) ────────────────────────────
console.log('\n1) Criar processo pela UI')
const btnNovo = page.getByRole('button', { name: /Novo processo/i }).first()
if (await btnNovo.count()) {
  await btnNovo.click(); await page.waitForTimeout(1200)
  const nome = page.getByPlaceholder(/nome/i).first()
  if (await nome.count()) await nome.fill('Teste E2E ' + Date.now().toString().slice(-5))
  const criar = page.getByRole('button', { name: /^Criar processo$/i }).first()
  await criar.click()
  await page.waitForTimeout(6000)
  const txt = await page.locator('body').innerText()
  chk(!/Erro ao criar processo/.test(txt), 'sem "Erro ao criar processo"')
  await page.screenshot({ path: `${OUT}/10-criar.png` })
} else chk(false, 'botão "Novo processo" encontrado')

// ── 2. Central Operacional ─────────────────────────────────────────────────
console.log('\n2) Central Operacional')
await page.goto(`${BASE}/kanban`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.getByText(PROC, { exact: true }).first().click()
await page.waitForTimeout(2500)
const aba = page.getByText('Central Operacional', { exact: true }).first()
await aba.click()
await page.waitForTimeout(4000)
let body = await page.locator('body').innerText()
chk(/Fila de produção documental|Nenhuma operação materializada|Genealogia/.test(body), 'Central renderizou conteúdo (não ficou só no spinner)')
chk(!/^\s*$/.test(body), 'corpo não vazio')
await page.screenshot({ path: `${OUT}/11-central.png` })

// ── 3. troca rápida entre abas ─────────────────────────────────────────────
console.log('\n3) Troca rápida de abas')
for (const nome of ['Geral', 'Documentos', 'Central Operacional', 'Geral', 'Central Operacional']) {
  const t = page.getByText(nome, { exact: true }).first()
  if (await t.count()) { await t.click(); await page.waitForTimeout(400) }
}
await page.waitForTimeout(3500)
body = await page.locator('body').innerText()
chk(/Fila de produção documental|Nenhuma operação materializada|Genealogia/.test(body), 'Central ok após troca rápida de abas')
await page.screenshot({ path: `${OUT}/12-troca-abas.png` })

// ── 4. fechar e reabrir o modal ────────────────────────────────────────────
console.log('\n4) Fechar e reabrir o modal')
await page.keyboard.press('Escape')
await page.waitForTimeout(1200)
await page.getByText(PROC, { exact: true }).first().click()
await page.waitForTimeout(2000)
await page.getByText('Central Operacional', { exact: true }).first().click()
await page.waitForTimeout(4000)
body = await page.locator('body').innerText()
chk(/Fila de produção documental|Nenhuma operação materializada|Genealogia/.test(body), 'Central ok ao reabrir o modal')
await page.screenshot({ path: `${OUT}/13-reabrir.png` })

// ── 5. requisições ─────────────────────────────────────────────────────────
console.log('\n5) Rede e console')
const central = reqs.filter(r => r.url.includes('central-operacional'))
const pendentes = reqs.filter(r => r.status === null)
const cincos = reqs.filter(r => r.status >= 500)
chk(central.length > 0 && central.length <= 8, `central-operacional chamada ${central.length}x (sem loop)`)
chk(pendentes.length === 0, `nenhuma requisição pendente (${pendentes.length})`)
chk(cincos.length === 0, `nenhum 5xx (${cincos.length})`)
chk(erros.length === 0, `console sem erros (${erros.length})`)
if (erros.length) console.log('   erros:', erros.slice(0,5).join(' | '))
console.log('   central:', central.map(r => `${r.status} ${r.ms}ms`).join(', '))
console.log(`\n${ok} ok · ${fail} falhas`)
await browser.close()
process.exit(fail ? 1 : 0)
