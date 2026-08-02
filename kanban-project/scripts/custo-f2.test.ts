// F2 — Paridade de ciclo de vida do Custo (reusando o motor V3; Custo segue domínio próprio).
// Prova: editar fornecedor/fase/centro; duplicar; arquivar/desarquivar — tudo p/ custo.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { criarFornecedor } from '@/src/services/fornecedor'
import { editarReceita, carregarReceitaEditavel } from '@/lib/financeiro/acoes/editar-receita'
import { duplicarReceita } from '@/lib/financeiro/acoes/duplicar-receita'
import { arquivarReceita } from '@/lib/financeiro/acoes/arquivar'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const D = `9${Date.now().toString().slice(-13)}`.padStart(14, '9').slice(0, 14)
// 2º CNPJ SEMPRE distinto do 1º (antes usava o dígito fixo '8' e colidia com D quando o
// último dígito do timestamp era 8 → dedup devolvia o MESMO fornecedor e o teste falhava 1x a cada 10).
const D2 = `${D.slice(0, 13)}${(Number(D[13]) + 1) % 10}`

async function limparObr(id: number) {
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: id } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } })
  await prisma.distribuicaoEconomica.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } })
  await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
}

async function main() {
  const PROC = 16
  const fA = await criarFornecedor({ nome: 'Cartório A', tipo: 'PJ', cpfCnpj: D })
  const fB = await criarFornecedor({ nome: 'Tradutor B', tipo: 'PJ', cpfCnpj: D2 })
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 400, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1, fornecedorId: fA!.id, observacoes: 'Custo base' })
  const ref = String(obrigacaoId)

  // (1) EDITAR fornecedor + fase + descrição
  const r = await editarReceita(ref, { fornecedorId: fB!.id, faseId: 7, titulo: 'Custo — editado' } as any, { criadoPorId: 1 })
  chk((r as any).ok === true, `editar campos do custo ok (${JSON.stringify((r as any).erros)})`)
  const obr1 = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { fornecedorId: true, faseId: true, observacoes: true } })
  chk(obr1?.fornecedorId === fB!.id, `fornecedor alterado (${obr1?.fornecedorId})`)
  chk(obr1?.faseId === 7, `fase alterada (${obr1?.faseId})`)
  chk(obr1?.observacoes === 'Custo — editado', 'descrição alterada')
  const edit = await carregarReceitaEditavel(ref)
  chk((edit as any)?.fornecedorId === fB!.id && (edit as any)?.fornecedorNome === 'Tradutor B', `editor semeia fornecedor atual (${(edit as any)?.fornecedorNome})`)

  // (2) DUPLICAR custo
  const dup = await duplicarReceita(ref, { usuarioId: 1 })
  const dObr = await prisma.obrigacaoEconomica.findUnique({ where: { id: dup.obrigacaoId }, select: { natureza: true, valorContratado: true, fornecedorId: true, origemTipo: true } })
  chk(dObr?.natureza === 'CUSTO', 'duplicado nasce natureza CUSTO')
  chk(Number(dObr?.valorContratado) === 400, 'valor copiado')
  chk(dObr?.fornecedorId === fB!.id, 'fornecedor copiado na duplicação')
  chk(!/^REC/i.test(dup.codigo), `código do custo NÃO usa prefixo de receita (${dup.codigo})`)
  const ocsDup = await prisma.ocorrenciaFinanceira.count({ where: { obrigacaoId: dup.obrigacaoId, tipo: { in: ['PAGAMENTO', 'PAGAMENTO_PARCIAL'] } } })
  chk(ocsDup === 0, 'duplicado nasce ZERADO (sem pagamentos da origem)')
  const logDup = await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: dup.obrigacaoId, acao: 'DUPLICAR' } })
  chk(!!logDup, 'LogAuditoria DUPLICAR gravado')

  // (3) ARQUIVAR / DESARQUIVAR
  const naLista = async () => (await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).some((o) => o.obrigacaoId === obrigacaoId)
  const arq = await arquivarReceita(ref, { arquivar: true }, { usuarioId: 1 })
  chk((arq as any).arquivada === true, 'arquivarReceita(custo) → arquivada')
  chk(!(await naLista()), 'custo arquivado some da lista')
  chk(!!(await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, acao: 'ARQUIVAR' } })), 'LogAuditoria ARQUIVAR')
  const desarq = await arquivarReceita(ref, { arquivar: false }, { usuarioId: 1 })
  chk((desarq as any).arquivada === false, 'desarquivar → arquivada:false')
  const obr2 = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { arquivadaEm: true } })
  chk(obr2?.arquivadaEm == null, 'arquivadaEm limpo ao desarquivar')
  chk(await naLista(), 'custo volta à lista ao desarquivar')
  chk(!!(await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, acao: 'DESARQUIVAR' } })), 'LogAuditoria DESARQUIVAR')

  // limpeza
  await limparObr(dup.obrigacaoId)
  await limparObr(obrigacaoId)
  await prisma.fornecedor.deleteMany({ where: { id: { in: [fA!.id, fB!.id] } } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
