// F7.2 — REPROVAÇÃO de custo: a permissão financeiro.custo_reprovar deixa de ser órfã.
// Prova no banco: motivo obrigatório; só custo; só em análise (Previsto/Aprovado); bloqueada
// quando já houve pagamento; encerra pelo motor único (CANCELADO + ledger zerado, histórico
// preservado); auditoria REPROVAR com de/para/motivo; idempotente; aparece na timeline geral.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { prisma } from '@/lib/prisma'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { reprovarCusto, ESTADOS_REPROVAVEIS, motivoReprovacaoValido } from '@/lib/financeiro/acoes/reprovar-custo'
import { registrarOcorrencia } from '@/lib/financeiro/ocorrencias/ocorrencia-service'
import { timelineGeralReceita } from '@/lib/financeiro/leitura/timeline-financeira'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const PROC = 16

async function novoCusto(estado: 'PREVISTO' | 'APROVADO' | 'CONTRATADO', valor = 400) {
  const { obrigacaoId } = await criarObrigacaoEconomicaComLedger({
    natureza: 'CUSTO', valorContratado: valor, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1,
    observacoes: `Custo reprovação ${estado}`, estadoCusto: estado,
  } as any)
  return obrigacaoId
}

async function main() {
  // ---- núcleo puro
  chk(motivoReprovacaoValido('ok!') === true, 'motivo com 3+ caracteres é válido')
  chk(motivoReprovacaoValido('  ') === false, 'motivo em branco é inválido')
  chk(ESTADOS_REPROVAVEIS.join(',') === 'PREVISTO,APROVADO', 'reprovável apenas em Previsto/Aprovado')

  // ---- (1) motivo obrigatório
  const c1 = await novoCusto('PREVISTO')
  const semMotivo = await reprovarCusto(c1, { motivo: '', usuarioId: 1 })
  chk(semMotivo.ok === false && /motivo/i.test(semMotivo.erro ?? ''), 'reprovar SEM motivo é recusado')

  // ---- (2) caminho feliz: PREVISTO → reprovado
  const r1 = await reprovarCusto(c1, { motivo: 'Fornecedor acima da tabela', usuarioId: 1 })
  chk(r1.ok === true && r1.de === 'PREVISTO', `custo Previsto reprovado (${r1.erro ?? 'ok'})`)
  const obr1 = await prisma.obrigacaoEconomica.findUnique({ where: { id: c1 }, select: { status: true, estadoCusto: true } })
  chk(obr1?.status === 'CANCELADO' && obr1?.estadoCusto === 'CANCELADO', `encerrado pelo motor único (${obr1?.status}/${obr1?.estadoCusto})`)
  const proj1 = await prisma.saldoProjecao.findUnique({ where: { obrigacaoId: c1 }, select: { saldo: true } })
  chk(proj1 != null && Number(proj1.saldo) === 0, `ledger zerado e PRESERVADO (saldo ${Number(proj1?.saldo ?? -1)})`)
  const log1 = await prisma.logAuditoria.findFirst({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c1, acao: 'REPROVAR' } })
  chk(!!log1, 'auditoria REPROVAR gravada')
  chk((log1?.detalhes as any)?.de === 'PREVISTO' && (log1?.detalhes as any)?.motivo === 'Fornecedor acima da tabela' && (log1?.detalhes as any)?.reprovacao === true,
    'auditoria registra de/motivo/marca de reprovação')

  // ---- (3) idempotência
  const r1b = await reprovarCusto(c1, { motivo: 'Fornecedor acima da tabela', usuarioId: 1 })
  chk(r1b.ok === true && r1b.jaReprovado === true, 'reprovar duas vezes é idempotente (não duplica)')
  const logs1 = await prisma.logAuditoria.count({ where: { entidade: 'ObrigacaoEconomica', entidadeId: c1, acao: 'REPROVAR' } })
  chk(logs1 === 1, `sem auditoria duplicada (${logs1})`)

  // ---- (4) APROVADO também é reprovável
  const c2 = await novoCusto('APROVADO')
  const r2 = await reprovarCusto(c2, { motivo: 'Escopo cancelado pelo cliente', usuarioId: 1 })
  chk(r2.ok === true && r2.de === 'APROVADO', 'custo Aprovado é reprovável')

  // ---- (5) CONTRATADO NÃO é reprovável (usa cancelamento)
  const c3 = await novoCusto('CONTRATADO')
  const r3 = await reprovarCusto(c3, { motivo: 'tentativa indevida', usuarioId: 1 })
  chk(r3.ok === false && /Cancelar custo/.test(r3.erro ?? ''), `custo Contratado NÃO é reprovável, orienta cancelar (${r3.erro ?? ''})`)
  const obr3 = await prisma.obrigacaoEconomica.findUnique({ where: { id: c3 }, select: { status: true } })
  chk(obr3?.status !== 'CANCELADO', 'recusa não alterou o custo Contratado')

  // ---- (6) com pagamento registrado → bloqueado
  const c4 = await novoCusto('APROVADO', 200)
  await registrarOcorrencia({ obrigacaoId: c4, tipo: 'PAGAMENTO', valor: 50, moeda: 'BRL', idempotencyKey: `f72-pag-${c4}`, criadoPorId: 1 } as any)
  const r4 = await reprovarCusto(c4, { motivo: 'tentativa após pagamento', usuarioId: 1 })
  chk(r4.ok === false && /estorne/i.test(r4.erro ?? ''), `custo com pagamento exige estorno antes (${r4.erro ?? ''})`)

  // ---- (7) receita NUNCA é reprovável (reprovação é conceito de custo)
  const { obrigacaoId: rec } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 300, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1 })
  const r5 = await reprovarCusto(rec, { motivo: 'não deveria valer', usuarioId: 1 })
  chk(r5.ok === false && /custo/i.test(r5.erro ?? ''), 'receita não é reprovável')

  // ---- (8) timeline geral exibe a reprovação (mesmo com motivo contendo palavra individual)
  const c5 = await novoCusto('PREVISTO')
  await reprovarCusto(c5, { motivo: 'pagamento em duplicidade', usuarioId: 1 })
  const tl = await timelineGeralReceita(String(c5))
  chk(tl.some((e) => e.tipo === 'REPROVAR' && e.titulo === 'Custo reprovado'),
    'reprovação aparece na timeline geral com título legível')

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
