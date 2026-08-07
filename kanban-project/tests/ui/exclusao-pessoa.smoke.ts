// tests/ui/exclusao-pessoa.smoke.ts
//
// SMOKE AUTENTICADO DA EXCLUSÃO DE PESSOA — pela interface real.
//
// ⚠ ESTE ARQUIVO ESCREVE. A suíte de `tests/ui/*.spec.ts` é somente-leitura por
// regra; por isso este arquivo NÃO termina em `.spec.ts` e só roda quando
// apontado explicitamente. Ele toca EXCLUSIVAMENTE dados marcados com
// `SMOKE-UI-CICLO-VIDA`, criados e removidos por `scripts/smoke-ui-setup.ts`.
//
// Rodar:
//   npx tsx --env-file=.env scripts/smoke-ui-setup.ts          # monta o cenário
//   UI_TEST_BASE_URL=http://localhost:3477 \
//     npx playwright test tests/ui/exclusao-pessoa.smoke.ts --config=playwright.config.ts
//   npx tsx --env-file=.env scripts/smoke-ui-setup.ts --limpar # remove o cenário
//
// O que ele prova que nenhum teste de serviço prova: que o BOTÃO chega ao
// serviço, que o modal mostra o plano que o domínio calculou, que a tela
// reflete o resultado, e que o resultado PERSISTE depois de recarregar.

import { test, expect, type Page } from '@playwright/test'

const PROCESSO = 513
const MARCA = 'SMOKE-UI-CICLO-VIDA'

/**
 * O `/kanban` exige `localStorage.user` além do token: sem ele `autenticado` é
 * false e a tela pinga /kanban → /login → /dashboard em loop.
 */
async function entrar(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('user')) {
      localStorage.setItem('user', JSON.stringify({
        id: 1, nome: 'Smoke', email: 'smoke@discovery', tipo: 'admin',
      }))
    }
  })
}

/** Troca de aba dentro do modal do processo, sem fechá-lo. */
async function abrirAba(page: Page, rotulo: RegExp) {
  const aba = page.getByRole('button', { name: rotulo }).first()
  await aba.waitFor({ state: 'visible', timeout: 30_000 })
  await aba.click()
}

/** Abre o modal do processo e vai para a aba Árvore. */
async function abrirArvore(page: Page) {
  await page.goto('/kanban', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/kanban/, { timeout: 30_000 })

  // O board abre filtrado por nacionalidade (Alemanha, por padrão). O processo
  // 513 é da Espanha: sem trocar a aba, o card não está na tela.
  await page.getByRole('button', { name: 'Espanha' }).first().click()

  // Deep-link nem sempre abre o modal; clicar no card do processo funciona.
  const card = page.getByText('Abellan', { exact: false }).first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card.click()

  await abrirAba(page, /árvore genealógica/i)
}

test.describe('Exclusão de pessoa pela interface', () => {
  test.beforeEach(async ({ page }) => { await entrar(page) })

  test('o plano aparece, a exclusão acontece e o resultado persiste', async ({ page }) => {
    const errosDeConsole: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errosDeConsole.push(m.text()) })
    // "Failed to load resource" não diz QUAL recurso. Sem a URL não dá para
    // separar defeito de rota de imagem decorativa ausente.
    const respostasRuins: string[] = []
    page.on('response', (r) => { if (r.status() >= 400) respostasRuins.push(`${r.status()} ${r.url()}`) })

    // ── 1) A pessoa de teste está na árvore ────────────────────────────────
    await abrirArvore(page)
    const no = page.getByText(MARCA, { exact: false }).first()
    await expect(no, 'a pessoa de teste aparece na árvore').toBeVisible({ timeout: 30_000 })

    // ── 2) Abrir a sidebar e disparar a remoção ────────────────────────────
    await no.click()
    const botaoExcluir = page.getByTitle('Remover da árvore')
    await expect(botaoExcluir, 'o botão de remover está disponível').toBeVisible({ timeout: 20_000 })
    await botaoExcluir.click()

    // ── 3) O MODAL mostra o plano vindo do domínio ─────────────────────────
    const modal = page.getByRole('heading', { name: 'Remover da árvore' })
    await expect(modal, 'o modal de plano abre').toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Serão removidos')).toBeVisible({ timeout: 20_000 })

    // O plano tem de citar o que existe de verdade: documento, tarefa,
    // participante financeiro, receita — não uma mensagem genérica.
    const corpo = await page.locator('body').innerText()
    expect(corpo, 'o plano cita o documento').toMatch(/documento operacional/i)
    expect(corpo, 'o plano cita a tarefa').toMatch(/tarefa/i)
    expect(corpo, 'o plano cita o participante financeiro').toMatch(/participante financeiro/i)
    expect(corpo, 'o plano cita a receita prevista').toMatch(/receita prevista/i)
    expect(corpo, 'o cadastro de cliente é preservado').toMatch(/não\s*\n?\s*é apagado|não é apagado/i)

    // Sem fato protegido ⇒ a ação oferecida é a exclusão definitiva.
    const confirmar = page.getByRole('button', { name: 'Excluir definitivamente' })
    await expect(confirmar, 'sem fato protegido, o hard delete é oferecido').toBeVisible()

    // ── 4) Concluir ────────────────────────────────────────────────────────
    await confirmar.click()
    await expect(modal, 'o modal fecha ao concluir').toBeHidden({ timeout: 60_000 })
    await expect(page.getByText(MARCA, { exact: false }).first(),
      'a pessoa some da árvore sem recarregar').toBeHidden({ timeout: 30_000 })

    // ── 5) Persistência: recarregar e conferir de novo ─────────────────────
    await abrirArvore(page)
    await expect(page.getByText(MARCA, { exact: false }).first(),
      'a pessoa continua fora depois de recarregar').toBeHidden({ timeout: 30_000 })

    // ── 6) As outras telas do processo também ficaram corretas ─────────────
    // Central, Documentos e Financeiro derivam das MESMAS linhas que saíram —
    // nenhuma tem estado próprio a atualizar. Se a pessoa aparecer em alguma
    // delas, é porque sobrou linha em algum lugar.
    await abrirAba(page, /central operacional/i)
    await expect(page.getByText(MARCA, { exact: false }).first(),
      'a Central não lista a pessoa removida').toBeHidden({ timeout: 30_000 })

    await abrirAba(page, /^documentos$/i)
    await expect(page.getByText(MARCA, { exact: false }).first(),
      'os Documentos não listam documento da pessoa removida').toBeHidden({ timeout: 30_000 })

    await abrirAba(page, /geral/i)
    await expect(page.getByText(MARCA, { exact: false }).first(),
      'o Geral não lista a pessoa como requerente ativo').toBeHidden({ timeout: 30_000 })

    // ── 7) REINSERÇÃO ──────────────────────────────────────────────────────
    // A exclusão definitiva remove TAMBÉM o vínculo pessoa↔processo. Readicionar
    // tem, portanto, duas etapas — e é assim que o domínio foi especificado:
    //   (a) devolver o requerente ao processo  (aba Geral / edição do processo)
    //   (b) vinculá-lo à árvore                (aba Árvore, tela abaixo)
    // A etapa (a) vai pela API REAL da aplicação, autenticada com a mesma
    // sessão do navegador — é a mesma chamada que a aba Geral dispara.
    // A aplicação chama a própria API com `Authorization: Bearer` lido do
    // localStorage (`authFetch`). Reproduzir isso DENTRO da página é usar o
    // mesmo caminho do produto, não um atalho de teste.
    const chamar = (url: string, init?: { method?: string; body?: unknown }) =>
      page.evaluate(
        async ([u, i]) => {
          const token = localStorage.getItem('authToken')
          const r = await fetch(u as string, {
            method: (i as { method?: string })?.method ?? 'GET',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: (i as { body?: unknown })?.body ? JSON.stringify((i as { body?: unknown }).body) : undefined,
          })
          return { status: r.status, corpo: await r.text() }
        },
        [url, init ?? {}] as const,
      )

    const disponiveis = await chamar(`/api/processos/${PROCESSO}/requerentes-disponiveis`)
    expect(disponiveis.status, `lista de requerentes do processo — ${disponiveis.corpo.slice(0, 200)}`).toBe(200)
    const atuais: { requerentes: { requerenteId: number }[] } = JSON.parse(disponiveis.corpo)

    const todos = await chamar('/api/requerentes')
    expect(todos.status, `cadastro de requerentes — ${todos.corpo.slice(0, 200)}`).toBe(200)
    const lista = JSON.parse(todos.corpo)
    const arr: { id: number; nome: string }[] = Array.isArray(lista) ? lista : (lista.requerentes ?? lista.dados ?? [])
    const doTeste = arr.find((r) => r.nome?.startsWith(MARCA))
    expect(doTeste, 'o cadastro do requerente de teste SOBREVIVEU à exclusão').toBeTruthy()

    const revinculo = await chamar(`/api/processos/${PROCESSO}`, {
      method: 'PUT',
      body: { requerenteIds: [...atuais.requerentes.map((r) => r.requerenteId), doTeste!.id] },
    })
    expect(revinculo.status, `requerente volta ao processo — ${revinculo.corpo.slice(0, 200)}`).toBe(200)

    // (b) Com a árvore vazia, a tela oferece o onboarding. O requerente é
    // REUSADO, não recriado — é o caminho que impede a segunda identidade.
    await abrirArvore(page)
    await page.getByText('Requerente (quem está pedindo cidadania)').first().click()
    await page.getByRole('button', { name: /continuar|avançar|próximo/i }).first().click()

    // A lista de requerentes do processo é longa; o de teste fica abaixo da dobra.
    const opcao = page.getByText(MARCA, { exact: false }).first()
    await opcao.waitFor({ state: 'attached', timeout: 30_000 })
    await opcao.scrollIntoViewIfNeeded()
    await expect(opcao, 'o requerente de teste aparece para ser vinculado').toBeVisible({ timeout: 30_000 })
    await opcao.click()

    // A tela declara o reuso — é o contrato do dedup, escrito na interface.
    await expect(page.getByText(/reaproveitado/i),
      'a tela declara que o requerente é reaproveitado').toBeVisible({ timeout: 10_000 })

    const vincular = page.getByRole('button', { name: /vincular requerente/i })
    await expect(vincular, 'o botão de vincular fica habilitado após escolher').toBeEnabled({ timeout: 10_000 })
    await vincular.scrollIntoViewIfNeeded()
    await vincular.click()

    // A PROVA do vínculo é o domínio, não o pixel: o texto da marca também
    // aparece na LISTA do seletor, e uma asserção visual daria falso-verde —
    // como deu, na primeira versão deste teste. `jaNaArvore` é inequívoco.
    await expect
      .poll(async () => {
        const r = await chamar(`/api/processos/${PROCESSO}/requerentes-disponiveis`)
        if (r.status !== 200) return `HTTP ${r.status}`
        const dados: { requerentes: { nome: string; personId: number | null; jaNaArvore: boolean }[] } = JSON.parse(r.corpo)
        const alvo = dados.requerentes.find((x) => x.nome?.startsWith(MARCA))
        return alvo ? `personId=${alvo.personId} jaNaArvore=${alvo.jaNaArvore}` : 'ausente'
      }, { timeout: 60_000, message: 'o requerente volta a ser nó da árvore' })
      .toMatch(/jaNaArvore=true/)

    // Sem duplicidade: UM requerente com a marca, e ele é nó da árvore uma vez.
    const conferencia = await chamar(`/api/processos/${PROCESSO}/requerentes-disponiveis`)
    const dados: { requerentes: { nome: string; jaNaArvore: boolean }[] } = JSON.parse(conferencia.corpo)
    const marcados = dados.requerentes.filter((x) => x.nome?.startsWith(MARCA))
    expect(marcados, 'existe UM único requerente de teste no processo').toHaveLength(1)
    expect(marcados[0].jaNaArvore, 'e ele está na árvore').toBe(true)

    await abrirArvore(page)
    await expect(page.getByText(MARCA, { exact: false }).first(),
      'a pessoa reinserida aparece na árvore').toBeVisible({ timeout: 30_000 })

    // O `_vercel/speed-insights` é injetado pela PLATAFORMA; rodando o build de
    // produção fora da Vercel ele não existe e dá 404. É artefato do harness,
    // não da aplicação — por isso sai da conta, nomeado, e nada mais sai.
    const ARTEFATO_DO_HARNESS = /_vercel\/speed-insights/
    const apisRuins = respostasRuins.filter((r) => /\/api\//.test(r))
    const outrasRuins = respostasRuins.filter((r) => !ARTEFATO_DO_HARNESS.test(r) && !/\/api\//.test(r))
    if (respostasRuins.length) console.log("\n[respostas >= 400]\n" + respostasRuins.map((e) => "  · " + e).join("\n"))

    expect(apisRuins, `nenhuma chamada de API falhou — ${apisRuins.join(' | ')}`).toHaveLength(0)
    expect(outrasRuins, `nenhum recurso da aplicação faltou — ${outrasRuins.join(' | ')}`).toHaveLength(0)

    const erros = errosDeConsole.filter(
      (e) => !/favicon|ResizeObserver|hydrat/i.test(e) &&
             !(/Failed to load resource/i.test(e) && respostasRuins.every((r) => ARTEFATO_DO_HARNESS.test(r))),
    )
    if (erros.length) console.log("\n[console do navegador]\n" + erros.map((e) => "  · " + e).join("\n"))
    expect(erros, `console limpo — ${erros.join(' | ')}`).toHaveLength(0)
  })
})
