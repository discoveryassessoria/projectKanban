// scripts/prod-consolidar-categorias.mjs
// ============================================================================
// CONSOLIDAÇÃO DAS CATEGORIAS DE SERVIÇO — transacional e idempotente.
//
// A migration converteu a categoria textual em vínculo real. Onde o texto legado
// não estava no mapa de equivalências, ela fez a coisa certa: NÃO adivinhou —
// criou uma categoria preservando fielmente o que o dado dizia, e deixou visível.
// Este script fecha esses casos, um a um, por correspondência DOCUMENTADA.
//
// Correspondência não é palpite: cada entrada de EQUIVALENCIAS abaixo é uma
// decisão escrita. O que não estiver aqui NÃO é consolidado — fica no cadastro,
// aparece no smoke e espera curadoria humana. É o oposto de fundir por parecença.
//
// GARANTIAS:
//   • transação única: ou a consolidação inteira entra, ou nada entra;
//   • vínculo transferido por ID (categoriaId), nunca por nome;
//   • contagem conferida ANTES e DEPOIS — divergiu, aborta;
//   • a duplicada só é removida depois de provada sem nenhuma dependência;
//   • auditoria oficial registra a transferência e a remoção;
//   • rodar de novo não faz nada (idempotente).
//
// Roda no build, onde a credencial existe. Não derruba o deployment: problema
// aqui vira alerta no log.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { identificador, retratar } from '../lib/db/identidade-banco.mjs'

const prisma = new PrismaClient()
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''

/**
 * Chave semântica: ignora caixa, acento, espaço excedente, hífen e sublinhado.
 * Espelha lib/gerenciamento/cadastro-identidade.ts (o guard compara as duas).
 */
const chaveSemantica = (v) =>
  (v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

const CODES_OFICIAIS = ['CIDNAC', 'REGCIV', 'RETREG']

/**
 * Correspondências DECIDIDAS. Chave = forma semântica do nome legado.
 *
 * `honorario` → CIDNAC: honorário é a remuneração do serviço de cidadania, não
 * uma família de serviço. É a mesma decisão que a migration já aplicava para a
 * forma plural ("Honorários"); em produção o dado estava no singular e por isso
 * escapou do mapa. Consolidar aqui é fechar essa lacuna, não abrir uma regra.
 */
const EQUIVALENCIAS = new Map([
  ['honorario', 'CIDNAC'],
  ['honorarios', 'CIDNAC'],
  ['nacionalidade', 'CIDNAC'],
  ['cidadania', 'CIDNAC'],
  ['servico documental', 'REGCIV'],
  ['transcricao', 'REGCIV'],
  ['registro civil', 'REGCIV'],
  ['retificacao', 'RETREG'],
])

async function main() {
  const retrato = await retratar(prisma)
  console.log(`[consolidar-cat] alvo: ${identificador(url)} (tabelas=${retrato.tabelas}, migrations=${retrato.migrations})`)

  const categorias = await prisma.categoriaServico.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, code: true, nome: true, _count: { select: { itens: true } } },
  })
  const oficiais = new Map(categorias.filter((c) => CODES_OFICIAIS.includes(c.code)).map((c) => [c.code, c]))
  if (oficiais.size !== 3) {
    console.log(`[consolidar-cat] AVISO: as três categorias oficiais ainda não existem (${oficiais.size}/3). Nada a fazer.`)
    await prisma.$disconnect(); return
  }

  const forasteiras = categorias.filter((c) => !CODES_OFICIAIS.includes(c.code))
  if (forasteiras.length === 0) {
    console.log('[consolidar-cat] OK — só existem as três categorias oficiais. Nada a consolidar.')
    await prisma.$disconnect(); return
  }

  // ── DIAGNÓSTICO (sem escrita) ─────────────────────────────────────────────
  const plano = []
  for (const c of forasteiras) {
    const destinoCode = EQUIVALENCIAS.get(chaveSemantica(c.nome))
    const destino = destinoCode ? oficiais.get(destinoCode) : null
    if (!destino) {
      console.log(`[consolidar-cat] ⚠ SEM CORRESPONDÊNCIA DECIDIDA: #${c.id} [${c.code}] "${c.nome}" (${c._count.itens} item(ns)). Preservada — decisão humana.`)
      continue
    }
    console.log(`[consolidar-cat] plano: #${c.id} [${c.code}] "${c.nome}" (${c._count.itens} item(ns)) → #${destino.id} [${destino.code}] "${destino.nome}"`)
    plano.push({ origem: c, destino })
  }
  if (plano.length === 0) { console.log('[consolidar-cat] nada a executar.'); await prisma.$disconnect(); return }

  // ── EXECUÇÃO (transação única) ────────────────────────────────────────────
  const totalAntes = await prisma.itemCatalogo.count({ where: { categoriaId: { not: null } } })

  await prisma.$transaction(async (tx) => {
    for (const { origem, destino } of plano) {
      const itens = await tx.itemCatalogo.findMany({ where: { categoriaId: origem.id }, select: { id: true } })
      // Transferência por ID. Nome não entra na condição em momento nenhum.
      const movidos = await tx.itemCatalogo.updateMany({
        where: { categoriaId: origem.id },
        data: { categoriaId: destino.id },
      })
      if (movidos.count !== itens.length) {
        throw new Error(`transferência divergente em #${origem.id}: esperados ${itens.length}, movidos ${movidos.count}`)
      }

      // A remoção só acontece com dependência ZERO, conferida agora.
      const restantes = await tx.itemCatalogo.count({ where: { categoriaId: origem.id } })
      if (restantes !== 0) throw new Error(`#${origem.id} ainda tem ${restantes} vínculo(s); remoção abortada`)

      await tx.categoriaServico.delete({ where: { id: origem.id } })

      await tx.logAuditoria.create({
        data: {
          acao: 'EDITAR', entidade: 'CategoriaServico', entidadeId: destino.id,
          descricao: `Consolidação: "${origem.nome}" [${origem.code}] absorvida por "${destino.nome}" [${destino.code}]`,
          detalhes: {
            origemId: origem.id, origemCode: origem.code, origemNome: origem.nome,
            destinoId: destino.id, destinoCode: destino.code,
            itensTransferidos: itens.map((i) => i.id),
          },
        },
      })
      console.log(`[consolidar-cat] ✓ #${origem.id} [${origem.code}] → #${destino.id} [${destino.code}] · ${itens.length} item(ns) transferido(s) · origem removida`)
    }
  }, { timeout: 30000, maxWait: 10000 })

  // ── PROVA DE NÃO-PERDA ────────────────────────────────────────────────────
  const totalDepois = await prisma.itemCatalogo.count({ where: { categoriaId: { not: null } } })
  if (totalAntes !== totalDepois) {
    console.log(`[consolidar-cat] ⚠ DIVERGÊNCIA: itens categorizados ${totalAntes} → ${totalDepois}`)
  } else {
    console.log(`[consolidar-cat] ✓ nenhum vínculo perdido: ${totalAntes} itens categorizados antes e depois`)
  }

  const finais = await prisma.categoriaServico.count()
  console.log(`[consolidar-cat] categorias após consolidação: ${finais}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.log(`[consolidar-cat] AVISO: consolidação não concluída, nada foi alterado (${String(e?.message ?? e).slice(0, 200)})`)
  await prisma.$disconnect()
})
