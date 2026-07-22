// scripts/prod-seed-condicoes-taxas.mjs
// ============================================================================
// Cadastro IDEMPOTENTE das Condições de Pagamento padrão (À vista, Cartão 2x–12x,
// Boleto 1x–12x) e das taxas de boleto (R$5 emissão + R$5 pagamento), no build
// da Vercel. Mesmo contrato dos demais seeds: só VERCEL_ENV=production, trava de
// identidade PRODUCAO, só INSERT do AUSENTE (por nome). Nunca UPDATE/DELETE.
// Código CPG-n / TXP-n pela mesma sequência atômica (CodeSequence).
// NÃO gera receitas/cobranças/parcelas reais.
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[seed-cond-tax] ${m}`)
if (process.env.VERCEL_ENV !== 'production') { log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — pulando.`); process.exit(0) }
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[seed-cond-tax] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

const proxCod = async (tx, scope) => {
  const r = await tx.$queryRawUnsafe(`INSERT INTO "CodeSequence" ("scope","ultimo","atualizadoEm") VALUES ('${scope}',1,now())
    ON CONFLICT ("scope") DO UPDATE SET "ultimo"="CodeSequence"."ultimo"+1,"atualizadoEm"=now() RETURNING "ultimo"`)
  return `${scope}-${Number(r[0].ultimo)}`
}

try {
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe}`)
  if (classe !== CLASSE.PRODUCAO) { console.error(`[seed-cond-tax] ABORTADO: alvo não é PRODUCAO (${classe}).`); process.exit(1) }

  // formas por tipo (para vínculos e sugestão)
  const formas = await prisma.formaPagamentoCadastro.findMany({ select: { id: true, type: true } })
  const fid = (t) => formas.find((f) => String(f.type).toUpperCase() === t)?.id ?? null
  const TODAS = ['PIX', 'TRANSFERENCIA', 'DINHEIRO', 'WISE', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'BOLETO'].map(fid).filter((x) => x != null)
  const CARTAO = fid('CARTAO_CREDITO'), BOLETO = fid('BOLETO'), PIX = fid('PIX')

  // ── Condições desejadas ──
  const cond = []
  cond.push({ name: 'À vista', tipoPagamento: 'AVISTA', n: 1, formas: TODAS, sugerida: PIX })
  for (let n = 2; n <= 12; n++) cond.push({ name: `Cartão de crédito — ${n}x`, tipoPagamento: 'PARCELADO', n, formas: CARTAO != null ? [CARTAO] : [], sugerida: CARTAO })
  for (let n = 1; n <= 12; n++) cond.push({ name: `Boleto — ${n}x`, tipoPagamento: n === 1 ? 'AVISTA' : 'PARCELADO', n, formas: BOLETO != null ? [BOLETO] : [], sugerida: BOLETO })

  const existentes = new Set((await prisma.condicaoPagamento.findMany({ select: { name: true } })).map((c) => c.name))
  let novasC = 0
  for (const c of cond) {
    if (existentes.has(c.name)) { log(`Condição "${c.name}" já existe — mantida.`); continue }
    await prisma.$transaction(async (tx) => {
      const codigo = await proxCod(tx, 'CPG')
      await tx.condicaoPagamento.create({ data: {
        codigo, versao: 1, name: c.name, ativo: true,
        tipoPagamento: c.tipoPagamento, parcelas: c.n, parcelasMin: 1, parcelasMax: c.n, parcelasPadrao: c.n,
        inicioCronograma: 'IMEDIATA', periodicidade: 'MENSAL', // primeira no ato, demais +30d
        aplicaA: 'RECEITA', politicaTaxas: 'IGNORAR', vigenciaInicio: new Date(),
        formaSugeridaId: c.sugerida ?? undefined,
        formasPermitidas: c.formas.length ? { create: c.formas.map((formaId) => ({ formaId })) } : undefined,
      } })
    })
    novasC++; log(`✓ Condição "${c.name}" criada (${c.formas.length} forma(s)).`)
  }

  // ── Taxas de boleto (R$5 emissão + R$5 pagamento) ──
  const taxas = [
    { name: 'Boleto — Taxa de Emissão', categoria: 'TARIFA_BANCARIA', descricao: 'R$ 5,00 por boleto emitido.' },
    { name: 'Boleto — Taxa de Pagamento', categoria: 'TARIFA_BANCARIA', descricao: 'R$ 5,00 por boleto pago/liquidado.' },
  ]
  const taxasExist = new Set((await prisma.taxaPagamento.findMany({ select: { name: true } })).map((t) => t.name))
  let novasT = 0
  for (const t of taxas) {
    if (taxasExist.has(t.name)) { log(`Taxa "${t.name}" já existe — mantida.`); continue }
    await prisma.$transaction(async (tx) => {
      const code = await proxCod(tx, 'TXP')
      await tx.taxaPagamento.create({ data: {
        code, name: t.name, descricao: t.descricao, categoria: t.categoria,
        feeType: 'fixed', fixedFee: 5, baseIncidencia: 'PARCELA', quemAbsorve: 'EMPRESA',
        aplicaParcela: 'TODAS', ativo: true, prioridade: 0,
        formasAplicaveis: BOLETO != null ? [BOLETO] : [], vigenciaInicio: new Date(),
      } })
    })
    novasT++; log(`✓ Taxa "${t.name}" criada (R$5 fixo, boleto).`)
  }

  const tc = await prisma.condicaoPagamento.count(), tt = await prisma.taxaPagamento.count()
  log(`OK — condições: ${tc} (${novasC} novas) · taxas: ${tt} (${novasT} novas de boleto).`)
} catch (err) {
  console.error('[seed-cond-tax] ERRO:', String(err?.message ?? err).slice(0, 500)); process.exit(1)
} finally { await prisma.$disconnect() }
