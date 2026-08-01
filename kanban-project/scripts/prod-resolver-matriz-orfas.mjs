// scripts/prod-resolver-matriz-orfas.mjs
// ============================================================================
// RESOLVE as regras órfãs da Matriz Documental — arquivar não é estado final.
//
// Uma regra cujo `tipoProcessoId` não existe nunca é avaliada pelo motor: ela é
// dado morto. Mantê-la arquivada seria trocar legado ativo por legado dormente.
//
// REMAPEAR exige correspondência COMPROVADA. Não há: os tipos de origem (#0, #5)
// não existem mais e nada na regra indica para qual tipo oficial ela iria. O
// prefixo "IT -" dos códigos significa INTEIRO TEOR, não Itália — inferir país
// dali seria exatamente a adivinhação por texto que a arquitetura proíbe.
//
// Então: audita tudo, remapeia o que tiver destino comprovado (hoje, nada),
// elimina o que for inválido E sem dependência, e registra na auditoria oficial.
// A auditoria guarda o conteúdo integral da regra removida.
//
// NÃO roda no build. É operação administrativa explícita:
//   npm run prod:resolver-matriz-orfas
// exigindo VERCEL_ENV=production, PROD_RESOLVER_MATRIZ_ORFAS=APLICAR,
// PRISMA_DATABASE_URL e identidade do banco classificada como PRODUCAO.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { rodarScriptProducao } from '../lib/db/guarda-escrita-producao.mjs'

const NOME = 'matriz'
const FLAG = 'PROD_RESOLVER_MATRIZ_ORFAS'
const L = (m) => console.log(`[matriz] ${m}`)

async function resolverOrfas({ prisma }) {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ select: { id: true, name: true, countryKey: true } })
  const idsTipo = new Set(tipos.map((t) => t.id))
  L(`tipos de processo oficiais: ${tipos.map((t) => `#${t.id} ${t.countryKey}`).join(', ')}`)

  const todas = await prisma.matrizDocumental.findMany({ orderBy: { id: 'asc' } })
  L(`regras na matriz: ${todas.length}`)

  const orfas = todas.filter((g) => !idsTipo.has(g.tipoProcessoId))
  const validas = todas.filter((g) => idsTipo.has(g.tipoProcessoId))
  L(`válidas: ${validas.length} · órfãs: ${orfas.length}`)

  // ── FICHA de cada órfã ───────────────────────────────────────────────────
  for (const g of orfas) {
    const doc = await prisma.tipoDocumentoCadastro.findFirst({
      where: { code: g.documentTypeCode },
      select: { id: true, name: true, ativo: true, itemCatalogoId: true },
    })
    L(`  ── regra #${g.id} ──────────────────────────────`)
    L(`     documento mestre: ${g.documentTypeCode}${doc ? ` → #${doc.id} ${doc.name} (item ${doc.itemCatalogoId ?? '—'})` : ' → NÃO EXISTE no cadastro'}`)
    L(`     alvo: ${g.target} · fase: ${g.phaseKey ?? '—'}`)
    L(`     condição: ${g.condition ?? '—'} · obrigatória=${g.required} condicional=${g.conditional}`)
    L(`     efeitos: tarefa=${g.createsTask} custo=${g.createsCost} receita=${g.createsRevenue} bloqueia=${g.blocksPhaseCompletion}`)
    L(`     tipo de processo antigo: #${g.tipoProcessoId} (INEXISTENTE)`)
    L(`     consumidores (usedByCount): ${g.usedByCount} · arquivada=${g.arquivado} · versão=${g.versao}`)
    L(`     remapeamento: SEM correspondência comprovada — o tipo de origem não existe e a regra não carrega país nem modalidade`)
  }

  const comUso = orfas.filter((g) => g.usedByCount > 0)
  const semUso = orfas.filter((g) => g.usedByCount === 0)
  if (comUso.length) {
    L(`⚠ ${comUso.length} órfã(s) com usedByCount > 0 — PRESERVADAS para conferência humana: ${comUso.map((g) => `#${g.id}`).join(', ')}`)
  }
  if (semUso.length === 0) { L('nada a eliminar.'); return }

  // ── ELIMINAÇÃO definitiva das inválidas sem dependência ──────────────────
  await prisma.$transaction(async (tx) => {
    await tx.logAuditoria.create({
      data: {
        acao: 'EXCLUIR', entidade: 'MatrizDocumental', entidadeId: null,
        descricao: `${semUso.length} regra(s) documental(is) inválida(s) eliminada(s): tipo de processo inexistente e sem consumidores`,
        detalhes: {
          motivo: 'tipoProcessoId sem correspondência oficial; sem remapeamento comprovado; usedByCount = 0',
          regras: semUso.map((g) => ({
            id: g.id, tipoProcessoId: g.tipoProcessoId, documentTypeCode: g.documentTypeCode,
            target: g.target, phaseKey: g.phaseKey, condition: g.condition,
            required: g.required, conditional: g.conditional, generationRule: g.generationRule,
            createsTask: g.createsTask, createsCost: g.createsCost, createsRevenue: g.createsRevenue,
            blocksPhaseCompletion: g.blocksPhaseCompletion, versao: g.versao,
          })),
        },
      },
    })
    await tx.matrizDocumental.deleteMany({ where: { id: { in: semUso.map((g) => g.id) } } })
  }, { timeout: 30000, maxWait: 10000 })
  L(`✓ ${semUso.length} regra(s) eliminada(s) — conteúdo integral preservado na auditoria`)

  // Prova de não-perda: só podem ter saído as `semUso`, nada mais.
  const restante = await prisma.matrizDocumental.count()
  const esperado = todas.length - semUso.length
  if (restante !== esperado) {
    throw new Error(`DIVERGÊNCIA: matriz tinha ${todas.length} regra(s), ${semUso.length} eliminada(s), esperado ${esperado}, encontrado ${restante}`)
  }
  const arquivadas = await prisma.matrizDocumental.count({ where: { arquivado: true } })
  L(`matriz após limpeza: ${restante} regra(s) · arquivadas: ${arquivadas}`)
  L(restante === 0 ? 'matriz VAZIA — nenhuma regra morta, nenhum legado.' : 'conferir as remanescentes.')
}

await rodarScriptProducao({
  nome: NOME,
  flag: FLAG,
  criarPrisma: () => new PrismaClient(),
  operacao: resolverOrfas,
})
