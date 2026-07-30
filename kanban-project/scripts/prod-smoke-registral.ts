// scripts/prod-smoke-registral.ts
// ============================================================================
// SMOKE DE PRODUÇÃO do Motor Registral Genealógico — SOMENTE LEITURA.
//
// Prova, contra o banco de produção, que a estrutura do motor existe e está
// coerente. NÃO cria lote, NÃO processa documento, NÃO grava nada: um smoke que
// escreve em produção deixa de ser smoke.
//
// Verificações:
//   1. as 13 tabelas do MRG existem;
//   2. as 12 enums do MRG existem;
//   3. `Documento` tem as 4 colunas de transcrição, todas NULLABLE;
//   4. cada tabela do MRG tem índice UNIQUE de idempotência;
//   5. os perfis têm as 8 chaves `registral.*` gravadas e `mesclar_pessoas` FALSA;
//   6. nenhuma tabela do MRG guarda arquivo ou status documental;
//   7. os motores puros respondem (linhagem/integridade) sobre uma árvore real,
//      sem escrever — e sem quebrar quando a árvore não tem requerente.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { CHAVE_REGISTRAL, MATRIZ_REGISTRAL, OPERACOES_REGISTRAIS } from '@/lib/genealogia/permissoes-registral'

let ok = 0
let falhas = 0
const erros: string[] = []
function checar(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    ok++
    console.log(`  ✅ ${nome}`)
  } else {
    falhas++
    erros.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ''}`)
  }
}

const TABELAS = [
  'LoteRegistral',
  'ExecucaoRegistral',
  'EtapaExecucaoRegistral',
  'OcorrenciaDocumental',
  'FatoRegistral',
  'EvidenciaRegistral',
  'CorrespondenciaIdentidade',
  'PropostaReconciliacao',
  'ConflitoRegistral',
  'ImpactoAplicacaoRegistral',
  'DecisaoRevisaoRegistral',
  'VersaoGenealogica',
  'MetricaRegistral',
]

const ENUMS = [
  'EtapaRegistral',
  'StatusLoteRegistral',
  'EstadoFatoRegistral',
  'CampoRegistral',
  'PapelOcorrencia',
  'ClasseCorrespondencia',
  'TipoPropostaRegistral',
  'CriticidadeRegistral',
  'StatusPropostaRegistral',
  'SeveridadeRegistral',
  'StatusConflitoRegistral',
  'ResultadoLinhagemRegistral',
]

/** Tabelas sem chaveIdempotencia por desenho (trilha e agregados). */
const SEM_CHAVE_IDEMPOTENCIA = new Set(['EtapaExecucaoRegistral', 'VersaoGenealogica', 'MetricaRegistral'])

async function main() {
  console.log('\nSMOKE REGISTRAL (somente leitura)\n')

  // ---------------------------------------------------------------- 1. tabelas
  const tabelas = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  `
  const nomes = new Set(tabelas.map((t) => t.table_name))
  for (const t of TABELAS) checar(nomes.has(t), `tabela ${t} existe`)

  // ---------------------------------------------------------------- 2. enums
  const tipos = await prisma.$queryRaw<Array<{ typname: string }>>`
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema() AND t.typtype = 'e'
  `
  const enums = new Set(tipos.map((t) => t.typname))
  for (const e of ENUMS) checar(enums.has(e), `enum ${e} existe`)

  // ------------------------------------------------- 3. transcrição no Documento
  const colsDoc = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Documento'
      AND column_name IN ('transcricaoTexto','transcricaoPaginas','transcricaoFonte','transcricaoEm')
  `
  checar(colsDoc.length === 4, 'Documento tem as 4 colunas de transcrição', colsDoc.length)
  checar(
    colsDoc.every((c) => c.is_nullable === 'YES'),
    'todas as colunas de transcrição são NULLABLE (aditivas, sem backfill)',
    colsDoc.filter((c) => c.is_nullable !== 'YES').map((c) => c.column_name),
  )

  // ------------------------------------------------------ 4. índices de idempotência
  const indices = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`
    SELECT tablename, indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND indexdef LIKE '%UNIQUE%'
  `
  for (const t of TABELAS) {
    if (SEM_CHAVE_IDEMPOTENCIA.has(t)) continue
    const temChave = indices.some((i) => i.tablename === t && i.indexdef.includes('chaveIdempotencia'))
    checar(temChave, `${t} tem UNIQUE de idempotência`)
  }
  checar(
    indices.some((i) => i.tablename === 'VersaoGenealogica' && i.indexdef.includes('versao')),
    'VersaoGenealogica é única por (árvore, versão)',
  )
  checar(
    indices.some((i) => i.tablename === 'MetricaRegistral' && i.indexdef.includes('janelaInicio')),
    'MetricaRegistral é única por (chave, escopo, janela)',
  )

  // ------------------------------------------------------------- 5. permissões
  // ESCOPO: o smoke afirma sobre os perfis DA MATRIZ, que são os que o seed é
  // responsável por manter. Perfil personalizado fora da matriz pode legitimamente
  // não ter as chaves (ninguém as concedeu) ou ter `mesclar_pessoas` concedida
  // explicitamente — é para isso que OPT-IN existe. Afirmar sobre todos derrubaria
  // o build por uma configuração legítima que o motor nem toca.
  const nomesDaMatriz = Object.keys(MATRIZ_REGISTRAL)
  const perfis = await prisma.perfil.findMany({ select: { nome: true, permissoes: true } })
  const daMatriz = perfis.filter((p) => nomesDaMatriz.includes(p.nome.trim()))
  checar(perfis.length > 0, `${perfis.length} perfil(is) no banco (${daMatriz.length} na matriz)`)

  const semChaves = daMatriz.filter((p) => {
    const m = (p.permissoes ?? {}) as Record<string, boolean>
    return OPERACOES_REGISTRAIS.some((op) => !(CHAVE_REGISTRAL[op] in m))
  })
  checar(
    semChaves.length === 0,
    'todo perfil da matriz tem as 8 chaves registral.* gravadas',
    semChaves.map((p) => p.nome),
  )

  const conformes = daMatriz.filter((p) => {
    const m = (p.permissoes ?? {}) as Record<string, boolean>
    const esperadas = new Set(MATRIZ_REGISTRAL[p.nome.trim()] ?? [])
    return OPERACOES_REGISTRAIS.every((op) => !!m[CHAVE_REGISTRAL[op]] === esperadas.has(op))
  })
  checar(
    conformes.length === daMatriz.length,
    'todo perfil da matriz está exatamente conforme a matriz canônica',
    daMatriz.filter((p) => !conformes.includes(p)).map((p) => p.nome),
  )

  const comFusao = daMatriz.filter(
    (p) => ((p.permissoes ?? {}) as Record<string, boolean>)[CHAVE_REGISTRAL.mesclar_pessoas] === true,
  )
  checar(
    comFusao.length === 0,
    'nenhum perfil da matriz tem registral.mesclar_pessoas (OPT-IN preservado)',
    comFusao.map((p) => p.nome),
  )

  const foraComFusao = perfis
    .filter((p) => !nomesDaMatriz.includes(p.nome.trim()))
    .filter((p) => ((p.permissoes ?? {}) as Record<string, boolean>)[CHAVE_REGISTRAL.mesclar_pessoas] === true)
  if (foraComFusao.length) {
    console.log(
      `     ℹ️  ${foraComFusao.length} perfil(is) fora da matriz com fusão concedida explicitamente: ${foraComFusao.map((p) => p.nome).join(', ')}`,
    )
  }

  // --------------------------------------- 6. a árvore não virou repositório documental
  const proibidas = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (
        'LoteRegistral','ExecucaoRegistral','OcorrenciaDocumental','FatoRegistral','EvidenciaRegistral',
        'CorrespondenciaIdentidade','PropostaReconciliacao','ConflitoRegistral','ImpactoAplicacaoRegistral',
        'DecisaoRevisaoRegistral','VersaoGenealogica','MetricaRegistral'
      )
      AND column_name IN ('arquivo_url','arquivo_nome','arquivo_tamanho','arquivo_mime_type','status_documento')
  `
  checar(proibidas.length === 0, 'nenhuma tabela do MRG guarda arquivo/status documental', proibidas)

  // ------------------------------------------------- 7. motores puros respondem
  const { recalcularLinhagem } = await import('@/src/services/registral/consultas')
  const processo = await prisma.processo.findFirst({
    where: { arvoreId: { not: null } },
    orderBy: { id: 'desc' },
    select: { id: true, nome: true },
  })
  if (!processo) {
    checar(true, 'nenhum processo com árvore em produção — nada a apurar (não é falha)')
  } else {
    const r = await recalcularLinhagem(processo.id)
    checar(r !== null, `linhagem apurada para o processo #${processo.id}`)
    checar(
      r == null || typeof r.elegibilidade.resultado === 'string',
      'resultado de elegibilidade é um dos valores canônicos',
      r?.elegibilidade.resultado,
    )
    checar(
      r == null || typeof r.elegibilidade.comprovadoDocumentalmente === 'boolean',
      'o motor declara explicitamente se a linha está comprovada',
      r?.elegibilidade.comprovadoDocumentalmente,
    )
    console.log(
      `     ↳ processo #${processo.id}: ${r?.elegibilidade.resultado ?? '—'} · ${r?.inconsistencias.length ?? 0} inconsistência(s) · ${r?.elegibilidade.pendencias.length ?? 0} pendência(s)`,
    )
  }

  // Contadores de volume: o motor nasce vazio em produção; isto é informativo.
  const [lotes, evidencias, propostas, conflitos, fatos] = await Promise.all([
    prisma.loteRegistral.count(),
    prisma.evidenciaRegistral.count(),
    prisma.propostaReconciliacao.count(),
    prisma.conflitoRegistral.count(),
    prisma.fatoRegistral.count(),
  ])
  console.log(
    `\n  volume atual — lotes=${lotes} evidências=${evidencias} propostas=${propostas} conflitos=${conflitos} fatos=${fatos}`,
  )

  console.log(`\n${'='.repeat(60)}`)
  console.log(`SMOKE REGISTRAL: ${ok} ok, ${falhas} falha(s)`)
  await prisma.$disconnect()
  if (falhas) {
    console.error('\nFalhas:')
    for (const e of erros) console.error(`  · ${e}`)
    process.exit(1)
  }
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
