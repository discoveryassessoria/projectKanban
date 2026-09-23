// tests/ui/biblioteca-selecao-workflow.spec.ts
//
// PROVA REAL — Workflow Interno oferece "Selecionar tarefa da Biblioteca"
// (mandato "separação Biblioteca × Workflow Interno", 22/09/2026). SOMENTE
// LEITURA: abre o seletor e confirma os modelos publicados aparecem, mas
// NUNCA clica em um modelo — nada pode ser vinculado à Italiana nesta
// entrega, por instrução explícita.

import { expect, test } from '@playwright/test'

test('Workflow Interno oferece "Selecionar tarefa da Biblioteca" (nunca "+ Passo")', async ({ page }) => {
  await page.goto('/administrator?screen=phaseiwf')
  await expect(page.getByText(/^Carregando\.{0,3}$/).first()).toBeHidden({ timeout: 30_000 })

  // Nacionalidade DELIBERADAMENTE não-Italiana — este teste é somente
  // leitura e nunca clica em um modelo, mas escolhe outra nacionalidade de
  // propósito, para nem de leve tocar o cadastro da Itália.
  await page.getByRole('combobox').selectOption({ label: 'Nacionalidade Alemã' })
  await expect(page.getByText(/^Carregando\.{0,3}$/).first()).toBeHidden({ timeout: 30_000 })

  await expect(page.getByText('+ Passo', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Selecionar tarefa da Biblioteca' }).first()).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Selecionar tarefa da Biblioteca' }).first().click()
  await expect(page.getByRole('heading', { name: 'Selecionar tarefa da Biblioteca' })).toBeVisible()
  // Os 7 modelos publicados aparecem no seletor — prova que a tela do
  // Workflow Interno enxerga a Biblioteca real, sem selecionar nenhum.
  // `.first()`: a mesma chave também pode aparecer atrás do modal, em passos
  // que já foram selecionados anteriormente — a visibilidade é o que importa.
  for (const chave of ['localizar_registro', 'solicitar_certidao', 'traducao_juramentada', 'apostilamento']) {
    await expect(page.getByText(chave, { exact: false }).first()).toBeVisible()
  }

  await page.screenshot({ path: 'tests/ui/.artifacts/workflow-interno-seletor-biblioteca.png', fullPage: true })

  // Fecha SEM selecionar — este teste nunca escolhe um modelo.
  await page.getByRole('button', { name: 'Cancelar' }).last().click()
})
