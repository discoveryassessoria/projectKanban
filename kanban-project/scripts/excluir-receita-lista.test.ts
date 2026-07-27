// Regressão do bug de produção: Receita EXCLUÍDA (exclusão lógica) continuava
// aparecendo na lista de Receitas. Causa: listarReceitas filtrava obrigações só por
// status!=CANCELADO, ignorando a marca de exclusão (Receita.arquivadaEm +
// contextoAplicado.exclusao). Este teste reproduz E2E e exige que a receita excluída
// SUMA da lista, com Ledger/auditoria preservados.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { podeExcluir, excluirReceita } from '@/lib/financeiro/acoes/excluir-receita'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'
import { carregarVisaoGeralProcesso } from '@/lib/financeiro/leitura/visao-geral-processo'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const PROC = 16
  // Receita de origem + obrigação vinculada (origemTipo='Receita'), SEM pagamentos.
  const receita = await prisma.receita.create({ data: { processoId: PROC, valor: 500, moeda: 'BRL', fxEstimado: 5.5, data1: new Date(), descricao: 'TESTE exclusão lista', codigo: `REC-EXCL-${Date.now().toString().slice(-8)}` } as any })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
    natureza: 'RECEITA', valorContratado: 500, moedaContratual: 'BRL', processoId: PROC,
    origemTipo: 'Receita', origemId: receita.id, criadoPorId: 1,
  })
  const ref = String(obrigacaoId)

  // aparece ANTES da exclusão
  const antes = await listarReceitas(PROC)
  chk((antes.receitas as any[]).some((g) => g.id === obrigacaoId), 'receita aparece na lista ANTES de excluir')

  // exclusão permitida (sem pagamento/bloqueio)
  const check = await podeExcluir(ref)
  chk((check as any).permitido === true, `podeExcluir = permitido (${JSON.stringify((check as any).motivos ?? [])})`)

  const res = await excluirReceita(ref, { usuarioId: 1, motivo: 'teste' })
  chk((res as any).excluida === true, 'excluirReceita retorna excluida:true')

  // DB: marca de exclusão + Ledger preservado + auditoria
  const rDb = await prisma.receita.findUnique({ where: { id: receita.id }, select: { arquivadaEm: true, contextoAplicado: true } })
  chk(rDb?.arquivadaEm != null, 'Receita.arquivadaEm preenchido (soft-delete)')
  chk(!!(rDb?.contextoAplicado as any)?.exclusao, 'contextoAplicado.exclusao marcado')
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } })
  chk(proj != null, 'Ledger/projeção PRESERVADOS (não apagados)')
  const evt = await prisma.eventoFinanceiro.findFirst({ where: { receitaId: receita.id, tipo: 'CANCELAMENTO' } })
  chk(!!evt, 'evento de auditoria da exclusão criado')

  // O CERNE: some de TODAS as consultas padrão DEPOIS de excluir
  const depois = await listarReceitas(PROC)
  chk(!(depois.receitas as any[]).some((g) => g.id === obrigacaoId), 'receita SOME da LISTA depois de excluir')
  const obrsDepois = await listarObrigacoes({ processoId: PROC })
  chk(!obrsDepois.some((o) => o.obrigacaoId === obrigacaoId), 'receita SOME de listarObrigacoes (consulta padrão)')
  const vgDepois = await carregarVisaoGeralProcesso(PROC)
  chk(![...vgDepois.receitas, ...vgDepois.custos].some((i: any) => i.id === obrigacaoId), 'receita SOME da VISÃO GERAL depois de excluir')

  // limpeza
  await prisma.eventoFinanceiro.deleteMany({ where: { receitaId: receita.id } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrigacaoId)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})
  await prisma.receita.delete({ where: { id: receita.id } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
