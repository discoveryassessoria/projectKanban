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

  // ── 3 condições LÓGICAS (código fixo, idempotente por código). A quantidade
  //    de parcelas é escolhida na cobrança, dentro de min..max — NÃO há condição
  //    por parcela. Taxas vêm SEMPRE das Tabelas de Taxas (a condição não guarda %). ──
  const COND = [
    { codigo: 'COND-AVISTA', name: 'À Vista', tipoPagamento: 'AVISTA', min: 1, max: 1,
      formas: ['PIX', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO_DEBITO', 'WISE'], sugerida: 'PIX',
      temEntrada: false, politicaTaxas: 'ABSORVER' },
    { codigo: 'COND-CARTAO-CREDITO', name: 'Cartão de Crédito', tipoPagamento: 'PARCELADO', min: 1, max: 12,
      formas: ['CARTAO_CREDITO'], sugerida: 'CARTAO_CREDITO',
      temEntrada: true, politicaTaxas: 'ABSORVER' },
    // Boleto: política IGNORAR no cálculo da cobrança — emissão/liquidação (R$5)
    // e multa/juros NÃO são antecipados; são aplicados por EVENTO (lib/financeiro/
    // encargos-boleto.ts) na emissão/pagamento/atraso reais.
    { codigo: 'COND-BOLETO', name: 'Boleto Parcelado', tipoPagamento: 'PARCELADO', min: 1, max: 12,
      formas: ['BOLETO'], sugerida: 'BOLETO',
      temEntrada: true, politicaTaxas: 'IGNORAR', multaPercent: 2, jurosMesPercent: 1, carenciaDias: 3 },
  ]

  const codigosExist = new Set((await prisma.condicaoPagamento.findMany({ select: { codigo: true } })).map((c) => c.codigo).filter(Boolean))
  let novasC = 0
  for (const c of COND) {
    if (codigosExist.has(c.codigo)) { log(`Condição ${c.codigo} já existe — mantida (não sobrescreve).`); continue }
    const formaIds = c.formas.map(fid).filter((x) => x != null)
    await prisma.$transaction(async (tx) => {
      await tx.condicaoPagamento.create({ data: {
        codigo: c.codigo, versao: 1, name: c.name, ativo: true,
        tipoPagamento: c.tipoPagamento, parcelas: c.max, parcelasMin: c.min, parcelasMax: c.max, parcelasPadrao: c.min,
        inicioCronograma: 'IMEDIATA', periodicidade: 'MENSAL', // 1ª no ato; demais por mês de calendário
        aplicaA: 'RECEITA', politicaTaxas: c.politicaTaxas, vigenciaInicio: new Date(),
        temEntrada: !!c.temEntrada, // entrada é CAPACIDADE; valor é escolhido na cobrança (PIX/Transferência)
        multaPercent: c.multaPercent ?? undefined, jurosMesPercent: c.jurosMesPercent ?? undefined, carenciaDias: c.carenciaDias ?? undefined,
        formaSugeridaId: fid(c.sugerida) ?? undefined,
        formasPermitidas: formaIds.length ? { create: formaIds.map((formaId) => ({ formaId })) } : undefined,
      } })
    })
    novasC++; log(`✓ Condição ${c.codigo} "${c.name}" criada (${formaIds.length} forma(s)).`)
  }

  // ── Inativa (aditivo/reversível) as condições LEGADAS por-parcela SEM USO
  //    (À vista antigo, "Cartão de crédito — Nx", "Boleto — Nx"). Nunca apaga;
  //    nunca toca condição usada em receita/custo (histórico preservado). ──
  const codigosNovos = new Set(COND.map((c) => c.codigo))
  const legadas = await prisma.condicaoPagamento.findMany({
    where: {
      ativo: true,
      OR: [{ name: 'À vista' }, { name: { startsWith: 'Cartão de crédito — ' } }, { name: { startsWith: 'Boleto — ' } }],
    },
    select: { id: true, name: true, codigo: true },
  })
  let inativadas = 0
  for (const l of legadas) {
    if (l.codigo && codigosNovos.has(l.codigo)) continue // nunca as 3 novas
    const usoR = await prisma.receita.count({ where: { condicaoPagamentoId: l.id } })
    const usoC = await prisma.custo.count({ where: { condicaoPagamentoId: l.id } })
    if (usoR + usoC > 0) { log(`Condição legada "${l.name}" EM USO (${usoR + usoC}) — mantida ativa.`); continue }
    await prisma.condicaoPagamento.update({ where: { id: l.id }, data: { ativo: false } })
    inativadas++
  }
  if (inativadas) log(`✓ ${inativadas} condição(ões) legada(s) por-parcela inativada(s) (sem uso; reversível).`)

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
        formasAplicaveis: fid('BOLETO') != null ? [fid('BOLETO')] : [], vigenciaInicio: new Date(),
      } })
    })
    novasT++; log(`✓ Taxa "${t.name}" criada (R$5 fixo, boleto).`)
  }

  const tc = await prisma.condicaoPagamento.count(), tt = await prisma.taxaPagamento.count()
  log(`OK — condições: ${tc} (${novasC} novas) · taxas: ${tt} (${novasT} novas de boleto).`)
} catch (err) {
  console.error('[seed-cond-tax] ERRO:', String(err?.message ?? err).slice(0, 500)); process.exit(1)
} finally { await prisma.$disconnect() }
