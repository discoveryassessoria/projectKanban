// scripts/prod-apply-cadastros-aditivas.mjs
// ============================================================================
// Aplica, DENTRO DO BUILD DA VERCEL (onde PRISMA_DATABASE_URL existe), as
// migrations ADITIVAS do redesenho dos cadastros de pagamento — sem depender de
// `migrate deploy` (o histórico _prisma_migrations está dessincronizado) e sem
// expor a connection string.
//
// Seguro por construção:
//   • roda só em VERCEL_ENV=production (previews e local: pula);
//   • trava de identidade — só escreve se o alvo for classificado PRODUCAO;
//   • aplica apenas `ADD COLUMN IF NOT EXISTS` + backfill guardado → idempotente
//     (no-op após a 1ª vez); nenhum drop, nenhuma perda de dado;
//   • falha FECHADA: qualquer erro aborta o build (o deployment atual segue no ar).
//
// Ao adicionar as próximas fases (Taxa, Condição), inclua o diretório da migration
// aditiva na lista ADITIVAS.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const RAIZ = join(import.meta.dirname, '..')

// Migrations 100% aditivas desta entrega (idempotentes).
const ADITIVAS = [
  '20260729000000_condicao_regra_reutilizavel',
  '20260730000000_forma_pagamento_capacidades',
  '20260731000000_taxa_pagamento_regra_reutilizavel',
  '20260732000000_forma_pagamento_uso_e_codigo',
  '20260801000000_cobranca_runtime_calculo',
  '20260802000000_condicao_aplicabilidade_relacional',
  '20260803000000_taxa_aplicabilidade_relacional',
  '20260804000000_taxa_tabela_parcelamento',
  '20260805000000_adquirente_bandeira',
  '20260806000000_taxa_finalidade',
  '20260807000000_cobranca_cambio_idempotencia',
]

// Colunas-sentinela p/ verificação pós-aplicação.
const SENTINELAS = [
  ['Adquirente', ['slug', 'code', 'formasSuportadas']],
  ['Bandeira', ['slug', 'code']],
  ['FormaPagamentoCadastro', ['moedasAceitas', 'tipoIntegracao', 'prazoLiquidacao', 'carteirasCompativeis', 'minParcelas', 'exigeAdquirente', 'usoRecebimento', 'usoPagamento']],
  ['MoedaCadastro', ['ativo']],
  ['CondicaoPagamento', ['politicaTaxas', 'formaSugeridaId', 'servicos', 'entradaTipo']],
  ['TaxaPagamento', ['formasAplicaveis', 'aplicaParcela', 'anticipationType', 'momentoCambio', 'adquirenteId', 'bandeiraId', 'finalidade']],
  ['Cobranca', ['politicaTaxas', 'valorBase', 'valorTaxa', 'valorLiquido', 'moedaOrigem', 'cotacao', 'congeladaEm', 'adquirenteId', 'bandeiraId', 'moedaDestino', 'cotacaoTipo', 'cotacaoId', 'cotacaoManualPorId', 'cotacaoJustificativa', 'idempotencyKey']],
  // Aplicabilidade relacional da Condição (tabelas de vínculo — checadas pelas colunas).
  ['CondicaoPagamentoMoeda', ['condicaoId', 'moedaId']],
  ['CondicaoPagamentoPais', ['condicaoId', 'paisId']],
  ['CondicaoPagamentoModalidade', ['condicaoId', 'modalidadeId']],
  ['CondicaoPagamentoServico', ['condicaoId', 'servicoId']],
  // Aplicabilidade relacional da Taxa (moeda/país).
  ['TaxaPagamentoMoeda', ['taxaId', 'moedaId']],
  ['TaxaPagamentoPais', ['taxaId', 'paisId']],
  // Tabela de parcelamento da Taxa (tabela comercial da adquirente).
  ['TaxaParcelamento', ['taxaId', 'parcelasDe', 'parcelasAte', 'feePercent', 'fixedFee', 'antecipacao']],
]

const log = (m) => console.log(`[cadastros-aditivas] ${m}`)

if (process.env.VERCEL_ENV !== 'production') {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Pulando.`)
  process.exit(0)
}

const url = process.env.PRISMA_DATABASE_URL
if (!url) {
  console.error('[cadastros-aditivas] ABORTADO: PRISMA_DATABASE_URL ausente no build de produção.')
  process.exit(1)
}

const statements = (sql) =>
  sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean)

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe} (${retrato.tabelas} tabelas, ${retrato.requerentes} requerentes)`)
  if (classe !== CLASSE.PRODUCAO) {
    console.error(`[cadastros-aditivas] ABORTADO: alvo não é PRODUCAO (classificado ${classe}). Nada escrito.`)
    process.exit(1)
  }

  for (const m of ADITIVAS) {
    const sql = readFileSync(join(RAIZ, 'prisma/migrations', m, 'migration.sql'), 'utf8')
    const stmts = statements(sql)
    for (const s of stmts) await prisma.$executeRawUnsafe(s)
    log(`✓ ${m} — ${stmts.length} statement(s)`)
  }

  // verificação: todas as colunas-sentinela presentes
  let faltando = 0
  for (const [tabela, colunas] of SENTINELAS) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name='${tabela}' AND column_name = ANY($1::text[])`,
      colunas,
    )
    const presentes = new Set(rows.map((r) => r.column_name))
    const ausentes = colunas.filter((c) => !presentes.has(c))
    if (ausentes.length) { faltando += ausentes.length; console.error(`[cadastros-aditivas] ${tabela}: faltam ${ausentes.join(', ')}`) }
    else log(`✓ ${tabela}: ${colunas.length} colunas presentes`)
  }
  if (faltando) { console.error('[cadastros-aditivas] ABORTADO: colunas ausentes após aplicação.'); process.exit(1) }

  // proteção anti-perda: requerentes não pode cair (nada nesta migração remove dados)
  const depois = await retratar(prisma)
  if (depois.requerentes < retrato.requerentes) {
    console.error(`[cadastros-aditivas] ABORTADO: requerentes caiu de ${retrato.requerentes} para ${depois.requerentes}.`)
    process.exit(1)
  }
  log('OK — colunas aditivas aplicadas e verificadas.')
} catch (err) {
  console.error('[cadastros-aditivas] ERRO:', String(err?.message ?? err).slice(0, 400))
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
