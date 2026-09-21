// tests/ui/excluir-fase-em-uso.smoke.ts
//
// Achado real, mandato "Módulo de Fases" (21/09/2026): clicar em "Excluir"
// numa fase EM USO (usos>0) era um botão `disabled` — o navegador não
// dispara clique nenhum num elemento desabilitado, então NADA acontecia:
// sem diálogo, sem mensagem, parecendo "travado" pra quem clicava sem antes
// conferir a coluna "Usada em". Botão nunca mais desabilitado — o clique
// sempre dispara, e a recusa vem como mensagem visível.
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   UI_TEST_BASE_URL=http://localhost:3412 \
//     npx playwright test tests/ui/excluir-fase-em-uso.smoke.ts --config=playwright.smoke.config.ts
import { test, expect } from '@playwright/test'

test('clicar em Excluir numa fase EM USO dispara e mostra a mensagem — nunca fica inerte', async ({ page }) => {
  await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })

  const linhas = page.locator('tbody tr')
  const n = await linhas.count()
  let alvo = null
  for (let i = 0; i < n; i++) {
    const txt = await linhas.nth(i).innerText()
    if (/fluxo\(s\)/.test(txt)) { alvo = linhas.nth(i); break }
  }
  test.skip(!alvo, 'nenhuma fase em uso no banco de teste local no momento')
  if (!alvo) return

  await alvo.getByLabel('Excluir').click({ timeout: 5000 })
  await expect(page.getByText(/é usada em \d+ fluxo/i)).toBeVisible({ timeout: 5_000 })
})
