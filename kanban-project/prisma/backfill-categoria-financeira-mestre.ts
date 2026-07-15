// prisma/backfill-categoria-financeira-mestre.ts
// Migra CategoriaFinanceira LEGADO (texto livre, sem FK) → vínculo por FK a um
// cadastro mestre. IDEMPOTENTE e não-destrutivo.
//
// Estratégia (nesta ordem, conforme a regra do sistema):
//   1) MATCHING POR FK — se algum ProdutoFinanceiro (config) que aponta para a
//      categoria tiver um mestre (tipoDocumento/serviço/honorário/processo),
//      herda esse mestre. Só usa se houver UM mestre distinto.
//   2) MATCHING POR NOME — só quando não há FK: casa o nome normalizado da
//      categoria com o nome de um mestre. Usa apenas se o match for de UMA origem.
// Colisão com o unique (mestre × tipo) → registra conflito e NÃO altera.
// O nome é re-derivado do mestre. Só toca linhas origem = LEGADO.
//
// Rodar:  npm run backfill:catfin:dry   |   npm run backfill:catfin

import { prisma } from '../lib/prisma'
import { writeFileSync } from 'node:fs'

const EXECUTE = process.argv.includes('--execute')

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

type Alvo =
  | { origem: 'DOCUMENTO'; field: 'tipoDocumentoId'; id: number; nome: string }
  | { origem: 'SERVICO'; field: 'itemCatalogoId'; id: number; nome: string }
  | { origem: 'HONORARIO'; field: 'honorarioId'; id: number; nome: string }
  | { origem: 'PROCESSO'; field: 'tipoProcessoId'; id: number; nome: string }

async function main() {
  console.log(`\n=== Backfill CategoriaFinanceira → mestre (${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}) ===\n`)

  const [legadas, tiposDoc, servicos, honorarios, tiposProc] = await Promise.all([
    prisma.categoriaFinanceira.findMany({ where: { origem: 'LEGADO' }, orderBy: { id: 'asc' } }),
    prisma.tipoDocumentoCadastro.findMany({ where: { ativo: true }, select: { id: true, name: true } }),
    prisma.itemCatalogo.findMany({ where: { natureza: 'SERVICO', ativo: true }, select: { id: true, name: true } }),
    prisma.honorario.findMany({ where: { ativo: true }, select: { id: true, name: true } }),
    prisma.tipoProcessoNacionalidade.findMany({ where: { ativo: true }, select: { id: true, name: true } }),
  ])

  // índices por nome normalizado (só considera nomes únicos dentro de cada origem)
  const idxPorNome = (
    rows: { id: number; name: string }[],
    origem: Alvo['origem'],
    field: Alvo['field'],
  ) => {
    const m = new Map<string, Alvo | null>()
    for (const r of rows) {
      const k = norm(r.name)
      m.set(k, m.has(k) ? null /* ambíguo dentro da origem */ : ({ origem, field, id: r.id, nome: r.name } as Alvo))
    }
    return m
  }
  const idxDoc = idxPorNome(tiposDoc, 'DOCUMENTO', 'tipoDocumentoId')
  const idxSrv = idxPorNome(servicos, 'SERVICO', 'itemCatalogoId')
  const idxHon = idxPorNome(honorarios, 'HONORARIO', 'honorarioId')
  const idxProc = idxPorNome(tiposProc, 'PROCESSO', 'tipoProcessoId')

  // ocupação atual do unique (mestre × tipo) para detectar colisão antes de gravar
  const ocupados = new Set<string>()
  const jaVinculadas = await prisma.categoriaFinanceira.findMany({
    where: { origem: { not: 'LEGADO' } },
    select: { tipo: true, tipoDocumentoId: true, itemCatalogoId: true, honorarioId: true, tipoProcessoId: true },
  })
  for (const c of jaVinculadas) {
    if (c.tipoDocumentoId) ocupados.add(`tipoDocumentoId:${c.tipoDocumentoId}:${c.tipo}`)
    if (c.itemCatalogoId) ocupados.add(`itemCatalogoId:${c.itemCatalogoId}:${c.tipo}`)
    if (c.honorarioId) ocupados.add(`honorarioId:${c.honorarioId}:${c.tipo}`)
    if (c.tipoProcessoId) ocupados.add(`tipoProcessoId:${c.tipoProcessoId}:${c.tipo}`)
  }

  const rel = {
    porFk: [] as any[],
    porNome: [] as any[],
    semMatch: [] as any[],
    conflito: [] as any[],
  }

  for (const c of legadas) {
    let alvo: Alvo | null = null
    let via: 'FK' | 'NOME' | null = null

    // 1) matching por FK — via configs (ProdutoFinanceiro) que apontam para a categoria
    const configs = await prisma.produtoFinanceiro.findMany({
      where: {
        categoriaId: c.id,
        OR: [
          { tipoDocumentoId: { not: null } },
          { itemCatalogoId: { not: null } },
          { honorarioId: { not: null } },
          { tipoProcessoId: { not: null } },
        ],
      },
      select: { tipoDocumentoId: true, itemCatalogoId: true, honorarioId: true, tipoProcessoId: true },
    })
    const candidatos = new Map<string, Alvo>()
    for (const p of configs) {
      if (p.tipoDocumentoId) candidatos.set(`d${p.tipoDocumentoId}`, { origem: 'DOCUMENTO', field: 'tipoDocumentoId', id: p.tipoDocumentoId, nome: tiposDoc.find((x) => x.id === p.tipoDocumentoId)?.name ?? c.nome })
      else if (p.itemCatalogoId) candidatos.set(`s${p.itemCatalogoId}`, { origem: 'SERVICO', field: 'itemCatalogoId', id: p.itemCatalogoId, nome: servicos.find((x) => x.id === p.itemCatalogoId)?.name ?? c.nome })
      else if (p.honorarioId) candidatos.set(`h${p.honorarioId}`, { origem: 'HONORARIO', field: 'honorarioId', id: p.honorarioId, nome: honorarios.find((x) => x.id === p.honorarioId)?.name ?? c.nome })
      else if (p.tipoProcessoId) candidatos.set(`p${p.tipoProcessoId}`, { origem: 'PROCESSO', field: 'tipoProcessoId', id: p.tipoProcessoId, nome: tiposProc.find((x) => x.id === p.tipoProcessoId)?.name ?? c.nome })
    }
    if (candidatos.size === 1) { alvo = [...candidatos.values()][0]; via = 'FK' }

    // 2) matching por nome — só se não houve FK
    if (!alvo) {
      const k = norm(c.nome)
      const hits = [idxDoc.get(k), idxSrv.get(k), idxHon.get(k), idxProc.get(k)].filter((x): x is Alvo => !!x)
      if (hits.length === 1) { alvo = hits[0]; via = 'NOME' }
      else if (hits.length > 1) { rel.semMatch.push({ id: c.id, nome: c.nome, motivo: 'nome casa em múltiplas origens (ambíguo)' }); continue }
    }

    if (!alvo) { rel.semMatch.push({ id: c.id, nome: c.nome, motivo: 'nenhum mestre correspondente' }); continue }

    const chave = `${alvo.field}:${alvo.id}:${c.tipo}`
    if (ocupados.has(chave)) {
      rel.conflito.push({ id: c.id, nome: c.nome, origem: alvo.origem, mestreId: alvo.id, mestre: alvo.nome, tipo: c.tipo, motivo: 'já existe categoria para (mestre × tipo)' })
      continue
    }
    ocupados.add(chave)

    const registro = { id: c.id, de: c.nome, origem: alvo.origem, mestreId: alvo.id, para: alvo.nome, tipo: c.tipo, via }
    ;(via === 'FK' ? rel.porFk : rel.porNome).push(registro)

    if (EXECUTE) {
      await prisma.categoriaFinanceira.update({
        where: { id: c.id },
        data: { origem: alvo.origem, [alvo.field]: alvo.id, nome: alvo.nome },
      })
    }
  }

  const resumo = {
    total: legadas.length,
    porFk: rel.porFk.length,
    porNome: rel.porNome.length,
    conflito: rel.conflito.length,
    semMatch: rel.semMatch.length,
    modo: EXECUTE ? 'EXECUTE' : 'DRY-RUN',
    geradoEm: new Date().toISOString(),
  }
  console.log('Resumo:', JSON.stringify(resumo, null, 2))
  console.log(`  ✔ por FK:   ${rel.porFk.length}`)
  console.log(`  ✔ por nome: ${rel.porNome.length}`)
  console.log(`  ⚠ conflito: ${rel.conflito.length}`)
  console.log(`  ✖ sem match:${rel.semMatch.length}`)

  const path = `categoria-mestre-backfill-${EXECUTE ? 'exec' : 'dry'}-report.json`
  writeFileSync(path, JSON.stringify({ resumo, ...rel }, null, 2))
  console.log(`\nRelatório: ${path}`)
  if (!EXECUTE) console.log('\n(DRY-RUN — nada foi gravado. Rode com --execute para aplicar.)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
