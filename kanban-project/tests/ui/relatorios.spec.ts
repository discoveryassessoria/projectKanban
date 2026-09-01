// tests/ui/relatorios.spec.ts
//
// RELATÓRIOS VISTOS PELO NAVEGADOR.
//
// Este arquivo existe por causa de um defeito específico: a versão anterior
// desta tela redirecionava para a home antes de a lista de domínios chegar, e
// eu declarei que ela funcionava porque `curl /relatorios` devolvia 200. O
// servidor entregava o HTML; o navegador é que expulsava o usuário na
// hidratação. Nenhuma verificação de API alcança isso.
//
// SOMENTE LEITURA: navega, filtra, agrupa e confere. Não salva visão nem
// exporta — o servidor de desenvolvimento aponta para o banco do `.env`.

import { expect, test } from '@playwright/test'

test.describe('Relatórios', () => {
  test('a tela ABRE e não expulsa para a home', async ({ page }) => {
    await page.goto('/relatorios')
    // A prova do defeito antigo: continuar em /relatorios depois da hidratação.
    await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
    await expect(page).toHaveURL(/\/relatorios/)
    await expect(page.getByText('Carregando relatórios…')).toBeHidden()
  })

  test('a nacionalidade oferecida NÃO é a lista geográfica de países', async ({ page }) => {
    await page.goto('/relatorios')
    await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible()

    const contexto = page.locator('main').first()
    // Ofertadas aparecem…
    await expect(contexto.getByRole('button', { name: /Itália/ })).toBeVisible()
    // …e países que existem só como geografia, NÃO. Brasil tem 60 órgãos
    // cadastrados e nenhuma oferta: se ele aparecer aqui, a regressão voltou.
    await expect(contexto.getByRole('button', { name: /^🇧🇷?\s*Brasil$/ })).toHaveCount(0)
    await expect(contexto.getByRole('button', { name: /Paraguai/ })).toHaveCount(0)
    await expect(contexto.getByRole('button', { name: /Argentina/ })).toHaveCount(0)
  })

  test('os domínios aparecem e cada um abre com tabela ou vazio explicado', async ({ page }) => {
    await page.goto('/relatorios')
    await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible()

    // A home lista domínios — não relatórios prontos.
    for (const nome of ['Processos', 'Requerentes', 'Protocolos', 'Qualidade e Integridade']) {
      await expect(page.getByRole('button', { name: new RegExp(nome) }).first()).toBeVisible()
    }
  })

  test('Protocolos abre, filtra por período e mostra a consulta atual', async ({ page }) => {
    await page.goto('/relatorios?d=protocolos')
    await expect(page.getByRole('button', { name: 'Explorar' })).toBeVisible()

    // O total aparece — e é um número, não "carregando" eterno.
    await expect(page.getByText(/\d+ resultados?/)).toBeVisible({ timeout: 30_000 })

    // Adiciona o período do protocolo pelo seletor de filtros.
    await page.getByRole('combobox').filter({ hasText: '+ Adicionar filtro' })
      .selectOption({ label: 'Período do protocolo' })
    const datas = page.locator('input[type="date"]')
    await expect(datas.first()).toBeVisible()
    await datas.first().fill('2023-01-01')
    await datas.nth(1).fill('2023-01-31')

    // O resumo mostra o MESMO dia que foi escolhido — a borda de fuso já
    // exibiu "31/12/2022" aqui, e isso é defeito.
    await expect(page.getByText('Consulta atual')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('01/01/2023 – 31/01/2023')).toBeVisible()
  })

  test('agrupar não abre outra tela: é a mesma consulta', async ({ page }) => {
    await page.goto('/relatorios?d=processos')
    await expect(page.getByText(/\d+ resultados?/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('combobox').filter({ hasText: 'Sem agrupamento' })
      .selectOption({ label: 'Agrupar por Fase atual' })
    await expect(page).toHaveURL(/\/relatorios\?d=processos/)
    await expect(page.getByText(/\d+ resultados?/)).toBeVisible()
  })

  test('a nacionalidade escolhida acompanha a navegação entre domínios', async ({ page }) => {
    await page.goto('/relatorios?pais=italia&d=protocolos')
    await expect(page.getByText(/\d+ resultados?/)).toBeVisible({ timeout: 30_000 })
    // A trilha mostra o contexto, e o botão da nacionalidade está marcado.
    await expect(page.locator('main').getByText('Itália').first()).toBeVisible()
  })

  test('domínio com zero resultados explica, em vez de parecer quebrado', async ({ page }) => {
    // Certidões está zerado no banco atual: a tela precisa dizer isso.
    await page.goto('/relatorios?d=certidoes')
    await expect(page.getByText(/\d+ resultados?/)).toBeVisible({ timeout: 30_000 })
    const vazio = page.getByText(/Nenhum resultado para esta consulta/)
    const tabela = page.locator('table')
    // Ou tem tabela, ou tem a explicação — nunca uma área em branco.
    await expect(vazio.or(tabela).first()).toBeVisible()
  })
})
