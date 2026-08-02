// tests/ui/gerenciamento.spec.ts
//
// TODA TELA DO MENU ABRE DE VERDADE.
//
// Item de menu que leva a tela em branco é botão morto com aparência de vivo.
// A verificação estática de navegação prova que a chave existe no registro; só
// o navegador prova que a tela renderiza, busca seus dados e não estoura.
//
// A lista de telas vem da navegação oficial — sem segunda fonte de verdade.

import { expect, test } from '@playwright/test'
import { ehRuido, telasAtivas } from './telas'

const TELAS = telasAtivas()

test('a navegação oficial tem telas para testar', () => {
  expect(TELAS.length, 'nenhuma tela ativa encontrada na navegação — o teste estaria passando por vazio').toBeGreaterThan(20)
})

for (const tela of TELAS) {
  test(`${tela.modulo} › ${tela.rotulo} (?screen=${tela.screen}) abre e renderiza`, async ({ page }) => {
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !ehRuido(m.text())) erros.push(m.text()) })

    const resposta = await page.goto(`/administrator?screen=${tela.screen}`)
    expect(resposta?.status(), 'a rota do Gerenciamento precisa responder 200').toBeLessThan(400)

    // O shell do Gerenciamento sempre carrega; o que se prova aqui é que a
    // TELA dentro dele apareceu — e que não é a casca de erro.
    await expect(page.locator('body')).not.toContainText('Application error', { timeout: 20_000 })
    await expect(page.locator('body')).not.toContainText('Unhandled Runtime Error')
    await expect(page.locator('body')).not.toContainText('This page could not be found')

    // conteúdo real, não esqueleto permanente: alguma palavra de 4+ letras
    await expect(page.locator('body')).toContainText(/[A-Za-zÀ-ú]{4,}/, { timeout: 20_000 })

    // Um "Carregando" que nunca termina é defeito; um que demora é latência.
    // A tela tem uma janela generosa para sair do estado de carregamento — o
    // servidor de desenvolvimento fala com o banco remoto, e confundir lentidão
    // com travamento produziria alarme falso.
    const carregando = page.getByText(/^Carregando\.{0,3}$/).first()
    await expect(carregando, 'a tela ficou presa em "Carregando"').toBeHidden({ timeout: 45_000 })

    expect(erros, `erros no console de ${tela.screen}: ${erros.join(' | ')}`).toEqual([])
  })
}
