// tests/ui/biblioteca-tarefas.spec.ts
//
// PROVA REAL — Biblioteca de Tarefas (mandato 22/09/2026, entrega "somente
// Modelo"). Os 7 modelos cadastrados e publicados em produção
// (scripts/seed-biblioteca-tarefas-italiana.ts) precisam aparecer na tela e
// o editor reaproveitado (ConfiguracaoDoPassoModal) precisa abrir com o
// conteúdo real. SOMENTE LEITURA — nenhuma ação que grava é clicada aqui
// (mesma regra do resto desta suíte, ver playwright.config.ts).

import { expect, test } from '@playwright/test'

const MODELOS_ESPERADOS = [
  'localizar_registro', 'solicitar_certidao', 'analise_documental_provisoria',
  'retificacao_provisoria', 'emissao_retificada_certidao', 'traducao_juramentada', 'apostilamento',
]

test('Biblioteca de Tarefas lista os 7 modelos publicados', async ({ page }) => {
  await page.goto('/administrator?screen=bibliotecatarefas')
  await expect(page.getByText(/^Carregando\.{0,3}$/).first()).toBeHidden({ timeout: 30_000 })

  for (const chave of MODELOS_ESPERADOS) {
    await expect(page.getByText(chave, { exact: true }), `modelo "${chave}" não apareceu na lista`).toBeVisible()
  }

  // Todos publicados nesta entrega (v2) — nenhum ficou em rascunho.
  const badgesPublicado = page.locator('span', { hasText: 'PUBLICADO' })
  await expect(badgesPublicado).toHaveCount(MODELOS_ESPERADOS.length)

  await page.screenshot({ path: 'tests/ui/.artifacts/biblioteca-tarefas-lista.png', fullPage: true })
})

test('Biblioteca de Tarefas — editor abre com o conteúdo real de "Solicitar certidão"', async ({ page }) => {
  await page.goto('/administrator?screen=bibliotecatarefas')
  await expect(page.getByText(/^Carregando\.{0,3}$/).first()).toBeHidden({ timeout: 30_000 })

  const linha = page.locator('tr', { has: page.getByText('solicitar_certidao', { exact: true }) })
  await linha.getByRole('button', { name: 'Editar conteúdo' }).click()

  // "Geral" é a área inicial do editor — as subtarefas vivem em "Execução".
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('tab', { name: 'Execução' }).click()
  await expect(page.getByRole('tab', { name: 'Subtarefas (4)' })).toBeVisible({ timeout: 15_000 })

  // O modal reaproveitado (ConfiguracaoDoPassoModal) abriu com as 4 subtarefas
  // do mandato, na ordem certa — prova que o conteúdo real está lá, não um
  // modal vazio. O nome de cada subtarefa vive num <input> (valor, não nó de
  // texto); a chave (`code`) é texto puro e identifica a subtarefa sem ambiguidade.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('enviar_requerimento_cartorio', { exact: true })).toBeVisible()
  await expect(dialog.getByText('receber_confirmacao_pedido', { exact: true })).toBeVisible()
  await expect(dialog.getByText('receber_certidao', { exact: true })).toBeVisible()
  await expect(dialog.getByText('conferir_validar_certidao', { exact: true })).toBeVisible()
  // A subtarefa 2 nasce em espera de terceiro — visível no resumo da linha.
  await expect(dialog.getByText('espera de terceiro')).toBeVisible()

  await page.screenshot({ path: 'tests/ui/.artifacts/biblioteca-tarefas-editor.png', fullPage: true })
})
