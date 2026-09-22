// tests/ui/menu-lateral-fases.smoke.ts
//
// MANDATO "MÓDULO DE FASES" (22/09/2026) — falha relatada em produção: clicar
// em "Fases" (Gerenciamento → Processos → Estrutura) pelo menu lateral não
// abria a tela; só a URL direta (?screen=fases) funcionava. Investigado a
// fundo: não reproduziu com clique real de mouse contra a árvore de
// navegação atual (`managementNavigation.tsx`, item "fases" introduzido em
// ebbfaec2, sem alteração desde então) — nem partindo de "overview" nem
// depois de visitar outra tela de Processos primeiro. A explicação mais
// provável é bundle de cliente desatualizado no navegador de quem testou (a
// mesma classe de falso-negativo já confirmada para o Defeito 2 nesta
// mandato). Este teste fica como regressão permanente do clique real —
// se algum dia voltar a quebrar, aqui é onde vai pegar.
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   UI_TEST_BASE_URL=http://localhost:3412 \
//     npx playwright test tests/ui/menu-lateral-fases.smoke.ts --config=playwright.smoke.config.ts
import { test, expect } from '@playwright/test'

test.describe('Menu lateral — Processos › Estrutura › Fases', () => {
  test('clique real no menu abre a tela (partindo de Visão Geral)', async ({ page }) => {
    await page.goto('/administrator?screen=overview', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Processos$/ }).click()
    const fasesBtn = page.getByRole('button', { name: /^Fases$/ })
    await expect(fasesBtn).toBeVisible({ timeout: 5_000 })
    await fasesBtn.click()

    await expect(page).toHaveURL(/screen=fases/, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: '+ Nova fase' })).toBeVisible({ timeout: 10_000 })
  })

  test('clique real no menu abre a tela partindo de OUTRA tela de Processos (sem estado preso)', async ({ page }) => {
    await page.goto('/administrator?screen=proctypes', { waitUntil: 'networkidle' })
    // O módulo "Processos" já está expandido (a tela ativa pertence a ele) —
    // o submenu já está visível, sem precisar reabrir o accordion.
    const fasesBtn = page.getByRole('button', { name: /^Fases$/ })
    await expect(fasesBtn).toBeVisible({ timeout: 5_000 })
    await fasesBtn.click()

    await expect(page).toHaveURL(/screen=fases/, { timeout: 10_000 })
    await expect(page.getByRole('button', { name: '+ Nova fase' })).toBeVisible({ timeout: 10_000 })
  })

  test('URL direta ?screen=fases também abre (paridade com o deep-link)', async ({ page }) => {
    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: '+ Nova fase' })).toBeVisible({ timeout: 10_000 })
  })
})
