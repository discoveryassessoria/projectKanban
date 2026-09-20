// scripts/backfill-catalogo-fase-revisao.mjs
// ============================================================================
// BACKFILL DE DADOS do mandato "Catálogo de Fases" (20/09/2026). Complementa a
// migration `20260920020000_catalogo_fase_revisao_macro_workflow_versao`, que
// só cria colunas/tabelas — este script decide CONTEÚDO, e por isso roda à
// parte, revisável, com relatório completo e nunca aplicado por padrão.
//
// O QUE FAZ (nesta ordem, cada passo LOGADO antes de escrever):
//   1) Corrige `CatalogoFase.efeitosPermitidos` das 7 fases canônicas que hoje
//      estão `null` (achado real, produção, 20/09/2026): genealogia,
//      emissao_documental_retificada, traducao_juramentada, apostilamento,
//      aguardando_protocolo, protocolado, finalizado. `null` caía no ramo
//      "sem restrição declarada" de `efeitosDaFase` — que agora nega por
//      padrão — então SEM este passo essas 7 fases perdem TODOS os efeitos.
//      Os valores aqui são a competência que cada fase já deveria ter,
//      documentada em `COMPETENCIA_PADRAO_DA_FASE`
//      (src/lib/motor/catalogo-de-efeitos.ts).
//   2) Marca `status = INATIVA` (mantendo `ativo = false` em sincronia) nas
//      fases de teste/legado: `teste_fase`, `TESTEVIS_fase`, `transcricoes`.
//      NUNCA exclui a linha — o cadastro e toda referência histórica (inclusive
//      os 6 processos de teste visual que hoje têm `faseAtualKey =
//      'TESTEVIS_fase'`) permanecem intactos e operáveis; a fase só deixa de
//      ser OFERTADA como opção de composição de workflow novo.
//   3) Semeia `CatalogoFaseRevisao` #1 para toda `CatalogoFase` existente, e
//      `MacroWorkflowVersao` #1 para todo `MacroWorkflow` existente — a
//      fotografia "como estava" no instante em que o versionamento passou a
//      existir. origem = 'BACKFILL'.
//
// O QUE NÃO FAZ: não move nenhum Processo de fase, não altera
// `Processo.faseAtualKey`, não apaga nenhuma linha, não altera FaseMacro.
//
// USO:
//   node scripts/backfill-catalogo-fase-revisao.mjs                → dry-run (só relatório)
//   node scripts/backfill-catalogo-fase-revisao.mjs --aplicar       → aplica no banco do DATABASE_URL/PRISMA_DATABASE_URL atual
//   node scripts/backfill-catalogo-fase-revisao.mjs --aplicar --prod → exige também EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1
//
// Idempotente: rodar de novo depois de aplicado não duplica revisão nem
// sobrescreve `efeitosPermitidos` que já não seja `null`.
// ============================================================================
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APLICAR = process.argv.includes('--aplicar')
const ALVO_PROD = process.argv.includes('--prod')

const EFEITOS_POR_FASE_NULA = {
  genealogia: ['COMPLETE_STEP', 'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY'],
  emissao_documental_retificada: [
    'COMPLETE_STEP', 'MARK_DOCUMENT_RECEIVED', 'APPROVE_FOR_ANALYSIS', 'REQUEST_NEW_COPY',
    'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY',
  ],
  traducao_juramentada: ['COMPLETE_STEP', 'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY'],
  apostilamento: ['COMPLETE_STEP', 'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY'],
  aguardando_protocolo: [
    'COMPLETE_STEP', 'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY',
    'REGISTER_PROTOCOL',
  ],
  protocolado: ['COMPLETE_STEP', 'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY'],
  finalizado: ['COMPLETE_STEP', 'PAUSE_FOR_EXTERNAL_WAIT', 'RESUME', 'COMPLETE_DOCUMENT', 'REGISTER_ONLY'],
}

const FASES_LEGADO_PARA_INATIVAR = ['teste_fase', 'TESTEVIS_fase', 'transcricoes']

async function main() {
  const urlAtual = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''
  const pareceProd = /db\.prisma\.io|neon\.tech/i.test(urlAtual) && !/discovery_test|127\.0\.0\.1|localhost/.test(urlAtual)
  console.log(`[backfill-catalogo-fase] alvo: ${urlAtual.replace(/:[^:@]+@/, ':***@')}`)
  console.log(`[backfill-catalogo-fase] modo: ${APLICAR ? 'APLICAR' : 'DRY-RUN (nada será escrito)'}`)

  if (APLICAR && pareceProd && !ALVO_PROD) {
    console.error('[backfill-catalogo-fase] RECUSADO: a URL atual parece produção, mas --prod não foi passado. Nada foi escrito.')
    process.exit(1)
  }
  if (APLICAR && ALVO_PROD && process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== '1') {
    console.error('[backfill-catalogo-fase] RECUSADO: --prod exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1. Nada foi escrito.')
    process.exit(1)
  }

  const fases = await prisma.catalogoFase.findMany({ orderBy: { ordemPadrao: 'asc' } })
  const relatorio = { efeitosCorrigidos: [], legadoInativado: [], revisoesSemeadas: [], macroVersoesSemeadas: [] }

  // ── 1) efeitosPermitidos ──────────────────────────────────────────────
  for (const f of fases) {
    const novo = EFEITOS_POR_FASE_NULA[f.phaseKey]
    if (!novo) continue
    if (f.efeitosPermitidos != null) {
      console.log(`  [efeitos] ${f.phaseKey}: já tem efeitosPermitidos declarado — não sobrescrevo (idempotência).`)
      continue
    }
    relatorio.efeitosCorrigidos.push({ phaseKey: f.phaseKey, id: f.id, antes: null, depois: novo })
    console.log(`  [efeitos] ${f.phaseKey} (id ${f.id}): null → ${JSON.stringify(novo)}`)
    if (APLICAR) {
      await prisma.catalogoFase.update({ where: { id: f.id }, data: { efeitosPermitidos: novo } })
    }
  }

  // ── 2) inativação de fases de legado/teste ───────────────────────────
  for (const key of FASES_LEGADO_PARA_INATIVAR) {
    const f = fases.find((x) => x.phaseKey === key)
    if (!f) { console.log(`  [legado] ${key}: não existe no catálogo — nada a fazer.`); continue }
    if (f.status === 'INATIVA' && f.ativo === false) {
      console.log(`  [legado] ${key}: já INATIVA/ativo=false — não repito (idempotência).`)
      continue
    }
    relatorio.legadoInativado.push({ phaseKey: f.phaseKey, id: f.id, statusAntes: f.status, ativoAntes: f.ativo })
    console.log(`  [legado] ${key} (id ${f.id}): status=${f.status}/ativo=${f.ativo} → status=INATIVA/ativo=false. Linha preservada; nenhuma referência histórica é tocada.`)
    if (APLICAR) {
      await prisma.catalogoFase.update({ where: { id: f.id }, data: { status: 'INATIVA', ativo: false } })
    }
  }

  // ── 3) revisão #1 congelada de cada CatalogoFase ─────────────────────
  const fasesAtualizadas = APLICAR ? await prisma.catalogoFase.findMany({ orderBy: { ordemPadrao: 'asc' } }) : fases
  for (const f of fasesAtualizadas) {
    const existente = await prisma.catalogoFaseRevisao.findUnique({
      where: { catalogoFaseId_revisao: { catalogoFaseId: f.id, revisao: 1 } },
    }).catch(() => null)
    if (existente) { console.log(`  [revisao] ${f.phaseKey}: revisão 1 já existe — não duplico.`); continue }
    const efeitosParaSnapshot = APLICAR
      ? (EFEITOS_POR_FASE_NULA[f.phaseKey] && f.efeitosPermitidos == null ? EFEITOS_POR_FASE_NULA[f.phaseKey] : f.efeitosPermitidos)
      : (f.efeitosPermitidos ?? EFEITOS_POR_FASE_NULA[f.phaseKey] ?? null)
    relatorio.revisoesSemeadas.push({ phaseKey: f.phaseKey, id: f.id })
    console.log(`  [revisao] ${f.phaseKey} (id ${f.id}): semeando revisão 1 (origem BACKFILL).`)
    if (APLICAR) {
      await prisma.catalogoFaseRevisao.create({
        data: {
          catalogoFaseId: f.id, revisao: 1, phaseKey: f.phaseKey, label: f.label, descricao: f.descricao,
          escopo: f.escopo, ordemPadrao: f.ordemPadrao, requiredPadrao: f.requiredPadrao,
          conditionalPadrao: f.conditionalPadrao, status: f.status, efeitosPermitidos: efeitosParaSnapshot,
          origem: 'BACKFILL',
        },
      })
    }
  }

  // ── 4) versão #1 congelada de cada MacroWorkflow ─────────────────────
  const workflows = await prisma.macroWorkflow.findMany({ include: { fases: { orderBy: { ordem: 'asc' } } } })
  for (const mw of workflows) {
    const existente = await prisma.macroWorkflowVersao.findUnique({
      where: { macroWorkflowId_versao: { macroWorkflowId: mw.id, versao: mw.versao } },
    }).catch(() => null)
    if (existente) { console.log(`  [macro-versao] ${mw.name}: versão ${mw.versao} já existe — não duplico.`); continue }
    const snapshot = mw.fases.map((f) => ({
      phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required,
      conditional: f.conditional, showInKanban: f.showInKanban, entryRule: f.entryRule,
    }))
    relatorio.macroVersoesSemeadas.push({ macroWorkflowId: mw.id, name: mw.name, versao: mw.versao, fases: snapshot.length })
    console.log(`  [macro-versao] ${mw.name} (id ${mw.id}): semeando versão ${mw.versao} com ${snapshot.length} fase(s) (origem BACKFILL).`)
    if (APLICAR) {
      await prisma.macroWorkflowVersao.create({
        data: { macroWorkflowId: mw.id, versao: mw.versao, tipoProcessoId: mw.tipoProcessoId, name: mw.name, fases: snapshot, origem: 'BACKFILL' },
      })
    }
  }

  console.log('\n=== RESUMO ===')
  console.log(`efeitosPermitidos corrigidos: ${relatorio.efeitosCorrigidos.length}`)
  console.log(`fases de legado inativadas: ${relatorio.legadoInativado.length}`)
  console.log(`revisões de CatalogoFase semeadas: ${relatorio.revisoesSemeadas.length}`)
  console.log(`versões de MacroWorkflow semeadas: ${relatorio.macroVersoesSemeadas.length}`)
  if (!APLICAR) console.log('\nDRY-RUN — nada foi escrito. Rode com --aplicar para aplicar de fato.')
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
