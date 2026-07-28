// Validação visual REAL do módulo de Custos (homologação).
// Sobe contra o dev server local ligado no banco de teste, autentica como admin e
// captura as telas novas: lista de Custos, painel de Riscos, pagamento rico e a
// inteligência do lançamento. Falha se a tela não renderizar o que deveria.
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = 'http://localhost:3311'
const TOKEN = readFileSync('/tmp/fin-token.txt', 'utf8').trim()
const OUT = process.argv[2] || '/tmp/custos-visual'
mkdirSync(OUT, { recursive: true })

let ok = 0, fail = 0
const chk = (c, m) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

const erros = []

const main = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
  page.on('pageerror', (e) => erros.push(String(e)))

  await page.addInitScript((t) => { localStorage.setItem('authToken', t) }, TOKEN)

  // ── 1. Lista de Custos ────────────────────────────────────────────────────
  await page.goto(`${BASE}/financeiro/v3/processo-preview?processoId=16`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const abaCustos = page.getByRole('button', { name: /^Custos$/ }).first()
  if (await abaCustos.count()) await abaCustos.click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/01-custos-lista.png`, fullPage: true })
  const textoLista = await page.locator('body').innerText()
  chk(/Custos/.test(textoLista), 'aba Custos renderiza')
  chk(/Exportar/.test(textoLista), 'F7.5 — botão Exportar presente na lista')
  chk(await page.getByPlaceholder(/Buscar descrição/).count() > 0, 'filtros da lista presentes')
  chk(!/Saldo a receber/.test(textoLista), 'F7.4 — nenhum rótulo de Receita vazando na lista de custos')
  // invariante: custo QUITADO não oferece "Pagar" e mostra 100%
  const linhasPagas = await page.evaluate(() => [...document.querySelectorAll('tbody tr')]
    .filter((tr) => /\bPago\b/.test(tr.innerText))
    .map((tr) => ({ temPagar: /\bPagar\b/.test(tr.innerText), pct: (tr.innerText.match(/(\d+)%/) || [])[1] })))
  chk(linhasPagas.length > 0, `há custos quitados na amostra (${linhasPagas.length})`)
  chk(linhasPagas.every((l) => !l.temPagar), 'custo quitado NÃO oferece o botão Pagar')
  chk(linhasPagas.every((l) => l.pct === '100'), `custo quitado mostra 100% (${linhasPagas.map((l) => l.pct).join(',')})`)

  // ── 2. Painel (Contas a Pagar + Riscos) ───────────────────────────────────
  const abaPainel = page.getByRole('button', { name: /^Painel$/ }).first()
  if (await abaPainel.count()) {
    await abaPainel.click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/02-painel-riscos.png`, fullPage: true })
    const textoPainel = await page.locator('body').innerText()
    chk(/Riscos e pendências/.test(textoPainel), 'F8.2 — painel de Riscos e pendências renderiza')
    chk(/custo\(s\) analisado\(s\)/.test(textoPainel), 'painel informa a base analisada')
    chk(/Distribuição por situação/.test(textoPainel), 'gráfico de baldes preservado')
  } else chk(false, 'aba Painel encontrada')

  // diagnóstico: nomes de botão disponíveis na linha (ajuda quando um seletor falha)
  const nomes = await page.getByRole('button').evaluateAll((bs) => bs.map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40))
  console.log('  · botões na tela:', JSON.stringify([...new Set(nomes)]))

  // ── 3. Pagamento rico de custo ────────────────────────────────────────────
  if (await abaCustos.count()) { await abaCustos.click(); await page.waitForTimeout(1200) }
  // a alternância Lista|Painel é PERSISTIDA — volta explicitamente para a Lista
  const toggleLista = page.getByRole('button', { name: /^Lista$/ }).first()
  if (await toggleLista.count()) { await toggleLista.click(); await page.waitForTimeout(2000) }
  const nomesLista = await page.getByRole('button').evaluateAll((bs) => bs.map((b) => (b.textContent || '').trim()).filter(Boolean))
  console.log('  · botões na LISTA:', JSON.stringify([...new Set(nomesLista)].slice(0, 20)))
  const botaoPagar = page.getByRole('button', { name: /^Pagar$/ }).first()
  if (await botaoPagar.count()) {
    await botaoPagar.click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: `${OUT}/03-pagar-custo.png`, fullPage: true })
    const textoPagar = await page.locator('body').innerText()
    chk(/Pagar custo/.test(textoPagar), 'F7.5 — tela de pagamento rico abre')
    chk(/conta de origem/i.test(textoPagar), 'conta é de ORIGEM (saída de caixa)')
    chk(/empresa \(saída de caixa\)/i.test(textoPagar), 'pagador é a empresa (nunca requerente)')
    chk(/formas de pagamento/i.test(textoPagar) && /adicionar forma/i.test(textoPagar), 'multi-forma disponível')
    chk(/comprovantes/i.test(textoPagar) && /ajustes/i.test(textoPagar), 'ajustes e comprovantes presentes')
    chk(/saldo a pagar/i.test(textoPagar), 'F7.4 — linguagem de custo no cabeçalho')
    const opaco = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div.fixed.inset-0')].find((d) => (d.textContent || '').includes('Pagar custo'))
      if (!el) return null
      const bg = getComputedStyle(el).backgroundColor
      const m = bg.match(/rgba?\(([^)]+)\)/)
      const partes = m ? m[1].split(',').map((x) => Number(x)) : []
      return { bg, alpha: partes.length > 3 ? partes[3] : 1 }
    })
    chk(!!opaco && opaco.alpha === 1, `overlay de pagamento é OPACO (${opaco?.bg ?? 'não encontrado'})`)
    const fechar = page.getByRole('button', { name: /^Fechar$/ }).first()
    if (await fechar.count()) { await fechar.click(); await page.waitForTimeout(1200) }
  } else chk(false, 'botão Pagar encontrado na lista')

  // ── 4. Inteligência do lançamento ─────────────────────────────────────────
  const novo = page.getByRole('button', { name: /Novo Custo/i }).first()
  if (await novo.count()) {
    await novo.click()
    await page.waitForTimeout(4000)
    await page.screenshot({ path: `${OUT}/04-lancamento-inteligencia.png`, fullPage: true })
    const textoNovo = await page.locator('body').innerText()
    chk(/sem fornecedor|com base em|analisando o histórico|centro de custo/i.test(textoNovo), 'F8.1 — inteligência do lançamento aparece no modal')
    await page.screenshot({ path: `${OUT}/04b-lancamento-topo.png` })
  } else chk(false, 'botão de novo custo encontrado')

  // ── erros de runtime no console ───────────────────────────────────────────
  const relevantes = erros.filter((e) => !/favicon|Download the React DevTools|hydrat/i.test(e))
  if (relevantes.length) console.log('\n  Erros de console:\n' + relevantes.slice(0, 8).map((e) => '    • ' + e.slice(0, 200)).join('\n'))
  chk(relevantes.length === 0, `nenhum erro de runtime no console (${relevantes.length})`)

  await browser.close()
  console.log(`\n${ok} passaram, ${fail} falharam — imagens em ${OUT}`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
