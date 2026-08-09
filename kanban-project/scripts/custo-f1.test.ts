// F1 — Fornecedor: FK real em ObrigacaoEconomica + dedup no cadastro + reuso/leitura.
// Prova:
//  (1) DEDUP: criar fornecedor com o mesmo CPF/CNPJ (formatação diferente) REUSA o
//      cadastro existente — não duplica.
//  (2) FK REAL: obrigação com fornecedorId válido grava; com id inexistente FALHA (FK).
//  (3) READ-MODEL: listarObrigacoes(CUSTO) passa a expor o NOME do fornecedor (antes o
//      fornecedorId era gravado e nunca lido).
//  (4) ON DELETE SET NULL: remover o fornecedor não apaga o custo — só zera o vínculo.
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { criarFornecedor } from '@/src/services/fornecedor'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const DIGITS = `9${Date.now().toString().slice(-13)}`.padStart(14, '9').slice(0, 14) // CNPJ sintético único

async function main() {
  const PROC = 16
  // (1) DEDUP
  const f1 = await criarFornecedor({ nome: 'Cartório Central', tipo: 'PJ', cpfCnpj: `${DIGITS.slice(0,2)}.${DIGITS.slice(2,5)}.${DIGITS.slice(5,8)}/${DIGITS.slice(8,12)}-${DIGITS.slice(12)}` })
  const f2 = await criarFornecedor({ nome: 'Cartorio Central (grafia diferente)', tipo: 'PJ', cpfCnpj: DIGITS }) // só dígitos
  chk(f1!.id === f2!.id, `dedup por CPF/CNPJ: mesmo cadastro reusado (${f1!.id} == ${f2!.id})`)
  const qtd = (await prisma.fornecedor.findMany({ where: { cpfCnpj: { not: null } }, select: { id: true, cpfCnpj: true } })).filter((f) => (f.cpfCnpj ?? '').replace(/\D/g, '') === DIGITS).length
  chk(qtd === 1, `apenas 1 fornecedor com esse CNPJ (${qtd})`)

  // (2) FK REAL — id inexistente deve falhar
  let fkBarrou = false
  try {
    await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 100, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1, fornecedorId: 999999999 })
  } catch { fkBarrou = true }
  chk(fkBarrou, 'FK real: obrigação com fornecedorId inexistente é BARRADA')

  // válido grava
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 250, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1, fornecedorId: f1!.id, observacoes: 'Emolumentos' })

  // (3) READ-MODEL expõe o nome
  const linha = (await listarObrigacoes({ processoId: PROC, natureza: 'CUSTO' })).find((o) => o.obrigacaoId === obrigacaoId)
  chk(!!linha, 'custo aparece na lista')
  chk((linha as any)?.fornecedor === 'Cartório Central', `read-model expõe o fornecedor (${(linha as any)?.fornecedor})`)

  // (4) ON DELETE SET NULL
  await prisma.fornecedor.delete({ where: { id: f1!.id } })
  const obrPos = await prisma.obrigacaoEconomica.findUnique({ where: { id: obrigacaoId }, select: { id: true, fornecedorId: true } })
  chk(obrPos != null, 'custo PRESERVADO após remover o fornecedor (não cascateia delete)')
  chk(obrPos?.fornecedorId == null, 'vínculo zerado (ON DELETE SET NULL)')

  // limpeza
  await prisma.ocorrenciaFinanceira.deleteMany({ where: { obrigacaoId } }).catch(() => {})
  await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, obrigacaoId)
  await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId } })
  await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: obrigacaoId } })
  await prisma.obrigacaoEconomica.delete({ where: { id: obrigacaoId } }).catch(() => {})
  await prisma.fornecedor.deleteMany({ where: { id: { in: [f1!.id, f2!.id] } } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
