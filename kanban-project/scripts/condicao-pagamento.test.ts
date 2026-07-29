// scripts/condicao-pagamento.test.ts
// ============================================================================
// Motor de cronograma (lib/financeiro/condicao-pagamento) — o parcelamento
// oficial do sistema. Puro: não precisa de banco.
//
// Invariante testado em TODOS os cenários: a soma das parcelas fecha
// exatamente o total contratado.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  type CondicaoPagamentoView,
  ajustarVencimento,
  avancarPeriodo,
  condicaoAplicavel,
  distribuirValores,
  gerarCronograma,
  proximaVersao,
  resolverQuantidade,
} from '../lib/financeiro/condicao-pagamento'

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

const BASE = new Date('2026-07-21T12:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)
const soma = (ps: Array<{ valor: number }>) => Number(ps.reduce((s, p) => s + p.valor, 0).toFixed(2))

// ── 1 · comportamento histórico preservado ──────────────────────────────────
secao('Sem condição vinculada — comportamento histórico')
{
  const c = gerarCronograma(null, { total: 6290, dataBase: BASE })
  eq('1 parcela', c.nParcelas, 1)
  eq('vence na data base', iso(c.parcelas[0].vencimento), '2026-07-21')
  eq('valor integral', c.parcelas[0].valor, 6290)
  eq('sem entrada', c.valorEntrada, 0)
  eq('periodicidade mensal', c.periodicidade, 'MENSAL')
}

// ── 2 · parcelamento simples ────────────────────────────────────────────────
secao('Parcelamento mensal')
{
  const cond: CondicaoPagamentoView = { parcelasPadrao: 3, periodicidade: 'MENSAL' }
  const c = gerarCronograma(cond, { total: 6290, dataBase: BASE })
  eq('3 parcelas', c.nParcelas, 3)
  eq('soma fecha o total', soma(c.parcelas), 6290)
  eq('1ª em julho', iso(c.parcelas[0].vencimento), '2026-07-21')
  eq('2ª em agosto', iso(c.parcelas[1].vencimento), '2026-08-21')
  eq('3ª em setembro', iso(c.parcelas[2].vencimento), '2026-09-21')

  const quebrado = gerarCronograma({ parcelasPadrao: 3 }, { total: 100, dataBase: BASE })
  eq('centavos: 100/3 fecha exato', soma(quebrado.parcelas), 100)
  eq('última absorve o resto', quebrado.parcelas[2].valor, 33.34)
}

// ── 3 · entrada ─────────────────────────────────────────────────────────────
secao('Entrada')
{
  const pct: CondicaoPagamentoView = { temEntrada: true, percentEntrada: 30, parcelasPadrao: 3 }
  const c = gerarCronograma(pct, { total: 1000, dataBase: BASE })
  eq('entrada de 30%', c.valorEntrada, 300)
  eq('primeira parcela é a entrada', c.parcelas[0].entrada, true)
  eq('entrada vale 300', c.parcelas[0].valor, 300)
  // Entrada é COMPONENTE À PARTE: entrada + 3 parcelas de saldo = 4 componentes.
  eq('entrada + 3 parcelas de saldo = 4', c.nParcelas, 4)
  eq('saldo (3 parcelas) fecha 700', c.parcelas[1].valor + c.parcelas[2].valor + c.parcelas[3].valor, 700)
  eq('soma fecha o total', soma(c.parcelas), 1000)

  const fixa = gerarCronograma(
    { temEntrada: true, valorEntradaFixo: 500, parcelasPadrao: 3 },
    { total: 2000, dataBase: BASE },
  )
  eq('entrada fixa', fixa.valorEntrada, 500)
  eq('soma fecha o total', soma(fixa.parcelas), 2000)

  const absurda = gerarCronograma(
    { temEntrada: true, valorEntradaFixo: 5000, parcelasPadrao: 2 },
    { total: 1000, dataBase: BASE },
  )
  eq('entrada maior que o total é ignorada', absurda.valorEntrada, 0)
  eq('soma continua fechando', soma(absurda.parcelas), 1000)
}

// ── 4 · periodicidades ──────────────────────────────────────────────────────
secao('Periodicidades')
{
  eq('semanal +1', iso(avancarPeriodo(BASE, 1, 'SEMANAL')), '2026-07-28')
  eq('quinzenal +1', iso(avancarPeriodo(BASE, 1, 'QUINZENAL')), '2026-08-05')
  eq('mensal +1', iso(avancarPeriodo(BASE, 1, 'MENSAL')), '2026-08-21')
  eq('bimestral +1', iso(avancarPeriodo(BASE, 1, 'BIMESTRAL')), '2026-09-21')
  eq('trimestral +1', iso(avancarPeriodo(BASE, 1, 'TRIMESTRAL')), '2026-10-21')
  eq('semestral +1', iso(avancarPeriodo(BASE, 1, 'SEMESTRAL')), '2027-01-21')
  eq('anual +1', iso(avancarPeriodo(BASE, 1, 'ANUAL')), '2027-07-21')
  eq('personalizada 45 dias', iso(avancarPeriodo(BASE, 1, 'PERSONALIZADA', 45)), '2026-09-04')

  const fim = new Date('2026-01-31T12:00:00Z')
  eq('31/jan +1 mês cai no último dia de fev', iso(avancarPeriodo(fim, 1, 'MENSAL')), '2026-02-28')
}

// ── 5 · início do cronograma ────────────────────────────────────────────────
secao('Primeira parcela')
{
  const imediata = gerarCronograma({ inicioCronograma: 'IMEDIATA' }, { total: 100, dataBase: BASE })
  eq('imediata', iso(imediata.parcelas[0].vencimento), '2026-07-21')

  const dias = gerarCronograma({ inicioCronograma: 'DIAS', primeiraParcelaDias: 30 }, { total: 100, dataBase: BASE })
  eq('em 30 dias', iso(dias.parcelas[0].vencimento), '2026-08-20')

  const data = gerarCronograma(
    { inicioCronograma: 'DATA_ESPECIFICA', primeiraParcelaData: '2026-12-01' },
    { total: 100, dataBase: BASE },
  )
  eq('data específica', iso(data.parcelas[0].vencimento), '2026-12-01')
}

// ── 6 · dia fixo e dias úteis ───────────────────────────────────────────────
secao('Dia fixo e ajuste de dia útil')
{
  const c = gerarCronograma(
    { parcelasPadrao: 3, diaFixo: 10, periodicidade: 'MENSAL' },
    { total: 300, dataBase: BASE },
  )
  eq('todas no dia 10', c.parcelas.map((p) => iso(p.vencimento).slice(-2)).join(','), '10,10,10')

  // 2026-02-30 não existe: dia fixo 31 cai no último dia do mês.
  const fev = gerarCronograma(
    { parcelasPadrao: 1, diaFixo: 31 },
    { total: 100, dataBase: new Date('2026-02-10T12:00:00Z') },
  )
  eq('dia 31 em fevereiro vira 28', iso(fev.parcelas[0].vencimento), '2026-02-28')

  // 2026-07-25 é sábado.
  const sabado = new Date('2026-07-25T12:00:00Z')
  eq('sábado sem ajuste', iso(ajustarVencimento(sabado, { ajusteDiaUtil: 'NENHUM' })), '2026-07-25')
  eq('próximo dia útil', iso(ajustarVencimento(sabado, { ajusteDiaUtil: 'PROXIMO_DIA_UTIL' })), '2026-07-27')
  eq('último dia útil', iso(ajustarVencimento(sabado, { ajusteDiaUtil: 'ULTIMO_DIA_UTIL' })), '2026-07-24')
  eq('ajustarFimDeSemana empurra p/ segunda', iso(ajustarVencimento(sabado, { ajustarFimDeSemana: true })), '2026-07-27')
}

// ── 7 · distribuição ────────────────────────────────────────────────────────
secao('Distribuição')
{
  eq('iguais fecham', soma(distribuirValores(900, 3, 'IGUAIS').map((v) => ({ valor: v }))), 900)
  eq('última ajusta centavos', distribuirValores(100, 3, 'ULTIMA_AJUSTA'), [33.33, 33.33, 33.34])

  const pd = distribuirValores(1000, 3, 'PRIMEIRA_DIFERENCIADA', 50)
  eq('primeira diferenciada = 50%', pd[0], 500)
  eq('primeira diferenciada fecha', Number(pd.reduce((s, v) => s + v, 0).toFixed(2)), 1000)

  let erro = false
  try { distribuirValores(100, 0, 'IGUAIS') } catch { erro = true }
  ok('n inválido é rejeitado', erro)

  erro = false
  try { distribuirValores(0, 3, 'IGUAIS') } catch { erro = true }
  ok('total inválido é rejeitado', erro)
}

// ── 8 · limites de quantidade ───────────────────────────────────────────────
secao('Quantidade de parcelas')
{
  eq('padrão quando nada é pedido', resolverQuantidade({ parcelasPadrao: 6 }).n, 6)
  eq('respeita o máximo', resolverQuantidade({ parcelasMin: 1, parcelasMax: 12 }, 24).n, 12)
  eq('respeita o mínimo', resolverQuantidade({ parcelasMin: 3, parcelasMax: 12 }, 1).n, 3)
  ok('ajuste é reportado', resolverQuantidade({ parcelasMax: 6 }, 10).observacao != null)
  eq('à vista força 1 parcela', resolverQuantidade({ tipoPagamento: 'AVISTA', parcelasPadrao: 5 }, 5).n, 1)

  const avista = gerarCronograma({ tipoPagamento: 'AVISTA' }, { total: 500, dataBase: BASE, nParcelas: 6 })
  eq('à vista gera 1 parcela', avista.nParcelas, 1)
  eq('à vista mantém o total', avista.parcelas[0].valor, 500)
}

// ── 9 · restrições / aplicabilidade ─────────────────────────────────────────
secao('Restrições de uso')
{
  const ctx = { natureza: 'RECEITA' as const, moeda: 'EUR', total: 6290, pais: 'IT', modalidade: 'sanguinis', tipoProcesso: 'cidadania_italiana' }

  ok('sem restrição declarada é permissiva', condicaoAplicavel({}, ctx).aplicavel)
  ok('inativa bloqueia', !condicaoAplicavel({ ativo: false }, ctx).aplicavel)
  ok('somente custo bloqueia receita', !condicaoAplicavel({ aplicaA: 'CUSTO' }, ctx).aplicavel)
  ok('ambos permite', condicaoAplicavel({ aplicaA: 'AMBOS' }, ctx).aplicavel)
  ok('moeda permitida', condicaoAplicavel({ moedasPermitidas: ['EUR', 'BRL'] }, ctx).aplicavel)
  ok('moeda não permitida bloqueia', !condicaoAplicavel({ moedasPermitidas: ['BRL'] }, ctx).aplicavel)
  ok('valor abaixo do mínimo bloqueia', !condicaoAplicavel({ valorMinimo: 10000 }, ctx).aplicavel)
  ok('valor acima do máximo bloqueia', !condicaoAplicavel({ valorMaximo: 1000 }, ctx).aplicavel)
  ok('país permitido', condicaoAplicavel({ paises: ['IT'] }, ctx).aplicavel)
  ok('país diferente bloqueia', !condicaoAplicavel({ paises: ['PT'] }, ctx).aplicavel)
  ok('modalidade diferente bloqueia', !condicaoAplicavel({ modalidades: ['materna'] }, ctx).aplicavel)
  ok('tipo de processo diferente bloqueia', !condicaoAplicavel({ tiposProcesso: ['cidadania_portuguesa'] }, ctx).aplicavel)
  ok('motivo é explicado', /moeda/i.test(condicaoAplicavel({ moedasPermitidas: ['BRL'] }, ctx).motivo ?? ''))
}

// ── 10 · vigência e versionamento ───────────────────────────────────────────
secao('Vigência e versionamento')
{
  const ctx = { natureza: 'RECEITA' as const, moeda: 'EUR', total: 1000, emDatas: BASE }
  ok('dentro da vigência', condicaoAplicavel({ vigenciaInicio: '2026-01-01', vigenciaFim: '2026-12-31' }, ctx).aplicavel)
  ok('antes do início bloqueia', !condicaoAplicavel({ vigenciaInicio: '2027-01-01' }, ctx).aplicavel)
  ok('depois do fim bloqueia', !condicaoAplicavel({ vigenciaFim: '2026-01-01' }, ctx).aplicavel)

  const v1: CondicaoPagamentoView = { id: 7, codigo: 'COND-PADRAO', versao: 1, parcelasPadrao: 3, ativo: true }
  const v2 = proximaVersao(v1, { parcelasPadrao: 6 })
  eq('nova versão incrementa', v2.versao, 2)
  eq('mesmo código', v2.codigo, 'COND-PADRAO')
  eq('alteração aplicada', v2.parcelasPadrao, 6)
  eq('versão anterior intacta', v1.parcelasPadrao, 3)
  ok('nova versão não reusa o id', v2.id == null)
  ok('nova versão nasce vigente', v2.vigenciaFim == null && v2.ativo === true)
}

// ── 11 · caso real: honorários italianos ────────────────────────────────────
secao('Caso real — honorários € 6.290,00')
{
  const cond: CondicaoPagamentoView = {
    codigo: 'IT-HON-6X',
    temEntrada: true,
    percentEntrada: 20,
    parcelasPadrao: 6,
    periodicidade: 'MENSAL',
    diaFixo: 10,
    ajusteDiaUtil: 'PROXIMO_DIA_UTIL',
    distribuicao: 'ULTIMA_AJUSTA',
    aplicaA: 'RECEITA',
    moedasPermitidas: ['EUR'],
  }
  const c = gerarCronograma(cond, { total: 6290, dataBase: BASE })
  eq('entrada + 6 parcelas de saldo = 7', c.nParcelas, 7)
  eq('entrada de 20%', c.valorEntrada, 1258)
  eq('soma fecha € 6.290,00', soma(c.parcelas), 6290)
  eq('saldo em 6 parcelas', soma(c.parcelas.slice(1)), 5032)
  ok('nenhum vencimento em fim de semana',
    c.parcelas.every((p) => p.vencimento.getUTCDay() !== 0 && p.vencimento.getUTCDay() !== 6))
  ok('vencimentos crescentes',
    c.parcelas.every((p, i) => i === 0 || p.vencimento.getTime() > c.parcelas[i - 1].vencimento.getTime()))
}

// ── 12 · guarda: motor não monta mais parcelamento na mão ───────────────────
secao('FinanceRuleEngine consome a Condição de Pagamento')
{
  const executor = readFileSync(join(RAIZ, 'src/lib/motor/executor.ts'), 'utf8')
  // O motor consome o PONTO ÚNICO (lib/financeiro/aplicar-condicao.ts), que
  // internamente resolve a condição, gera o cronograma e calcula taxas/encargos.
  ok('executor usa o ponto único de aplicação', executor.includes('aplicarCondicaoPagamento'))
  ok('executor não chama mais gerarParcelas', !executor.includes('gerarParcelas'))
  // ARQUITETURA base ÚNICA: a RECEITA virou CONTRATO puro — não nasce com
  // parcelas/condição (isso vive na Cobrança). E o CUSTO virou V3-native: UMA
  // ObrigacaoEconomica A_PAGAR, com os pagamentos parciais no Ledger em vez de
  // linhas de parcela. A condição continua sendo APLICADA — ela define o
  // vencimento — e continua AUDITÁVEL, agora pelo resumo gravado na obrigação.
  ok('custo aplica a condição pelo ponto único, para a natureza CUSTO', /aplicarCondicaoPagamento\(\{[^}]*natureza: 'CUSTO'/.test(executor))
  ok('condição define o vencimento do custo (ap.data1)', executor.includes('vencimento: ap.data1'))
  ok('condição aplicada fica auditável no custo (resumo na obrigação)', executor.includes('ap.resumo') && executor.includes('observacoes'))
  ok('custo V3-native: UMA obrigação, sem linhas de parcela no lançamento', executor.includes('criarObrigacaoEconomicaComLedgerTx') && !executor.includes('nParcelas: ap.campos.nParcelas'))
  ok('Receita = contrato: motor NÃO gera parcelas/condição na receita', /a Receita é SÓ o CONTRATO/.test(executor))

  const aplicar = readFileSync(join(RAIZ, 'lib/financeiro/aplicar-condicao.ts'), 'utf8')
  ok('ponto único usa o motor de cronograma', aplicar.includes('gerarCronograma'))
  ok('ponto único resolve a condição da config', aplicar.includes('condicaoDaConfig'))

  const matriz = readFileSync(join(RAIZ, 'src/lib/motor/matriz-economica.ts'), 'utf8')
  ok('matriz econômica usa o ponto único', matriz.includes('aplicarCondicaoPagamento'))
  ok('matriz não chama mais gerarParcelas', !matriz.includes('gerarParcelas'))

  // O reparcelamento da Receita deixou de existir como rota própria: na base ÚNICA
  // a Receita é o contrato e QUEM parcela é a Cobrança. O invariante migrou junto.
  ok('rota antiga de reparcelamento da Receita não existe', !existsSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/parcelas/route.ts')))
  const cobrancas = readFileSync(join(RAIZ, 'src/app/api/financeiro/receitas/[id]/cobrancas/route.ts'), 'utf8')
  ok('parcelamento aceita condição (na Cobrança)', cobrancas.includes('condicaoPagamentoId'))
  ok('parcelamento usa o motor (gerarCronograma)', cobrancas.includes('gerarCronograma'))
  ok('parcelamento nunca altera a Receita (contrato intacto)', /Nunca altera a Receita/.test(cobrancas))
  const cond = readFileSync(join(RAIZ, 'lib/financeiro/condicao-pagamento.ts'), 'utf8')
  ok('cronograma preserva o total (soma exata é invariante do motor)', cond.includes('Falha de arredondamento'))

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  ok('config financeira aponta para a condição', schema.includes('condicaoPagamentoId'))
  ok('condição tem versionamento', /model CondicaoPagamento[\s\S]*?versao\s+Int/.test(schema))
  ok('condição tem vigência', /model CondicaoPagamento[\s\S]*?vigenciaInicio/.test(schema))
  ok('formas ligadas por N:N', schema.includes('model CondicaoPagamentoForma'))
  ok('taxas ligadas por N:N', schema.includes('model CondicaoPagamentoTaxa'))

  // Tabela de Preços responde por VALOR — nunca por cronograma.
  const tabela = schema.slice(schema.indexOf('model TabelaValor'))
  const corpoTabela = tabela.slice(0, tabela.indexOf('\n}'))
  for (const proibido of ['parcelasPadrao', 'periodicidade', 'diaFixo', 'temEntrada', 'inicioCronograma']) {
    ok(`TabelaValor sem "${proibido}"`, !corpoTabela.includes(proibido))
  }
}

// ── resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`Condição de Pagamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
