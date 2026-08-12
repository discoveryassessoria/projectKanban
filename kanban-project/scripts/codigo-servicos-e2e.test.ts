/**
 * E2E — geração do código SRV-n contra BANCO REAL (de teste).
 * Rodar:
 *   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
 *   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/codigo-servicos-e2e.test.ts
 *
 * O guard estático (test:codigo-servicos) prova a FORMA do código. Este prova o
 * COMPORTAMENTO — as três coisas que só o banco responde:
 *   · criação simultânea não colide nem duplica;
 *   · promoção item→serviço é idempotente;
 *   · falha depois da geração faz rollback e não deixa serviço órfão.
 *
 * Recusa rodar fora de um banco de teste local.
 */
import { PrismaClient, NaturezaItem } from '@prisma/client'
import { garantirServicoDoItem } from '../src/services/catalogo-sync'
import { prisma } from '../lib/prisma'

const URL_DB = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''
if (!/127\.0\.0\.1|localhost/.test(URL_DB) || !/test/i.test(URL_DB)) {
  console.error('\n❌ Este teste ESCREVE no banco. Aponte PRISMA_DATABASE_URL para o banco de TESTE local.')
  console.error('   Ex.: postgresql://postgres@127.0.0.1:55432/discovery_test\n')
  process.exit(1)
}

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = 'ZZTESTE_CODIGO_SRV'
const criados: number[] = []
const itensCriados: number[] = []

async function limpar() {
  await prisma.servicoProduto.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: `SRV_${MARCA}` } } })
}

async function main() {
  console.log('Código SRV-n — comportamento contra banco real\n')
  await limpar()

  // ── 1) Toda criação recebe SRV-n ──────────────────────────────────────────
  secao('1) Criação atribui o código')
  const s1 = await prisma.servicoProduto.create({
    data: { code: `${MARCA}_A`, name: 'Serviço de teste A' },
    select: { id: true, publicCode: true },
  })
  criados.push(s1.id)
  ok('novo serviço nasce com publicCode', !!s1.publicCode, String(s1.publicCode))
  ok('o formato é SRV-{n}', /^SRV-\d+$/.test(s1.publicCode ?? ''), String(s1.publicCode))

  // ── 2) Concorrência: 12 criações simultâneas, zero colisão ────────────────
  secao('2) Criações simultâneas')
  const lote = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      prisma.servicoProduto.create({
        data: { code: `${MARCA}_C${i}`, name: `Serviço concorrente ${i}` },
        select: { id: true, publicCode: true },
      }),
    ),
  )
  for (const s of lote) criados.push(s.id)
  const codigos = lote.map((s) => s.publicCode)
  ok('todas as 12 receberam código', codigos.every((c) => !!c))
  ok('nenhum código repetido entre concorrentes', new Set(codigos).size === codigos.length, codigos.join(' '))
  ok('nenhum serviço duplicado (12 linhas para 12 criações)', new Set(lote.map((s) => s.id)).size === 12)

  // ── 3) Imutabilidade ──────────────────────────────────────────────────────
  secao('3) O código é imutável')
  const antes = s1.publicCode
  await prisma.servicoProduto.update({
    where: { id: s1.id },
    data: { name: 'Serviço de teste A (renomeado)', publicCode: 'SRV-999999' } as never,
  })
  const depois = await prisma.servicoProduto.findUnique({ where: { id: s1.id }, select: { publicCode: true, name: true } })
  ok('update NÃO altera o publicCode', depois?.publicCode === antes, `${antes} → ${depois?.publicCode}`)
  ok('a edição do resto do cadastro funciona normalmente', depois?.name === 'Serviço de teste A (renomeado)')

  await prisma.servicoProduto.updateMany({ where: { id: s1.id }, data: { publicCode: 'SRV-888888' } as never })
  const depois2 = await prisma.servicoProduto.findUnique({ where: { id: s1.id }, select: { publicCode: true } })
  ok('updateMany também não altera o publicCode', depois2?.publicCode === antes)

  // ── 4) Cliente não escolhe o código ───────────────────────────────────────
  secao('4) Código informado pelo cliente é ignorado')
  const forjado = await prisma.servicoProduto.create({
    data: { code: `${MARCA}_F`, name: 'Serviço forjado', publicCode: 'SRV-777777' } as never,
    select: { id: true, publicCode: true },
  })
  criados.push(forjado.id)
  ok('o backend sobrescreve o código enviado', forjado.publicCode !== 'SRV-777777', String(forjado.publicCode))

  // ── 5) Promoção item → serviço, idempotente ───────────────────────────────
  secao('5) garantirServicoDoItem')
  const item = await prisma.itemCatalogo.create({
    data: { code: `SRV_${MARCA}_ITEM`, name: 'Serviço vindo do mestre', natureza: NaturezaItem.SERVICO },
    select: { id: true },
  })
  itensCriados.push(item.id)

  const p1 = await prisma.$transaction((tx) => garantirServicoDoItem(tx, item.id))
  criados.push(p1.servicoId)
  ok('promoção cria o serviço com código', p1.criado && /^SRV-\d+$/.test(p1.publicCode ?? ''), String(p1.publicCode))
  ok('a chave técnica é derivada do mestre, sem o prefixo SRV_', (await prisma.servicoProduto.findUnique({ where: { id: p1.servicoId }, select: { code: true } }))?.code === `${MARCA}_ITEM`)

  const p2 = await prisma.$transaction((tx) => garantirServicoDoItem(tx, item.id))
  ok('rodar de novo NÃO cria segundo serviço (idempotente)', !p2.criado && p2.servicoId === p1.servicoId)
  ok('rodar de novo preserva o código original', p2.publicCode === p1.publicCode)
  ok('o item do mestre continua existindo e com a chave intacta', (await prisma.itemCatalogo.findUnique({ where: { id: item.id }, select: { code: true } }))?.code === `SRV_${MARCA}_ITEM`)

  const itemDoc = await prisma.itemCatalogo.create({
    data: { code: `SRV_${MARCA}_DOC`, name: 'Item que não é serviço', natureza: NaturezaItem.DOCUMENTO },
    select: { id: true },
  })
  itensCriados.push(itemDoc.id)
  let recusou = false
  try { await prisma.$transaction((tx) => garantirServicoDoItem(tx, itemDoc.id)) } catch { recusou = true }
  ok('item que não é SERVICO é recusado', recusou)

  // ── 6) Rollback: falha depois da geração não deixa serviço ────────────────
  secao('6) Falha na transação faz rollback')
  const antesFalha = await prisma.servicoProduto.count({ where: { code: { startsWith: MARCA } } })
  let abortou = false
  try {
    await prisma.$transaction(async (tx) => {
      await tx.servicoProduto.create({ data: { code: `${MARCA}_ROLLBACK`, name: 'Serviço que não deve sobreviver' } })
      throw new Error('falha proposital depois de gerar o código')
    })
  } catch { abortou = true }
  const depoisFalha = await prisma.servicoProduto.count({ where: { code: { startsWith: MARCA } } })
  ok('a transação abortou', abortou)
  ok('nenhum serviço sobrou da transação abortada', depoisFalha === antesFalha, `${antesFalha} → ${depoisFalha}`)
  ok('o serviço abortado não existe', (await prisma.servicoProduto.count({ where: { code: `${MARCA}_ROLLBACK` } })) === 0)

  // ── 7) Invariante final ───────────────────────────────────────────────────
  secao('7) Invariante do Catálogo')
  ok('nenhum ServicoProduto de teste ficou sem código', (await prisma.servicoProduto.count({ where: { code: { startsWith: MARCA }, publicCode: null } })) === 0)
  const todosCodigos = (await prisma.servicoProduto.findMany({ where: { publicCode: { not: null } }, select: { publicCode: true } })).map((s) => s.publicCode)
  ok('não há código repetido na tabela inteira', new Set(todosCodigos).size === todosCodigos.length)
}

main()
  .catch((e) => { console.error(e); falhou++; falhas.push(`exceção: ${e?.message}`) })
  .finally(async () => {
    await limpar()
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
    if (falhou > 0) {
      console.log('\nFalhas:')
      for (const f of falhas) console.log(`  · ${f}`)
      process.exit(1)
    }
    console.log('Geração de código: única, atômica, imutável e transacional.\n')
  })

// evita "declarado e nunca lido" quando o script cai antes da limpeza
void PrismaClient
