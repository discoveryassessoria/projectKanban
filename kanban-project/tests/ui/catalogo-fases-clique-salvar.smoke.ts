// tests/ui/catalogo-fases-clique-salvar.smoke.ts
//
// SMOKE AUTENTICADO DO CLIQUE EM "SALVAR" — Gerenciamento → Processos →
// Estrutura → Fases — contra o BANCO DE TESTE LOCAL (nunca produção — este
// arquivo ESCREVE).
//
// Existe porque a auditoria relatou (20/09/2026): "clicar em Salvar não fecha
// o formulário, não grava, não mostra mensagem — só Enter funciona". Testar
// só com `locator.press('Enter')` ou submissão programática NÃO prova nada
// sobre esse relato: o bug (se real) é especificamente sobre o CLIQUE do
// mouse. Este teste usa `locator.click()`, que o Playwright resolve em
// coordenadas reais e despacha como evento de mouse de verdade.
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   UI_TEST_BASE_URL=http://localhost:3412 \
//     npx playwright test tests/ui/catalogo-fases-clique-salvar.smoke.ts --config=playwright.smoke.config.ts
import { test, expect } from '@playwright/test'

const MARCA = 'UICLICKFASE'

test.describe('Catálogo de Fases — clique em Salvar', () => {
  test('criar fase por CLIQUE do mouse: salva, fecha o formulário e atualiza a tabela', async ({ page }) => {
    const nomeFase = `${MARCA}_criar_${Date.now()}`
    const respostasPost: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes('/api/gerenciamento/catalogo-fases')) respostasPost.push(r.status())
    })

    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: '+ Nova fase' })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: '+ Nova fase' }).click()
    await expect(page.getByRole('heading', { name: 'Nova fase' })).toBeVisible()

    await page.getByPlaceholder('Ex.: Emissão de Certidões').fill(nomeFase)
    await page.locator('select').first().selectOption('PROCESSO')

    // O CLIQUE — não Enter, não dispatchEvent, não form.requestSubmit().
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    // Fecha o formulário (não fica preso aberto sem explicação).
    await expect(page.getByRole('heading', { name: 'Nova fase' })).not.toBeVisible({ timeout: 10_000 })
    // Confirmação visual (toast).
    await expect(page.getByText('Fase salva.')).toBeVisible({ timeout: 5_000 })
    // Gravou de verdade: POST respondeu 201, e a linha aparece na tabela.
    expect(respostasPost, 'esperava um POST /api/gerenciamento/catalogo-fases').toContain(201)
    await expect(page.getByText(nomeFase, { exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test('editar fase por CLIQUE do mouse: salva, fecha o formulário e atualiza a tabela', async ({ page }) => {
    // Reusa a fase criada no teste anterior (mesmo worker, mesma ordem — Playwright
    // roda os testes deste arquivo em série por padrão neste projeto).
    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    const linha = page.locator('tr', { hasText: MARCA }).first()
    await expect(linha).toBeVisible({ timeout: 20_000 })
    await linha.getByLabel('Editar').click()
    await expect(page.getByRole('heading', { name: 'Editar fase' })).toBeVisible()

    const novaDescricao = `editado por clique ${Date.now()}`
    await page.locator('textarea').fill(novaDescricao)

    const respostasPut: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && r.url().includes('/api/gerenciamento/catalogo-fases/')) respostasPut.push(r.status())
    })

    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Editar fase' })).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Fase salva.')).toBeVisible({ timeout: 5_000 })
    expect(respostasPut, 'esperava um PUT /api/gerenciamento/catalogo-fases/[id]').toContain(200)
  })

  test('chave duplicada por CLIQUE: recusa e MOSTRA a mensagem de erro', async ({ page }) => {
    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    const linhaExistente = page.locator('tr', { hasText: MARCA }).first()
    await expect(linhaExistente).toBeVisible({ timeout: 20_000 })
    const chaveExistente = await linhaExistente.locator('code').innerText()

    await page.getByRole('button', { name: '+ Nova fase' }).click()
    const nomeDigitado = `${MARCA}_dup_${Date.now()}`
    await page.getByPlaceholder('Ex.: Emissão de Certidões').fill(nomeDigitado)
    await page.getByPlaceholder('emissao_certidoes').fill(chaveExistente)
    await page.locator('select').first().selectOption('PROCESSO')

    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    // NÃO pode fechar sozinho, e a mensagem de erro precisa aparecer (era o bug
    // 1.6: "as validações bloqueiam, mas não mostram o erro").
    await expect(page.getByRole('heading', { name: 'Nova fase' })).toBeVisible()
    await expect(page.getByText(new RegExp(`já existe uma fase`, 'i'))).toBeVisible({ timeout: 5_000 })

    // Matriz de blindagem, item 7: erro real do servidor reabilita o botão
    // (não fica travado em "salvando…") e os campos preenchidos não somem —
    // o admin não precisa redigitar tudo de novo.
    const botaoSalvar = page.getByRole('button', { name: 'Salvar', exact: true })
    await expect(botaoSalvar).toBeEnabled({ timeout: 5_000 })
    await expect(page.getByPlaceholder('Ex.: Emissão de Certidões')).toHaveValue(nomeDigitado)
    await expect(page.getByPlaceholder('emissao_certidoes')).toHaveValue(chaveExistente)
  })

  test('matriz de blindagem item 8: duplo clique real em Salvar NÃO dispara duas requisições nem cria duas fases', async ({ page }) => {
    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '+ Nova fase' }).click()
    const nomeUnico = `${MARCA}_duplo_clique_${Date.now()}`
    await page.getByPlaceholder('Ex.: Emissão de Certidões').fill(nomeUnico)
    await page.locator('select').first().selectOption('PROCESSO')

    const respostasPost: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes('/api/gerenciamento/catalogo-fases')) respostasPost.push(r.status())
    })

    const botaoSalvar = page.getByRole('button', { name: 'Salvar', exact: true })
    await botaoSalvar.scrollIntoViewIfNeeded()
    const caixa = await botaoSalvar.boundingBox()
    if (!caixa) throw new Error('botão Salvar sem bounding box')
    // DOIS cliques de mouse no MESMO ponto, sem esperar a re-checagem de
    // "actionability" do Playwright entre eles — é o que um duplo clique real
    // de usuário é: dois eventos de clique do sistema operacional, não duas
    // chamadas de locator concorrentes. O segundo clique deve encontrar o
    // botão já `disabled` (React processou o primeiro de forma síncrona),
    // então só UMA requisição sai.
    const x = caixa.x + caixa.width / 2, y = caixa.y + caixa.height / 2
    await page.mouse.click(x, y)
    await page.mouse.click(x, y)

    await expect(page.getByRole('heading', { name: 'Nova fase' })).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Fase salva.')).toBeVisible({ timeout: 5_000 })
    expect(respostasPost.length, `esperava exatamente 1 POST, recebeu ${respostasPost.length}: ${JSON.stringify(respostasPost)}`).toBe(1)

    const linhasComEsseNome = await page.locator('tr', { hasText: nomeUnico }).count()
    expect(linhasComEsseNome, 'duplo clique não pode criar duas linhas na tabela').toBe(1)
  })
})
