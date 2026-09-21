// tests/ui/permissoes-modulo-fases.smoke.ts
//
// SEÇÃO 4 do mandato "Módulo de Fases" (20/09/2026) — prova VISUAL (navegador
// real) de que um perfil operacional (ex.: "Daniela") não vê nem acessa o
// Gerenciamento. Contra o BANCO DE TESTE LOCAL — mesmo que não escreva nada
// de fato, entra na convenção `.smoke.ts` por criar/remover o usuário fixture.
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   UI_TEST_BASE_URL=http://localhost:3412 \
//     npx playwright test tests/ui/permissoes-modulo-fases.smoke.ts --config=playwright.smoke.config.ts
import { test, expect, type Page } from '@playwright/test'
import { prisma } from '../../lib/prisma'
import { signAuthToken } from '../../lib/auth-jwt'

const MARCA = 'PERMFASESUI'

async function entrarComo(page: Page, token: string, user: Record<string, unknown>) {
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('authToken', t as string)
    localStorage.setItem('user', u as string)
  }, [token, JSON.stringify(user)] as const)
}

test.describe('Módulo de Fases — permissões (navegador real)', () => {
  test('perfil operacional (Daniela) é redirecionado ao tentar abrir /administrator?screen=fases', async ({ page }) => {
    await prisma.usuario.deleteMany({ where: { email: `operacional@${MARCA.toLowerCase()}.test` } })
    const operacional = await prisma.usuario.create({
      data: { nome: `${MARCA} Daniela`, email: `operacional@${MARCA.toLowerCase()}.test`, senha: 'x', tipo: 'operacional' },
    })
    const token = await signAuthToken({ userId: operacional.id, email: operacional.email, tipo: operacional.tipo, sessaoInicio: Date.now() })

    await entrarComo(page, token, { id: operacional.id, nome: operacional.nome, email: operacional.email, tipo: operacional.tipo })
    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })

    // O guard (administrator/page.tsx) redireciona pra /dashboard.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await expect(page.locator('body')).not.toContainText('Fases')

    await prisma.usuario.delete({ where: { id: operacional.id } })
  })

  test('administrador abre /administrator?screen=fases normalmente', async ({ page }) => {
    const admin = await prisma.usuario.findFirst({ where: { tipo: 'admin' }, orderBy: { id: 'asc' } })
    if (!admin) test.skip(true, 'nenhum admin no banco de teste local')
    const token = await signAuthToken({ userId: admin!.id, email: admin!.email, tipo: 'admin', sessaoInicio: Date.now() })
    await entrarComo(page, token, { id: admin!.id, nome: admin!.nome, email: admin!.email, tipo: 'admin' })

    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/administrator/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: '+ Nova fase' })).toBeVisible({ timeout: 15_000 })
  })
})

test.afterAll(async () => {
  await prisma.$disconnect()
})
