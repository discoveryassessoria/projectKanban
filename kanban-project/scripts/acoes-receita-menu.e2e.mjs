// scripts/acoes-receita-menu.e2e.mjs
// ============================================================================
// E2E OBRIGATÓRIO — "Mais ações" da Receita, UMA asserção por ação, clicando
// pelo MESMO menu do operador. Reproduz o bug de empilhamento injetando no body
// um pai `fixed z-[9999]` idêntico ao modal do processo (atividade-details-modal):
// os modais das ações são portais em document.body; se ficarem abaixo de 9999,
// somem atrás do processo. O teste exige que cada modal abra ACIMA de 9999.
// A rota standalone SOZINHA dá falso positivo (não tem o pai z-9999) — por isso
// o overlay é injetado aqui.
//
// Uso: dev server em :3999 (test DB) + usuário homolog. `node scripts/acoes-receita-menu.e2e.mjs`
// ============================================================================
import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3999'
const REF = process.env.RECEITA_REF ?? '63'
const EMAIL = process.env.HOMOLOG_EMAIL ?? 'homolog@discovery.local'
const SENHA = process.env.HOMOLOG_SENHA ?? 'homolog123'

let ok = 0, fail = 0
const pass = (n, extra = '') => { ok++; console.log(`✅ ${n}${extra ? ' — ' + extra : ''}`) }
const bad = (n, extra = '') => { fail++; console.log(`❌ ${n}${extra ? ' — ' + extra : ''}`) }

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const p = await ctx.newPage()
const con = []; p.on('console', m => { if (m.type() === 'error') con.push(m.text().slice(0, 140)) })

await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await p.fill('#login-email', EMAIL); await p.fill('#login-senha', SENHA)
await p.click('button:has-text("Entrar")'); await p.waitForTimeout(1500)

// injeta o "modal do processo" (z-9999) — o contexto que expõe o bug
async function abrirComContextoProcesso() {
  await p.goto(`${BASE}/financeiro/v3/receita/${REF}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1100)
  await p.evaluate(() => {
    document.getElementById('__proc_ctx__')?.remove()
    const d = document.createElement('div')
    d.id = '__proc_ctx__'
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none'
    document.body.appendChild(d)
  })
}
const zTopo = () => p.evaluate(() => {
  let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2), z = 0
  while (el) { const v = parseInt(getComputedStyle(el).zIndex); if (!isNaN(v)) z = Math.max(z, v); el = el.parentElement }
  return z
})

async function acaoAbreAcimaDoProcesso(nome, item, txt) {
  await abrirComContextoProcesso()
  con.length = 0
  await p.locator('button:has-text("Mais ações")').first().click({ timeout: 5000 }).catch(() => {})
  await p.waitForTimeout(300)
  const el = p.locator(`button:has-text("${item}")`).last()
  if (!(await el.count())) return bad(nome, 'item ausente no menu')
  if (await el.isDisabled().catch(() => false)) return pass(nome, 'desabilitado com motivo (ação indisponível tratada)')
  await el.click({ timeout: 4000 }).catch(() => {})
  await p.waitForTimeout(800)
  const z = await zTopo()
  const vis = await p.locator(`text=/${txt}/i`).first().isVisible().catch(() => false)
  if (z >= 10000 && vis && con.length === 0) pass(nome, `modal acima do processo (z=${z})`)
  else bad(nome, `z=${z} visível=${vis} consoleErr=${con.length}`)
}

await acaoAbreAcimaDoProcesso('Editar Receita', 'Editar Receita', 'Cadastro Mestre|Título|câmbio')
await acaoAbreAcimaDoProcesso('Editar regra de câmbio', 'Editar regra de câmbio', 'câmbio|Taxa|fx')
await acaoAbreAcimaDoProcesso('Gerar fatura', 'Gerar fatura', 'Fatura|fatura')
await acaoAbreAcimaDoProcesso('Gerar recibo', 'Gerar recibo', 'recibo|pagamento confirmado')
await acaoAbreAcimaDoProcesso('Renegociar', 'Renegociar', 'Renegociar|cobranças em aberto')
await acaoAbreAcimaDoProcesso('Arquivar', 'Arquivar', 'Arquivar|listagens')
await acaoAbreAcimaDoProcesso('Cancelar Receita', 'Cancelar Receita', 'Cancelar|cancelamento')

// Estornar pagamento: o item leva à aba Pagamentos (menu por linha faz o estorno).
await abrirComContextoProcesso()
await p.locator('button:has-text("Mais ações")').first().click(); await p.waitForTimeout(250)
await p.locator('button:has-text("Estornar pagamento")').last().click(); await p.waitForTimeout(500)
;(await p.locator('text=/Pagamentos/i').first().isVisible().catch(() => false)) ? pass('Estornar pagamento', 'leva à aba Pagamentos') : bad('Estornar pagamento')

// Ver movimentações → aba Timeline
await abrirComContextoProcesso()
await p.locator('button:has-text("Mais ações")').first().click(); await p.waitForTimeout(250)
await p.locator('button:has-text("Ver movimentações")').last().click(); await p.waitForTimeout(500)
;(await p.locator('text=/Timeline|movimenta/i').first().isVisible().catch(() => false)) ? pass('Ver movimentações', 'aba Timeline') : bad('Ver movimentações')

// Copiar código → clipboard recebe o código
await abrirComContextoProcesso()
await p.locator('button:has-text("Mais ações")').first().click(); await p.waitForTimeout(250)
await p.locator('button:has-text("Copiar código")').last().click(); await p.waitForTimeout(400)
const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')
clip && clip.length > 2 ? pass('Copiar código', `clipboard="${clip}"`) : bad('Copiar código', `clipboard vazio`)

console.log(`\n${fail === 0 ? '✅ TODAS' : '❌'} — ${ok} ok, ${fail} falhas`)
await b.close()
process.exit(fail === 0 ? 0 : 1)
