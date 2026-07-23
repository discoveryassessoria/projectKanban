// scripts/preview-sandbox-setup.mjs
// ============================================================================
// SANDBOX DE HOMOLOGAÇÃO — Motor Financeiro V3 · Fase 2.
// Monta, DENTRO DO BUILD DO PREVIEW (onde a Vercel injeta o PRISMA_DATABASE_URL /
// DIRECT_DATABASE_URL do PRÓPRIO Preview), um ambiente isolado com dados 100%
// SINTÉTICOS sobre o banco Neon do Preview (que está VAZIO).
//
// Seguro por construção:
//   • roda SÓ em VERCEL_ENV=preview (produção e local: pula);
//   • GUARDA INVERSA — aborta FECHADO se o alvo classificar como PRODUCAO/STAGING
//     ou tiver QUALQUER requerente (defesa em profundidade: nunca escreve sobre
//     dados reais nem sobre produção);
//   • `db push` só roda quando o banco está comprovadamente VAZIO (schema base
//     ausente + 0 requerentes); em banco vazio é 100% aditivo (nada a perder);
//   • dataset sintético idempotente (Receita REC-SBX1): não repete;
//   • não derruba o build em erro (loga e segue) — o legado do Preview permanece.
// ============================================================================
import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const statements = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)

const log = (m) => console.log(`[sandbox] ${m}`)

if (process.env.VERCEL_ENV !== 'preview') { log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — sandbox só roda em preview. Pulando.`); process.exit(0) }

// Marca ESTE build como sandbox: flags V3 ligadas por padrão (independe de env
// var em runtime). Escrito ANTES de qualquer saída antecipada e antes do next build.
try {
  writeFileSync(join(import.meta.dirname, '..', 'lib/financeiro/sandbox.generated.ts'),
    '// GERADO no build do Preview — NÃO editar. Ver preview-sandbox-setup.mjs / sandbox.generated.ts.\nexport const SANDBOX_PREVIEW = true\n')
  log('✓ marcador de sandbox assado (SANDBOX_PREVIEW=true) — flags V3 padrão-ON.')
} catch (e) { log(`AVISO: não consegui assar o marcador de sandbox (${String(e?.message ?? e).slice(0, 100)}).`) }
const url = process.env.PRISMA_DATABASE_URL
if (!url) { log('PRISMA_DATABASE_URL ausente no Preview — nada a fazer.'); process.exit(0) }

const { PrismaClient } = await import('@prisma/client')
let prisma = new PrismaClient({ datasources: { db: { url } } })

const tabExiste = async (t) => Number((await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`))[0].n) > 0
const BASE = ['Processo', 'Pessoa', 'Receita', 'Cobranca', 'ParcelaFinanceira', 'ObrigacaoEconomica', 'LedgerFinanceiro']

// SMOKE de leitura: resolve REC-SBX1 e reconstrói o saldo por replay do Ledger
// (mesma lógica da Posição). Prova real, no banco do sandbox, no build do Preview.
async function smokeLeitura() {
  // Reproduz EXATAMENTE a sequência de queries de carregarPosicao() para achar a que falha.
  const passo = async (nome, fn) => { try { const r = await fn(); log(`SMOKE ok · ${nome}`); return r } catch (e) { log(`SMOKE FALHA · ${nome} → ${String(e?.message ?? e).slice(0, 220)}`); throw e } }
  try {
    const ref = await passo('resolver REC-SBX1', () => prisma.obrigacaoEconomica.findFirst({ where: { codigoOperacional: 'REC-SBX1' }, select: { id: true } }))
    if (!ref) { log('SMOKE: REC-SBX1 NÃO encontrada.'); return }
    const obr = await passo('findUnique+includes', () => prisma.obrigacaoEconomica.findUnique({ where: { id: ref.id }, include: { ledger: { include: { entries: { orderBy: { sequencia: 'asc' } } } }, ocorrencias: { orderBy: { data: 'asc' }, include: { aplicacoes: true } }, distribuicoes: { orderBy: { versao: 'desc' }, include: { participacoes: true } } } }))
    await passo('saldoProjecao', () => prisma.saldoProjecao.findUnique({ where: { obrigacaoId: ref.id } }))
    const pagIds = (obr?.ocorrencias ?? []).map((o) => o.pagadorId).filter((v) => v != null)
    await passo('pagador.findMany', () => pagIds.length ? prisma.pagador.findMany({ where: { id: { in: pagIds } } }) : Promise.resolve([]))
    await passo('parteExterna.findMany', () => prisma.parteExterna.findMany({ where: { id: { in: [] } } }))
    await passo('creditoFinanceiro.findMany', () => prisma.creditoFinanceiro.findMany({ where: { obrigacaoId: ref.id }, orderBy: { criadoEm: 'asc' } }))
    const entries = obr?.ledger?.entries ?? []
    let saldo = 0
    for (const e of entries) if (e.contaContabil === '1.1') saldo += (e.direcao === 'DEBITO' ? 1 : -1) * Number(e.valorContabil)
    log(`SMOKE ✓ REC-SBX1 → obrigação #${obr.id}, ${entries.length} lançamentos, saldo(replay)=${saldo}, status=${obr.status}.`)
  } catch { log('SMOKE: a query acima é a que falha no runtime da Posição.') }
}

// CONFIRMAÇÃO do estado final para o relatório de homologação.
async function confirmarEstado() {
  try {
    const obrs = await prisma.obrigacaoEconomica.findMany({ include: { distribuicoes: { include: { participacoes: true } }, _count: { select: { ocorrencias: true } } }, orderBy: { id: 'asc' } })
    const totalOcor = await prisma.ocorrenciaFinanceira.count()
    const extras = obrs.filter((o) => o.natureza !== 'RECEITA')
    const rec = obrs.find((o) => o.codigoOperacional === 'REC-SBX1')
    const proj = rec ? await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: rec.id } }) : null
    const pessoas = await prisma.pessoa.findMany({ where: { requerente: 'sim' }, select: { id: true, nome: true }, orderBy: { id: 'asc' } })
    const parts = rec?.distribuicoes?.[0]?.participacoes ?? []
    log('CONFIRMA ══════════════════════════════════════')
    log(`CONFIRMA saldo inicial REC-SBX1 = ${proj ? Number(proj.saldo) : '?'} (obrigação #${rec?.id})`)
    log(`CONFIRMA obrigações totais = ${obrs.length} | extras (natureza≠RECEITA) = ${extras.length}`)
    log(`CONFIRMA ocorrências totais = ${totalOcor} (esperado 1 = OBRIGACAO_CRIADA)`)
    log(`CONFIRMA requerentes vinculados = ${parts.length} → participações [${parts.map((p) => `pessoa#${p.pessoaId}=${Number(p.valor)}`).join(', ')}]`)
    log(`CONFIRMA pessoas requerentes (ids): [${pessoas.map((p) => `#${p.id} ${p.nome}`).join(' | ')}]`)
    log('CONFIRMA ══════════════════════════════════════')
  } catch (e) { log(`CONFIRMA ERRO: ${String(e?.message ?? e).slice(0, 160)}`) }
}

try {
  // ── 1) Diagnóstico + GUARDA INVERSA anti-produção ──
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe} (tabelas=${retrato.tabelas}, migrations=${retrato.migrations}, requerentes=${retrato.requerentes})`)
  if (classe === CLASSE.PRODUCAO || classe === CLASSE.STAGING) {
    console.error(`[sandbox] ABORTADO: alvo classificado ${classe}. O sandbox NUNCA escreve em produção/staging.`); process.exit(1)
  }

  // ── 2) Materializa o schema atual se o banco estiver VAZIO ──
  const faltam = []
  for (const t of BASE) if (!(await tabExiste(t))) faltam.push(t)
  if (faltam.length) {
    if (retrato.requerentes > 0) { console.error(`[sandbox] ABORTADO: schema base ausente mas há ${retrato.requerentes} requerentes — não sobrescrevo dados reais.`); process.exit(1) }
    log(`banco vazio (faltam ${faltam.length} tabelas base) → aplicando schema atual via db push (aditivo em banco vazio)…`)
    // Empurra para o MESMO banco do runtime: endpoint direto derivado da própria
    // PRISMA_DATABASE_URL (removendo `-pooler`), para escrita/leitura coincidirem.
    const pushUrl = url.replace('-pooler.', '.')
    log(`db push → ${identificador(pushUrl)} (mesmo banco do runtime, endpoint direto).`)
    // Trava extra: force-reset só sobre banco comprovadamente sem dado real
    // (0 requerentes já garantido acima) e pequeno (longe da assinatura de prod).
    if (retrato.tabelas >= 100) { console.error(`[sandbox] ABORTADO: ${retrato.tabelas} tabelas — grande demais p/ reset seguro.`); process.exit(1) }
    await prisma.$disconnect()
    execSync('npx prisma db push --accept-data-loss --force-reset --skip-generate', { stdio: 'inherit', env: { ...process.env, PRISMA_DATABASE_URL: pushUrl, DIRECT_DATABASE_URL: pushUrl } })
    prisma = new PrismaClient({ datasources: { db: { url } } })
    log('✓ schema aplicado (db push).')
  } else {
    log('schema base já presente — seguindo para os seeds.')
  }

  // ── 2b) Deltas ADITIVOS (Fase 2/3) idempotentes — cobre deploys incrementais
  // sobre sandbox já existente (db push só roda em banco vazio). Todos IF NOT EXISTS.
  const DELTAS = ['20260809000000_obrigacao_vencimento', '20260810000000_opening_balance_rollback', '20260811000000_conciliacao_bancaria']
  for (const m of DELTAS) {
    try {
      const sql = readFileSync(join(import.meta.dirname, '..', 'prisma/migrations', m, 'migration.sql'), 'utf8')
      for (const s of statements(sql)) await prisma.$executeRawUnsafe(s)
      log(`✓ delta aditivo aplicado: ${m}`)
    } catch (e) { log(`AVISO: delta ${m} (${String(e?.message ?? e).slice(0, 80)})`) }
  }

  // ── 3) Plano de contas (INSERT do ausente) ──
  const CONTAS = [
    { codigo: '1.0', nome: 'Caixa/Banco', tipo: 'ATIVO' }, { codigo: '1.1', nome: 'Clientes a Receber', tipo: 'ATIVO' },
    { codigo: '2.1', nome: 'Fornecedores/Custos a Pagar', tipo: 'PASSIVO' }, { codigo: '4.1', nome: 'Receita a Realizar', tipo: 'RECEITA' },
    { codigo: '4.2', nome: 'Descontos', tipo: 'RESULTADO' }, { codigo: '4.3', nome: 'Encargos (juros/multa)', tipo: 'RECEITA' },
    { codigo: '5.1', nome: 'Taxas/Tarifas', tipo: 'DESPESA' }, { codigo: '6.1', nome: 'Diferença Cambial', tipo: 'RESULTADO' },
    { codigo: '7.1', nome: 'Créditos de Clientes', tipo: 'PASSIVO' }, { codigo: '9.9', nome: 'Saldo de Abertura', tipo: 'RESULTADO' },
  ]
  const existentes = new Set((await prisma.planoContaFinanceira.findMany({ select: { codigo: true } })).map((c) => c.codigo))
  let nc = 0
  for (const c of CONTAS) if (!existentes.has(c.codigo)) { await prisma.planoContaFinanceira.create({ data: c }); nc++ }
  log(`✓ plano de contas: ${await prisma.planoContaFinanceira.count()} contas (${nc} novas).`)

  // ── 3b) Usuário admin do sandbox (idempotente) — habilita login + flags V3 ──
  const ADMIN_EMAIL = 'homolog@sandbox.local', ADMIN_SENHA = 'Homolog@2026'
  const jaAdmin = await prisma.usuario.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } }).catch(() => null)
  if (!jaAdmin) {
    const bcrypt = (await import('bcrypt')).default
    const hash = await bcrypt.hash(ADMIN_SENHA, 10)
    await prisma.usuario.create({ data: { nome: 'Admin Homologação', email: ADMIN_EMAIL, senha: hash, tipo: 'admin' } })
    log(`✓ admin do sandbox criado (${ADMIN_EMAIL}).`)
  } else { log(`✓ admin do sandbox já existe (${ADMIN_EMAIL}).`) }

  // ── 3c) RESET opcional (SANDBOX_RESET=1): apaga TODO o dado sintético e re-semeia.
  // O banco do sandbox é 100% sintético (força inversa já garantiu). Preserva plano
  // de contas e o admin. One-shot: o flag é removido após aplicar.
  if (process.env.SANDBOX_RESET === '1') {
    log('RESET (SANDBOX_RESET=1) — apagando dados de teste e re-semeando o estado inicial…')
    await prisma.aplicacaoFinanceira.deleteMany()
    await prisma.ledgerEntry.deleteMany()
    await prisma.ocorrenciaFinanceira.deleteMany()
    await prisma.participacaoEconomica.deleteMany()
    await prisma.distribuicaoEconomica.deleteMany()
    await prisma.creditoFinanceiro.deleteMany()
    await prisma.saldoProjecao.deleteMany()
    await prisma.snapshotCambial.deleteMany().catch(() => {})
    await prisma.pagador.deleteMany()
    await prisma.parteExterna.deleteMany()
    await prisma.ledgerFinanceiro.deleteMany()
    await prisma.obrigacaoEconomica.deleteMany()
    await prisma.parcelaFinanceira.deleteMany()
    await prisma.cobranca.deleteMany()
    await prisma.receita.deleteMany()
    await prisma.pessoa.deleteMany()
    await prisma.processo.deleteMany()
    log('✓ dados sintéticos apagados — re-semeando pristine.')
  }

  // ── 4) Dataset sintético (idempotente por Receita REC-SBX1) ──
  const jaTem = await prisma.receita.findUnique({ where: { codigo: 'REC-SBX1' }, select: { id: true } }).catch(() => null)
  if (jaTem) { log(`✓ dataset sintético já existe (Receita REC-SBX1 = #${jaTem.id}). Nada a repetir.`); await smokeLeitura(); process.exit(0) }

  const VALOR = 4000, N = 4, COTA = 1000, MOEDA = 'BRL'
  await prisma.$transaction(async (tx) => {
    const proc = await tx.processo.create({ data: { codigo: 'SBX-1', nome: 'Sandbox Homologação — Motor V3', pais: 'Itália', descricao: 'Processo sintético de homologação (Fase 2). Não é dado real.' } })
    const pessoas = []
    for (let i = 1; i <= N; i++) pessoas.push(await tx.pessoa.create({ data: { nome: `SBX Requerente ${i}`, requerente: 'sim', pais_nasc: 'Brasil' } }))

    const receita = await tx.receita.create({ data: {
      codigo: 'REC-SBX1', processoId: proc.id, descricao: 'Honorários — Sandbox Homologação', moeda: MOEDA,
      valor: VALOR, fxEstimado: 1, nParcelas: N, data1: new Date(), status: 'ATIVA', origem: 'manual', personId: pessoas[0].id,
    } })

    const obr = await tx.obrigacaoEconomica.create({ data: {
      codigoOperacional: 'REC-SBX1', natureza: 'RECEITA', direcao: 'A_RECEBER', processoId: proc.id,
      moedaContratual: MOEDA, moedaContabil: MOEDA, valorContratado: VALOR, status: 'ATIVO',
      origemTipo: 'Receita', origemId: receita.id, politicaDivisao: 'IGUAL',
    } })
    const ledger = await tx.ledgerFinanceiro.create({ data: { obrigacaoId: obr.id, moedaContabil: MOEDA } })
    const oc = await tx.ocorrenciaFinanceira.create({ data: { obrigacaoId: obr.id, tipo: 'OBRIGACAO_CRIADA', valor: VALOR, moeda: MOEDA, data: new Date(), status: 'PROCESSADA', idempotencyKey: `obr-criada:${obr.id}` } })
    const tId = `obr-criada:${obr.id}`
    const b = { ledgerId: ledger.id, obrigacaoId: obr.id, ocorrenciaId: oc.id, transacaoId: tId, tipo: 'OBRIGACAO_CRIADA', moeda: MOEDA, data: new Date() }
    await tx.ledgerEntry.create({ data: { ...b, contaContabil: '1.1', direcao: 'DEBITO', valor: VALOR, valorContabil: VALOR, sequencia: 1, idempotencyKey: `${tId}#1.1#DEBITO#1` } })
    await tx.ledgerEntry.create({ data: { ...b, contaContabil: '4.1', direcao: 'CREDITO', valor: VALOR, valorContabil: VALOR, sequencia: 2, idempotencyKey: `${tId}#4.1#CREDITO#2` } })
    await tx.saldoProjecao.create({ data: { obrigacaoId: obr.id, saldo: VALOR, recebidoBruto: 0, recebidoLiquido: 0, ultimaSequenciaAplicada: 2 } })

    const dist = await tx.distribuicaoEconomica.create({ data: { obrigacaoId: obr.id, modo: 'IGUAL', versao: 1 } })
    for (let i = 0; i < N; i++) await tx.participacaoEconomica.create({ data: { distribuicaoId: dist.id, pessoaId: pessoas[i].id, incluido: true, valor: COTA, moeda: MOEDA, ordem: i } })

    const cob = await tx.cobranca.create({ data: { receitaId: receita.id, processoId: proc.id, valorTotal: VALOR, moeda: MOEDA, status: 'ABERTA', obrigacaoId: obr.id } })
    for (let i = 1; i <= N; i++) {
      const venc = new Date(); venc.setMonth(venc.getMonth() + i)
      await tx.parcelaFinanceira.create({ data: { cobrancaId: cob.id, receitaId: receita.id, numero: i, vencimento: venc, valor: COTA, status: 'PENDENTE' } })
    }
    log(`✓ dataset criado — Processo #${proc.id} (SBX-1), Pessoas [${pessoas.map((p) => p.id).join(', ')}], Receita REC-SBX1 #${receita.id}, Obrigação #${obr.id} (saldo ${VALOR} ${MOEDA}, 4×${COTA} parcelas).`)
  })
  await smokeLeitura()
  await confirmarEstado()
  log('SANDBOX PRONTO.')
} catch (err) {
  log(`ERRO (não bloqueia o build): ${String(err?.message ?? err).slice(0, 300)}`)
} finally {
  await prisma.$disconnect().catch(() => {})
}
process.exit(0)
