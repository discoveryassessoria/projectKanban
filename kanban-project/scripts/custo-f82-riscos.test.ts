// F8.2 — Riscos e pendências de Contas a Pagar: núcleo puro + banco real.
// Prova: agrupamento de duplicidade; detecção de vencido, parado em análise, sem
// fornecedor, sem data/cronograma e pago sem conciliar; ordenação por gravidade;
// coerência com a lista (mesma base) e ausência de escrita.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { criarFornecedor } from '@/src/services/fornecedor'
import { listarContasAPagar } from '@/lib/financeiro/leitura/contas-a-pagar'
import {
  riscosContasAPagar, gruposDuplicados, emAberto,
  DIAS_APROVACAO_PENDENTE, DIAS_CONCILIACAO_PENDENTE,
} from '@/lib/financeiro/inteligencia/riscos-custo'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const RAIZ = join(__dirname, '..')
const TS = Date.now()
const DIA = 86_400_000
const item = (p: Partial<any>): any => ({ obrigacaoId: 1, processoId: 99, fornecedor: 'F', moeda: 'BRL', valorContratado: 100, criadoEm: new Date().toISOString(), balde: 'FUTURA', saldoBrl: 100, ...p })

async function main() {
  // ───────── núcleo PURO ─────────
  chk(emAberto(item({ balde: 'VENCIDA' })) && !emAberto(item({ balde: 'PAGA' })) && !emAberto(item({ balde: 'CANCELADA' })), 'em aberto = nem paga nem cancelada')
  const dups = gruposDuplicados([
    item({ obrigacaoId: 1 }), item({ obrigacaoId: 2 }), // iguais → grupo
    item({ obrigacaoId: 3, valorContratado: 200 }),     // valor diferente
    item({ obrigacaoId: 4, fornecedor: 'Outro' }),      // fornecedor diferente
    item({ obrigacaoId: 5, processoId: 100 }),          // outro processo
  ])
  chk(dups.length === 1 && dups[0].length === 2, `agrupa só o par realmente igual (${dups.length} grupo(s))`)
  chk(gruposDuplicados([item({ obrigacaoId: 1, fornecedor: null }), item({ obrigacaoId: 2, fornecedor: null })]).length === 0, 'sem fornecedor não vira duplicidade (seria falso positivo)')
  chk(gruposDuplicados([item({ obrigacaoId: 1, criadoEm: new Date(Date.now() - 60 * DIA).toISOString() }), item({ obrigacaoId: 2, criadoEm: new Date(Date.now() - 60 * DIA).toISOString() })]).length === 0, 'fora da janela não vira duplicidade')

  // ───────── fixtures no banco: processo isolado ─────────
  const proc = await prisma.processo.create({ data: { nome: `Proc riscos F82 ${TS}`, pais: 'Itália' }, select: { id: true } })
  const forn = await criarFornecedor({ nome: `Fornecedor F82 ${TS}`, tipo: 'PJ', cpfCnpj: `3${String(TS).slice(-13)}`.slice(0, 14) })
  const novo = (extra: Record<string, unknown>) => criarObrigacaoEconomicaComLedger({
    natureza: 'CUSTO', moedaContratual: 'BRL', processoId: proc.id, criadoPorId: 1, ...extra,
  } as any)

  // vencido (com fornecedor e data no passado)
  const { obrigacaoId: vencido } = await novo({ valorContratado: 300, fornecedorId: forn!.id, vencimento: new Date(Date.now() - 5 * DIA), observacoes: 'vencido' })
  // parado em análise (PREVISTO) — envelhecido no banco para passar do limite
  const { obrigacaoId: previsto } = await novo({ valorContratado: 400, fornecedorId: forn!.id, vencimento: new Date(Date.now() + 30 * DIA), estadoCusto: 'PREVISTO', observacoes: 'em análise' })
  await prisma.obrigacaoEconomica.update({ where: { id: previsto }, data: { criadoEm: new Date(Date.now() - (DIAS_APROVACAO_PENDENTE + 2) * DIA) } })
  // sem fornecedor e sem data
  const { obrigacaoId: incompleto } = await novo({ valorContratado: 500, observacoes: 'incompleto' })
  // duplicidade: dois iguais (mesmo fornecedor/valor)
  const { obrigacaoId: dupA } = await novo({ valorContratado: 777, fornecedorId: forn!.id, vencimento: new Date(Date.now() + 10 * DIA), observacoes: 'dup A' })
  const { obrigacaoId: dupB } = await novo({ valorContratado: 777, fornecedorId: forn!.id, vencimento: new Date(Date.now() + 10 * DIA), observacoes: 'dup B' })

  const r = await riscosContasAPagar({ processoId: proc.id })
  const por = (cod: string) => r.riscos.find((x) => x.codigo === cod)
  chk(r.analisados >= 5, `analisa a mesma base da lista (${r.analisados})`)
  chk(por('VENCIDOS')?.obrigacaoIds.includes(vencido) === true, 'detecta custo vencido')
  chk(por('AGUARDANDO_APROVACAO')?.obrigacaoIds.includes(previsto) === true, `detecta parado em análise há ${DIAS_APROVACAO_PENDENTE}+ dias`)
  chk(por('SEM_FORNECEDOR')?.obrigacaoIds.includes(incompleto) === true, 'detecta custo sem fornecedor')
  chk(por('SEM_DATA')?.obrigacaoIds.includes(incompleto) === true, 'detecta custo sem vencimento nem cronograma')
  chk(por('SEM_DATA')?.obrigacaoIds.includes(vencido) === false, 'custo COM vencimento não entra em "sem data"')
  const dup = por('DUPLICIDADE_SUSPEITA')
  chk(!!dup && dup.obrigacaoIds.includes(dupA) && dup.obrigacaoIds.includes(dupB), 'detecta a dupla de custos iguais')
  chk(r.riscos[0].severidade === 'alto', 'riscos ordenados por gravidade')
  chk(r.riscos.every((x) => x.qtd > 0 && x.acao.length > 0), 'todo risco traz quantidade e o que fazer (nunca alerta estéril)')

  // total do risco confere com a lista (sem segunda fonte de verdade)
  const { itens } = await listarContasAPagar({ processoId: proc.id })
  const somaVencidos = itens.filter((o) => por('VENCIDOS')!.obrigacaoIds.includes(o.obrigacaoId)).reduce((s, o) => s + Number(o.saldoBrl ?? 0), 0)
  chk(Math.abs(somaVencidos - por('VENCIDOS')!.totalBrl) < 0.01, 'total do risco bate com a lista')

  // cronograma resolve o "sem data" (parcela pagável conta como data)
  await prisma.parcelaPagavel.create({ data: { obrigacaoId: incompleto, numero: 1, vencimento: new Date(Date.now() + 20 * DIA), valor: 500 } })
  const r2 = await riscosContasAPagar({ processoId: proc.id })
  chk(r2.riscos.find((x) => x.codigo === 'SEM_DATA')?.obrigacaoIds.includes(incompleto) !== true, 'definir cronograma tira o custo do risco "sem data"')

  // pago e não conciliado (envelhecido)
  await prisma.obrigacaoEconomica.update({ where: { id: dupA }, data: { estadoCusto: 'PAGO', criadoEm: new Date(Date.now() - (DIAS_CONCILIACAO_PENDENTE + 2) * DIA) } })
  const r3 = await riscosContasAPagar({ processoId: proc.id })
  chk(r3.riscos.find((x) => x.codigo === 'PAGO_SEM_CONCILIAR')?.obrigacaoIds.includes(dupA) === true, 'detecta pago sem conciliar')

  // processo sem nada → sem riscos (não inventa alerta)
  const procVazio = await prisma.processo.create({ data: { nome: `Proc vazio F82 ${TS}`, pais: 'Itália' }, select: { id: true } })
  const rVazio = await riscosContasAPagar({ processoId: procVazio.id })
  chk(rVazio.riscos.length === 0 && rVazio.analisados === 0, 'processo sem custos não gera risco algum')

  // invariante: análise de risco NÃO escreve
  const antes = await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } })
  await riscosContasAPagar({ processoId: proc.id })
  chk(await prisma.obrigacaoEconomica.count({ where: { processoId: proc.id } }) === antes, 'a análise de riscos não altera dados')

  // guardas de integração
  const rota = readFileSync(join(RAIZ, 'src/app/api/financeiro/v3/contas-a-pagar/route.ts'), 'utf8')
  chk(rota.includes('riscosContasAPagar'), 'endpoint de Contas a Pagar entrega os riscos')
  const painel = readFileSync(join(RAIZ, 'src/components/financeiro/v3/ContasAPagarDashboard.tsx'), 'utf8')
  chk(painel.includes('Riscos e pendências') && painel.includes('r.acao'), 'painel mostra os riscos com a ação recomendada')
  chk(painel.includes('onAbrirDetalhe(r.obrigacaoIds[0])'), 'painel permite abrir o caso (drill-down real, não alerta morto)')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
