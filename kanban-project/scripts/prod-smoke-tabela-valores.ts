// scripts/prod-smoke-tabela-valores.ts
// ============================================================================
// SMOKE DE PRODUÇÃO — Tabela de Preços: o item escolhido fica vinculado.
//
// Por que existe: o defeito que este smoke cobre não aparecia em teste nenhum
// que lesse código ou banco. Ele só aparecia na TELA, e só para um item que
// ainda não tinha Configuração Financeira — em produção, todo Documento Mestre.
// Quem valida isso é um navegador de verdade, no ambiente de verdade.
//
// AUTENTICAÇÃO — pela porta de todo mundo. `scripts/ui-token.ts` assina um token
// com o JWT_SECRET do ambiente; em produção esse segredo é Sensitive na Vercel e
// não é legível nem por quem faz o deploy (e está certo que não seja). Então
// aqui o token vem do LOGIN oficial (`POST /api/auth/login`) com a identidade
// técnica criada por `scripts/usuario-smoke-tecnico.ts`, cuja senha vive no
// secret manager. Nenhuma credencial pessoal, nenhum segredo lido, nenhum bypass.
//
// PRIVILÉGIO — a identidade técnica fica com UMA permissão (`usuarios.gerenciar`).
// Como o middleware exige `tipo: 'admin'` para abrir /administrator, o smoke
// ELEVA a identidade pelo tempo da execução e devolve ao mínimo no `finally`,
// inclusive quando falha no meio. As duas transições são auditadas.
//
// ESCRITA — cria UM valor de teste (custo + venda, o mesmo pedido atômico que a
// tela faz) e o ARQUIVA no fim (R19: arquiva, nunca deleta). A lista ativa volta
// exatamente ao estado inicial; o histórico arquivado permanece, como deve.
//
// Uso: SMOKE_USER_EMAIL=… SMOKE_USER_PASSWORD=… npx tsx scripts/prod-smoke-tabela-valores.ts
// ============================================================================
import { chromium } from 'playwright'
import { prisma } from '@/lib/prisma'
import { exigirConfirmacaoDeEscritaEmProducao } from './_banco-de-teste'

const BASE = process.env.SMOKE_BASE ?? 'https://app.discovery.com.br'
let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const passo = (n: number, t: string) => console.log(`\n── ${n}) ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`)

async function definirTipo(email: string, tipo: 'admin' | 'servico', motivo: string) {
  // Alterna o tipo do usuário TÉCNICO de smoke no ambiente real (e audita).
  exigirConfirmacaoDeEscritaEmProducao(`ajusta o tipo do usuário técnico ${email} para ${tipo}`, 'prod-smoke-tabela-valores')
  const u = await prisma.usuario.update({ where: { email }, data: { tipo }, select: { id: true } })
  await prisma.logAuditoria.create({
    data: { acao: 'EDITAR', entidade: 'Usuario', entidadeId: u.id, usuarioId: u.id, descricao: `Identidade técnica de smoke: tipo → ${tipo} (${motivo})` },
  })
  console.log(`[identidade] tipo = ${tipo} (${motivo})`)
}

async function main() {
  const email = process.env.SMOKE_USER_EMAIL, senha = process.env.SMOKE_USER_PASSWORD
  if (!email || !senha) throw new Error('SMOKE_USER_EMAIL/SMOKE_USER_PASSWORD ausentes (secret manager da Vercel)')
  await definirTipo(email, 'admin', 'elevação temporária para o smoke de interface')

  const rLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }),
  })
  const bLogin = await rLogin.json()
  const token: string = bLogin.token ?? ''
  console.log(`login oficial: HTTP ${rLogin.status} · ${bLogin?.usuario?.nome ?? '—'}`)
  if (!rLogin.ok || !token) throw new Error(`login falhou (HTTP ${rLogin.status})`)
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const get = async () => (await fetch(`${BASE}/api/gerenciamento/tabela-valores`, { headers: h, cache: 'no-store' as RequestCache })).json()

  const inicial = await get()
  const configs: any[] = inicial.configs ?? []
  const precosAntes: any[] = inicial.tabelaValores ?? []
  // O ALVO é o caso que quebrava: documento mestre sem Configuração Financeira.
  const doc = configs.find((c) => c.natureza === 'DOCUMENTO' && c.id == null)
  if (!doc) throw new Error('nenhum Documento Mestre sem Configuração Financeira — o cenário do defeito não existe mais neste ambiente')
  console.log(`alvo: ${doc.mestre} (item #${doc.itemCatalogoId}, configuração financeira: ${doc.id ?? 'INEXISTENTE'})`)
  console.log(`estado inicial: ${precosAntes.length} preços ativos`)

  const navegador = await chromium.launch()
  const ctx = await navegador.newContext({
    viewport: { width: 1536, height: 960 },
    storageState: {
      // A aplicação lê o token dos DOIS lugares: cookie (middleware) e localStorage (cliente).
      cookies: [{ name: 'authToken', value: token, domain: new URL(BASE).hostname, path: '/', expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: false, secure: BASE.startsWith('https'), sameSite: 'Lax' as const }],
      origins: [{ origin: BASE, localStorage: [{ name: 'authToken', value: token }] }],
    },
  })
  const p = await ctx.newPage()
  const erros: string[] = []
  p.on('pageerror', (e) => erros.push(String(e.message).slice(0, 160)))

  await p.goto(`${BASE}/administrator?screen=pricingtable`, { waitUntil: 'domcontentloaded' })
  await p.getByRole('button', { name: '+ Novo valor' }).waitFor({ state: 'visible', timeout: 60_000 })

  passo(1, 'abertura do modal "Novo valor"')
  await p.getByRole('button', { name: '+ Novo valor' }).click()
  await p.getByLabel('Tipo de item').waitFor({ state: 'visible', timeout: 20_000 })
  chk(await p.getByRole('heading', { name: 'Novo valor' }).isVisible(), 'modal aberto')
  chk(!(await p.getByLabel('Preço de Custo').isEnabled()) && !(await p.getByLabel('Preço de Venda').isEnabled()), 'naturezas começam desabilitadas (sem item)')

  passo(2, 'seleção do Tipo de item = Documentos')
  await p.getByLabel('Tipo de item').selectOption('DOCUMENTO')
  chk(await p.getByLabel('Tipo de item').inputValue() === 'DOCUMENTO', 'tipo "Documentos" selecionado')

  passo(3, 'seleção de documento SEM configuração financeira')
  await p.getByLabel('Item', { exact: true }).selectOption(String(doc.itemCatalogoId))
  chk(true, `documento escolhido: ${doc.mestre} (nunca precificado)`)

  passo(4, 'vínculo REAL do itemId')
  const valorNoCampo = await p.getByLabel('Item', { exact: true }).inputValue()
  chk(valorNoCampo === String(doc.itemCatalogoId), `o campo Item carrega o ID canônico: "${valorNoCampo}" === #${doc.itemCatalogoId}`)
  const confirmacao = await p.getByText(/^Item vinculado:/).innerText()
  chk(confirmacao.includes(doc.mestre), `a tela confirma o vínculo: "${confirmacao}"`)

  passo(5, 'habilitação de Preço de Custo e Preço de Venda')
  chk(await p.getByLabel('Preço de Custo').isEnabled(), 'Preço de Custo habilitado')
  chk(await p.getByLabel('Preço de Venda').isEnabled(), 'Preço de Venda habilitado')

  passo(6, 'criação do valor de teste pela própria tela')
  await p.getByLabel('Preço de Custo').check()
  await p.getByLabel('Preço de Venda').check()
  await p.locator('select').nth(5).selectOption('BRL')   // Moeda do custo
  await p.locator('select').nth(6).selectOption('BRL')   // Moeda da venda
  const valores = p.getByPlaceholder('0,00')
  await valores.nth(0).fill('1.11')
  await valores.nth(1).fill('2.22')
  await p.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10))
  await p.getByRole('button', { name: 'Salvar' }).click()
  await p.getByRole('heading', { name: 'Novo valor' }).waitFor({ state: 'hidden', timeout: 30_000 })
  chk(true, 'modal fechou após Salvar (sem erro de validação)')

  passo(7, 'persistência após releitura')
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.getByRole('button', { name: '+ Novo valor' }).waitFor({ state: 'visible', timeout: 60_000 })
  const linhaDoDoc = p.getByRole('row').filter({ hasText: doc.mestre })
  await linhaDoDoc.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  chk(await linhaDoDoc.count() === 2, `após reload, a tela mostra as 2 linhas do documento (custo + venda)`)
  const depois = await get()
  const precosDepois: any[] = depois.tabelaValores ?? []
  const novos = precosDepois.filter((r) => !precosAntes.some((a) => a.id === r.id))
  chk(novos.length === 2, `2 registros persistidos: ${novos.map((r) => `#${r.id}/${r.natureza}`).join(' ')}`)
  chk(novos.every((r) => r.itemCatalogoId === doc.itemCatalogoId), 'cada preço gravou o itemCatalogoId escolhido')
  chk(novos.every((r) => r.configuracaoFinanceiraItemId != null), `Configuração Financeira resolvida no backend (#${novos[0]?.configuracaoFinanceiraItemId})`)
  chk(novos.every((r) => r.configuracaoFinanceiraItem?.itemCatalogo?.name === doc.mestre), `o preço aponta para o item certo: ${novos[0]?.configuracaoFinanceiraItem?.itemCatalogo?.name}`)
  const custo = novos.find((r) => r.natureza === 'CUSTO'), venda = novos.find((r) => r.natureza === 'VENDA')
  chk(Number(custo?.valor) === 1.11 && Number(venda?.valor) === 2.22, `valores conferem: custo ${custo?.valor} · venda ${venda?.valor}`)

  passo(8, 'integridade dos Serviços')
  const so = (lista: any[]) => lista.filter((r) => r.configuracaoFinanceiraItem?.itemCatalogo?.natureza === 'SERVICO').map((r) => [r.id, String(r.valor), r.natureza])
  chk(JSON.stringify(so(precosAntes)) === JSON.stringify(so(precosDepois)), `nenhum preço de serviço alterado (${so(precosAntes).length} preços)`)
  const serv = (depois.configs ?? []).find((c: any) => c.natureza === 'SERVICO' && c.id != null)
  await p.getByRole('button', { name: '+ Novo valor' }).click()
  await p.getByLabel('Tipo de item').selectOption('SERVICO')
  await p.getByLabel('Item', { exact: true }).selectOption(String(serv.itemCatalogoId))
  chk(await p.getByLabel('Item', { exact: true }).inputValue() === String(serv.itemCatalogoId), `serviço "${serv.mestre}" também vincula normalmente`)
  chk((await p.getByLabel('Preço de Custo').isEnabled()) || (await p.getByLabel('Preço de Venda').isEnabled()), 'naturezas do serviço habilitadas')
  await p.getByRole('button', { name: 'Cancelar' }).click()
  chk(erros.length === 0, `nenhum erro de JavaScript no navegador${erros.length ? `: ${erros[0]}` : ''}`)
  await ctx.close(); await navegador.close()

  passo(9, 'arquivamento do valor de teste (R19 — arquiva, não deleta)')
  for (const r of novos) {
    const d = await fetch(`${BASE}/api/gerenciamento/tabela-valores/${r.id}`, { method: 'DELETE', headers: h })
    chk(d.ok, `preço #${r.id} (${r.natureza}) arquivado — HTTP ${d.status}`)
  }

  passo(10, 'retorno da base ao estado inicial')
  const precosFinais: any[] = (await get()).tabelaValores ?? []
  chk(JSON.stringify(precosFinais.map((r) => r.id).sort()) === JSON.stringify(precosAntes.map((r) => r.id).sort()), `exatamente os mesmos preços de antes (${precosAntes.length})`)
  const arquivados = await prisma.tabelaValor.findMany({ where: { id: { in: novos.map((r) => r.id) } }, select: { id: true, arquivado: true } })
  chk(arquivados.every((r) => r.arquivado), `histórico preservado e arquivado: ${arquivados.map((r) => `#${r.id}`).join(' ')}`)
  const audit = await prisma.logAuditoria.findMany({
    where: { entidade: 'TabelaValor', entidadeId: { in: novos.map((r) => r.id) } },
    select: { acao: true, entidadeId: true }, orderBy: { id: 'asc' },
  })
  // O POST audita o LOTE (uma entrada); o DELETE audita cada linha.
  chk(audit.some((a) => a.acao === 'CRIAR') && novos.every((n) => audit.some((a) => a.acao === 'DESATIVAR' && a.entidadeId === n.id)),
    `trilha de auditoria: ${audit.map((a) => `${a.acao}#${a.entidadeId}`).join(' ')}`)

  console.log(`\n${'='.repeat(62)}\nSMOKE DE PRODUÇÃO: ${ok} verificações ok, ${fail} falhas\n${'='.repeat(62)}`)
}

let codigoSaida = 0
main()
  .catch((e) => { console.error('FALHA:', String(e?.message ?? e)); codigoSaida = 1 })
  .finally(async () => {
    // A reversão acontece SEMPRE — inclusive quando o smoke falha no meio.
    const email = process.env.SMOKE_USER_EMAIL
    if (email) {
      await definirTipo(email, 'servico', 'reversão ao privilégio mínimo').catch((e) => { console.error('REVERSÃO FALHOU:', String(e)); codigoSaida = 1 })
      const u = await prisma.usuario.findUnique({ where: { email }, select: { tipo: true, permissoesCustom: true } })
      console.log(`[identidade] estado final: tipo=${u?.tipo} permissões=${JSON.stringify(u?.permissoesCustom)}`)
    }
    await prisma.$disconnect()
    process.exit(fail > 0 ? 1 : codigoSaida)
  })
