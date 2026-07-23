// scripts/taxa-pagamento-guard.test.ts
// ============================================================================
// GUARDA — Taxa de Pagamento = regra reutilizável de cálculo.
// (1) mapeamento paraColunasTaxa (puro) — disclosure/derivações corretas.
// (2) estrutura: identidade premium (wizard), fonte única de enums, DELETE seguro.
// Puro: sem banco.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paraColunasTaxa, validarTaxa } from '../src/app/api/gerenciamento/taxas-pagamento/campos'
import { FEE_TYPES, QUEM_ABSORVE, APLICA_PARCELA, ADQUIRENTES } from '../lib/financeiro/taxa-constants'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

sec('1 — paraColunasTaxa (derivações e disclosure)')
{
  const base = { name: 'Taxa X' }
  const t = paraColunasTaxa(base)
  ok('default aplicaParcela = TODAS', t.aplicaParcela === 'TODAS')
  ok('default baseIncidencia = TOTAL', t.baseIncidencia === 'TOTAL')
  ok('default quemAbsorve = EMPRESA', t.quemAbsorve === 'EMPRESA')

  const faixa = paraColunasTaxa({ name: 'x', aplicaParcela: 'FAIXA', installmentsFrom: 2, installmentsTo: 6 })
  ok('FAIXA preserva installmentsFrom/To', faixa.installmentsFrom === 2 && faixa.installmentsTo === 6)
  const naoFaixa = paraColunasTaxa({ name: 'x', aplicaParcela: 'TODAS', installmentsFrom: 2, installmentsTo: 6 })
  ok('não-FAIXA zera installmentsFrom/To', naoFaixa.installmentsFrom === null && naoFaixa.installmentsTo === null)

  const antec = paraColunasTaxa({ name: 'x', anticipationType: 'OPCIONAL', anticipationPercent: 1.5 })
  ok('antecipação OPCIONAL liga anticipationEnabled', antec.anticipationEnabled === true && Number(antec.anticipationPercent) === 1.5)
  const semAntec = paraColunasTaxa({ name: 'x', anticipationType: 'NAO_POSSUI', anticipationPercent: 1.5 })
  ok('antecipação NAO_POSSUI descarta percentual', semAntec.anticipationEnabled === false && semAntec.anticipationPercent === null)

  const comp = paraColunasTaxa({ name: 'x', quemAbsorve: 'COMPARTILHADA', absorcaoPercentEmpresa: 40 })
  ok('COMPARTILHADA mantém % empresa', Number(comp.absorcaoPercentEmpresa) === 40)
  const emp = paraColunasTaxa({ name: 'x', quemAbsorve: 'EMPRESA', absorcaoPercentEmpresa: 40 })
  ok('EMPRESA descarta % empresa', emp.absorcaoPercentEmpresa === null)

  ok('quemAbsorve amplia p/ COBRANCA', paraColunasTaxa({ name: 'x', quemAbsorve: 'COBRANCA' }).quemAbsorve === 'COBRANCA')
  ok('baseIncidencia amplia p/ SALDO', paraColunasTaxa({ name: 'x', baseIncidencia: 'SALDO' }).baseIncidencia === 'SALDO')
  ok('adquirente enum válido', paraColunasTaxa({ name: 'x', adquirente: 'STONE' }).adquirente === 'STONE')
  ok('adquirente inválido → null', paraColunasTaxa({ name: 'x', adquirente: 'texto livre' }).adquirente === null)
  ok('multiplas formas', JSON.stringify(paraColunasTaxa({ name: 'x', formasAplicaveis: [1, 2, 3] }).formasAplicaveis) === '[1,2,3]')
}

sec('2 — validarTaxa')
{
  ok('nome obrigatório', validarTaxa({}).some((e) => e.campo === 'name'))
  ok('FAIXA sem limites falha', validarTaxa({ name: 'x', aplicaParcela: 'FAIXA' }).some((e) => e.campo === 'installmentsFrom'))
  ok('FAIXA invertida falha', validarTaxa({ name: 'x', aplicaParcela: 'FAIXA', installmentsFrom: 6, installmentsTo: 2 }).some((e) => e.campo === 'installmentsTo'))
  ok('vigência invertida falha', validarTaxa({ name: 'x', vigenciaInicio: '2026-05-01', vigenciaFim: '2026-01-01' }).some((e) => e.campo === 'vigenciaFim'))
  ok('taxa mínima válida passa', validarTaxa({ name: 'Taxa' }).length === 0)
}

sec('3 — enums (fonte única, enxutos)')
{
  ok('FEE_TYPES só os reais (sem faixa progressiva/tabela externa)', FEE_TYPES.length === 3 && !(FEE_TYPES as readonly string[]).includes('installment_based'))
  ok('QUEM_ABSORVE ampliado', QUEM_ABSORVE.includes('COMPARTILHADA') && QUEM_ABSORVE.includes('COBRANCA'))
  ok('APLICA_PARCELA tem FAIXA', APLICA_PARCELA.includes('FAIXA'))
  ok('ADQUIRENTES enum', ADQUIRENTES.includes('STONE') && ADQUIRENTES.includes('WISE'))
}

sec('4 — estrutura & premium (organização POR FORMA)')
{
  const tab = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx'), 'utf8')
  ok('identidade premium (OURO via shell)', tab.includes('pagamentoUI') && tab.includes('OURO'))
  ok('sem azul de CRUD', !tab.includes('bg-blue-600'))
  // Listagem UMA linha por forma; bandeira/adquirente/parcela DENTRO da config.
  ok('lista consome API agregada /formas', tab.includes('/api/gerenciamento/taxas-pagamento/formas'))
  ok('linha por Forma de Pagamento (não por bandeira)', tab.includes('FormaAgrupada') && tab.includes('formaPagamentoId') && tab.includes('Configurar'))
  ok('tela interna de configuração por forma', tab.includes('function FormaConfig') && tab.includes('/formas/${formaId}'))
  ok('grade bandeiras × 1x–12x (crédito)', tab.includes('const PARCELAS') && tab.includes('mostraGrade') && tab.includes('setCell'))
  ok('adquirente selecionável na config do cartão', tab.includes('adqSel') && tab.includes('det.adquirentes'))
  ok('vazio ≠ 0% (célula vazia = indisponível)', tab.includes('combinação indisponível') && tab.includes('taxa explícita'))
  ok('salvamento agregado (PUT /formas)', tab.includes("method: 'PUT'") && tab.includes('salvar'))

  const listaRoute = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/formas/route.ts'), 'utf8')
  const formaRoute = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/formas/[formaId]/route.ts'), 'utf8')
  ok('GET /formas agrupa por forma', listaRoute.includes('agruparTaxasPorForma'))
  ok('PUT /formas é transacional', formaRoute.includes('prisma.$transaction') && formaRoute.includes('regravarLinhas'))
  ok('valida taxa 0–100% e vazio≠0', formaRoute.includes('entre 0% e 100%') && formaRoute.includes("g.feePercent !== null"))
  ok('registra auditoria', formaRoute.includes('registrarAuditoria'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Taxa de Pagamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
