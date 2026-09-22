// tests/ui/mudar-escopo-fase-em-uso.smoke.ts
//
// MANDATO "MÓDULO DE FASES" (21/09/2026), DEFEITO 2 — "ALTERAÇÃO DE ESCOPO DE
// FASE EM USO". Achado real: a tela dizia "Opera sobre * (imutável enquanto a
// fase estiver em uso)" mas o seletor continuava editável, e clicar em Salvar
// com o escopo mudado não dava NENHUM sinal — nem sucesso nem erro — porque
// nada tratava a recusa 409 (ESCOPO_EM_USO) que o servidor já emitia. A fase
// PRECISA continuar evolutiva mesmo em uso (nunca bloqueada de vez); o que
// faltava era pedir confirmação explícita do impacto antes de publicar.
//
// Contra o BANCO DE TESTE LOCAL (nunca produção — este arquivo ESCREVE).
//
// Roda com:
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   UI_TEST_BASE_URL=http://localhost:3412 \
//     npx playwright test tests/ui/mudar-escopo-fase-em-uso.smoke.ts --config=playwright.smoke.config.ts
import { test, expect, type Page } from '@playwright/test'
import { prisma } from '../../lib/prisma'
import { signAuthToken } from '../../lib/auth-jwt'

const MARCA = 'ESCOPOEMUSOUI'
const CHAVE = `${MARCA.toLowerCase()}_fase`

async function entrarComo(page: Page, token: string, user: Record<string, unknown>) {
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('authToken', t as string)
    localStorage.setItem('user', u as string)
  }, [token, JSON.stringify(user)] as const)
}

async function limpar() {
  const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { code: MARCA } })
  if (tipo) {
    await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcessoId: tipo.id } } })
    await prisma.macroWorkflow.deleteMany({ where: { tipoProcessoId: tipo.id } })
    await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: CHAVE } })
}

test.describe('Catálogo de Fases — mudar escopo de fase EM USO', () => {
  test.beforeAll(async () => {
    await limpar()
    const pm = await prisma.modalidadePais.findFirst({ select: { id: true, paisId: true } })
    if (!pm) throw new Error('nenhuma modalidade de país no banco de teste')
    await prisma.catalogoFase.create({
      data: { phaseKey: CHAVE, label: `[${MARCA}] Fase`, escopo: 'PROCESSO', ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: 'PUBLICADA', revisaoAtual: 1, efeitosPermitidos: ['REGISTER_ONLY'] },
    })
    const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: MARCA, name: `[${MARCA}] tipo`, paisId: pm.paisId, ativo: true } })
    await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pm.id, ativo: true } })
    const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: pm.id, name: `[${MARCA}] macro`, ativo: true } })
    // COMPOSTA — é isso que torna a fase "em uso" (usos > 0).
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: CHAVE, label: 'Fase', ordem: 1, required: true, conditional: false, entryRule: 'process_created', showInKanban: true } })
  })

  test.afterAll(async () => {
    await limpar()
    await prisma.$disconnect()
  })

  test('mudar "Opera sobre" numa fase em uso: recusa sem confirmação, confirma e publica com sucesso VISÍVEL', async ({ page }) => {
    const admin = await prisma.usuario.findFirst({ where: { tipo: 'admin' }, orderBy: { id: 'asc' } })
    if (!admin) test.skip(true, 'nenhum admin no banco de teste local')
    const token = await signAuthToken({ userId: admin!.id, email: admin!.email, tipo: 'admin', sessaoInicio: Date.now() })
    await entrarComo(page, token, { id: admin!.id, nome: admin!.nome, email: admin!.email, tipo: 'admin' })

    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    const linha = page.locator('tr', { hasText: MARCA }).first()
    await expect(linha).toBeVisible({ timeout: 20_000 })
    await expect(linha).toContainText('1 fluxo(s)')

    await linha.getByLabel('Editar').click()
    await expect(page.getByRole('heading', { name: 'Editar fase' })).toBeVisible()

    // O rótulo do ESCOPO não pode mais afirmar imutabilidade — a fase segue
    // evolutiva ("Chave (imutável)" é outro campo, correto e intocado).
    await expect(page.getByText(/imutável enquanto a fase estiver em uso/i)).not.toBeVisible()

    // O seletor "Opera sobre" continua HABILITADO mesmo em uso — muda de
    // verdade, sem bloqueio permanente.
    const selectEscopo = page.locator('select').first()
    await expect(selectEscopo).toBeEnabled()
    await selectEscopo.selectOption('DOCUMENTO')

    let dialogMsg = ''
    page.once('dialog', async (d) => { dialogMsg = d.message(); await d.accept() })

    const respostasPut: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && r.url().includes('/api/gerenciamento/catalogo-fases/')) respostasPut.push(r.status())
    })

    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    // PRIMEIRO round-trip: 409 (ESCOPO_EM_USO) — a confirmação apareceu com o
    // impacto nomeado (não um erro mudo, não um "nada acontece").
    await expect.poll(() => respostasPut.includes(409), { timeout: 10_000 }).toBe(true)
    expect(dialogMsg).toMatch(/usada em 1 fluxo/i)

    // SEGUNDO round-trip (após confirmar): 200 — publica de verdade, com
    // sucesso VISÍVEL e o formulário fechando (nenhum clique em Salvar fica
    // sem resposta visível).
    await expect.poll(() => respostasPut.includes(200), { timeout: 10_000 }).toBe(true)
    await expect(page.getByRole('heading', { name: 'Editar fase' })).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Fase salva.')).toBeVisible({ timeout: 5_000 })

    const persistido = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true, revisaoAtual: true } })
    expect(persistido.escopo).toBe('DOCUMENTO')
    expect(persistido.revisaoAtual).toBeGreaterThan(1)
  })

  test('cancelar a confirmação: NÃO altera nada, formulário permanece aberto com os dados originais', async ({ page }) => {
    const admin = await prisma.usuario.findFirst({ where: { tipo: 'admin' }, orderBy: { id: 'asc' } })
    if (!admin) test.skip(true, 'nenhum admin no banco de teste local')
    const token = await signAuthToken({ userId: admin!.id, email: admin!.email, tipo: 'admin', sessaoInicio: Date.now() })
    await entrarComo(page, token, { id: admin!.id, nome: admin!.nome, email: admin!.email, tipo: 'admin' })

    const escopoAntes = (await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true } })).escopo

    await page.goto('/administrator?screen=fases', { waitUntil: 'networkidle' })
    const linha = page.locator('tr', { hasText: MARCA }).first()
    await expect(linha).toBeVisible({ timeout: 20_000 })
    await linha.getByLabel('Editar').click()
    await expect(page.getByRole('heading', { name: 'Editar fase' })).toBeVisible()

    const selectEscopo = page.locator('select').first()
    await selectEscopo.selectOption('PESSOA')

    page.once('dialog', async (d) => { await d.dismiss() })
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()

    // Recusou a confirmação — mensagem de cancelamento visível, formulário
    // continua ABERTO (nada foi perdido, nada fechou sozinho).
    await expect(page.getByText(/cancelada/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('heading', { name: 'Editar fase' })).toBeVisible()

    const escopoDepois = (await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: CHAVE }, select: { escopo: true } })).escopo
    expect(escopoDepois).toBe(escopoAntes)
  })
})
