// scripts/prod-seed-adquirentes-bandeiras.mjs
// ============================================================================
// Cadastro IDEMPOTENTE de Adquirentes/Gateways e Bandeiras, no build da Vercel.
// Mesmo contrato do seed de formas: só em VERCEL_ENV=production, trava de
// identidade PRODUCAO, só INSERT do que estiver AUSENTE (por slug); nunca UPDATE/
// DELETE. Código ADQ-n / BND-n pela mesma sequência atômica (CodeSequence).
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[seed-adq-bnd] ${m}`)

if (process.env.VERCEL_ENV !== 'production') {
  log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — só roda em production. Pulando.`)
  process.exit(0)
}
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[seed-adq-bnd] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }

const ADQUIRENTES = [
  { slug: 'CIELO', nome: 'Cielo', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] },
  { slug: 'REDE', nome: 'Rede', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] },
  { slug: 'STONE', nome: 'Stone', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX'] },
  { slug: 'GETNET', nome: 'Getnet', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO'] },
  { slug: 'MERCADO_PAGO', nome: 'Mercado Pago', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'BOLETO'] },
  { slug: 'PAGBANK', nome: 'PagBank', formas: ['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'BOLETO'] },
]
const BANDEIRAS = [
  { slug: 'VISA', nome: 'Visa' }, { slug: 'MASTERCARD', nome: 'Mastercard' },
  { slug: 'ELO', nome: 'Elo' }, { slug: 'AMEX', nome: 'American Express' }, { slug: 'HIPERCARD', nome: 'Hipercard' }, { slug: 'DINERS', nome: 'Diners Club' },
]

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

async function proximoCodigo(tx, scope) {
  const rows = await tx.$queryRawUnsafe(`
    INSERT INTO "CodeSequence" ("scope", "ultimo", "atualizadoEm") VALUES ('${scope}', 1, now())
    ON CONFLICT ("scope") DO UPDATE SET "ultimo" = "CodeSequence"."ultimo" + 1, "atualizadoEm" = now()
    RETURNING "ultimo"`)
  return `${scope}-${Number(rows[0].ultimo)}`
}

try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe}`)
  if (classe !== CLASSE.PRODUCAO) { console.error(`[seed-adq-bnd] ABORTADO: alvo não é PRODUCAO (${classe}).`); process.exit(1) }

  // mapa type→id de formas (para formasSuportadas)
  const formas = await prisma.formaPagamentoCadastro.findMany({ select: { id: true, type: true } })
  const formaIdPorTipo = new Map(formas.filter((f) => f.type).map((f) => [String(f.type).toUpperCase(), f.id]))

  const adqExist = new Set((await prisma.adquirente.findMany({ select: { slug: true } })).map((a) => a.slug))
  let novasA = 0
  for (const a of ADQUIRENTES) {
    if (adqExist.has(a.slug)) { log(`Adquirente ${a.slug} já existe — mantida.`); continue }
    const formasSuportadas = a.formas.map((t) => formaIdPorTipo.get(t)).filter((x) => x != null)
    await prisma.$transaction(async (tx) => {
      const code = await proximoCodigo(tx, 'ADQ')
      await tx.adquirente.create({ data: { code, slug: a.slug, nome: a.nome, ativo: true, formasSuportadas } })
    })
    novasA++; log(`✓ Adquirente ${a.slug} criada (${formasSuportadas.length} formas).`)
  }

  const bndExist = new Set((await prisma.bandeira.findMany({ select: { slug: true } })).map((b) => b.slug))
  let novasB = 0
  for (const b of BANDEIRAS) {
    if (bndExist.has(b.slug)) { log(`Bandeira ${b.slug} já existe — mantida.`); continue }
    await prisma.$transaction(async (tx) => {
      const code = await proximoCodigo(tx, 'BND')
      await tx.bandeira.create({ data: { code, slug: b.slug, nome: b.nome, ativo: true } })
    })
    novasB++; log(`✓ Bandeira ${b.slug} criada.`)
  }

  const totA = await prisma.adquirente.count(), totB = await prisma.bandeira.count()
  log(`OK — adquirentes: ${totA} (${novasA} novas) · bandeiras: ${totB} (${novasB} novas).`)
} catch (err) {
  console.error('[seed-adq-bnd] ERRO:', String(err?.message ?? err).slice(0, 400)); process.exit(1)
} finally { await prisma.$disconnect() }
