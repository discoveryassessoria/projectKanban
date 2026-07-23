// scripts/prod-smoke-dual-write.mjs
// ============================================================================
// TESTE CONTROLADO (smoke) do Motor Financeiro V3 no build de PRODUÇÃO. Cria uma
// obrigação SINTÉTICA + lançamento double-entry, valida balanceamento (Σd=Σc),
// idempotência (mesma origem não duplica) e AUSÊNCIA de duplicidade, e LIMPA
// tudo (cascade). NUNCA bloqueia o build (exit 0 sempre). Isolado (origem SMOKE).
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[smoke-dual-write] ${m}`)
if (process.env.VERCEL_ENV !== 'production') { log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — pulando.`); process.exit(0) }
const url = process.env.PRISMA_DATABASE_URL
if (!url) { log('sem PRISMA_DATABASE_URL — pulando.'); process.exit(0) }

const ORIGEM_TIPO = 'SMOKE'
const ORIGEM_ID = 999999999

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })
let ok = true
const check = (n, c) => { if (c) log(`  ✓ ${n}`); else { ok = false; log(`  ✗ ${n}`) } }

try {
  const retrato = await retratar(prisma); const classe = classificar(retrato)
  if (classe !== CLASSE.PRODUCAO) { log(`alvo não é PRODUCAO (${classe}) — pulando.`); process.exit(0) }
  log(`alvo: ${identificador(url)} — PRODUCAO`)

  // limpeza defensiva de execução anterior
  await prisma.obrigacaoEconomica.deleteMany({ where: { origemTipo: ORIGEM_TIPO, origemId: ORIGEM_ID } })

  // cria obrigação sintética + ledger + lançamento balanceado (D 1.1 / C 4.1)
  const criar = async () => prisma.$transaction(async (tx) => {
    const existente = await tx.obrigacaoEconomica.findUnique({ where: { origemTipo_origemId: { origemTipo: ORIGEM_TIPO, origemId: ORIGEM_ID } } })
    if (existente) return { obrigacaoId: existente.id, reaproveitada: true }
    const obr = await tx.obrigacaoEconomica.create({ data: { natureza: 'RECEITA', direcao: 'A_RECEBER', moedaContratual: 'BRL', moedaContabil: 'BRL', valorContratado: 100, status: 'ATIVO', origemTipo: ORIGEM_TIPO, origemId: ORIGEM_ID, codigoOperacional: 'SMOKE-V3' } })
    const ledger = await tx.ledgerFinanceiro.create({ data: { obrigacaoId: obr.id, moedaContabil: 'BRL' } })
    const tx0 = `obr-criada:${obr.id}`
    await tx.ledgerEntry.create({ data: { ledgerId: ledger.id, obrigacaoId: obr.id, transacaoId: tx0, tipo: 'OBRIGACAO_CRIADA', contaContabil: '1.1', direcao: 'DEBITO', valor: 100, moeda: 'BRL', valorContabil: 100, data: new Date(), sequencia: 1, idempotencyKey: `${tx0}#1.1#DEBITO#1` } })
    await tx.ledgerEntry.create({ data: { ledgerId: ledger.id, obrigacaoId: obr.id, transacaoId: tx0, tipo: 'OBRIGACAO_CRIADA', contaContabil: '4.1', direcao: 'CREDITO', valor: 100, moeda: 'BRL', valorContabil: 100, data: new Date(), sequencia: 2, idempotencyKey: `${tx0}#4.1#CREDITO#2` } })
    await tx.saldoProjecao.create({ data: { obrigacaoId: obr.id, saldo: 100, recebidoBruto: 0, recebidoLiquido: 0, ultimaSequenciaAplicada: 2 } })
    return { obrigacaoId: obr.id, reaproveitada: false }
  })

  const r1 = await criar()
  check('obrigação criada', !r1.reaproveitada && r1.obrigacaoId > 0)

  // balanceamento Σd=Σc
  const entries = await prisma.ledgerEntry.findMany({ where: { obrigacaoId: r1.obrigacaoId }, select: { direcao: true, valorContabil: true } })
  const d = entries.filter((e) => e.direcao === 'DEBITO').reduce((s, e) => s + Number(e.valorContabil), 0)
  const c = entries.filter((e) => e.direcao === 'CREDITO').reduce((s, e) => s + Number(e.valorContabil), 0)
  check(`lançamento balanceado (Σd=${d} = Σc=${c})`, Math.abs(d - c) < 0.005 && d === 100)

  // idempotência: re-executar não duplica
  const r2 = await criar()
  check('idempotência: 2ª execução reaproveita (não recria)', r2.reaproveitada === true && r2.obrigacaoId === r1.obrigacaoId)
  const totalObr = await prisma.obrigacaoEconomica.count({ where: { origemTipo: ORIGEM_TIPO, origemId: ORIGEM_ID } })
  check('ausência de duplicidade: exatamente 1 obrigação', totalObr === 1)
  const totalEntries = await prisma.ledgerEntry.count({ where: { obrigacaoId: r1.obrigacaoId } })
  check('ausência de duplicidade: exatamente 2 entries', totalEntries === 2)

  // limpeza (cascade remove ledger/entries/projeção)
  await prisma.obrigacaoEconomica.deleteMany({ where: { origemTipo: ORIGEM_TIPO, origemId: ORIGEM_ID } })
  const sobrou = await prisma.obrigacaoEconomica.count({ where: { origemTipo: ORIGEM_TIPO, origemId: ORIGEM_ID } })
  check('limpeza: nenhum resíduo de smoke em prod', sobrou === 0)

  log(ok ? 'SMOKE OK — motor V3 balanceado e idempotente em produção.' : 'SMOKE COM FALHAS (ver acima) — build segue, corrigir.')
} catch (err) {
  log(`ERRO no smoke (ignorado, não bloqueia build): ${String(err?.message ?? err).slice(0, 300)}`)
} finally {
  await prisma.$disconnect()
}
process.exit(0)
