import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const BASE = 'http://localhost:3399'
const TOKEN = readFileSync('/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/token.txt', 'utf8').trim()
const OUT = '/private/tmp/claude-501/-Users-marcoantoniofriedrichbrinkerrovatti/d3937e4d-754d-4279-a237-16b7ca16e12d/scratchpad/shots'
let ok = 0, fail = 0
const chk = (c, m) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const novaPagina = async (ctx, rota) => {
  const page = await ctx.newPage()
  if (rota) await page.route('**/central-operacional*', rota)
  return page
}
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 } })
await ctx.addInitScript((t) => {
  localStorage.setItem('authToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, nome: 'Ator de Teste', email: 'ator-teste@local', tipo: 'admin' }))
}, TOKEN)

const abrirCentral = async (page, nome) => {
  await page.goto(`${BASE}/kanban?tab=lista`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const lista = page.getByText('Lista', { exact: true }).first()
  if (await lista.count()) { await lista.click(); await page.waitForTimeout(1500) }
  await page.getByText(nome, { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.getByText('Central Operacional', { exact: true }).first().click()
  await page.waitForTimeout(4000)
  return page.locator('body').innerText()
}

// ── ESTADO VAZIO: processo sem fase/workflow ───────────────────────────────
console.log('\n1) Estado VAZIO — processo sem fase e sem workflow')
{
  const page = await novaPagina(ctx)
  const body = await abrirCentral(page, 'Proc sem fase')
  const vazio = /Nenhuma operação materializada|A Central aparece quando o processo tem fase/.test(body)
  const semSpinnerSozinho = body.trim().length > 50
  chk(vazio || /Genealogia|Fila de produção/.test(body), 'estado VAZIO ou conteúdo — nunca só spinner')
  chk(semSpinnerSozinho, 'a aba diz alguma coisa')
  await page.screenshot({ path: `${OUT}/20-vazio.png` })
  console.log('   trecho:', body.replace(/\s+/g,' ').slice(0, 160))
  await page.close()
}

// ── ESTADO ERRO: falha temporária da API (500) ─────────────────────────────
console.log('\n2) Estado ERRO — falha temporária da API')
{
  const page = await novaPagina(ctx, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada' }) }))
  const body = await abrirCentral(page, 'Teste')
  chk(/⚠|Erro ao carregar|Falha simulada|Falha ao carregar/.test(body), 'erro VISÍVEL na aba')
  chk(/Tentar novamente/.test(body), 'ação "Tentar novamente" presente')
  chk(!/^\s*$/.test(body), 'não ficou em branco nem no spinner')
  await page.screenshot({ path: `${OUT}/21-erro.png` })
  console.log('   trecho:', body.replace(/\s+/g,' ').slice(0, 200))

  // recuperação: destrava a rota e clica em Tentar novamente
  await page.unroute('**/central-operacional*')
  await page.getByText('Tentar novamente', { exact: true }).first().click()
  await page.waitForTimeout(4000)
  const depois = await page.locator('body').innerText()
  chk(/Fila de produção documental|Genealogia/.test(depois), 'recupera após "Tentar novamente"')
  await page.screenshot({ path: `${OUT}/22-erro-recuperado.png` })
  await page.close()
}

// ── REDE MORTA: requisição que nunca responde ──────────────────────────────
console.log('\n3) Requisição que NUNCA responde (rede pendurada)')
{
  const page = await novaPagina(ctx, () => { /* nunca resolve */ })
  const body = await abrirCentral(page, 'Teste')
  const spinnerSozinho = !/Fila de produção|Nenhuma operação|Tentar novamente|⚠/.test(body)
  console.log(spinnerSozinho ? '  ⚠️  fica no spinner enquanto a requisição não responde' : '  ✅ sai do spinner')
  await page.screenshot({ path: `${OUT}/23-pendurada.png` })
  console.log('   trecho:', body.replace(/\s+/g,' ').slice(0, 200))
  await page.close()
}

console.log(`\n${ok} ok · ${fail} falhas`)
await browser.close()
