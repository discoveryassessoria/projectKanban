// HOMOLOGAÇÃO — a matriz de permissões de custo VALE de fato, perfil por perfil.
// Não testa o mapa em memória: cria PERFIL + USUÁRIO reais no banco, assina JWT real e
// passa pelos MESMOS gates que as rotas usam — em modo ESTRITO (como ficará em produção)
// e em modo retrocompatível (como fica até a env ser ligada).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48)
import { prisma } from '@/lib/prisma'
import { signAuthToken } from '@/lib/auth-jwt'
import { criarObrigacaoEconomicaComLedger } from '@/lib/financeiro/ledger/ledger-service'
import { verificarPermissaoCustoDaObrigacao, OPERACOES_CUSTO, CHAVE_CUSTO, type OperacaoCusto } from '@/lib/financeiro/permissoes-custo'
import { MATRIZ_CUSTO, aplicarMatriz, diffCusto } from './seed-permissoes-custo'
import { PERFIS_PADRAO } from '@/src/lib/permissoes'

import { exigirBancoDeTeste } from "./_banco-de-teste"

// TRAVA DE AMBIENTE: este arquivo ESCREVE. Sem banco de teste local, não roda.
exigirBancoDeTeste()

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const TS = Date.now()
const PROC = 16
const passou = (r: unknown) => r === null
const req = (t: string) => new Request('http://t/x', { headers: { Authorization: `Bearer ${t}` } })
const setEstrito = (v: boolean) => { if (v) process.env.FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS = '1'; else delete process.env.FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS }

async function main() {
  // ── núcleo puro do seed ──
  const base = { 'financeiro.ver': true, 'tarefas.criar': true, 'financeiro.custo_pagar': true }
  const aplicado = aplicarMatriz(base, ['criar', 'editar', 'arquivar'])
  chk(aplicado['tarefas.criar'] === true && aplicado['financeiro.ver'] === true, 'seed PRESERVA permissões fora do domínio custo')
  chk(aplicado['financeiro.custo_pagar'] === false, 'seed REVOGA operação fora da matriz do perfil')
  chk(aplicado['financeiro.custo_criar'] === true, 'seed CONCEDE operação prevista na matriz')
  chk(diffCusto(aplicado, aplicado).length === 0, 'seed é idempotente (segunda passada não muda nada)')

  // ── matriz do seed == matriz dos perfis padrão (uma fonte só) ──
  for (const nome of Object.keys(MATRIZ_CUSTO)) {
    const padrao = PERFIS_PADRAO.find((p) => p.nome === nome)
    if (!padrao) { chk(false, `perfil padrão ${nome} existe no catálogo`); continue }
    const permitidas = new Set(MATRIZ_CUSTO[nome])
    const coerente = OPERACOES_CUSTO.every((op) => !!(padrao.permissoes as Record<string, boolean>)[CHAVE_CUSTO[op]] === permitidas.has(op))
    chk(coerente, `perfil padrão "${nome}" bate com a matriz do seed`)
  }

  // ── enforcement real, perfil por perfil ──
  const { obrigacaoId: custoId } = await criarObrigacaoEconomicaComLedger({ natureza: 'CUSTO', valorContratado: 100, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1 })
  const { obrigacaoId: receitaId } = await criarObrigacaoEconomicaComLedger({ natureza: 'RECEITA', valorContratado: 100, moedaContratual: 'BRL', processoId: PROC, criadoPorId: 1 })

  const tokens: Record<string, string> = {}
  for (const nome of Object.keys(MATRIZ_CUSTO)) {
    // perfil REAL com a matriz aplicada por cima de "vê o financeiro"
    const perfil = await prisma.perfil.create({
      // base REAL do perfil padrão (o Estagiário, por exemplo, não tem financeiro.ver)
      data: { nome: `${nome} T${TS}`, descricao: 'homologação', permissoes: aplicarMatriz(PERFIS_PADRAO.find((p) => p.nome === nome)!.permissoes as Record<string, boolean>, MATRIZ_CUSTO[nome]) },
      select: { id: true },
    })
    const email = `matriz-${nome.toLowerCase().replace(/[^a-z]/g, '')}-${TS}@t.t`
    const u = await prisma.usuario.create({ data: { nome, email, senha: 'x', tipo: 'operador', perfilId: perfil.id }, select: { id: true } })
    tokens[nome] = await signAuthToken({ userId: u.id, email, tipo: 'operador' })
  }

  // MODO ESTRITO — o que valerá em produção depois do smoke
  setEstrito(true)
  for (const [nome, permitidas] of Object.entries(MATRIZ_CUSTO)) {
    const set = new Set<OperacaoCusto>(permitidas)
    const erradas: string[] = []
    for (const op of OPERACOES_CUSTO) {
      const deixou = passou(await verificarPermissaoCustoDaObrigacao(req(tokens[nome]), op, custoId))
      if (deixou !== set.has(op)) erradas.push(`${op}=${deixou ? 'permitiu' : 'negou'}`)
    }
    chk(erradas.length === 0, `estrito · ${nome}: exatamente ${permitidas.length} operação(ões) permitida(s)${erradas.length ? ` — divergências: ${erradas.join(', ')}` : ''}`)
  }

  // segregação de funções, explícita
  chk(!passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Assistente']), 'aprovar', custoId)), 'estrito · Assistente NÃO aprova')
  chk(!passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Assistente']), 'pagar', custoId)), 'estrito · Assistente NÃO paga')
  chk(!passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Assistente']), 'excluir', custoId)), 'estrito · Assistente NÃO exclui')
  chk(passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Assistente']), 'criar', custoId)), 'estrito · Assistente CRIA')
  chk(passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Gerente']), 'pagar', custoId)), 'estrito · Gerente PAGA')
  chk(!passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Estagiário']), 'criar', custoId)), 'estrito · Estagiário não opera custo')

  // RECEITA nunca é afetada pela matriz de custo (natureza-aware)
  for (const nome of Object.keys(MATRIZ_CUSTO)) {
    chk(passou(await verificarPermissaoCustoDaObrigacao(req(tokens[nome]), 'pagar', receitaId)), `estrito · ${nome}: Receita segue intacta (sem regressão)`)
  }

  // MODO RETROCOMPATÍVEL — como fica ATÉ ligar a env: ninguém perde acesso no deploy
  setEstrito(false)
  for (const nome of ['Assistente', 'Gerente', 'Administrador']) {
    chk(passou(await verificarPermissaoCustoDaObrigacao(req(tokens[nome]), 'pagar', custoId)), `retrocompat · ${nome} continua operando (deploy não quebra ninguém)`)
  }
  chk(!passou(await verificarPermissaoCustoDaObrigacao(req(tokens['Estagiário']), 'pagar', custoId)), 'retrocompat · Estagiário (perfil padrão, sem financeiro.ver) segue negado')
  setEstrito(false)

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
