// Regressão do relato de produção: "alterei o vencimento de uma receita e ela sumiu".
// PROVA que NÃO é perda de dado: ao mudar o vencimento de passado→futuro, a receita
// permanece na lista (não é removida), mas seu aging migra VENCIDO→A VENCER e ela troca
// de aba. O fix (ReceitasTab) não deixa isso ser silencioso: quando a receita observada
// continua existindo mas saiu da aba filtrada, um aviso "Ver em Todas" aparece.
// Este teste reproduz E2E o banco e valida o predicado exato do aviso.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { editarReceita } from '@/lib/financeiro/acoes/editar-receita'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'

// espelho do mapa da ReceitasTab (statusConsolidado -> aba)
const ABA_DE: Record<string, string> = { 'A VENCER': 'avencer', PARCIAL: 'avencer', VENCIDO: 'vencidas', QUITADO: 'pagas', CANCELADO: 'canceladas' }
// espelho do predicado movidaForaDoFiltro da ReceitasTab
const avisoDispara = (grupos: any[], aba: string, movidaId: number) => {
  const filtrados = grupos.filter((g) => aba === 'todas' || ABA_DE[g.statusConsolidado] === aba)
  return aba !== 'todas' && grupos.some((g) => g.id === movidaId) && !filtrados.some((g) => g.id === movidaId)
}

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const PROC = 16
  const receita = await prisma.receita.create({ data: { processoId: PROC, valor: 640, moeda: 'BRL', fxEstimado: 5.5, data1: new Date(), descricao: 'TESTE venc move', codigo: `REC-VMV-${Date.now().toString().slice(-8)}` } as any })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 640, moedaContratual: 'BRL', processoId: PROC, origemTipo: 'Receita', origemId: receita.id, criadoPorId: 1, vencimento: new Date('2025-01-01') })
  const ref = String(obrigacaoId)
  const grupo = (l: any) => (l.receitas as any[]).find((g) => g.id === obrigacaoId)

  const antes = await listarReceitas(PROC)
  const gA = grupo(antes)
  chk(!!gA, 'receita presente na lista ANTES')
  chk(gA?.statusConsolidado === 'VENCIDO', `status ANTES = VENCIDO (${gA?.statusConsolidado})`)
  chk(ABA_DE[gA?.statusConsolidado] === 'vencidas', 'ANTES pertence à aba "vencidas"')

  const r = await editarReceita(ref, { titulo: 'TESTE venc move', descricaoDetalhada: '', referenciaContratual: '', observacoes: null, vencimento: '2027-03-15' } as any, { criadoPorId: 1 })
  chk((r as any).ok === true, 'editarReceita (vencimento) ok')

  const depois = await listarReceitas(PROC)
  const gD = grupo(depois)
  chk(!!gD, 'receita CONTINUA na lista DEPOIS (NÃO foi removida) — não é perda de dado')
  chk((depois.receitas as any[]).length === (antes.receitas as any[]).length, 'total da lista inalterado')
  chk(gD?.statusConsolidado === 'A VENCER', `status DEPOIS = A VENCER (${gD?.statusConsolidado})`)

  // No banco: sem marca de exclusão / arquivamento
  const rec = await prisma.receita.findUnique({ where: { id: receita.id }, select: { arquivadaEm: true, contextoAplicado: true } })
  chk(rec?.arquivadaEm == null, 'Receita.arquivadaEm continua nulo (não arquivada)')
  chk(!(rec?.contextoAplicado as any)?.exclusao, 'contextoAplicado.exclusao ausente (não excluída)')
  const obr = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { status: true } })
  chk(obr?.status === 'ATIVO', `obrigação segue ATIVO (${obr?.status})`)

  // Predicado do aviso: quem estava em "vencidas" recebe o aviso; em "todas" NÃO.
  chk(avisoDispara(depois.receitas as any[], 'vencidas', obrigacaoId) === true, 'AVISO dispara na aba "vencidas" (saiu do filtro)')
  chk(avisoDispara(depois.receitas as any[], 'avencer', obrigacaoId) === false, 'AVISO não dispara em "avencer" (é onde ela está agora)')
  chk(avisoDispara(depois.receitas as any[], 'todas', obrigacaoId) === false, 'AVISO nunca dispara em "todas"')

  // limpeza
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrigacaoId)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})
  await prisma.receita.delete({ where: { id: receita.id } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
