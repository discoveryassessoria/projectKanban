// tests/ui/enquadramento.spec.ts
//
// A PÁGINA NUNCA PODE FICAR MAIS LARGA QUE A JANELA.
//
// Relatado no iMac: sumiam o sino, o avatar, o "Sair" e as últimas bandeiras de
// país; rolando de lado, a barra lateral saía da tela. O shell era `flex` com
// filho `flex-1` — arranjo em que um descendente largo demais INFLA o
// container — e o recorte era `overflow-hidden`, que esconde sem barra de
// rolagem. Some sem aviso e sem jeito de alcançar.
//
// Roda também no WebKit porque é o motor do Safari, onde o defeito apareceu:
// `overflow-x: hidden` sozinho não impede a página de rolar de lado ali.

import { test, expect } from '@playwright/test'

const ROTAS = ['/kanban', '/relatorios', '/genealogy', '/registral', '/events', '/tarefas']
const LARGURAS = [1280, 1512, 1728, 1920, 2200, 2560]

test('nenhuma tela fica mais larga que a janela', async ({ page }) => {
  for (const rota of ROTAS) {
    for (const largura of LARGURAS) {
      await page.setViewportSize({ width: largura, height: 1000 })
      await page.goto(rota)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(900)

      const medida = await page.evaluate(() => {
        const janela = document.documentElement.clientWidth
        const cabecalho = document.querySelector('header')
        const lateral = document.querySelector('aside')
        return {
          janela,
          documento: document.documentElement.scrollWidth,
          corpo: document.body.scrollWidth,
          cabecalhoDireita: cabecalho ? Math.round(cabecalho.getBoundingClientRect().right) : null,
          lateralPosicao: lateral ? getComputedStyle(lateral).position : null,
        }
      })

      const onde = `${rota} @ ${largura}px`
      expect(medida.documento, `${onde}: o documento ficou mais largo que a janela`)
        .toBeLessThanOrEqual(medida.janela + 1)
      expect(medida.corpo, `${onde}: o corpo ficou mais largo que a janela`)
        .toBeLessThanOrEqual(medida.janela + 1)
      if (medida.cabecalhoDireita !== null) {
        expect(medida.cabecalhoDireita, `${onde}: o cabeçalho passa da janela — as ações somem`)
          .toBeLessThanOrEqual(medida.janela + 1)
      }
      // A lateral precisa continuar presa à janela: se ela deixar de ser
      // `fixed`, rola junto com a página e desaparece.
      if (medida.lateralPosicao !== null) {
        expect(medida.lateralPosicao, `${onde}: a barra lateral deixou de ser fixa`).toBe('fixed')
      }
    }
  }
})
