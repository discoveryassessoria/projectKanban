// F8.1 — Inteligência do lançamento de custo: núcleo puro + comportamento no banco real.
// Prova: mediana/classificação de valor; sugestão de fornecedor/valor pelo histórico
// do MESMO item; duplicidade provável (mesmo processo/fornecedor/valor na janela) com
// evidências; vencimento no passado; avisos de completude; e — o mais importante — que a
// análise NUNCA grava nada e NUNCA bloqueia.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { criarFornecedor } from '@/src/services/fornecedor'
import {
  analisarLancamentoCusto, classificarValor, mediana, maisFrequente,
  JANELA_DUPLICIDADE_DIAS, AMOSTRA_MINIMA_FAIXA,
} from '@/lib/financeiro/inteligencia/analise-lancamento-custo'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const RAIZ = join(__dirname, '..')
const PROC = 16
const TS = Date.now()
const temAviso = (a: { avisos: { codigo: string }[] }, cod: string) => a.avisos.some((x) => x.codigo === cod)

async function main() {
  // ───────── núcleo PURO ─────────
  chk(mediana([10, 20, 30]) === 20, 'mediana ímpar')
  chk(mediana([10, 20, 30, 40]) === 25, 'mediana par')
  chk(mediana([]) === 0, 'mediana de lista vazia é 0')
  chk(classificarValor(100, [90, 100, 110]) === 'ok', 'valor dentro da faixa praticada')
  chk(classificarValor(500, [90, 100, 110]) === 'acima', 'valor bem acima da faixa')
  chk(classificarValor(10, [90, 100, 110]) === 'abaixo', 'valor bem abaixo da faixa')
  chk(classificarValor(500, [100, 100]) === 'sem-base', `amostra < ${AMOSTRA_MINIMA_FAIXA} não gera julgamento`)
  chk(maisFrequente([1, 2, 2, null, 3])?.id === 2, 'mais frequente ignora nulos')
  chk(maisFrequente([])?.id === undefined, 'sem dados → sem sugestão')
  chk(maisFrequente([5, 5, 7, 7])?.id === 5, 'empate resolve pelo menor id (estável)')

  // ───────── fixtures no banco ─────────
  const item = await prisma.itemCatalogo.create({ data: { code: `F81-${TS}`, name: `Certidão F81 ${TS}`, natureza: 'DOCUMENTO' } as any, select: { id: true } })
  const fornA = await criarFornecedor({ nome: `Cartório A ${TS}`, tipo: 'PJ', cpfCnpj: `1${String(TS).slice(-13)}`.slice(0, 14) })
  const fornB = await criarFornecedor({ nome: `Cartório B ${TS}`, tipo: 'PJ', cpfCnpj: `2${String(TS).slice(-13)}`.slice(0, 14) })

  // histórico: 3 lançamentos do MESMO item, fornecedor A, ~200
  for (const v of [190, 200, 210]) {
    await criarObrigacaoEconomicaComLedger({
      natureza: 'CUSTO', valorContratado: v, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1,
      fornecedorId: fornA!.id, itemCatalogoId: item.id, observacoes: 'histórico F81',
    })
  }

  // ───────── sugestões ─────────
  const a1 = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL' })
  chk(a1.baseHistorica === 3, `base histórica reconhecida (${a1.baseHistorica})`)
  chk(a1.sugestoes.fornecedor?.id === fornA!.id, `sugere o fornecedor mais usado (${a1.sugestoes.fornecedor?.nome ?? '—'})`)
  chk(a1.sugestoes.valorTipico?.valor === 200, `sugere o valor típico = mediana (${a1.sugestoes.valorTipico?.valor})`)
  chk(a1.sugestoes.valorTipico?.minimo === 190 && a1.sugestoes.valorTipico?.maximo === 210, 'sugestão informa a faixa observada')

  // moeda diferente não mistura histórico
  const aEur = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'EUR' })
  chk(aEur.sugestoes.valorTipico === null, 'valor típico não mistura moedas')

  // ───────── valor fora da faixa ─────────
  const aAlto = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 2000, fornecedorId: fornB!.id })
  chk(temAviso(aAlto, 'VALOR_ACIMA_DO_HISTORICO'), 'avisa valor bem acima do praticado')
  const aBaixo = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 20, fornecedorId: fornB!.id })
  chk(temAviso(aBaixo, 'VALOR_ABAIXO_DO_HISTORICO'), 'avisa valor bem abaixo do praticado')
  const aOk = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 205, fornecedorId: fornB!.id })
  chk(!temAviso(aOk, 'VALOR_ACIMA_DO_HISTORICO') && !temAviso(aOk, 'VALOR_ABAIXO_DO_HISTORICO'), 'valor normal não gera ruído')

  // ───────── duplicidade provável ─────────
  const aDup = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 200, fornecedorId: fornA!.id })
  chk(temAviso(aDup, 'DUPLICIDADE_PROVAVEL'), `duplicidade detectada na janela de ${JANELA_DUPLICIDADE_DIAS} dias`)
  const dup = aDup.avisos.find((x) => x.codigo === 'DUPLICIDADE_PROVAVEL')!
  chk((dup.evidencias?.length ?? 0) >= 1, `aviso traz EVIDÊNCIA verificável (${dup.evidencias?.length ?? 0} registro(s))`)
  chk(dup.severidade === 'alto', 'duplicidade é o aviso mais grave')

  // tolerância de 1%: 201 ainda é "mesmo valor"; 260 não é
  chk(temAviso(await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 201, fornecedorId: fornA!.id }), 'DUPLICIDADE_PROVAVEL'), 'tolerância de 1% no valor')
  chk(!temAviso(await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 260, fornecedorId: fornA!.id }), 'DUPLICIDADE_PROVAVEL'), 'valor diferente não vira duplicidade')

  // fornecedor diferente + valor igual: sem fornecedor informado compara por ITEM
  chk(!temAviso(await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 200, fornecedorId: fornB!.id }), 'DUPLICIDADE_PROVAVEL'), 'outro fornecedor com o mesmo valor não é duplicidade')

  // em EDIÇÃO a própria obrigação não é duplicata de si mesma
  const existente = await prisma.obrigacaoEconomica.findFirst({ where: { processoId: PROC, itemCatalogoId: item.id, valorContratado: 200 }, select: { id: true } })
  const aEdit = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 200, fornecedorId: fornA!.id, ignorarObrigacaoId: existente!.id })
  const dupEdit = aEdit.avisos.find((x) => x.codigo === 'DUPLICIDADE_PROVAVEL')
  chk(!dupEdit?.evidencias?.some((ev) => ev.obrigacaoId === existente!.id), 'em edição, o próprio registro não conta como duplicata')

  // custo CANCELADO não conta como duplicata
  await prisma.obrigacaoEconomica.update({ where: { id: existente!.id }, data: { status: 'CANCELADO' } })
  const aPosCancel = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 200, fornecedorId: fornA!.id })
  chk(!aPosCancel.avisos.find((x) => x.codigo === 'DUPLICIDADE_PROVAVEL')?.evidencias?.some((ev) => ev.obrigacaoId === existente!.id), 'custo cancelado não conta como duplicidade')
  await prisma.obrigacaoEconomica.update({ where: { id: existente!.id }, data: { status: 'ATIVO' } })

  // ───────── completude e datas ─────────
  const aVenc = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 205, vencimento: '2020-01-01' })
  chk(temAviso(aVenc, 'VENCIMENTO_NO_PASSADO'), 'avisa vencimento no passado')
  chk(temAviso(aVenc, 'SEM_FORNECEDOR'), 'avisa ausência de fornecedor')
  const aCompleto = await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 205, fornecedorId: fornB!.id })
  chk(!temAviso(aCompleto, 'SEM_FORNECEDOR') && !temAviso(aCompleto, 'SEM_CENTRO_CUSTO'), 'lançamento completo não recebe aviso de completude')

  // ordem: o mais grave primeiro
  chk(aDup.avisos[0].severidade === 'alto', 'avisos ordenados por gravidade')

  // ───────── invariante: análise é SOMENTE LEITURA ─────────
  const antes = await prisma.obrigacaoEconomica.count({ where: { processoId: PROC } })
  const logsAntes = await prisma.logAuditoria.count()
  await analisarLancamentoCusto({ processoId: PROC, itemCatalogoId: item.id, moeda: 'BRL', valor: 200, fornecedorId: fornA!.id })
  chk(await prisma.obrigacaoEconomica.count({ where: { processoId: PROC } }) === antes, 'a análise NÃO cria obrigação')
  chk(await prisma.logAuditoria.count() === logsAntes, 'a análise NÃO grava auditoria')

  // sem item escolhido → sem palpite (nada de inventar sugestão)
  const aSemItem = await analisarLancamentoCusto({ processoId: PROC, moeda: 'BRL' })
  chk(aSemItem.baseHistorica === 0 && aSemItem.sugestoes.fornecedor === null && aSemItem.sugestoes.valorTipico === null, 'sem item não há sugestão (não inventa)')

  // ───────── guardas de integração ─────────
  const rota = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/custos/analise/route.ts'), 'utf8')
  chk(/verificarPermissao\(req, 'financeiro\.ver'\)/.test(rota), 'rota de análise é gated (financeiro.ver)')
  chk(!/prisma\.[a-zA-Z]+\.(create|update|delete)/.test(rota), 'rota de análise não escreve no banco')
  // O formulário legado (LancamentoManualModal) foi substituído pelo lançamento
  // definitivo; a inteligência migrou junto e continua sendo conselho, nunca
  // preenchimento automático.
  const modal = readFileSync(join(RAIZ, 'src/components/financeiro/v3/lancamento/LancamentoFinanceiroModal.tsx'), 'utf8')
  chk(modal.includes('/api/financeiro/v3/custos/analise'), 'modal de lançamento consome a análise')
  chk(/if \(!custo \|\| !item\) return/.test(modal), 'a inteligência roda só para CUSTO')
  chk(/onClick=\{\(\) => alterar\(setFornecedorId\)/.test(modal), 'sugestão é APLICADA por ação do operador (nunca automática)')
  chk(!/setFornecedorId\(String\(analise\.sugestoes/.test(modal.replace(/onClick=\{\(\) => alterar\(setFornecedorId\)\(String\(analise\.sugestoes\.fornecedor!\.id\)\)/g, '')), 'nenhuma aplicação silenciosa da sugestão')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
