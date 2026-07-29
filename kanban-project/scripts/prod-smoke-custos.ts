// scripts/prod-smoke-custos.ts
// ============================================================================
// SMOKE DE PRODUÇÃO — Receitas e Custos.
//
// SOMENTE LEITURA, por decisão: produção é patrimônio e um smoke que escreve
// deixa lixo em dado real. Tudo aqui é `findMany/count/read model` sobre o que
// já existe. Nenhum INSERT, UPDATE ou DELETE.
//
// Cobre:
//   1. schema × Prisma Client — os campos que a migração acabou de trazer;
//   2. read models de Receitas (lista, detalhe, posição) sobre dado real;
//   3. read models de Custos (lista, contas a pagar, cronograma, repasse);
//   4. modo de segregação em vigor e a decisão de autorização correspondente.
//
// Roda INTEIRO nas duas passadas — antes e depois de ligar
// FINANCEIRO_PERMISSOES_CUSTO_ESTRITAS. É barato (só leitura) e a segunda
// passada só prova alguma coisa se exercitar os mesmos caminhos da primeira.
// Falha ⇒ exit 1.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { listarObrigacoes } from '@/lib/financeiro/leitura/consultas'
import { listarReceitas } from '@/lib/financeiro/leitura/receitas-lista'
import { listarContasAPagar } from '@/lib/financeiro/leitura/contas-a-pagar'
import { carregarPosicao } from '@/lib/financeiro/leitura/posicao-service'
import { carregarVisaoGeralProcesso } from '@/lib/financeiro/leitura/visao-geral-processo'
import { carregarReceitaDetalhe } from '@/lib/financeiro/leitura/receita-detalhe'
import { CHAVE_CUSTO, OPERACOES_CUSTO, podeOperarCusto, segregacaoEstrita } from '@/lib/financeiro/permissoes-custo'
import { MATRIZ_CUSTO } from '@/scripts/seed-permissoes-custo'
import type { MapaPermissoes } from '@/src/lib/permissoes'

let ok = 0
let fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
const secao = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

/** Roda uma leitura e reprova se ela lançar — o objetivo é provar que o caminho não quebra. */
async function ler<T>(rotulo: string, fn: () => Promise<T>): Promise<T | null> {
  try { const r = await fn(); chk(true, rotulo); return r }
  catch (e) { chk(false, `${rotulo} → ${String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200)}`); return null }
}

async function main() {
  console.log('SMOKE DE PRODUÇÃO — Receitas e Custos')
  console.log(`segregação estrita: ${segregacaoEstrita() ? 'LIGADA' : 'desligada (retrocompat)'}`)

  // ── 0) histórico de migrations: repositório × banco ─────────────────────────
  // INFORMATIVO. Produção acumula migrations de várias branches; o repositório
  // desta branch não é necessariamente um superconjunto do histórico do banco.
  // Saber disso é o que separa "está tudo aplicado" de "está tudo conhecido".
  secao('0) histórico de migrations (informativo)')
  try {
    const path = await import('node:path')
    const { listarMigrations } = await import('@/lib/db/leitura-migrations.mjs')
    const noRepo: string[] = listarMigrations(path.join(process.cwd(), 'prisma', 'migrations'))
    const registradas = (await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name',
    )).map((r) => r.migration_name)
    const conjuntoRepo = new Set(noRepo)
    const foraDoRepo = registradas.filter((m) => !conjuntoRepo.has(m))
    const naoAplicadas = noRepo.filter((m) => !registradas.includes(m))
    console.log(`     ${noRepo.length} no repositório · ${registradas.length} registradas no banco`)
    chk(naoAplicadas.length === 0, `nenhuma migration do repositório pendente${naoAplicadas.length ? `: ${naoAplicadas.join(', ')}` : ''}`)
    if (foraDoRepo.length) {
      console.log(`     ⚠ ${foraDoRepo.length} registrada(s) no banco e AUSENTE(s) neste repositório (de outras branches):`)
      for (const m of foraDoRepo) console.log(`        · ${m}`)
    } else {
      console.log('     · o repositório cobre todo o histórico do banco')
    }
  } catch (e) {
    console.log(`     ·  não foi possível comparar o histórico (${String((e as Error)?.message ?? e).slice(0, 140)})`)
  }

  // ── 1) schema × Prisma Client ───────────────────────────────────────────────
  secao('1) schema × Prisma Client')
  await ler('obrigacaoEconomica com os campos novos de Custo', () => prisma.obrigacaoEconomica.findMany({
    take: 1,
    select: { id: true, fornecedorId: true, itemCatalogoId: true, arquivadaEm: true, estadoCusto: true, natureza: true, direcao: true, status: true },
  }))
  await ler('obrigacaoEconomica filtrando arquivadaEm/estadoCusto', () => prisma.obrigacaoEconomica.findMany({ take: 1, where: { arquivadaEm: null, estadoCusto: null } }))
  await ler('parcelaPagavel', () => prisma.parcelaPagavel.findMany({ take: 1 }))
  await ler('repasseCusto', () => prisma.repasseCusto.findMany({ take: 1 }))
  await ler('receitaDocumento (obrigacaoId)', () => prisma.receitaDocumento.findMany({ take: 1, select: { id: true, receitaId: true, obrigacaoId: true } }))
  await ler('creditoMovimento', () => prisma.creditoMovimento.findMany({ take: 1 }))
  await ler('receita.arquivadaEm', () => prisma.receita.findMany({ take: 1, select: { id: true, arquivadaEm: true } }))
  await ler('cobranca.enviadaEm/linkPagamento/enviadaPorId', () => prisma.cobranca.findMany({ take: 1, select: { id: true, enviadaEm: true, linkPagamento: true, enviadaPorId: true } }))
  await ler('fatura.receitaId', () => prisma.fatura.findMany({ take: 1, select: { id: true, receitaId: true } }))
  await ler('evento.status/responsavelId', () => prisma.evento.findMany({ take: 1, select: { id: true, status: true, responsavelId: true } }))

  // ── 2) Receitas sobre dado real ─────────────────────────────────────────────
  secao('2) Receitas (read models sobre dado real)')
  const receitas = await ler('listarReceitas() global', () => listarReceitas())
  const totalReceitas = (receitas?.receitas as unknown[] | undefined)?.length ?? 0
  console.log(`     ${totalReceitas} receita(s) visíveis`)
  const umaReceita = await prisma.obrigacaoEconomica.findFirst({
    where: { natureza: 'RECEITA', arquivadaEm: null }, select: { id: true, processoId: true, codigoOperacional: true }, orderBy: { id: 'desc' },
  })
  if (umaReceita) {
    await ler(`carregarPosicao(#${umaReceita.id})`, () => carregarPosicao({ obrigacaoId: umaReceita.id }))
    await ler(`carregarReceitaDetalhe(#${umaReceita.id})`, () => carregarReceitaDetalhe(String(umaReceita.id)))
    if (umaReceita.processoId) {
      await ler(`listarReceitas(processo ${umaReceita.processoId})`, () => listarReceitas(umaReceita.processoId as number))
      await ler(`carregarVisaoGeralProcesso(${umaReceita.processoId})`, () => carregarVisaoGeralProcesso(umaReceita.processoId as number))
    }
  } else {
    console.log('     ·  nenhuma receita ativa em produção — read models por id não exercitados')
  }

  // ── 3) Custos sobre dado real ───────────────────────────────────────────────
  secao('3) Custos (read models sobre dado real)')
  await ler('listarObrigacoes(natureza CUSTO)', () => listarObrigacoes({ natureza: 'CUSTO' }))
  await ler('listarContasAPagar() global', () => listarContasAPagar())
  const custos = await prisma.obrigacaoEconomica.count({ where: { direcao: 'A_PAGAR' } })
  const custosArquivados = await prisma.obrigacaoEconomica.count({ where: { direcao: 'A_PAGAR', arquivadaEm: { not: null } } })
  console.log(`     ${custos} custo(s); ${custosArquivados} arquivado(s)`)
  const umCusto = await prisma.obrigacaoEconomica.findFirst({ where: { direcao: 'A_PAGAR' }, select: { id: true, processoId: true }, orderBy: { id: 'desc' } })
  if (umCusto) {
    await ler(`carregarPosicao(custo #${umCusto.id})`, () => carregarPosicao({ obrigacaoId: umCusto.id }))
    if (umCusto.processoId) await ler(`listarContasAPagar(processo ${umCusto.processoId})`, () => listarContasAPagar({ processoId: umCusto.processoId as number }))
    await ler('parcelaPagavel do custo (cronograma)', () => prisma.parcelaPagavel.findMany({ where: { obrigacaoId: umCusto.id } }))
    await ler('repasseCusto do custo', () => prisma.repasseCusto.findMany({ where: { custoObrigacaoId: umCusto.id } }))
  } else {
    console.log('     ·  nenhum custo em produção ainda — read models por id não exercitados')
  }

  // ── 4) autorização no modo em vigor ─────────────────────────────────────────
  secao('4) autorização de custo no modo em vigor')
  const estrita = segregacaoEstrita()
  const perfis = await prisma.perfil.findMany({ select: { nome: true, permissoes: true } })
  for (const [nome, permitidas] of Object.entries(MATRIZ_CUSTO)) {
    const perfil = perfis.find((p) => p.nome.trim() === nome)
    if (!perfil) { chk(false, `perfil "${nome}" presente`); continue }
    const mapa = (perfil.permissoes ?? {}) as MapaPermissoes
    const esperado = new Set(permitidas)
    const concedidas = OPERACOES_CUSTO.filter((op) => podeOperarCusto(mapa, op, estrita))
    if (estrita) {
      const igual = concedidas.length === esperado.size && concedidas.every((op) => esperado.has(op))
      chk(igual, `${nome}: concede exatamente ${permitidas.length} operação(ões) — ${concedidas.join(', ') || '(nenhuma)'}`)
    } else {
      const cobre = permitidas.every((op) => concedidas.includes(op))
      chk(cobre, `${nome}: retrocompat cobre as ${permitidas.length} da matriz (concede ${concedidas.length})`)
    }
  }
  // Sem permissão alguma nunca opera — vale nos dois modos.
  chk(OPERACOES_CUSTO.every((op) => !podeOperarCusto({}, op, estrita)), 'mapa vazio não opera nenhuma operação de custo')
  chk(OPERACOES_CUSTO.every((op) => !podeOperarCusto(null, op, estrita)), 'permissões nulas não operam nenhuma operação de custo')
  // A chave específica sempre concede, independentemente do modo.
  chk(
    OPERACOES_CUSTO.every((op) => podeOperarCusto({ [CHAVE_CUSTO[op]]: true }, op, estrita)),
    'chave específica concede a própria operação nos dois modos',
  )

  console.log(`\n${ok} passaram, ${fail} falharam`)
  await prisma.$disconnect()
  if (fail) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
