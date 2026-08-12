// F0 — Custos: correção dos no-ops "Editar custo" e "Excluir custo" + auditoria.
// Prova E2E no banco:
//  (1) Editar um Custo (sem Receita) altera a descrição (ObrigacaoEconomica.observacoes)
//      e grava LogAuditoria EDITAR — antes era no-op (só escrevia em prisma.receita).
//  (2) Excluir um Custo marca ObrigacaoEconomica.arquivadaEm, some das consultas padrão,
//      preserva o Ledger e grava LogAuditoria EXCLUIR — antes era no-op (só ocultava Receita).
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { editarReceita } from '@/lib/financeiro/acoes/editar-receita'
import { podeExcluir, excluirReceita } from '@/lib/financeiro/acoes/excluir-receita'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

async function main() {
  const PROC = 16
  // Custo NATIVO (sem Receita de origem) — origemTipo null.
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 300, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1, observacoes: 'Custo cartório (original)' })
  const ref = String(obrigacaoId)
  const naLista = async () => (await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).some((o) => o.obrigacaoId === obrigacaoId)

  chk(await naLista(), 'custo aparece na lista de custos ANTES')

  // (1) EDITAR descrição
  const r = await editarReceita(ref, { titulo: 'Custo cartório — EDITADO' } as any, { criadoPorId: 1 })
  chk((r as any).ok === true, `editarReceita ok (${JSON.stringify((r as any).erros)})`)
  const obrPos = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { observacoes: true } })
  chk(obrPos?.observacoes === 'Custo cartório — EDITADO', `descrição do custo ATUALIZADA (${obrPos?.observacoes})`)
  const logEdit = await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, acao: 'EDITAR' } })
  chk(!!logEdit, 'LogAuditoria EDITAR gravado (antes→depois)')
  chk((logEdit?.detalhes as any)?.de === 'Custo cartório (original)' && (logEdit?.detalhes as any)?.para === 'Custo cartório — EDITADO', 'auditoria registra de→para corretos')

  // (2) EXCLUIR
  const check = await podeExcluir(ref)
  chk((check as any).permitido === true, `podeExcluir custo = permitido (${JSON.stringify((check as any).motivos)})`)
  const ex = await excluirReceita(ref, { usuarioId: 1, motivo: 'teste F0' })
  chk((ex as any).excluida === true, 'excluirReceita(custo) retorna excluida:true')
  const obrDel = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { arquivadaEm: true, status: true } })
  chk(obrDel?.arquivadaEm != null, 'ObrigacaoEconomica.arquivadaEm preenchido (soft-delete)')
  chk(obrDel?.status !== 'CANCELADO', 'exclusão ≠ cancelamento (status NÃO vira CANCELADO)')
  chk(!(await naLista()), 'custo SOME da lista de custos depois de excluir')
  const proj = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId } })
  chk(proj != null, 'Ledger/projeção PRESERVADOS (não apagados)')
  const logDel = await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId, acao: 'EXCLUIR' } })
  chk(!!logDel && (logDel?.detalhes as any)?.natureza === 'CUSTO', 'LogAuditoria EXCLUIR gravado (natureza CUSTO)')

  // limpeza
  await prisma.logAuditoria.deleteMany({ where: { entidade: 'ObrigacaoEconomica', entidadeId: obrigacaoId } }).catch(() => {})
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrigacaoId)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
