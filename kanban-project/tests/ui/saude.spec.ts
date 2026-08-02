// tests/ui/saude.spec.ts
//
// O PAINEL DE SAÚDE VISTO PELO NAVEGADOR.
//
// A guarda estática prova que o motor está certo. Este teste prova que a TELA
// mostra o que o motor disse — e, principalmente, que ela não maquia: com
// achado crítico aberto, nenhum caminho da interface pode exibir "Saudável".
//
// Somente leitura: os botões que EXECUTAM diagnóstico não são clicados, porque
// o servidor de desenvolvimento aponta para o banco do `.env`.

import { expect, test } from '@playwright/test'
import { ehRuido } from './telas'

const ROTA = '/administrator?screen=syshealth'

const ABAS = [
  'Visão geral', 'Prontidão', 'O que falta', 'Plano de correção', 'Problemas',
  'Capacidades', 'Domínios', 'Cobertura', 'Execução', 'Histórico',
] as const

test.describe('Saúde do Sistema', () => {
  test('abre autenticada e mostra o estado com a versão do catálogo', async ({ page }) => {
    await page.goto(ROTA)
    await expect(page.getByText(/catálogo v\d+\.\d+\.\d+/)).toBeVisible()
    // O estado é um dos seis — nunca um texto inventado.
    await expect(page.getByRole('heading', {
      name: /Saudável|Atenção|Degradado|Crítico|Diagnóstico incompleto|Indisponível/,
    })).toBeVisible()
  })

  test('as dez abas existem e cada uma renderiza conteúdo', async ({ page }) => {
    await page.goto(ROTA)
    await expect(page.getByText(/catálogo v/)).toBeVisible()

    for (const aba of ABAS) {
      const botao = page.getByRole('button', { name: new RegExp(`^${aba}`) }).first()
      await expect(botao, `a aba "${aba}" precisa existir`).toBeVisible()
      await botao.click()
      // conteúdo, não casca: a área abaixo das abas não pode ficar vazia
      await expect(page.getByRole('main')).toContainText(/[A-Za-zÀ-ú]{4,}/)
    }
  })

  test('não declara "Saudável" quando existe achado crítico ou erro aberto', async ({ page }) => {
    await page.goto(ROTA)
    await expect(page.getByText(/catálogo v/)).toBeVisible()

    const criticos = Number((await page.locator('text=Críticos').locator('..').innerText()).match(/\d+/)?.[0] ?? '0')
    const erros = Number((await page.locator('text=Erros').first().locator('..').innerText()).match(/\d+/)?.[0] ?? '0')
    const titulo = await page.getByRole('heading', {
      name: /Saudável|Atenção|Degradado|Crítico|Diagnóstico incompleto|Indisponível/,
    }).innerText()

    if (criticos > 0 || erros > 0) {
      expect(titulo, 'com crítico ou erro aberto a tela NÃO pode dizer "Saudável"').not.toMatch(/^Saudável$/)
    }
  })

  test('prontidão operacional lista capacidades com estado e dependências', async ({ page }) => {
    await page.goto(ROTA)
    await page.getByRole('button', { name: /^Prontidão/ }).first().click()
    await expect(page.getByText(/pode ser executada hoje, de ponta a ponta/i)).toBeVisible()
    // toda capacidade exibe um dos estados de prontidão
    await expect(page.getByText(/Pronto|Parcialmente pronto|Não configurado|Configuração inválida|Bloqueado|Diagnóstico incompleto/).first()).toBeVisible()
  })

  test('o plano de correção vem ordenado e diz problema, causa, impacto e ação', async ({ page }) => {
    await page.goto(ROTA)
    await page.getByRole('button', { name: /^Plano de correção/ }).first().click()

    const vazio = await page.getByText('Nada pendente no plano de correção.').isVisible().catch(() => false)
    if (vazio) return

    await expect(page.getByText('1º').first()).toBeVisible()
    for (const rotulo of ['Problema:', 'Causa:', 'Impacto:', 'Ação:']) {
      await expect(page.getByText(rotulo).first(), `o plano precisa dizer "${rotulo}"`).toBeVisible()
    }
  })

  test('a aba Cobertura mostra a matriz por módulo e os domínios obrigatórios', async ({ page }) => {
    await page.goto(ROTA)
    await page.getByRole('button', { name: /^Cobertura/ }).first().click()
    await expect(page.getByText('Matriz por módulo')).toBeVisible()
    await expect(page.getByText('Domínio obrigatório')).toBeVisible()
  })

  test('a tela abre sem erro de JavaScript no navegador', async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !ehRuido(m.text())) erros.push(m.text()) })

    await page.goto(ROTA)
    await expect(page.getByText(/catálogo v/)).toBeVisible()
    for (const aba of ABAS) {
      await page.getByRole('button', { name: new RegExp(`^${aba}`) }).first().click()
    }
    expect(erros, `erros no console: ${erros.join(' | ')}`).toEqual([])
  })
})
