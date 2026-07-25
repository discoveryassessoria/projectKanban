// scripts/int-p0-motor-db.test.ts
// P0 do motor: idempotência/concorrência de estorno · atomicidade multi-forma ·
// timeline in-tx · revogação de crédito no estorno. Precisa do Postgres de teste.
// Env: DATABASE_URL/PRISMA_DATABASE_URL + FINANCEIRO_V3_*. Roda: npx tsx scripts/int-p0-motor-db.test.ts
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { registrarPagamentoComposto } from '@/lib/financeiro/pagamentos/registrar-pagamento-composto'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'

let passed = 0, failed = 0
const ok = (cond: boolean, nome: string) => { if (cond) { passed++; console.log(`  ✅ ${nome}`) } else { failed++; console.log(`  ❌ ${nome}`) } }
const near = (a: number, b: number) => Math.abs(a - b) < 0.02
const CFG = 9500

async function limpar() {
  const recs = await prisma.receita.findMany({ where: { configFinanceiraId: CFG }, select: { id: true } })
  const recIds = recs.map((r) => r.id)
  const obrs = await prisma.obrigacaoEconomica.findMany({ where: { origemTipo: 'Receita', origemId: { in: recIds } }, select: { id: true } })
  const obrIds = obrs.map((o) => o.id)
  const creds = await prisma.creditoFinanceiro.findMany({ where: { obrigacaoId: { in: obrIds } }, select: { id: true } })
  await prisma.creditoMovimento.deleteMany({ where: { creditoId: { in: creds.map((c) => c.id) } } }).catch(() => {})
  await prisma.aplicacaoFinanceira.deleteMany({ where: { ocorrencia: { obrigacaoId: { in: obrIds } } } }).catch(() => {})
  await prisma.ledgerEntry.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.creditoFinanceiro.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: { in: obrIds } } }).catch(() => {})
  await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.cobranca.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.obrigacaoEconomica.deleteMany({ where: { id: { in: obrIds } } }).catch(() => {})
  await prisma.receitaRequerente.deleteMany({ where: { receitaId: { in: recIds } } }).catch(() => {})
  await prisma.receita.deleteMany({ where: { id: { in: recIds } } }).catch(() => {})
}

let seq = 0
let PROC = 0
async function seed(valor: number) {
  seq++
  const rec = await prisma.receita.create({ data: {
    codigo: `P0-${CFG}-${seq}-${Math.floor(valor)}`, processoId: PROC, categoria: 'HONORARIOS' as never,
    descricao: `P0 teste ${seq}`, moeda: 'BRL' as never, valor, valorUnitario: valor, quantidade: 1, valorTotalCongelado: valor,
    fxEstimado: 1, fxRule: 'VARIAVEL' as never, nParcelas: 1, data1: new Date('2026-07-01'), periodicidade: 'Mensal',
    status: 'ATIVA' as never, origem: 'motor', origemLancamento: 'PROCESSO', naturezaLancamento: 'RECEITA', configFinanceiraId: CFG,
  } })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: valor, moedaContratual: 'BRL', codigoOperacional: rec.codigo, processoId: PROC, origemTipo: 'Receita', origemId: rec.id })
  const cob = await prisma.cobranca.create({ data: { receitaId: rec.id, processoId: PROC, valorTotal: valor, moeda: 'BRL' as never, status: 'ABERTA', obrigacaoId } })
  await prisma.parcelaFinanceira.create({ data: { cobrancaId: cob.id, numero: 1, vencimento: new Date('2026-08-01'), valor, status: 'PENDENTE' } })
  return { receitaId: rec.id, obrigacaoId }
}
const saldoDe = async (obrigacaoId: number) => { const p = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } }); return p ? Number(p.saldo) : NaN }
const pagamentoOcId = async (obrigacaoId: number) => { const o = await prisma.ocorrenciaFinanceira.findFirst({ where: { obrigacaoId, tipo: 'PAGAMENTO', status: 'PROCESSADA' }, orderBy: { id: 'desc' } }); return o?.id ?? 0 }
const pagar = (obrigacaoId: number, valor: number, key: string, extra: any = {}) => registrarPagamentoComposto({ obrigacaoId, formas: [{ formaPagamentoId: 1, valor, contaId: 1 }], idempotencyKey: key, ...extra })

async function main() {
  const proc = await prisma.processo.findFirst({ select: { id: true } })
  if (!proc) { console.error('sem processo no DB de teste'); process.exit(1) }
  PROC = proc.id
  await limpar()

  // ── 1) DOIS estornos SIMULTÂNEOS do mesmo pagamento → só um estorna, sem reversão em dobro
  {
    const { obrigacaoId } = await seed(1000)
    await pagar(obrigacaoId, 1000, 'k1')
    const pagId = await pagamentoOcId(obrigacaoId)
    const est = (kk: string) => registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 1000, estornaOcorrenciaId: pagId, idempotencyKey: kk })
    const rs = await Promise.allSettled([est('e1'), est('e2')])
    const fulfilled = rs.filter((r) => r.status === 'fulfilled').length
    const estornosProc = await prisma.ocorrenciaFinanceira.count({ where: { estornaId: pagId, tipo: 'ESTORNO', status: 'PROCESSADA' } })
    const saldo = await saldoDe(obrigacaoId)
    ok(estornosProc === 1, `estorno concorrente: exatamente 1 estorno PROCESSADA (obtido ${estornosProc}, fulfilled ${fulfilled})`)
    ok(near(saldo, 1000), `estorno concorrente: saldo revertido UMA vez = 1000 (obtido ${saldo}, não 0 nem 2000)`)
  }

  // ── 2) retry com a MESMA idempotency key → mesmo resultado, sem nova mutação
  {
    const { obrigacaoId } = await seed(1000)
    await pagar(obrigacaoId, 1000, 'k2')
    const pagId = await pagamentoOcId(obrigacaoId)
    const r1 = await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 400, estornaOcorrenciaId: pagId, idempotencyKey: 'same-key' }) as any
    const r2 = await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 400, estornaOcorrenciaId: pagId, idempotencyKey: 'same-key' }) as any
    const nEstornos = await prisma.ocorrenciaFinanceira.count({ where: { estornaId: pagId, tipo: 'ESTORNO' } })
    ok(r2?.idempotente === true && r1?.ocorrenciaId === r2?.ocorrenciaId, 'retry mesma key: mesmo ocorrenciaId, marcado idempotente')
    ok(nEstornos === 1, `retry mesma key: NÃO cria segundo estorno (obtido ${nEstornos})`)
  }

  // ── 3) retry com chave DIFERENTE após estorno concluído → rejeitado (excede restante)
  {
    const { obrigacaoId } = await seed(1000)
    await pagar(obrigacaoId, 1000, 'k3')
    const pagId = await pagamentoOcId(obrigacaoId)
    await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 1000, estornaOcorrenciaId: pagId, idempotencyKey: 'e3a' })
    let rejeitou = false
    try { await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 1000, estornaOcorrenciaId: pagId, idempotencyKey: 'e3b' }) } catch { rejeitou = true }
    ok(rejeitou, 'estorno após total (chave nova): rejeitado por exceder o restante')
  }

  // ── 4) estorno MAIOR que o pago → rejeitado
  {
    const { obrigacaoId } = await seed(500)
    await pagar(obrigacaoId, 500, 'k4')
    const pagId = await pagamentoOcId(obrigacaoId)
    let rejeitou = false
    try { await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 800, estornaOcorrenciaId: pagId, idempotencyKey: 'e4' }) } catch { rejeitou = true }
    ok(rejeitou, 'estorno > pago: rejeitado')
  }

  // ── 5) estorno PARCIAL concorrente (2×600 sobre pago 1000) → soma nunca excede 1000
  {
    const { obrigacaoId } = await seed(1000)
    await pagar(obrigacaoId, 1000, 'k5')
    const pagId = await pagamentoOcId(obrigacaoId)
    const est = (kk: string) => registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 600, estornaOcorrenciaId: pagId, idempotencyKey: kk })
    await Promise.allSettled([est('e5a'), est('e5b')])
    const somaEst = await prisma.ocorrenciaFinanceira.aggregate({ where: { estornaId: pagId, tipo: 'ESTORNO', status: 'PROCESSADA' }, _sum: { valor: true } })
    const total = Number(somaEst._sum.valor ?? 0)
    ok(total <= 1000.01, `estorno parcial concorrente: Σ estornado ≤ pago (obtido ${total})`)
  }

  // ── 6) pagamento MULTI-FORMA bem-sucedido → todas aplicam, saldo 0
  {
    const { obrigacaoId } = await seed(1000)
    const r = await registrarPagamentoComposto({ obrigacaoId, formas: [{ formaPagamentoId: 1, valor: 400, contaId: 1 }, { formaPagamentoId: 2, valor: 600, contaId: 1 }], idempotencyKey: 'k6' })
    const nOc = await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId, tipo: 'PAGAMENTO', status: 'PROCESSADA' } })
    ok(r.ok && nOc === 2 && near(await saldoDe(obrigacaoId), 0), `multi-forma OK: 2 ocorrências, saldo 0 (oc ${nOc})`)
  }

  // ── 7) multi-forma com FALHA DB-level no meio da transação → ROLLBACK integral
  // Pré-insere a cobrança de saldo que o passo 6 vai tentar criar (idempotencyKey @unique):
  // a violação de unicidade estoura DENTRO da transação, DEPOIS das ocorrências de pagamento.
  {
    const { obrigacaoId, receitaId } = await seed(1000)
    const correl = `pg:${obrigacaoId}:k7`
    await prisma.cobranca.create({ data: { receitaId, processoId: PROC, valorTotal: 1, moeda: 'BRL' as never, status: 'ABERTA', idempotencyKey: `${correl}:saldo`.slice(0, 80) } })
    let throwed = false
    try {
      await registrarPagamentoComposto({ obrigacaoId, formas: [{ formaPagamentoId: 1, valor: 400, contaId: 1 }, { formaPagamentoId: 2, valor: 200, contaId: 1 }], parcialTratamento: 'GERAR_COBRANCA', idempotencyKey: 'k7' })
    } catch { throwed = true }
    const nOc = await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId, tipo: 'PAGAMENTO' } })
    const saldo = await saldoDe(obrigacaoId)
    ok(throwed, 'multi-forma falha DB no passo 6: transação lançou erro')
    ok(nOc === 0, `multi-forma falha: ROLLBACK integral das 2 formas, 0 ocorrências de PAGAMENTO (obtido ${nOc})`)
    ok(near(saldo, 1000), `multi-forma falha: saldo intacto = 1000 (obtido ${saldo})`)
  }

  // ── 8) timeline gravada na MESMA transação (sucesso) — evento existe após pagamento
  {
    const { obrigacaoId, receitaId } = await seed(1000)
    await pagar(obrigacaoId, 1000, 'k8')
    const evt = await prisma.eventoFinanceiro.count({ where: { receitaId, tipo: 'PAGAMENTO' } })
    ok(evt >= 1, `timeline in-tx: EventoFinanceiro de pagamento gravado (obtido ${evt})`)
  }

  // ── 9) estorno de pagamento com crédito de excedente NÃO utilizado → crédito REVOGADO
  {
    const { obrigacaoId } = await seed(1000)
    await pagar(obrigacaoId, 1200, 'k9') // paga 1200 sobre 1000 → excedente 200 vira crédito
    const pagId = await pagamentoOcId(obrigacaoId)
    const credAntes = await prisma.creditoFinanceiro.findFirst({ where: { origemOcorrenciaId: pagId } })
    await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 1200, estornaOcorrenciaId: pagId, idempotencyKey: 'e9' })
    const credDepois = await prisma.creditoFinanceiro.findUnique({ where: { id: credAntes?.id ?? -1 } })
    const movEstorno = await prisma.creditoMovimento.count({ where: { creditoId: credAntes?.id ?? -1, tipo: 'ESTORNO' } })
    ok(credAntes != null && near(Number(credAntes.valor), 200), `crédito excedente gerado = 200 (obtido ${credAntes ? Number(credAntes.valor) : 'null'})`)
    ok(credDepois != null && near(Number(credDepois.valor), 0) && movEstorno === 1, `estorno revoga crédito não usado → saldo 0 + movimento ESTORNO (valor ${credDepois ? Number(credDepois.valor) : 'null'}, mov ${movEstorno})`)
  }

  // ── 10) estorno de pagamento com crédito PARCIALMENTE utilizado → BLOQUEADO
  {
    const a = await seed(1000)
    await pagar(a.obrigacaoId, 1200, 'k10') // excedente 200 → crédito
    const pagId = await pagamentoOcId(a.obrigacaoId)
    // consome 120 do crédito num OUTRO pagamento (mesma obrigação, cria saldo? já quitado) → usa outra obrigação do MESMO processo
    // simplificação: consome direto reduzindo o crédito para simular uso parcial
    const cred = await prisma.creditoFinanceiro.findFirst({ where: { origemOcorrenciaId: pagId } })
    if (cred) { await prisma.creditoFinanceiro.update({ where: { id: cred.id }, data: { valor: 80 } }); await prisma.creditoMovimento.create({ data: { creditoId: cred.id, tipo: 'UTILIZACAO', valor: 120, saldoAnterior: 200, saldoPosterior: 80, moeda: 'BRL' as never, observacao: 'uso parcial (teste)' } }) }
    let bloqueou = false
    try { await registrarOcorrencia({ obrigacaoId: a.obrigacaoId, tipo: 'ESTORNO', valor: 1200, estornaOcorrenciaId: pagId, idempotencyKey: 'e10' }) } catch { bloqueou = true }
    ok(bloqueou, 'estorno com crédito parcialmente usado: BLOQUEADO (evita benefício duplicado)')
  }

  // ── 11) estorno de pagamento com crédito TOTALMENTE utilizado → BLOQUEADO
  {
    const a = await seed(1000)
    await pagar(a.obrigacaoId, 1200, 'k11')
    const pagId = await pagamentoOcId(a.obrigacaoId)
    const cred = await prisma.creditoFinanceiro.findFirst({ where: { origemOcorrenciaId: pagId } })
    if (cred) { await prisma.creditoFinanceiro.update({ where: { id: cred.id }, data: { valor: 0, status: 'UTILIZADO' } }); await prisma.creditoMovimento.create({ data: { creditoId: cred.id, tipo: 'UTILIZACAO', valor: 200, saldoAnterior: 200, saldoPosterior: 0, moeda: 'BRL' as never, observacao: 'uso total (teste)' } }) }
    let bloqueou = false
    try { await registrarOcorrencia({ obrigacaoId: a.obrigacaoId, tipo: 'ESTORNO', valor: 1200, estornaOcorrenciaId: pagId, idempotencyKey: 'e11' }) } catch { bloqueou = true }
    ok(bloqueou, 'estorno com crédito totalmente usado: BLOQUEADO')
  }

  // ── 12) consistência do razão: recebido + saldo = contratado após estorno total
  {
    const { obrigacaoId } = await seed(1000)
    await pagar(obrigacaoId, 1000, 'k12')
    const pagId = await pagamentoOcId(obrigacaoId)
    await registrarOcorrencia({ obrigacaoId, tipo: 'ESTORNO', valor: 1000, estornaOcorrenciaId: pagId, idempotencyKey: 'e12' })
    const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } })
    const receb = proj ? Number(proj.recebidoBruto) : NaN, saldo = proj ? Number(proj.saldo) : NaN
    ok(near(receb, 0) && near(saldo, 1000), `ledger consistente pós-estorno: recebido 0 + saldo 1000 = contratado (receb ${receb}, saldo ${saldo})`)
  }

  await limpar()
  console.log(`\n${failed === 0 ? '✅' : '❌'} int-p0-motor: ${passed} ok, ${failed} falhas`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
