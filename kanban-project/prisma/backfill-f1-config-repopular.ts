// prisma/backfill-f1-config-repopular.ts
// ============================================================================
// REPOPULAÇÃO F1 — cria o ESQUELETO de Configuração Financeira (ProdutoFinanceiro)
// a partir dos cadastros MESTRES existentes. NÃO cria preços (valores monetários
// são dado de negócio; ficam para o usuário preencher na Tabela de Preços).
//
// M-UNIFICA — UMA config por mestre: o papel financeiro NÃO vive mais aqui.
// Custo e receita são VALORES desta config (TabelaValor.natureza). O esqueleto
// habilita ambos os papéis (possuiCusto e possuiReceita) por padrão; os valores
// ficam nulos até o usuário preencher.
//
// Respeita as constraints já ativas em produção:
//   • itemCatalogoId (pivô) sempre presente;
//   • no máx. 1 config por mestre — @@unique([itemCatalogoId]);
//   • idempotente: pula se já existe config para o mestre.
//
// Origem dos mestres:
//   • Documento → TipoDocumentoCadastro (ativo, com itemCatalogoId) → tipoDocumentoId
//   • Serviço   → ItemCatalogo natureza=SERVICO (ativo)             → itemCatalogoId (sem FK domínio)
//   Honorário/Processo ficam de fora (Honorario é órfão de item — depende de M4).
//
// Uso:
//   npx tsx prisma/backfill-f1-config-repopular.ts            (dry-run, read-only)
//   npx tsx prisma/backfill-f1-config-repopular.ts --execute  (grava)
// Conexão: usa INSPECT_DB_URL se setado; senão o datasource padrão.
// ============================================================================
import { PrismaClient, Moeda } from '@prisma/client'

const url = process.env.INSPECT_DB_URL
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient()
const EXECUTE = process.argv.includes('--execute')

type Plano = { codigo: string; nome: string; itemCatalogoId: number; tipoDocumentoId: number | null; origem: string }

async function main() {
  const [docs, servicos, existentes] = await Promise.all([
    prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, code: true, name: true, itemCatalogoId: true } }),
    prisma.itemCatalogo.findMany({ where: { ativo: true, natureza: 'SERVICO' }, select: { id: true, code: true, name: true } }),
    prisma.produtoFinanceiro.findMany({ select: { tipoDocumentoId: true, itemCatalogoId: true } }),
  ])

  // chaves já existentes (idempotência) — UMA config por mestre (sem papel)
  const jaDoc = new Set(existentes.filter((e) => e.tipoDocumentoId != null).map((e) => `${e.tipoDocumentoId}`))
  const jaItem = new Set(existentes.filter((e) => e.tipoDocumentoId == null && e.itemCatalogoId != null).map((e) => `${e.itemCatalogoId}`))

  const plano: Plano[] = []
  const pulados: { origem: string; ref: string; motivo: string }[] = []

  for (const d of docs) {
    if (d.itemCatalogoId == null) { pulados.push({ origem: 'Documento', ref: d.code ?? d.name, motivo: 'sem itemCatalogo (pivô) — precisa espelho antes' }); continue }
    if (jaDoc.has(`${d.id}`)) { pulados.push({ origem: 'Documento', ref: d.code ?? d.name, motivo: 'config já existe' }); continue }
    plano.push({ codigo: `CFG_DOC_${d.id}`, nome: d.name, itemCatalogoId: d.itemCatalogoId, tipoDocumentoId: d.id, origem: 'Documento' })
  }
  for (const sv of servicos) {
    if (jaItem.has(`${sv.id}`)) { pulados.push({ origem: 'Serviço', ref: sv.code, motivo: 'config já existe' }); continue }
    plano.push({ codigo: `CFG_SRV_${sv.id}`, nome: sv.name, itemCatalogoId: sv.id, tipoDocumentoId: null, origem: 'Serviço' })
  }

  console.log(`\n=== REPOPULAÇÃO F1 — ${EXECUTE ? 'EXECUTAR' : 'DRY-RUN (read-only)'} ===`)
  console.log(`Mestres: ${docs.length} documentos, ${servicos.length} serviços. Configs existentes: ${existentes.length}.`)
  console.log(`Configs a criar: ${plano.length} (${plano.filter((p) => p.origem === 'Documento').length} doc, ${plano.filter((p) => p.origem === 'Serviço').length} serviço).`)
  console.log(`Pulados: ${pulados.length}.`)
  const porMotivo = pulados.reduce<Record<string, number>>((a, p) => ((a[p.motivo] = (a[p.motivo] ?? 0) + 1), a), {})
  console.log('  motivos:', JSON.stringify(porMotivo))
  if (pulados.some((p) => p.motivo.includes('pivô'))) {
    console.log('  ⚠️ documentos sem pivô (não geram config):', pulados.filter((p) => p.motivo.includes('pivô')).map((p) => p.ref).join(', '))
  }

  if (!EXECUTE) {
    console.log('\nAmostra do plano (até 10):')
    for (const p of plano.slice(0, 10)) console.log(`  + [${p.origem}] ${p.codigo} — ${p.nome} (item ${p.itemCatalogoId}${p.tipoDocumentoId ? `, tipoDoc ${p.tipoDocumentoId}` : ''})`)
    console.log('\nDRY-RUN: nada gravado. Rode com --execute para criar as configs (sem preços).')
    return
  }

  let criadas = 0
  for (const p of plano) {
    try {
      await prisma.produtoFinanceiro.create({
        data: {
          codigo: p.codigo, nome: p.nome, moedaPadrao: Moeda.BRL,
          possuiCusto: true, possuiReceita: true,
          itemCatalogoId: p.itemCatalogoId, tipoDocumentoId: p.tipoDocumentoId, ativo: true,
        },
      })
      criadas++
    } catch (e: any) {
      if (e?.code === 'P2002') { pulados.push({ origem: p.origem, ref: p.codigo, motivo: 'corrida/unique — já existe' }); continue }
      throw e
    }
  }
  console.log(`\n✅ EXECUTADO: ${criadas} configs criadas. NENHUM preço criado (valores são input de negócio).`)
}

main().catch((e) => { console.error('ERRO:', e); process.exit(1) }).finally(() => prisma.$disconnect())
