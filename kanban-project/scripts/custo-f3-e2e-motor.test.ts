// F3 — VALIDAÇÃO END-TO-END do fluxo REAL de geração automática de Custo com o motor
// completo (tipoProcessoMotorId + regra de custo por fase + config + preço). Semeia o
// cenário no próprio teste (o DB de teste não tem seed de motor) e valida os 8 itens.
import { prisma } from '@/lib/prisma'
import { reconciliarFinanceiroDaFase } from '@/src/lib/motor/executor'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now(); const PHASE = `F3E2E-${TS % 100000}`

async function main() {
  const PROC = 16
  const procAntes = await prisma.processo.findUnique({ where: { id: PROC }, select: { tipoProcessoMotorId: true } })
  const restoreTipo = procAntes?.tipoProcessoMotorId ?? null
  const tpn = await prisma.tipoProcessoNacionalidade.create({ data: { code: `E2E-TP-${TS % 100000}`, name: 'TP E2E', countryKey: 'xx', countryLabel: 'XX', nationalityKey: 'xx', nationalityLabel: 'XX', modalityKey: 'xx', modalityLabel: 'XX' } as any })
  const TP = tpn.id
  await prisma.processo.update({ where: { id: PROC }, data: { tipoProcessoMotorId: TP } })

  const cfgC = await prisma.produtoFinanceiro.create({ data: { codigo: `E2E-C-${TS % 100000}`, nome: 'Config Custo E2E', possuiCusto: true, possuiReceita: false } as any })
  await prisma.tabelaValor.create({ data: { name: 'E2E preco custo', configuracaoFinanceiraItemId: cfgC.id, natureza: 'CUSTO', moeda: 'BRL', valor: 250 } as any })
  const regraC = await prisma.phaseAutomationRule.create({ data: { tipoProcessoId: TP, phaseKey: PHASE, kind: 'financial', trigger: 'phase_entered', active: true, arquivado: false, configItemId: cfgC.id, aplicacaoFinanceira: 'CUSTO' } as any })

  const custoLegadoAntes = await prisma.custo.count({ where: { processoId: PROC } })

  // ── (1) ENTRADA NA FASE gera ObrigacaoEconomica V3 ──
  const r1 = await reconciliarFinanceiroDaFase(PROC, PHASE)
  const art = await prisma.motorArtefato.findFirst({ where: { processoId: PROC, phaseKey: PHASE, ruleKind: 'financial', status: 'active' }, select: { id: true, targetTable: true, targetId: true } })
  chk(!!art && art.targetTable === 'ObrigacaoEconomica' && art.targetId != null, `(1) MotorArtefato → ObrigacaoEconomica (${art?.targetTable}) criadas=${r1.criadas}`)
  const obrId = art!.targetId!
  const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrId }, select: { natureza: true, direcao: true, status: true, valorContratado: true } })
  chk(obr?.natureza === 'CUSTO' && obr?.direcao === 'A_PAGAR' && Number(obr?.valorContratado) === 250, `(1) obrigação CUSTO/A_PAGAR 250 (${JSON.stringify(obr)})`)

  // ── (2) NENHUM Custo legado novo ──
  chk((await prisma.custo.count({ where: { processoId: PROC } })) === custoLegadoAntes, '(2) tabela Custo legada INALTERADA (nenhum registro novo)')

  // ── (5) Ledger consistente ──
  const lg = await prisma.ledgerFinanceiro.findUnique({ where: { obrigacaoId: obrId } })
  const pj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: obrId } })
  chk(!!lg && !!pj && Number(pj!.saldo) === 250, `(5) Ledger + projeção consistentes (saldo=${pj ? Number(pj.saldo) : '?'})`)

  // ── (6) Auditoria (rastro do motor: MotorArtefato + Outbox obrigacao.criada) ──
  const outbox = await prisma.domainOutbox.findFirst({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrId, tipo: 'financeiro.obrigacao.criada' } })
  chk(!!art && !!outbox, '(6) auditoria registrada (MotorArtefato + DomainOutbox obrigacao.criada)')

  // ── (7) read-model (Dashboard/Central/Financeiro consomem listarObrigacoes) ──
  chk((await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).some((o) => o.obrigacaoId === obrId), '(7) aparece no read-model V3 (fonte de CustosTab/A Pagar/Visão Geral)')

  // ── (3) REABERTURA respeita idempotência (mesma akey, sem ciclo → não recria) ──
  const r2 = await reconciliarFinanceiroDaFase(PROC, PHASE)
  const nObr = await prisma.obrigacaoEconomica.count({ where: { id: obrId } })
  const nArt = await prisma.motorArtefato.count({ where: { processoId: PROC, phaseKey: PHASE, status: 'active' } })
  chk(r2.criadas === 0 && nObr === 1 && nArt === 1, `(3) idempotência: 2ª entrada NÃO recria (criadas=${r2.criadas}, obr=${nObr}, art=${nArt})`)

  // ── (4) RETORNO/política: regra desativada → reconciliação REMOVE o órfão (V3) ──
  await prisma.phaseAutomationRule.update({ where: { id: regraC.id }, data: { active: false } })
  const r3 = await reconciliarFinanceiroDaFase(PROC, PHASE)
  chk(r3.removidas >= 1 && (await prisma.obrigacaoEconomica.findUnique({ where: { id: obrId } })) === null, `(4) regra removida → obrigação órfã REMOVIDA (removidas=${r3.removidas})`)
  chk((await prisma.motorArtefato.findFirst({ where: { id: art!.id }, select: { status: true } }))?.status === 'removed', '(4) MotorArtefato marcado removed')

  // ── (8) REGRESSÃO Receitas: config VENDA ainda cria Receita legada (path intocado) ──
  const cfgR = await prisma.produtoFinanceiro.create({ data: { codigo: `E2E-R-${TS % 100000}`, nome: 'Config Receita E2E', possuiCusto: false, possuiReceita: true } as any })
  await prisma.tabelaValor.create({ data: { name: 'E2E preco venda', configuracaoFinanceiraItemId: cfgR.id, natureza: 'VENDA', moeda: 'BRL', valor: 400 } as any })
  const regraR = await prisma.phaseAutomationRule.create({ data: { tipoProcessoId: TP, phaseKey: PHASE, kind: 'financial', trigger: 'phase_entered', active: true, arquivado: false, configItemId: cfgR.id, aplicacaoFinanceira: 'RECEITA' } as any })
  await reconciliarFinanceiroDaFase(PROC, PHASE)
  const artR = await prisma.motorArtefato.findFirst({ where: { processoId: PROC, phaseKey: PHASE, ruleId: regraR.id, status: 'active' }, select: { targetTable: true, targetId: true } })
  chk(artR?.targetTable === 'Receita' && artR?.targetId != null, `(8) Receita segue LEGADA (targetTable=${artR?.targetTable}) — sem regressão`)

  // ── limpeza (restaura tudo) ──
  const recId = artR?.targetId ?? null
  for (const id of [obrId, ...(await prisma.obrigacaoEconomica.findMany({ where: { processoId: PROC, origemTipo: 'Receita', origemId: recId ?? -1 }, select: { id: true } })).map((o) => o.id)]) {
    await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } }).catch(() => {})
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }
  await prisma.motorArtefato.deleteMany({ where: { processoId: PROC, phaseKey: PHASE } }).catch(() => {})
  if (recId) { await prisma.parcelaFinanceira.deleteMany({ where: { receitaId: recId } }).catch(() => {}); await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: recId } }).catch(() => {}); await prisma.receita.delete({ where: { id: recId } }).catch(() => {}) }
  await prisma.pendenciaFinanceira.deleteMany({ where: { processoId: PROC, phaseKey: PHASE } }).catch(() => {})
  await prisma.phaseAutomationRule.deleteMany({ where: { id: { in: [regraC.id, regraR.id] } } }).catch(() => {})
  await prisma.tabelaValor.deleteMany({ where: { configuracaoFinanceiraItemId: { in: [cfgC.id, cfgR.id] } } }).catch(() => {})
  await prisma.produtoFinanceiro.deleteMany({ where: { id: { in: [cfgC.id, cfgR.id] } } }).catch(() => {})
  await prisma.processo.update({ where: { id: PROC }, data: { tipoProcessoMotorId: restoreTipo } })
  await prisma.tipoProcessoNacionalidade.delete({ where: { id: TP } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
