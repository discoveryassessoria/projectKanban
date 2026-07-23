// scripts/prod-seed-plano-contas.mjs
// ============================================================================
// Seed IDEMPOTENTE do plano de contas mínimo do Motor Financeiro V3, no build da
// Vercel. Só VERCEL_ENV=production + identidade PRODUCAO; só INSERT do ausente
// (por código); nunca UPDATE/DELETE. A tabela é aditiva (Fase 1).
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[seed-plano-contas] ${m}`)
if (process.env.VERCEL_ENV !== 'production') { log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — pulando.`); process.exit(0) }
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[seed-plano-contas] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }

const CONTAS = [
  { codigo: '1.0', nome: 'Caixa/Banco', tipo: 'ATIVO' },
  { codigo: '1.1', nome: 'Clientes a Receber', tipo: 'ATIVO' },
  { codigo: '2.1', nome: 'Fornecedores/Custos a Pagar', tipo: 'PASSIVO' },
  { codigo: '4.1', nome: 'Receita a Realizar', tipo: 'RECEITA' },
  { codigo: '4.2', nome: 'Descontos', tipo: 'RESULTADO' },
  { codigo: '4.3', nome: 'Encargos (juros/multa)', tipo: 'RECEITA' },
  { codigo: '5.1', nome: 'Taxas/Tarifas', tipo: 'DESPESA' },
  { codigo: '6.1', nome: 'Diferença Cambial', tipo: 'RESULTADO' },
  { codigo: '7.1', nome: 'Créditos de Clientes', tipo: 'PASSIVO' },
  { codigo: '9.9', nome: 'Saldo de Abertura', tipo: 'RESULTADO' },
]

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })
try {
  const retrato = await retratar(prisma); const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe}`)
  if (classe !== CLASSE.PRODUCAO) { console.error(`[seed-plano-contas] ABORTADO: alvo não é PRODUCAO (${classe}).`); process.exit(1) }

  const existentes = new Set((await prisma.planoContaFinanceira.findMany({ select: { codigo: true } })).map((c) => c.codigo))
  let novas = 0
  for (const c of CONTAS) {
    if (existentes.has(c.codigo)) { continue }
    await prisma.planoContaFinanceira.create({ data: c })
    novas++
  }
  const tot = await prisma.planoContaFinanceira.count()
  log(`OK — plano de contas: ${tot} (${novas} novas).`)
} catch (err) {
  console.error('[seed-plano-contas] ERRO:', String(err?.message ?? err).slice(0, 400)); process.exit(1)
} finally { await prisma.$disconnect() }
