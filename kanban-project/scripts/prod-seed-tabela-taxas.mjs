// scripts/prod-seed-tabela-taxas.mjs
// ============================================================================
// TABELA DE TAXAS PADRÃO (percentuais iniciais REAIS, editáveis) — no build da
// Vercel. Por bandeira × parcela (grade TaxaParcelamento). Idempotente: só INSERT
// de taxa AUSENTE (por nome); política das condições só é ajustada quando ainda
// está no default IGNORAR (não sobrescreve edição do admin). Trava PRODUCAO.
// Valores 100% editáveis depois pelo administrador nas telas de Taxa/Condição.
// ============================================================================
import { CLASSE, classificar, identificador, retratar } from '../lib/db/identidade-banco.mjs'

const log = (m) => console.log(`[seed-tabela-taxas] ${m}`)
if (process.env.VERCEL_ENV !== 'production') { log(`VERCEL_ENV=${process.env.VERCEL_ENV ?? '(vazio)'} — pulando.`); process.exit(0) }
const url = process.env.PRISMA_DATABASE_URL
if (!url) { console.error('[seed-tabela-taxas] ABORTADO: PRISMA_DATABASE_URL ausente.'); process.exit(1) }

// Percentuais de CRÉDITO por bandeira (índice = parcela-1). Diners só 1x.
const CREDITO = {
  VISA: [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60],
  MASTERCARD: [3.25, 5.67, 6.69, 7.09, 7.70, 8.07, 8.92, 9.60, 10.22, 10.58, 11.06, 11.60],
  ELO: [3.80, 6.32, 7.34, 7.74, 8.35, 8.72, 9.57, 10.25, 10.87, 11.23, 11.71, 12.25],
  AMEX: [3.75, 6.27, 7.29, 7.69, 8.30, 8.67, 9.52, 10.20, 10.82, 11.18, 11.66, 12.20],
  DINERS: [3.25],
}
const DEBITO = { VISA: 0.86, MASTERCARD: 0.86, ELO: 1.41 }
const OUTRAS = [{ tipo: 'WISE', nome: 'Wise', pct: 1.50 }, { tipo: 'PIX', nome: 'PIX', pct: 0 }, { tipo: 'TRANSFERENCIA', nome: 'Transferência', pct: 0 }, { tipo: 'DINHEIRO', nome: 'Dinheiro', pct: 0 }]

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })
const proxCod = async (tx, scope) => {
  const r = await tx.$queryRawUnsafe(`INSERT INTO "CodeSequence" ("scope","ultimo","atualizadoEm") VALUES ('${scope}',1,now())
    ON CONFLICT ("scope") DO UPDATE SET "ultimo"="CodeSequence"."ultimo"+1,"atualizadoEm"=now() RETURNING "ultimo"`)
  return `${scope}-${Number(r[0].ultimo)}`
}

try {
  const retrato = await retratar(prisma); const classe = classificar(retrato)
  log(`alvo: ${identificador(url)} — ${classe}`)
  if (classe !== CLASSE.PRODUCAO) { console.error(`[seed-tabela-taxas] ABORTADO: alvo não é PRODUCAO (${classe}).`); process.exit(1) }

  const formas = await prisma.formaPagamentoCadastro.findMany({ select: { id: true, type: true } })
  const fid = (t) => formas.find((f) => String(f.type).toUpperCase() === t)?.id ?? null
  const bandeiras = await prisma.bandeira.findMany({ select: { id: true, slug: true, nome: true } })
  const bid = (slug) => bandeiras.find((b) => b.slug === slug)?.id ?? null
  const CREDITO_ID = fid('CARTAO_CREDITO'), DEBITO_ID = fid('CARTAO_DEBITO')

  const jaTaxa = new Set((await prisma.taxaPagamento.findMany({ select: { name: true } })).map((t) => t.name))
  const criarTaxa = async (name, data, grade) => {
    if (jaTaxa.has(name)) { log(`Taxa "${name}" já existe — mantida.`); return }
    await prisma.$transaction(async (tx) => {
      const code = await proxCod(tx, 'TXP')
      await tx.taxaPagamento.create({ data: { code, name, ativo: true, prioridade: 0, quemAbsorve: 'EMPRESA', vigenciaInicio: new Date(), ...data,
        ...(grade ? { parcelamento: { create: grade } } : {}) } })
    })
    log(`✓ Taxa "${name}" criada.`)
  }

  // ── Crédito por bandeira (grade 1x..12x) ──
  for (const [slug, pcts] of Object.entries(CREDITO)) {
    const b = bandeiras.find((x) => x.slug === slug); if (!b || CREDITO_ID == null) continue
    const grade = pcts.map((p, i) => ({ parcelasDe: i + 1, parcelasAte: i + 1, feePercent: p, ordem: i }))
    await criarTaxa(`Cartão de Crédito — ${b.nome}`, { descricao: `Taxa de crédito ${b.nome} (grade por parcela, editável).`, categoria: 'TAXA_CARTAO', feeType: 'percentage', feePercent: pcts[0], aplicaParcela: 'TODAS', formasAplicaveis: [CREDITO_ID], bandeiraId: b.id }, grade)
  }
  // ── Débito por bandeira (à vista) ──
  for (const [slug, pct] of Object.entries(DEBITO)) {
    const b = bandeiras.find((x) => x.slug === slug); if (!b || DEBITO_ID == null) continue
    await criarTaxa(`Cartão de Débito — ${b.nome}`, { descricao: `Taxa de débito ${b.nome} (editável).`, categoria: 'TAXA_CARTAO', feeType: 'percentage', feePercent: pct, aplicaParcela: 'TODAS', formasAplicaveis: [DEBITO_ID], bandeiraId: b.id })
  }
  // ── Wise / PIX / Transferência / Dinheiro ──
  for (const o of OUTRAS) {
    const formaId = fid(o.tipo); if (formaId == null) continue
    await criarTaxa(`${o.nome} — Taxa`, { descricao: `Taxa de ${o.nome} (${o.pct}% — editável).`, categoria: o.pct ? 'GATEWAY' : 'OUTRO', feeType: 'percentage', feePercent: o.pct, aplicaParcela: 'TODAS', formasAplicaveis: [formaId] })
  }

  // ── Política das condições: habilita a aplicação da taxa (ABSORVER) só onde
  //    ainda está no default IGNORAR; + multa 2% / juros 1% no boleto. ──
  const upIgnorar = async (where, data, rotulo) => {
    const r = await prisma.condicaoPagamento.updateMany({ where: { ...where, politicaTaxas: 'IGNORAR' }, data })
    if (r.count) log(`✓ ${rotulo}: ${r.count} condição(ões) atualizada(s).`)
  }
  await upIgnorar({ name: { startsWith: 'Cartão de crédito —' } }, { politicaTaxas: 'ABSORVER' }, 'Cartão → ABSORVER')
  await upIgnorar({ name: 'À vista' }, { politicaTaxas: 'ABSORVER' }, 'À vista → ABSORVER')
  await upIgnorar({ name: { startsWith: 'Boleto —' } }, { politicaTaxas: 'ABSORVER', multaPercent: 2, jurosMesPercent: 1 }, 'Boleto → ABSORVER + multa 2%/juros 1%')

  const tt = await prisma.taxaPagamento.count()
  log(`OK — total de taxas: ${tt}. Percentuais são PADRÃO editável.`)
} catch (err) {
  console.error('[seed-tabela-taxas] ERRO:', String(err?.message ?? err).slice(0, 500)); process.exit(1)
} finally { await prisma.$disconnect() }
