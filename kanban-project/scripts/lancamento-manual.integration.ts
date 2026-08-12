// scripts/lancamento-manual.integration.ts
// Teste de INTEGRAÇÃO (banco real) do lançamento manual de Receita/Custo.
// Semeia dados mínimos e roda os cenários da spec, conferindo que os lançamentos
// aparecem em Receitas / Custos / Extrato·Timeline / merge da Visão Geral, com
// rateio, pagamento e SEM duplicação em releitura.
import { prisma } from '@/lib/prisma'
import { criarLancamentoManual } from '@/lib/financeiro/extras/lancamento-manual'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'
import { carregarPosicaoProcesso } from '@/lib/financeiro/leitura/posicao-processo'
import { resolverPrecoPorConfigDB } from '@/src/lib/motor/resolver-preco-financeiro.prisma'
import { cancelarObrigacao } from '@/lib/financeiro/extras/cancelar-lancamento'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n} ${extra}`) } }
const round2 = (v: number) => Math.round(v * 100) / 100

async function limpar() {
  // Ordem: filhos → pais. Banco de teste dedicado.
  await prisma.ledgerEntry.deleteMany({})
  await prisma.saldoProjecao.deleteMany({})
  await prisma.ocorrenciaFinanceira.deleteMany({})
  await prisma.participacaoEconomica.deleteMany({})
  await prisma.distribuicaoEconomica.deleteMany({})
  await prisma.ledgerFinanceiro.deleteMany({})
  await prisma.domainOutbox.deleteMany({})
  await prisma.obrigacaoEconomica.deleteMany({})
  await prisma.tabelaValor.deleteMany({})
  await prisma.produtoFinanceiro.deleteMany({})
  await prisma.processoRequerente.deleteMany({})
  await prisma.requerente.deleteMany({})
  await prisma.pessoa.deleteMany({})
  await prisma.processo.deleteMany({})
  await prisma.fornecedor.deleteMany({})
  await prisma.itemCatalogo.deleteMany({})
}

async function seed() {
  const proc = await prisma.processo.create({ data: { nome: 'Processo Teste', pais: 'IT' } })
  const forn = await prisma.fornecedor.create({ data: { nome: 'Cartório XYZ', tipo: 'PJ' } })

  // 3 pessoas + requerentes vinculados
  const pessoas = [] as { id: number }[]
  const requerentes = [] as { id: number; personId: number }[]
  for (const nome of ['Ana', 'Bruno', 'Carla']) {
    const pes = await prisma.pessoa.create({ data: { nome } })
    const req = await prisma.requerente.create({ data: { nome, personId: pes.id } })
    await prisma.processoRequerente.create({ data: { processoId: proc.id, requerenteId: req.id } })
    pessoas.push(pes); requerentes.push({ id: req.id, personId: pes.id })
  }

  // itens do Catálogo Mestre + config financeira + preço (Tabela de Valor)
  async function item(name: string, natureza: any, valor: number, moeda: any) {
    const it = await prisma.itemCatalogo.create({ data: { code: `IT_${name.replace(/\W/g, '_')}_${Math.floor(valor)}`, name, natureza } })
    const cfg = await prisma.produtoFinanceiro.create({ data: { codigo: `CFG_${it.id}`, nome: name, itemCatalogoId: it.id, moedaPadrao: moeda, valorPadrao: valor } })
    // preço VENDA e CUSTO
    for (const nat of ['VENDA', 'CUSTO'] as const) {
      await prisma.tabelaValor.create({ data: { name: `${name} ${nat}`, configuracaoFinanceiraItemId: cfg.id, valor, moeda, natureza: nat, modoCalculo: 'fixed' } })
    }
    return { it, cfg }
  }
  const servico = await item('Assessoria', 'SERVICO', 1000, 'BRL')
  const documento = await item('Certidão Nascimento', 'DOCUMENTO', 300, 'EUR')
  const taxa = await item('Taxa Consular', 'TAXA', 150, 'BRL')

  return { proc, forn, requerentes, servico, documento, taxa }
}

async function main() {
  console.log('\n=== Lançamento manual — integração (banco real) ===')
  await limpar()
  const { proc, forn, requerentes, servico, documento, taxa } = await seed()
  const [ana, bruno, carla] = requerentes

  // ---- Auto-preenchimento (item-config usa resolverPrecoPorConfigDB) ----
  console.log('\nAuto-preenchimento do item (Tabela de Preços por config)')
  const precoServ = await resolverPrecoPorConfigDB(servico.cfg.id, { natureza: 'VENDA' as any, processoId: proc.id, quantidade: 1 })
  ok('preço de venda do serviço resolve = 1000 BRL', precoServ.ok && precoServ.valorUnitario === 1000 && String(precoServ.moeda) === 'BRL', JSON.stringify(precoServ).slice(0, 120))
  const precoDoc = await resolverPrecoPorConfigDB(documento.cfg.id, { natureza: 'CUSTO' as any, processoId: proc.id, quantidade: 1 })
  ok('preço de custo do documento resolve = 300 EUR', precoDoc.ok && precoDoc.valorUnitario === 300 && String(precoDoc.moeda) === 'EUR')

  // ================= CENÁRIOS RECEITA =================
  console.log('\nReceitas')
  // 1) receita de serviço para UM requerente
  const r1 = await criarLancamentoManual({ natureza: 'RECEITA', processoId: proc.id, itemCatalogoId: servico.it.id, valorUnitario: 1000, moeda: 'BRL', rateio: { modo: 'IGUAL', participantes: [{ pessoaId: ana.personId, incluido: true }] } })
  ok('R1 criada (serviço, 1 requerente)', !!r1.obrigacaoId && r1.total === 1000)

  // 2) receita de documento para VÁRIOS requerentes (rateio igual)
  const r2 = await criarLancamentoManual({ natureza: 'RECEITA', processoId: proc.id, itemCatalogoId: documento.it.id, quantidade: 2, valorUnitario: 300, moeda: 'EUR', rateio: { modo: 'IGUAL', participantes: [{ pessoaId: ana.personId }, { pessoaId: bruno.personId }, { pessoaId: carla.personId }] } })
  ok('R2 criada (documento, 3 requerentes, total 600 EUR)', r2.total === 600)

  // 3) receita vinculada ao PROCESSO inteiro (sem rateio)
  const r3 = await criarLancamentoManual({ natureza: 'RECEITA', processoId: proc.id, itemCatalogoId: taxa.it.id, valorUnitario: 150, moeda: 'BRL', desconto: 50 })
  ok('R3 criada (processo inteiro, total 100 BRL após desconto)', r3.total === 100)

  // rateio por PERCENTUAL válido
  const r4 = await criarLancamentoManual({ natureza: 'RECEITA', processoId: proc.id, itemCatalogoId: servico.it.id, valorUnitario: 1000, moeda: 'BRL', rateio: { modo: 'PERCENTUAL', participantes: [{ pessoaId: ana.personId, percentual: 70 }, { pessoaId: bruno.personId, percentual: 30 }] } })
  const distR4 = await prisma.participacaoEconomica.findMany({ where: { distribuicao: { obrigacaoId: r4.obrigacaoId } }, orderBy: { ordem: 'asc' } })
  ok('R4 rateio 70/30 → cotas 700 e 300', distR4.length === 2 && Number(distR4[0].valor) === 700 && Number(distR4[1].valor) === 300, JSON.stringify(distR4.map(d => Number(d.valor))))

  // rateio percentual INVÁLIDO (soma != 100) deve FALHAR
  let falhouRateio = false
  try { await criarLancamentoManual({ natureza: 'RECEITA', processoId: proc.id, itemCatalogoId: servico.it.id, valorUnitario: 1000, rateio: { modo: 'PERCENTUAL', participantes: [{ pessoaId: ana.personId, percentual: 40 }, { pessoaId: bruno.personId, percentual: 40 }] } }) } catch { falhouRateio = true }
  ok('rateio percentual inválido (80%) é REJEITADO', falhouRateio)

  // ================= CENÁRIOS CUSTO =================
  console.log('\nCustos')
  // 1) custo de serviço vinculado ao processo
  const c1 = await criarLancamentoManual({ natureza: 'CUSTO', processoId: proc.id, itemCatalogoId: servico.it.id, valorUnitario: 400, moeda: 'BRL' })
  ok('C1 criado (serviço, processo)', c1.total === 400)
  // 2) custo documental para UM requerente
  const c2 = await criarLancamentoManual({ natureza: 'CUSTO', processoId: proc.id, itemCatalogoId: documento.it.id, valorUnitario: 300, moeda: 'EUR', rateio: { modo: 'IGUAL', participantes: [{ pessoaId: carla.personId }] } })
  ok('C2 criado (documento, 1 requerente)', c2.total === 300)
  // 3) custo rateado entre vários requerentes (por VALOR)
  const c3 = await criarLancamentoManual({ natureza: 'CUSTO', processoId: proc.id, itemCatalogoId: taxa.it.id, valorUnitario: 300, moeda: 'BRL', rateio: { modo: 'VALOR', participantes: [{ pessoaId: ana.personId, valor: 100 }, { pessoaId: bruno.personId, valor: 200 }] } })
  const distC3 = await prisma.participacaoEconomica.findMany({ where: { distribuicao: { obrigacaoId: c3.obrigacaoId } }, orderBy: { ordem: 'asc' } })
  ok('C3 rateio por valor 100/200', distC3.length === 2 && Number(distC3[0].valor) === 100 && Number(distC3[1].valor) === 200)
  // 4) custo com fornecedor + acréscimo
  const c4 = await criarLancamentoManual({ natureza: 'CUSTO', processoId: proc.id, itemCatalogoId: documento.it.id, valorUnitario: 300, moeda: 'EUR', acrescimo: 20, fornecedorId: forn.id })
  ok('C4 criado (fornecedor + acréscimo, total 320)', c4.total === 320)
  const c4obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: c4.obrigacaoId } })
  ok('C4 observação registra fornecedor (auditoria/manual)', !!c4obr?.observacoes?.includes('Cartório XYZ') && c4obr!.observacoes!.includes('manual'))
  ok('C4 fornecedor vinculado ESTRUTURALMENTE (fornecedorId)', c4obr?.fornecedorId === forn.id, `fornecedorId=${c4obr?.fornecedorId}`)
  // 5) custo + registrar pagamento (BAIXA de pagável) → saldo 0 / pago = total
  const c5 = await criarLancamentoManual({ natureza: 'CUSTO', processoId: proc.id, itemCatalogoId: taxa.it.id, valorUnitario: 250, moeda: 'BRL', pagamento: { observacao: 'pago' } })
  const projC5 = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: c5.obrigacaoId } })
  ok('C5 custo COM baixa → saldo 0 / pago 250', !!projC5 && round2(Number(projC5.saldo)) === 0 && round2(Number(projC5.recebidoBruto)) === 250, JSON.stringify(projC5))
  // custo SEM pagamento mantém saldo a pagar = contratado (projeção pagável correta)
  const c6 = await criarLancamentoManual({ natureza: 'CUSTO', processoId: proc.id, itemCatalogoId: servico.it.id, valorUnitario: 500, moeda: 'BRL' })
  const projC6 = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: c6.obrigacaoId } })
  ok('C6 custo SEM baixa → saldo a pagar 500 / pago 0', !!projC6 && round2(Number(projC6.saldo)) === 500 && round2(Number(projC6.recebidoBruto)) === 0, JSON.stringify(projC6))

  // Receita COM pagamento imediato → saldo 0 / recebido = total (recebível funciona)
  const rp = await criarLancamentoManual({ natureza: 'RECEITA', processoId: proc.id, itemCatalogoId: taxa.it.id, valorUnitario: 200, moeda: 'BRL', pagamento: { observacao: 'recebido' } })
  const projRP = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: rp.obrigacaoId } })
  ok('Receita COM pagamento → saldo 0 / recebido 200', !!projRP && round2(Number(projRP.saldo)) === 0 && round2(Number(projRP.recebidoBruto)) === 200, JSON.stringify(projRP))

  // ================= APARECE EM CADA ABA =================
  console.log('\nVisibilidade nas abas')
  const receitasAba = await listarReceitas(proc.id)
  ok('Aba Receitas mostra as 5 receitas', receitasAba.receitas.length === 5, `n=${receitasAba.receitas.length}`)
  // ESPELHO DO CADASTRO MESTRE: serviço/descrição vêm do ItemCatalogo, não do legado.
  const r1obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: r1.obrigacaoId } })
  ok('receita guarda itemCatalogoId ESTRUTURAL (Cadastro Mestre)', r1obr?.itemCatalogoId === servico.it.id, `itemCatalogoId=${r1obr?.itemCatalogoId}`)
  const linhaR1 = receitasAba.receitas.find((x: any) => x.obrigacaoId === r1.obrigacaoId)
  ok('aba Receitas rotula SERVIÇO com o item do Mestre ("Assessoria")', linhaR1?.servico === 'Assessoria', `servico=${linhaR1?.servico}`)
  const custoItens = await listarObrigacoes({ processoId: proc.id, natureza: 'CUSTO' })
  const c1linha = custoItens.find((x: any) => x.obrigacaoId === c1.obrigacaoId)
  ok('aba Custos rotula DESCRIÇÃO com o item do Mestre (não a observação)', c1linha?.descricao === 'Assessoria', `descricao=${c1linha?.descricao}`)
  const custosAba = await listarObrigacoes({ processoId: proc.id, natureza: 'CUSTO' })
  ok('Aba Custos mostra os 6 custos', custosAba.length === 6, `n=${custosAba.length}`)
  const pos = await carregarPosicaoProcesso(proc.id)
  const totalTimeline = (pos?.obrigacoes ?? []).reduce((s: number, o: any) => s + (o.timeline?.length ?? 0), 0)
  ok('Extrato/Timeline tem eventos de todas as 11 obrigações', (pos?.obrigacoes?.length ?? 0) === 11 && totalTimeline >= 11, `obrs=${pos?.obrigacoes?.length} eventos=${totalTimeline}`)
  ok('Visão Geral "Recebido" NÃO mistura baixa de custo (só recebível)', round2(pos.totais.recebido) === 200, `recebido=${pos.totais.recebido}`)
  const nativosReceita = await listarObrigacoes({ processoId: proc.id, natureza: 'RECEITA', origemTipo: 'nativo' })
  const nativosCusto = await listarObrigacoes({ processoId: proc.id, natureza: 'CUSTO', origemTipo: 'nativo' })
  ok('Merge Visão Geral: 5 receitas + 6 custos nativos', nativosReceita.length === 5 && nativosCusto.length === 6, `${nativosReceita.length}/${nativosCusto.length}`)

  // ================= NÃO DUPLICA EM RELEITURA =================
  console.log('\nIdempotência de leitura (reload)')
  const releitura1 = await listarObrigacoes({ processoId: proc.id })
  const releitura2 = await listarObrigacoes({ processoId: proc.id })
  ok('reload não duplica (11 obrigações estáveis)', releitura1.length === 11 && releitura2.length === 11, `${releitura1.length}/${releitura2.length}`)
  const totalObrDB = await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } })
  ok('total no banco = 11 (nenhuma duplicata)', totalObrDB === 11, `db=${totalObrDB}`)

  // ================= CANCELAMENTO AUDITÁVEL =================
  console.log('\nCancelamento (estorno auditável, sem apagar histórico)')
  await cancelarObrigacao({ obrigacaoId: r1.obrigacaoId, motivo: 'teste' })
  await cancelarObrigacao({ obrigacaoId: c1.obrigacaoId, motivo: 'teste' })
  const r1cancel = await prisma.obrigacaoEconomica.findUnique({ where: { id: r1.obrigacaoId } })
  const projR1c = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: r1.obrigacaoId } })
  ok('receita cancelada → status CANCELADO + saldo 0', r1cancel?.status === 'CANCELADO' && round2(Number(projR1c?.saldo)) === 0, `status=${r1cancel?.status} saldo=${projR1c?.saldo}`)
  const recAposCancel = await listarReceitas(proc.id)
  ok('receita cancelada some da aba Receitas (4 restantes)', recAposCancel.receitas.length === 4, `n=${recAposCancel.receitas.length}`)
  const custAposCancel = await listarObrigacoes({ processoId: proc.id, natureza: 'CUSTO' })
  ok('custo cancelado some da aba Custos (5 restantes)', custAposCancel.length === 5, `n=${custAposCancel.length}`)
  const histPreservado = await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } })
  ok('histórico preservado no banco (11 obrigações, nada apagado)', histPreservado === 11, `db=${histPreservado}`)
  const posComCancel = await carregarPosicaoProcesso(proc.id)
  ok('cancelados continuam no Extrato/Timeline (11 obrigações)', (posComCancel?.obrigacoes?.length ?? 0) === 11)
  let idempotente = false
  const rc2 = await cancelarObrigacao({ obrigacaoId: r1.obrigacaoId, motivo: 'de novo' })
  idempotente = rc2.jaCancelada === true
  ok('cancelar de novo é idempotente (jaCancelada=true)', idempotente)

  // ================= TIMELINE MARCA MANUAL =================
  const posFinal = await carregarPosicaoProcesso(proc.id)
  const algumManual = (posFinal?.obrigacoes ?? []).some((o: any) => (o.timeline ?? []).some((t: any) => t.manual === true))
  const todosManuais = (posFinal?.obrigacoes ?? []).every((o: any) => (o.timeline ?? []).every((t: any) => t.manual === true))
  ok('Timeline marca lançamento como manual (origemTipo=nativo)', algumManual && todosManuais)

  console.log(`\n=== RESULTADO: ${passou} passou, ${falhou} falhou ===\n`)
  await prisma.$disconnect()
  process.exit(falhou === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
