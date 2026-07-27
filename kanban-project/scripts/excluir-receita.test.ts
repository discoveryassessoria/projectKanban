// scripts/excluir-receita.test.ts
// ============================================================================
// GUARDA — Exclusão segura da Receita (persistência REAL, banco de teste).
// Cobre: bloqueia quando há pagamento (motivo explícito); bloqueia com documento
// fiscal; permite quando zerada; a exclusão é LÓGICA (Ledger preservado, reversível).
// Rodar: DATABASE_URL=...kanban_test (+ PRISMA_/DIRECT_) FINANCEIRO_V3_POSICAO_READ=1
// ============================================================================
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { podeExcluir, excluirReceita } from '@/lib/financeiro/acoes/excluir-receita'
import { AcaoReceitaError } from '@/lib/financeiro/acoes/recibo'

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) } }
const CFG = 91778
const sec = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const recs = await prisma.receita.findMany({ where: { configFinanceiraId: CFG }, select: { id: true } })
  const recIds = recs.map((r) => r.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: recIds } }, select: { id: true } })
  const obrIds = obrs.map((o) => o.id)
  await prisma.aplicacaoFinanceira.deleteMany({ where: { ocorrencia: { obrigacaoId: { in: obrIds } } } }).catch(() => {})
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.fatura.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.cobranca.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obrIds } } }).catch(() => {})
  await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: recIds } } }).catch(() => {})
}

let PROC = 0
let seq = 0
async function seed(valor: number): Promise<{ receitaId: number; obrigacaoId: number }> {
  seq++
  const rec = await prisma.receita.create({ data: {
    codigo: `EX-${CFG}-${seq}-${Date.now() % 100000}`, processoId: PROC, categoria: 'HONORARIOS' as never, descricao: `Exclusão — item ${seq}`,
    moeda: 'BRL' as never, valor, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor, fxEstimado: 1, fxRule: 'VARIAVEL' as never,
    nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal', status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA',
    configFinanceiraId: CFG, phaseKey: 'GENEALOGIA', phaseCycle: 1,
    requerentes: { create: { idx: 0, nome: `Requerente ${seq}` } },
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: valor, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC, valorTotal: valor, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, receitaId: rec.id, numero: 1, vencimento: new Date('2026-08-01'), valor, status: 'PENDENTE' } })
  return { receitaId: rec.id, obrigacaoId }
}
const ledgerCount = async (obrigacaoId: number) => prisma.ledgerEntry.count({ where: { obrigacaoId } })

async function main() {
  console.log('excluir-receita — persistência real\n')
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-EXCLUIR-RECEITA' } }).catch(() => {})
  PROC = (await prisma.processo.create({ data: { nome: 'TESTE-EXCLUIR-RECEITA', pais: 'Alemanha' } })).id

  // ── 1 · bloqueia quando há pagamento (motivo explícito) ──
  sec('Bloqueio por pagamento')
  {
    const a = await seed(1000)
    await registrarOcorrencia({ obrigacaoId: a.obrigacaoId, tipo: 'PAGAMENTO', valor: 400, moeda: 'BRL' })
    const chk = await podeExcluir(String(a.obrigacaoId))
    ok(!chk.permitido, 'podeExcluir=false quando há pagamento')
    ok(/pagamento/i.test(chk.motivos.join(' ')) && /consolidado|caixa|liquid/i.test(chk.motivos.join(' ')), 'motivos explícitos: pagamento + lançamento consolidado')
    let bloqueou = false
    try { await excluirReceita(String(a.obrigacaoId)) } catch (e) { bloqueou = e instanceof AcaoReceitaError && e.status === 422 }
    ok(bloqueou, 'excluirReceita lança 422 com pagamento')
    const rec = await prisma.receita.findUnique({ where: { id: a.receitaId }, select: { arquivadaEm: true } })
    ok(rec?.arquivadaEm == null, 'não excluiu (arquivadaEm intacto)')
  }

  // ── 2 · bloqueia com documento fiscal (Fatura emitida) ──
  sec('Bloqueio por documento fiscal')
  {
    const b = await seed(500)
    await prisma.fatura.create({ data: { processoId: PROC, receitaId: b.receitaId, descricao: 'Fatura', valor: 500, moeda: 'BRL' as never } })
    const chk = await podeExcluir(String(b.obrigacaoId))
    ok(!chk.permitido && /fiscal|fatura|recibo/i.test(chk.motivos.join(' ')), 'bloqueado por documento fiscal')
  }

  // ── 3 · permite quando zerada; exclusão LÓGICA (Ledger preservado) ──
  sec('Exclusão permitida (zerada) e lógica')
  {
    const c = await seed(800)
    const antesLedger = await ledgerCount(c.obrigacaoId)
    ok(antesLedger > 0, 'setup: há entries no Ledger')
    const chk = await podeExcluir(String(c.obrigacaoId))
    ok(chk.permitido, 'podeExcluir=true quando zerada (sem pagamento/fatura)')
    const r = await excluirReceita(String(c.obrigacaoId), { motivo: 'lançamento errado' })
    ok(r.excluida, 'excluída (lógica)')
    const depoisLedger = await ledgerCount(c.obrigacaoId)
    ok(depoisLedger === antesLedger, 'LEDGER PRESERVADO (nenhum entry apagado)')
    const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: c.obrigacaoId } })
    ok(proj != null, 'SaldoProjecao preservado')
    const rec = await prisma.receita.findUnique({ where: { id: c.receitaId }, select: { arquivadaEm: true, contextoAplicado: true } })
    const ctx = rec?.contextoAplicado as Record<string, unknown> | null
    ok(rec?.arquivadaEm != null, 'exclusão lógica: oculta (arquivadaEm setado)')
    ok(ctx != null && typeof ctx.exclusao === 'object' && ctx.exclusao != null, 'marcador contextoAplicado.exclusao gravado')
    const ev = await prisma.eventoFinanceiro.findFirst({ where: { receitaId: c.receitaId, tipo: 'CANCELAMENTO' } })
    ok(ev != null && /exclu/i.test(ev!.descricao), 'auditoria da exclusão registrada')
  }

  // ── 4 · bloqueia por obrigação legal (marcador no contexto) ──
  sec('Bloqueio por obrigação legal')
  {
    const d = await seed(300)
    await prisma.receita.update({ where: { id: d.receitaId }, data: { contextoAplicado: { obrigacaoLegal: true } } })
    const chk = await podeExcluir(String(d.obrigacaoId))
    ok(!chk.permitido && /legal/i.test(chk.motivos.join(' ')), 'bloqueado por obrigação legal')
  }

  console.log(`\n${passed} passaram, ${failed} falharam`)
  await limpar()
  await prisma.processo.deleteMany({ where: { nome: 'TESTE-EXCLUIR-RECEITA' } }).catch(() => {})
  await prisma.$disconnect()
  if (failed) { console.log('Falhas:', falhas.join(' | ')); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
