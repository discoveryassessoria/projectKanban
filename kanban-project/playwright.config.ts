// playwright.config.ts
//
// TESTES DE INTERFACE — o que a auditoria de saúde não alcança.
//
// As verificações do módulo Saúde do Sistema leem banco e código. Elas não
// sabem se a TELA abriu, se o menu leva a algum lugar e se o navegador
// registrou erro. Isso só um navegador de verdade responde.
//
// Regra desta suíte: SOMENTE LEITURA. Os testes navegam, leem e conferem; não
// clicam em ação que escreve. O servidor de desenvolvimento aponta para o banco
// configurado em `.env`, então um clique errado seria um clique em produção.

import { defineConfig, devices } from '@playwright/test'

const PORTA = Number(process.env.UI_TEST_PORT ?? 3411)
export const BASE_URL = process.env.UI_TEST_BASE_URL ?? `http://localhost:${PORTA}`

export default defineConfig({
  testDir: './tests/ui',
  // Um worker só: o servidor de desenvolvimento e o pool de conexões do Prisma
  // são pequenos de propósito; paralelismo aqui vira timeout que não é defeito.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './tests/ui/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    storageState: './tests/ui/.auth/state.json',
    viewport: { width: 1536, height: 960 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // O enquadramento roda TAMBÉM no motor do Safari: foi lá que ele quebrou, e
    // `overflow-x: hidden` se comporta diferente nesse motor. Só esta suíte —
    // duplicar a bateria inteira custaria caro sem provar mais nada.
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /enquadramento\.spec\.ts/ },
  ],
  webServer: process.env.UI_TEST_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORTA}`,
        url: `${BASE_URL}/login`,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
