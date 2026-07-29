// scripts/taxas-encargos.test.ts
// ============================================================================
// Motores de TAXAS (lib/financeiro/taxas-pagamento) e ENCARGOS
// (lib/financeiro/encargos-financeiros). Puros: não precisam de banco.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { calcularTaxas, taxaAplicavel, type TaxaView } from '../lib/financeiro/taxas-pagamento'
import { calcularEncargos, diferencaEmDias } from '../lib/financeiro/encargos-financeiros'

const RAIZ = join(__dirname, '..')
let passou = 0
let falhou = 0
function ok(nome: string, cond: boolean, detalhe = '') {
  if (cond) { passou++; console.log(`  ✓ ${nome}`) }
  else { falhou++; console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }
}
function eq(nome: string, a: unknown, b: unknown) {
  ok(nome, Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`)
}
function secao(t: string) { console.log(`\n${t}`) }

const HOJE = new Date('2026-07-21T12:00:00Z')

// ── TAXAS ───────────────────────────────────────────────────────────────────
secao('Taxa percentual')
{
  const t: TaxaView = { id: 1, nome: 'Cartão', tipo: 'PERCENTUAL', percentual: 3.5, adquirente: 'Stone' }
  const r = calcularTaxas([t], { valorBruto: 1000, nParcelas: 1, emDatas: HOJE })
  eq('valor bruto preservado', r.valorBruto, 1000)
  eq('taxa de 3,5%', r.valorTaxas, 35)
  eq('líquido = bruto − taxa', r.valorLiquido, 965)
  eq('uma linha', r.linhas.length, 1)
  eq('adquirente registrado', r.linhas[0].adquirente, 'Stone')
  ok('memória cita a fórmula', r.memoria.some((m) => m.includes('3.5%')))
}

secao('Taxa fixa e tarifa bancária')
{
  const fixa = calcularTaxas([{ id: 2, nome: 'Tarifa', tipo: 'FIXA', valorFixo: 4.9 }], { valorBruto: 1000, nParcelas: 3, emDatas: HOJE })
  eq('fixa cobrada uma vez', fixa.valorTaxas, 4.9)

  const porParcela = calcularTaxas(
    [{ id: 3, nome: 'Boleto', tipo: 'TARIFA_BANCARIA', valorFixo: 3.5, baseIncidencia: 'PARCELA' }],
    { valorBruto: 900, nParcelas: 3, emDatas: HOJE },
  )
  eq('tarifa por parcela × 3', porParcela.valorTaxas, 10.5)
  eq('líquido desconta as 3 tarifas', porParcela.valorLiquido, 889.5)
}

secao('Taxa por parcela (percentual)')
{
  const r = calcularTaxas(
    [{ id: 4, nome: 'Antecip.', tipo: 'PERCENTUAL', percentual: 1, baseIncidencia: 'PARCELA' }],
    { valorBruto: 900, nParcelas: 3, emDatas: HOJE },
  )
  eq('1% sobre cada parcela de 300', r.valorTaxas, 9)
}

secao('Percentual + fixa')
{
  const r = calcularTaxas(
    [{ id: 5, nome: 'Gateway', tipo: 'PERCENTUAL_MAIS_FIXA', percentual: 2, valorFixo: 0.39 }],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('2% + 0,39', r.valorTaxas, 20.39)
}

secao('Quem absorve a taxa')
{
  const cliente = calcularTaxas(
    [{ id: 6, nome: 'Repasse', tipo: 'PERCENTUAL', percentual: 5, quemAbsorve: 'CLIENTE' }],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('repassada não reduz o líquido', cliente.valorLiquido, 1000)
  eq('registrada como repasse', cliente.valorTaxasRepassadas, 50)
  eq('não entra em valorTaxas', cliente.valorTaxas, 0)

  const empresa = calcularTaxas(
    [{ id: 7, nome: 'Absorvida', tipo: 'PERCENTUAL', percentual: 5, quemAbsorve: 'EMPRESA' }],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('absorvida reduz o líquido', empresa.valorLiquido, 950)
}

secao('Aplicabilidade da taxa')
{
  const base = { valorBruto: 1000, nParcelas: 6, emDatas: HOJE }
  ok('sem restrição aplica', taxaAplicavel({ id: 1 }, base))
  ok('inativa não aplica', !taxaAplicavel({ id: 1, ativo: false }, base))
  ok('dentro da faixa de parcelas', taxaAplicavel({ id: 1, parcelasDe: 2, parcelasAte: 12 }, base))
  ok('abaixo da faixa não aplica', !taxaAplicavel({ id: 1, parcelasDe: 7 }, base))
  ok('acima da faixa não aplica', !taxaAplicavel({ id: 1, parcelasAte: 3 }, base))
  ok('fora de vigência não aplica', !taxaAplicavel({ id: 1, vigenciaFim: '2026-01-01' }, base))
  ok('dentro da vigência aplica', taxaAplicavel({ id: 1, vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' }, base))

  const r = calcularTaxas([{ id: 1, tipo: 'PERCENTUAL', percentual: 10, ativo: false }], base)
  eq('taxa inativa não entra no cálculo', r.valorTaxas, 0)
}

secao('Múltiplas taxas somam')
{
  const r = calcularTaxas(
    [
      { id: 1, nome: 'Cartão', tipo: 'PERCENTUAL', percentual: 3 },
      { id: 2, nome: 'Tarifa', tipo: 'FIXA', valorFixo: 5 },
    ],
    { valorBruto: 1000, nParcelas: 1, emDatas: HOJE },
  )
  eq('duas linhas', r.linhas.length, 2)
  eq('soma das taxas', r.valorTaxas, 35)
  eq('líquido', r.valorLiquido, 965)
}

// ── ENCARGOS ────────────────────────────────────────────────────────────────
secao('Momento GERACAO — descontos')
{
  const avista = calcularEncargos({
    regras: { descontoAVistaPercent: 10 }, base: 1000, momento: 'GERACAO', nParcelas: 1, dataEvento: HOJE,
  })
  eq('desconto à vista aplicado', avista.descontos, 100)
  eq('valor a cobrar', avista.valorACobrar, 900)

  const parcelado = calcularEncargos({
    regras: { descontoAVistaPercent: 10 }, base: 1000, momento: 'GERACAO', nParcelas: 3, dataEvento: HOJE,
  })
  eq('à vista NÃO se aplica a parcelado', parcelado.descontos, 0)
  eq('valor íntegro', parcelado.valorACobrar, 1000)

  const comercial = calcularEncargos({
    regras: { descontoPercent: 5 }, base: 1000, momento: 'GERACAO', nParcelas: 3, dataEvento: HOJE,
  })
  eq('desconto comercial vale em qualquer parcelamento', comercial.descontos, 50)
}

secao('Momento PAGAMENTO — multa e juros')
{
  const emDia = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'PAGAMENTO',
    vencimento: '2026-07-21', dataEvento: HOJE,
  })
  eq('sem atraso: nada é cobrado', emDia.acrescimos, 0)
  eq('dias de atraso zero', emDia.diasAtraso, 0)

  const atrasado = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'PAGAMENTO',
    vencimento: '2026-06-21', dataEvento: HOJE,
  })
  eq('30 dias de atraso', atrasado.diasAtraso, 30)
  eq('multa de 2% uma vez', atrasado.linhas.find((l) => l.tipo === 'MULTA')?.valor, 20)
  eq('juros 1%/mês por 30 dias', atrasado.linhas.find((l) => l.tipo === 'JUROS')?.valor, 10)
  eq('acréscimos somados', atrasado.acrescimos, 30)
  eq('valor a cobrar', atrasado.valorACobrar, 1030)

  const meioMes = calcularEncargos({
    regras: { jurosMesPercent: 2 }, base: 1000, momento: 'PAGAMENTO',
    vencimento: '2026-07-06', dataEvento: HOJE,
  })
  eq('juros pro-rata 15 dias', meioMes.linhas.find((l) => l.tipo === 'JUROS')?.valor, 10)
}

secao('Momento ANTECIPACAO')
{
  const ant = calcularEncargos({
    regras: { descontoAntecipacaoPercent: 2 }, base: 1000, momento: 'ANTECIPACAO',
    vencimento: '2026-08-20', dataEvento: HOJE,
  })
  eq('30 dias de antecipação', ant.diasAntecipacao, 30)
  eq('desconto de 2% ao mês', ant.descontos, 20)
  eq('valor a cobrar', ant.valorACobrar, 980)

  const semAntecipar = calcularEncargos({
    regras: { descontoAntecipacaoPercent: 2 }, base: 1000, momento: 'ANTECIPACAO',
    vencimento: '2026-07-21', dataEvento: HOJE,
  })
  eq('sem antecipação, sem desconto', semAntecipar.descontos, 0)
}

secao('Momento VENCIMENTO e RENEGOCIACAO')
{
  const venc = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'VENCIMENTO',
    vencimento: '2026-06-21', dataEvento: HOJE,
  })
  eq('VENCIMENTO não cobra nada', venc.acrescimos, 0)
  eq('base preservada', venc.valorACobrar, 1000)

  const reneg = calcularEncargos({
    regras: { multaPercent: 2, jurosMesPercent: 1 }, base: 1000, momento: 'RENEGOCIACAO',
    vencimento: '2026-06-21', dataEvento: HOJE,
  })
  eq('RENEGOCIACAO congela multa+juros', reneg.acrescimos, 30)
}

secao('Garantias gerais')
{
  eq('diferença em dias', diferencaEmDias(new Date('2026-07-01T00:00:00'), new Date('2026-07-21T00:00:00')), 20)

  const semRegras = calcularEncargos({ regras: {}, base: 1000, momento: 'PAGAMENTO', vencimento: '2026-01-01', dataEvento: HOJE })
  eq('sem regras declaradas, nada incide', semRegras.valorACobrar, 1000)

  const negativo = calcularEncargos({ regras: { descontoPercent: 150 }, base: 100, momento: 'GERACAO', nParcelas: 1, dataEvento: HOJE })
  ok('valor a cobrar nunca fica negativo', negativo.valorACobrar >= 0)

  const memoria = calcularEncargos({ regras: { multaPercent: 2 }, base: 500, momento: 'PAGAMENTO', vencimento: '2026-06-01', dataEvento: HOJE })
  ok('memória de cálculo preenchida', memoria.memoria.length >= 3)
  ok('memória cita o valor a cobrar', memoria.memoria.some((m) => m.includes('Valor a cobrar')))
}

// ── GUARDAS DE INTEGRAÇÃO ───────────────────────────────────────────────────
secao('Integração com o FinanceRuleEngine')
{
  const ap = readFileSync(join(RAIZ, 'lib/financeiro/aplicar-condicao.ts'), 'utf8')
  ok('aplica cronograma', ap.includes('gerarCronograma'))
  ok('aplica taxas', ap.includes('calcularTaxas'))
  ok('aplica encargos de geração', ap.includes("momento: 'GERACAO'"))
  ok('congela memória de cálculo', ap.includes('memoriaCalculo'))
  ok('rateia taxa entre parcelas', ap.includes('valorTaxa'))

  for (const f of ['src/lib/motor/executor.ts', 'src/lib/motor/matriz-economica.ts']) {
    const src = readFileSync(join(RAIZ, f), 'utf8')
    ok(`${f} usa o ponto único`, src.includes('aplicarCondicaoPagamento'))
    // V3-native (Custos F3.5): o Custo é UMA obrigação A_PAGAR. Os campos de parcela
    // (condicaoPagamentoId/valorLiquido do model legado) saíram do lançamento; o que a
    // condição produz e PRECISA sobreviver é o vencimento calculado pelo ponto único.
    ok(`${f} persiste o vencimento vindo da condição`, src.includes('vencimento: ap.data1'))
    ok(`${f} não recria campos de parcela do modelo legado`, !src.includes('ap.campos.'))
    ok(`${f} não monta parcelamento na mão`, !src.includes('gerarParcelas'))
  }

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  for (const campo of ['condicaoPagamentoId', 'condicaoVersao', 'valorBruto', 'valorTaxas', 'valorLiquido', 'memoriaCalculo']) {
    ok(`schema tem ${campo}`, schema.includes(campo))
  }
  ok('parcela marca entrada', /model ParcelaFinanceira[\s\S]*?entrada\s+Boolean/.test(schema))
  ok('taxa tem quemAbsorve', /model TaxaPagamento[\s\S]*?quemAbsorve/.test(schema))

  const mig = readFileSync(join(RAIZ, 'prisma/migrations/20260726000000_pagamentos_taxas_encargos/migration.sql'), 'utf8')
  ok('migration é aditiva', !/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE FROM/i.test(mig))
  ok('migration adiciona condição na Receita', mig.includes('"Receita" ADD COLUMN "condicaoPagamentoId"'))
  ok('migration adiciona condição no Custo', mig.includes('"Custo" ADD COLUMN "condicaoPagamentoId"'))
}

// A rota V1 de renegociação (receitas/[id]/parcelas?modo=renegociacao) foi
// removida. O mesmo invariante — nunca tocar cobrança já quitada/paga, agir
// só sobre o saldo em aberto, preservar histórico (sem apagar), transacional —
// migrou para a ação "Renegociar" do Financeiro V3.
secao('Renegociação (sucessor V3: ação "Renegociar" do detalhe da Receita)')
{
  const acao = readFileSync(join(RAIZ, 'lib/financeiro/acoes/renegociar.ts'), 'utf8')
  ok('atua só sobre cobranças em aberto/parcial', acao.includes("STATUS_ELEGIVEL = ['ABERTA', 'PARCIAL']"))
  ok('nunca sobre pagamentos confirmados', acao.includes('NUNCA') && acao.includes('sobre pagamentos confirmados'))
  ok('preserva histórico (não apaga nada)', /preserva histórico — não apaga/.test(acao) && !/\.delete\(|deleteMany/.test(acao))
  ok('bloqueia quando não há elegíveis', acao.includes('Nenhuma cobrança em aberto elegível para renegociação'))
  ok('é transacional', acao.includes('prisma.$transaction'))
  ok('registra evento com a ação/observação', acao.includes("registrarEventoReceita") && acao.includes("acao: 'RENEGOCIAR'"))

  const rota = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/receita/[ref]/renegociar/route.ts'), 'utf8')
  ok('rota V3 delega à ação canônica', rota.includes('renegociar('))

  const detalhe = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitaDetalheView.tsx'), 'utf8')
  ok('ação "Renegociar" acessível no detalhe da Receita', detalhe.includes('"renegociar"') && detalhe.includes('Renegociar'))
}

// O modal V1 (receita-modal/tipos.ts, ReceitaVisaoGeral.tsx,
// ReceitaInformacoesTecnicasTab.tsx) exibia a condição/memória de cálculo
// CONGELADA no momento da contratação. Essa tela específica foi removida e
// não foi reconstruída 1:1 no V3 — a taxa passou a ser calculada AO VIVO no
// momento de registrar o recebimento (RegistrarPagamentoView), por forma de
// pagamento escolhida ali, em vez de fixada antecipadamente. O invariante que
// sobrevive é "a taxa é sempre mostrada ao operador, nunca escondida"; o
// "congelamento por condição contratual" ficou sem tela equivalente — não é
// reintroduzido aqui por não existir sucessor a apontar.
secao('Reflexo nas telas — taxa ao vivo no recebimento (sucessor V3)')
{
  const receber = readFileSync(join(RAIZ, 'src/components/financeiro/v3/RegistrarPagamentoView.tsx'), 'utf8')
  ok('recebimento calcula a taxa da forma escolhida com a fonte única', receber.includes('calcularTaxas'))
  ok('taxa é exibida ao operador por linha', /Taxa:/.test(receber))
  ok('total de taxas aparece no resumo do recebimento', receber.includes('Taxas (cartão)'))

  const cond = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx'), 'utf8')
  // wizard premium (regra reutilizável): cobre entrada/parcelamento/cronograma/
  // distribuição/aplicabilidade/política de taxas/política cambial/encargos.
  for (const conceito of ['Parcelamento', 'Cronograma', 'distribuicao', 'Aplicabilidade', 'Política de Taxas', 'Política Cambial', 'Encargos']) {
    ok(`wizard de Condições cobre "${conceito}"`, cond.includes(conceito))
  }
  ok('tela de Condições versiona', cond.includes('EXIGE_NOVA_VERSAO') && cond.includes('Nova versão'))
  ok('cronograma com comportamento explícito de feriado', cond.includes('comportamentoFeriado'))

  const formas = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/FormasPagamentoTab.tsx'), 'utf8')
  for (const c of ['aceitaEntrada', 'aceitaRecorrencia', 'aceitaMoedaEstrangeira', 'ordem', 'icone', 'observacoes']) {
    ok(`tela de Formas edita ${c}`, formas.includes(c))
  }
  ok('Formas não duplica regra de parcelamento', formas.includes('pertencem à Condição de Pagamento'))

  // Tela de Taxas reorganizada POR FORMA: edita a grade (bandeiras×parcelas),
  // adquirente, taxa única e encargos de boleto — no agregado da forma.
  const taxasTela = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx'), 'utf8')
  for (const c of ['adqSel', 'setCell', 'boleto', 'ativo', 'FormaConfig']) {
    ok(`tela de Taxas (por forma) edita ${c}`, taxasTela.includes(c))
  }
}

// V1 dava paridade Receita×Custo DUPLICANDO rotas/telas (custos/[id]/detalhe,
// custos/[id]/parcelas, CustoFinanceiroModal, subabas/Custos.tsx) — todas
// removidas. O V3 dá uma paridade mais forte: RECEITA e CUSTO são a mesma
// ObrigacaoEconomica (campo `natureza`), lidas pelo mesmo read-model e
// renderizadas pelo mesmo componente (ReceitaDetalheView), sem código
// duplicado a manter sincronizado.
secao('Paridade Receita x Custo (sucessor V3: mesma obrigação, campo natureza)')
{
  const leitura = readFileSync(join(RAIZ, 'lib/financeiro/leitura/receita-detalhe.ts'), 'utf8')
  ok('read-model único expõe natureza RECEITA|CUSTO', /natureza:\s*'RECEITA'\s*\|\s*'CUSTO'/.test(leitura))
  ok('natureza é derivada da direção da obrigação (A_PAGAR → CUSTO)', /direcao === 'A_PAGAR'\s*\?\s*'CUSTO'\s*:\s*'RECEITA'/.test(leitura))

  const detalhe = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ReceitaDetalheView.tsx'), 'utf8')
  ok('mesmo componente atende Receita e Custo (isCusto deriva de natureza)', detalhe.includes('const isCusto = d.natureza === "CUSTO"'))
  ok('vocabulário muda por natureza (Recebido/Pago, Cobranças/Parcelas)', detalhe.includes('isCusto ? "Parcelas" : "Cobranças"') && detalhe.includes('isCusto ? "Pago" : "Recebido"'))
  ok('ações exclusivas de Receita ficam fora do Custo (fatura/recibo/renegociar)', /!isCusto &&.*Gerar fatura/.test(detalhe) && /!isCusto &&.*Gerar recibo/.test(detalhe))

  const shell = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ProcessoFinanceiroShell.tsx'), 'utf8')
  ok('Custos e Receitas no shell filtram a MESMA rota por natureza', shell.includes("natureza=CUSTO") && shell.includes('/api/financeiro/v3/obrigacoes'))
}

secao('Financeiro Geral')
{
  const proj = readFileSync(join(RAIZ, 'lib/financeiro/financeiro-geral-projecao.ts'), 'utf8')
  ok('projeção expõe valorTaxas', proj.includes('valorTaxas: number'))
  ok('projeção expõe valorLiquido', proj.includes('valorLiquido: number'))
  ok('projeção expõe a condição aplicada', proj.includes('condicao: string | null'))
  ok('receitas trazem os campos do banco', proj.includes('valorTaxas: true, valorLiquido: true, condicaoCodigo: true'))
  ok('totais somam líquido', proj.includes('aReceberLiquido'))
  ok('saldo líquido projetado', proj.includes('saldoProjetadoLiquido'))
  ok('conta corporativa não tem taxa', proj.includes('Conta corporativa não passa por Condição'))
  ok('valor bruto segue sendo o principal', proj.includes('Valor CONTRATADO (bruto)'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Taxas e Encargos: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
