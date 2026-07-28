// F6 — Integração: gate de permissão de custo APLICADO server-side sobre obrigações reais.
// Prova: (1) natureza-aware — receita NUNCA é gateada pela segregação de custo; (2) estrito
// nega custo sem a chave específica; (3) segregação real (custo_pagar ≠ custo_aprovar);
// (4) retrocompat — financeiro.ver concede durante a migração; (5) não autenticado → 401;
// (6) admin passa em tudo; (7) resolução por ref. Enforcement 100% no servidor.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { prisma } from '@/lib/prisma'
import { signAuthToken } from '@/lib/auth-jwt'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { verificarPermissaoCusto, verificarPermissaoCustoDaObrigacao, verificarPermissaoCustoPorRef } from '@/lib/financeiro/permissoes-custo'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now()
const status = (r: Response | null) => r === null ? 'PASS' : r.status // null = passou o gate
const reqCom = (token: string | null) => new Request('http://t/x', token ? { headers: { Authorization: `Bearer ${token}` } } : {})
const setEstrito = (v: boolean) => { if (v) process.env.FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS = '1'; else delete process.env.FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS }

async function criarUsuario(email: string, custom: Record<string, boolean>): Promise<number> {
  const u = await prisma.usuario.create({ data: { nome: 'F6 Teste', email, senha: 'x', tipo: 'operador', permissoesCustom: custom } })
  return u.id
}

async function main() {
  // --- fixtures: usuários (JWT) + obrigações reais (custo A_PAGAR e receita A_RECEBER) ---
  const emailVer = `f6-ver-${TS}@t.t`, emailPagar = `f6-pagar-${TS}@t.t`
  const idVer = await criarUsuario(emailVer, { 'financeiro.ver': true })
  const idPagar = await criarUsuario(emailPagar, { 'financeiro.custo_pagar': true }) // NÃO tem financeiro.ver
  const tkAdmin = await signAuthToken({ userId: 1, email: 'admin@t.t', tipo: 'admin' })
  const tkVer = await signAuthToken({ userId: idVer, email: emailVer, tipo: 'operador' })
  const tkPagar = await signAuthToken({ userId: idPagar, email: emailPagar, tipo: 'operador' })

  const { obrigacaoId: custoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 500, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })
  const { obrigacaoId: receitaId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 500, moedaContratual: 'BRL', processoId: 16, origemTipo: 'nativo', origemId: null })

  // ========================= MODO ESTRITO =========================
  setEstrito(true)

  // (1) NATUREZA-AWARE: receita NUNCA é gateada pela segregação de custo — passa mesmo em estrito
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkVer), 'pagar', receitaId)) === 'PASS', 'estrito: RECEITA não é gateada por custo (natureza-aware → passa)')

  // (2) ESTRITO nega custo quando o usuário só tem financeiro.ver (sem a chave específica)
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkVer), 'pagar', custoId)) === 403, 'estrito: custo + só financeiro.ver → 403 (negado)')

  // (3) SEGREGAÇÃO real: custo_pagar PAGA, mas NÃO aprova
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkPagar), 'pagar', custoId)) === 'PASS', 'estrito: custo_pagar → PODE pagar o custo')
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkPagar), 'aprovar', custoId)) === 403, 'estrito: custo_pagar → NÃO aprova (segregação)')
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkPagar), 'excluir', custoId)) === 403, 'estrito: custo_pagar → NÃO exclui (segregação)')

  // (6) ADMIN passa em toda operação, mesmo estrito
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkAdmin), 'aprovar', custoId)) === 'PASS', 'estrito: admin aprova custo')
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkAdmin), 'excluir', custoId)) === 'PASS', 'estrito: admin exclui custo')

  // (5) NÃO autenticado → 401 (gate cost-only)
  chk(status(await verificarPermissaoCusto(reqCom(null), 'pagar')) === 401, 'estrito: sem token → 401')

  // (7) resolução por REF (numérica) → mesma decisão do gate por obrigação
  chk(status(await verificarPermissaoCustoPorRef(reqCom(tkVer), 'excluir', String(custoId))) === 403, 'estrito: PorRef(custo) + só financeiro.ver → 403')
  chk(status(await verificarPermissaoCustoPorRef(reqCom(tkVer), 'excluir', String(receitaId))) === 'PASS', 'estrito: PorRef(receita) → passa (natureza-aware)')
  chk(status(await verificarPermissaoCustoPorRef(reqCom(tkVer), 'excluir', '99999999')) === 'PASS', 'PorRef inexistente → passa (rota trata o 404)')

  // ========================= RETROCOMPAT (não estrito) =========================
  setEstrito(false)

  // (4) financeiro.ver concede as operações de custo durante a migração
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkVer), 'pagar', custoId)) === 'PASS', 'retrocompat: financeiro.ver PAGA custo durante a migração')
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkVer), 'aprovar', custoId)) === 'PASS', 'retrocompat: financeiro.ver APROVA custo durante a migração')
  // quem não tem financeiro.ver nem a chave, continua negado mesmo em retrocompat
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkPagar), 'aprovar', custoId)) === 403, 'retrocompat: sem ver e sem custo_aprovar → 403 (não afrouxa além do previsto)')
  // e a chave específica continua valendo
  chk(status(await verificarPermissaoCustoDaObrigacao(reqCom(tkPagar), 'pagar', custoId)) === 'PASS', 'retrocompat: custo_pagar continua pagando')

  // --- limpeza ---
  setEstrito(false)
  for (const id of [custoId, receitaId]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "ledgerId" IN (SELECT id FROM "LedgerFinanceiro" WHERE "obrigacaoId"=$1)`, id).catch(() => {})
    await prisma.saldoProjecao.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.ledgerFinanceiro.deleteMany({ where: { obrigacaoId: id } }).catch(() => {})
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: 'ObrigacaoEconomica', aggregateId: id } }).catch(() => {})
    await prisma.obrigacaoEconomica.delete({ where: { id } }).catch(() => {})
  }
  await prisma.usuario.deleteMany({ where: { id: { in: [idVer, idPagar] } } }).catch(() => {})

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
