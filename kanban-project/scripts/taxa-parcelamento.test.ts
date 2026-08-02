// scripts/taxa-parcelamento.test.ts
// ============================================================================
// GUARDA — TABELA DE PARCELAMENTO da Taxa de Pagamento.
//
// Objetivo da entrega: UMA taxa representa a tabela comercial inteira da
// adquirente (1x 2,99% / 2x 3,39% / 3–6x 4,19%…), acabando com a necessidade de
// um cadastro por quantidade de parcelas. O campo "Aplica-se a" deixou de
// existir: a incidência por parcela vive só na tabela.
//
// (1) linhas e faixas: normalização, sobreposição, resolução por parcelas
// (2) cobrança: forma + parcelas → linha → exatamente aquela taxa
// (3) compatibilidade: taxa sem tabela continua igual
// (4) interface: tabela com adicionar/duplicar/remover linha e faixa
// (5) persistência e migration aditiva
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  linhasDoBody, validarTabela, linhaParaParcelas, rotuloLinha, linhasParaCriar, tabelaPresente,
} from '../lib/financeiro/taxa-parcelamento'
import { calcularCobranca, taxaParaCandidata } from '../lib/financeiro/charge-calculation-service'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

// Tabela comercial de exemplo (a do print).
const TABELA = [
  { parcelasDe: 1, parcelasAte: 1, feePercent: 2.99, fixedFee: 0, antecipacao: false },
  { parcelasDe: 2, parcelasAte: 2, feePercent: 3.39, fixedFee: 0, antecipacao: false },
  { parcelasDe: 3, parcelasAte: 3, feePercent: 3.79, fixedFee: 0, antecipacao: false },
  { parcelasDe: 4, parcelasAte: 6, feePercent: 4.19, fixedFee: 0, antecipacao: false },
  { parcelasDe: 7, parcelasAte: 12, feePercent: 4.59, fixedFee: 0, antecipacao: true },
]

const formaView = (over: Record<string, unknown> = {}) => ({
  id: 6, name: 'Cartão de Crédito', ativo: true, permiteParcelas: true, maxParcelas: 12,
  usoRecebimento: true, usoPagamento: true, moedasAceitas: [], aceitaEntrada: true, ...over,
}) as never

const condView = (over: Record<string, unknown> = {}) => ({
  id: 100, tipoPagamento: 'PARCELADO', parcelasPadrao: 1, parcelasMin: 1, parcelasMax: 12,
  // ABSORVER isola a SELEÇÃO da linha da grade (valorTaxa = base × %), sem a
  // matemática de gross-up do repasse (testada em cambio-grossup.test.ts).
  aplicaA: 'RECEITA', politicaTaxas: 'ABSORVER', periodicidade: 'MENSAL', distribuicao: 'ULTIMA_AJUSTA',
  inicioCronograma: 'IMEDIATA', ...over,
}) as never

const cobrar = (nParcelas: number, tabela = TABELA, extraTaxa: Record<string, unknown> = {}) =>
  calcularCobranca({
    aplicaComo: 'RECEBER', valorBase: 1000, moeda: 'BRL', dataBase: new Date('2026-03-10'),
    forma: formaView(), condicao: condView(), nParcelas,
    taxaCandidatas: [{
      id: 7, nome: 'Adquirente X', tipo: 'PERCENTUAL', ativo: true, prioridade: 0,
      baseIncidencia: 'TOTAL', tabelaParcelamento: tabela, ...extraTaxa,
    } as never],
  })

sec('1 — linhas, faixas e resolução por quantidade de parcelas')
{
  const linhas = linhasDoBody({ parcelamento: [{ parcelasDe: 1 }, { parcelasDe: 4, parcelasAte: 6, feePercent: 4.19 }] })
  ok('linha sem "até" vira parcela única', linhas[0].parcelasDe === 1 && linhas[0].parcelasAte === 1)
  ok('faixa preserva os limites', linhas[1].parcelasDe === 4 && linhas[1].parcelasAte === 6)
  ok('linhas saem ordenadas', linhas[0].parcelasDe < linhas[1].parcelasDe)
  ok('descarta linha sem parcela válida', linhasDoBody({ parcelamento: [{ parcelasDe: 0 }, { parcelasDe: 'x' }] }).length === 0)
  ok('aceita nomes curtos (de/ate/percentual)', linhasDoBody({ parcelamento: [{ de: 2, ate: 3, percentual: 5 }] })[0].feePercent === 5)
  ok('tabela ausente ≠ tabela vazia', tabelaPresente({ parcelamento: [] }) && !tabelaPresente({ name: 'x' }))

  ok('tabela válida não acusa erro', validarTabela(TABELA).length === 0)
  const sobrepostas = validarTabela([
    { parcelasDe: 1, parcelasAte: 6, feePercent: 3, fixedFee: null, antecipacao: false },
    { parcelasDe: 4, parcelasAte: 12, feePercent: 4, fixedFee: null, antecipacao: false },
  ])
  ok('faixas sobrepostas são rejeitadas', sobrepostas.some((e) => e.mensagem.includes('sobrepostas')))
  ok('faixa invertida é rejeitada', validarTabela([{ parcelasDe: 6, parcelasAte: 3, feePercent: 1, fixedFee: null, antecipacao: false }]).some((e) => e.mensagem.includes('inválida')))
  ok('parcela zero é rejeitada', validarTabela([{ parcelasDe: 0, parcelasAte: 3, feePercent: 1, fixedFee: null, antecipacao: false }]).length > 0)
  ok('percentual negativo é rejeitado', validarTabela([{ parcelasDe: 1, parcelasAte: 1, feePercent: -1, fixedFee: null, antecipacao: false }]).length > 0)

  ok('1x resolve a linha de 1x', linhaParaParcelas(TABELA, 1)?.feePercent === 2.99)
  ok('2x resolve a linha de 2x', linhaParaParcelas(TABELA, 2)?.feePercent === 3.39)
  ok('5x cai na faixa 4–6', linhaParaParcelas(TABELA, 5)?.feePercent === 4.19)
  ok('12x cai na faixa 7–12', linhaParaParcelas(TABELA, 12)?.feePercent === 4.59)
  ok('fora da tabela não resolve', linhaParaParcelas(TABELA, 18) === null)
  ok('sem tabela não resolve', linhaParaParcelas([], 3) === null && linhaParaParcelas(null, 3) === null)

  ok('rótulo de parcela única', rotuloLinha({ parcelasDe: 1, parcelasAte: 1 }) === '1x')
  ok('rótulo de faixa', rotuloLinha({ parcelasDe: 4, parcelasAte: 6 }) === '4–6x')
  ok('grava com ordem estável', JSON.stringify(linhasParaCriar(TABELA)?.create[3].ordem) === '3')
  ok('tabela vazia não grava nada', linhasParaCriar([]) === undefined)
}

sec('2 — cobrança: escolhe forma e parcelas, aplica exatamente aquela linha')
{
  const um = cobrar(1)
  ok('1x aplica 2,99% (29,90 sobre 1000)', um.ok && um.valorTaxa === 29.9)
  const dois = cobrar(2)
  ok('2x aplica 3,39%', dois.ok && dois.valorTaxa === 33.9)
  const cinco = cobrar(5)
  ok('5x aplica a faixa 4–6 (4,19%)', cinco.ok && cinco.valorTaxa === 41.9)
  const doze = cobrar(12)
  ok('12x aplica a faixa 7–12 (4,59%)', doze.ok && doze.valorTaxa === 45.9)

  ok('a linha usada aparece na memória', cinco.memoria.some((m) => m.includes('Tabela de parcelamento: 4–6x')))
  ok('a taxa aplicada identifica a linha', String(doze.taxaAplicada?.nome).includes('7–12x'))
  ok('um único registro de taxa cobre a tabela toda', [um, dois, cinco, doze].every((r) => r.taxaAplicada?.id === 7))

  // quantidade fora da tabela: a taxa simplesmente não é candidata
  const fora = calcularCobranca({
    aplicaComo: 'RECEBER', valorBase: 1000, moeda: 'BRL', dataBase: new Date('2026-03-10'),
    forma: formaView({ maxParcelas: 24 }), condicao: condView({ parcelasMax: 24 }), nParcelas: 18,
    taxaCandidatas: [{ id: 7, nome: 'Adquirente X', tipo: 'PERCENTUAL', ativo: true, baseIncidencia: 'TOTAL', tabelaParcelamento: TABELA } as never],
  })
  ok('parcelas fora da tabela: taxa não se aplica', fora.ok && fora.valorTaxa === 0 && fora.taxaAplicada === null)
  ok('sem regra adicional: nada além da linha', fora.memoria.some((m) => m.includes('Nenhuma taxa compatível')))

  // valor fixo e antecipação vêm da linha
  const comFixo = cobrar(1, [{ parcelasDe: 1, parcelasAte: 1, feePercent: 1, fixedFee: 0.39, antecipacao: false }])
  ok('linha com percentual + valor fixo', comFixo.ok && comFixo.valorTaxa === 10.39)
  ok('tipo da taxa reflete a linha', comFixo.taxaAplicada?.tipo === 'PERCENTUAL_MAIS_FIXA')
}

sec('3 — compatibilidade: taxa sem tabela continua exatamente igual')
{
  const semTabela = calcularCobranca({
    aplicaComo: 'RECEBER', valorBase: 1000, moeda: 'BRL', dataBase: new Date('2026-03-10'),
    forma: formaView(), condicao: condView(), nParcelas: 3,
    taxaCandidatas: [{ id: 8, nome: 'Taxa simples', tipo: 'PERCENTUAL', percentual: 2, ativo: true, baseIncidencia: 'TOTAL' } as never],
  })
  ok('sem tabela usa o percentual do registro', semTabela.ok && semTabela.valorTaxa === 20)
  ok('sem tabela não cita linha na memória', !semTabela.memoria.some((m) => m.includes('Tabela de parcelamento')))

  const candidata = taxaParaCandidata({ id: 9, name: 'X', feeType: 'percentage', feePercent: 3, parcelamento: [{ parcelasDe: 1, parcelasAte: 2, feePercent: '2.5', fixedFee: null, antecipacao: false }] })
  ok('registro do banco vira candidata com tabela', candidata.tabelaParcelamento?.length === 1 && candidata.tabelaParcelamento[0].feePercent === 2.5)
  ok('registro sem tabela vira candidata sem tabela', (taxaParaCandidata({ id: 9, name: 'X' }).tabelaParcelamento ?? []).length === 0)
}

sec('4 — interface: grade bandeiras × 1x–12x na config da FORMA')
{
  const tabRaw = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/TaxasPagamentoTab.tsx'), 'utf8')
  const tab = tabRaw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

  ok('campo "Aplica-se a" não existe mais', !tab.includes('Aplica-se a'))

  // A grade do crédito é bandeiras × 1x–12x, dentro da config da forma.
  ok('grade 1x–12x (cabeçalho de parcelas)', tab.includes('const PARCELAS') && tab.includes('map((p) =>') && tab.includes('{p}x'))
  ok('linha por bandeira', tab.includes('det.bandeiras.map((band)') && tab.includes('band.nome'))
  ok('célula editável por parcela (setCell)', tab.includes('setCell(band.id, p') && tab.includes('grade[band.id]?.[p]'))
  ok('salva em lote transacional via PUT /formas', tab.includes("method: 'PUT'") && tab.includes('gradeSpec'))
  ok('hidrata a grade do registro (t.grade)', tab.includes('t?.grade') || tab.includes('.grade ?? []'))
}

sec('5 — persistência e migration aditiva')
{
  const route = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/route.ts'), 'utf8')
  const put = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/taxas-pagamento/[id]/route.ts'), 'utf8')

  ok('GET devolve a tabela junto da taxa', route.includes('INCLUDE_PARCELAMENTO'))
  ok('POST valida a tabela antes de gravar', route.includes('validarTabela') && route.includes('linhasParaCriar'))
  ok('PUT valida e regrava a tabela', put.includes('validarTabela') && put.includes('regravarLinhas'))
  ok('PUT não apaga tabela ausente do body', put.includes('const temTabela = tabelaPresente(b)') && put.includes('if (temTabela) await regravarLinhas'))

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  ok('modelo TaxaParcelamento existe', schema.includes('model TaxaParcelamento {'))
  ok('unicidade por faixa', schema.includes('@@unique([taxaId, parcelasDe, parcelasAte])'))
  ok('colunas legadas preservadas no schema', schema.includes('aplicaParcela String?') && schema.includes('installmentsFrom    Int?'))

  const dir = join(RAIZ, 'prisma/migrations-arquivo/20260804000000_taxa_tabela_parcelamento/migration.sql')
  ok('migration existe', existsSync(dir))
  const sql = readFileSync(dir, 'utf8')
  ok('migration não é destrutiva', !/DROP\s+(TABLE|COLUMN)/i.test(sql) && !/DELETE\s+FROM/i.test(sql) && !/TRUNCATE/i.test(sql))
  ok('migration é idempotente', sql.includes('IF NOT EXISTS') && sql.includes('DO NOTHING'))
  ok('faixa legada vira a primeira linha', sql.includes("WHERE t.\"aplicaParcela\" = 'FAIXA'"))

  const aplicador = readFileSync(join(RAIZ, 'scripts/prod-apply-cadastros-aditivas.mjs'), 'utf8')
  ok('migration registrada no build', aplicador.includes('20260804000000_taxa_tabela_parcelamento'))
  ok('sentinela da nova tabela', aplicador.includes("'TaxaParcelamento'"))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Taxa — Tabela de parcelamento: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
