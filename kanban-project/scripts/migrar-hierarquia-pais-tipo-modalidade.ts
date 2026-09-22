// scripts/migrar-hierarquia-pais-tipo-modalidade.ts
// ============================================================================
// MANDATO "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro"
// (22/09/2026) — PASSO 2 de 3: BACKFILL de dados, sobre as colunas/tabela
// aditivas do passo 1 (migration 20260922100000_..._1_additive).
//
// O QUE ESTE SCRIPT FAZ, NA ORDEM (idempotente — rodar de novo não duplica
// nem sobrescreve o que já está correto):
//
//   1) Para cada TipoProcessoNacionalidade (ainda com o antigo modalidadeId
//      único): cria 1 linha em TipoProcessoModalidadeHabilitada com essa
//      mesma modalidade — nenhum dado novo inventado, só a mesma verdade que
//      já existia, agora num modelo N:N.
//   2) Para cada MacroWorkflow: copia modalidadeId do Tipo (mesmo valor de
//      hoje — não muda NADA sobre qual workflow serve qual processo).
//   3) Para os 4 países reais com ModalidadeLegal cadastrada, aplica a
//      cardinalidadeRequerimento no MacroWorkflow correspondente (mapeamento
//      confirmado nominalmente com o usuário: IT_JUDICIAL→COLETIVO,
//      ES_LMD/PT_ADMINISTRATIVO/DE_ADMINISTRATIVO→INDIVIDUAL). Onde não há
//      MacroWorkflow real correspondente (IT_ADMINISTRATIVO — nenhum Tipo
//      "Itália Administrativa" existe hoje), a linha fica só documentada,
//      NADA é inventado.
//   4) Para cada Processo com tipoProcessoMotorId setado: copia modalidadeId
//      do Tipo (mesma modalidade que o processo JÁ operava sob, via o
//      MacroWorkflow do Tipo — não migra processo nenhum pra fluxo diferente).
//   5) Para cada MacroWorkflowVersao: copia modalidadeId + cardinalidade do
//      MacroWorkflow pai (à data do backfill — versões congeladas antes
//      desta migração nunca tiveram esses campos; o valor atual é a melhor
//      verdade disponível, documentado como tal).
//   6) Limpa 2 países/modalidades sintéticos órfãos ("Esc", "País CFGRETRO")
//      — leftover de fixtures de teste anteriores, ZERO TipoProcessoNacionalidade
//      os usa (verificado antes de tocar).
//
// PROVA, ANTES E DEPOIS: contagens de cada tabela afetada, zero órfãos, zero
// duplicação. NÃO exclui processos, NÃO altera fase atual, NÃO toca
// histórico/tarefas/documentos.
//
// Uso:
//   npx tsx scripts/migrar-hierarquia-pais-tipo-modalidade.ts --dry-run
//   EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/migrar-hierarquia-pais-tipo-modalidade.ts --aplicar
// (contra o banco de teste local, sem EU_CONFIRMO_ESCRITA_EM_PRODUCAO, com
//  PRISMA_DATABASE_URL apontando pra lá, roda sem confirmação — mesma
//  convenção de scripts/backfill-catalogo-fase-revisao.mjs)
// ============================================================================

const DRY_RUN = !process.argv.includes('--aplicar')
const ALVO_PRODUCAO = process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO === '1'

import { prisma } from '../lib/prisma'

// Contagens brutas por SQL: durante o passo 2/3, `modalidadeId` já é `Int`
// obrigatório no schema.prisma (o alvo final), mas a coluna real no banco
// ainda pode ter linhas com NULL até este backfill rodar — Prisma Client não
// aceita `{ not: null }` num campo tipado como obrigatório, então a contagem
// precisa ler o banco como ele está de fato, não como o schema já declara.
async function contarNaoNulos(tabela: string, coluna: string): Promise<number> {
  const r = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT count(*) as c FROM "${tabela}" WHERE "${coluna}" IS NOT NULL`,
  )
  return Number(r[0].c)
}

// Mapeamento nominal confirmado com o usuário (22/09/2026) — NÃO inferido,
// NÃO adivinhado. Código da ModalidadeLegal real → cardinalidade real.
const CARDINALIDADE_POR_MODALIDADE_LEGAL: Record<string, 'INDIVIDUAL' | 'COLETIVO'> = {
  IT_JUDICIAL: 'COLETIVO',
  ES_LMD: 'INDIVIDUAL',
  PT_ADMINISTRATIVO: 'INDIVIDUAL',
  DE_ADMINISTRATIVO: 'INDIVIDUAL',
}

let ok = 0, falhou = 0
function prova(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? ' — ' + detalhe : ''}`) }
  else { falhou++; console.error(`  ❌ ${nome}${detalhe ? ' — ' + detalhe : ''}`) }
}

async function main() {
  if (ALVO_PRODUCAO) {
    const { exigirConfirmacaoDeEscritaEmProducao } = await import('./_banco-de-teste')
    exigirConfirmacaoDeEscritaEmProducao(
      'mandato "Reconstrução da hierarquia País/Tipo/Modalidade/Workflow Macro" (22/09/2026) — backfill passo 2/3: TipoProcessoModalidadeHabilitada, MacroWorkflow.modalidadeId/cardinalidadeRequerimento, Processo.modalidadeId, limpeza de 2 países sintéticos órfãos',
      'migrar-hierarquia-pais-tipo-modalidade.ts',
    )
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log(`BACKFILL — hierarquia País/Tipo/Modalidade/Workflow Macro${DRY_RUN ? ' (DRY-RUN)' : ' (APLICANDO)'}`)
  console.log('='.repeat(70))

  // ── ANTES ──────────────────────────────────────────────────────────────
  const antes = {
    tipos: await prisma.tipoProcessoNacionalidade.count(),
    habilitacoes: await prisma.tipoProcessoModalidadeHabilitada.count(),
    macros: await prisma.macroWorkflow.count(),
    macrosComModalidade: await contarNaoNulos('MacroWorkflow', 'modalidadeId'),
    processos: await prisma.processo.count(),
    processosComTipo: await prisma.processo.count({ where: { tipoProcessoMotorId: { not: null } } }),
    processosComModalidade: await contarNaoNulos('Processo', 'modalidadeId'),
    versoes: await prisma.macroWorkflowVersao.count(),
    versoesComModalidade: await contarNaoNulos('MacroWorkflowVersao', 'modalidadeId'),
  }
  console.log('\n── ANTES ──')
  console.log(JSON.stringify(antes, null, 2))

  // ── 1) TipoProcessoModalidadeHabilitada — 1 linha por Tipo, mesma modalidade que já tinha ──
  console.log('\n── 1) Habilitação Tipo × Modalidade (a mesma verdade de hoje, em N:N) ──')
  const tipos = await prisma.$queryRawUnsafe<Array<{ id: number; modalidadeId: number; code: string }>>(
    'SELECT id, "modalidadeId", code FROM "TipoProcessoNacionalidade"',
  )
  for (const t of tipos) {
    const jaExiste = await prisma.tipoProcessoModalidadeHabilitada.findUnique({
      where: { tipoProcessoId_modalidadeId: { tipoProcessoId: t.id, modalidadeId: t.modalidadeId } },
    })
    if (jaExiste) { console.log(`  · Tipo #${t.id} (${t.code}) já habilitado para modalidade #${t.modalidadeId} — pulando`); continue }
    console.log(`  ${DRY_RUN ? '[dry-run] criaria' : 'criando'}: Tipo #${t.id} (${t.code}) habilitado para modalidade #${t.modalidadeId}`)
    if (!DRY_RUN) await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: t.id, modalidadeId: t.modalidadeId, ativo: true } })
  }

  // ── 2) MacroWorkflow.modalidadeId — copia do Tipo ──────────────────────
  console.log('\n── 2) MacroWorkflow.modalidadeId (copiado do Tipo — nenhum workflow muda de processo) ──')
  const macros = await prisma.$queryRawUnsafe<Array<{ id: number; tipoProcessoId: number; name: string; modalidadeId: number | null }>>(
    'SELECT mw.id, mw."tipoProcessoId", mw.name, mw."modalidadeId" FROM "MacroWorkflow" mw',
  )
  const modalidadePorTipo = new Map(tipos.map((t) => [t.id, t.modalidadeId]))
  for (const mw of macros) {
    const modalidadeDoTipo = modalidadePorTipo.get(mw.tipoProcessoId)
    if (modalidadeDoTipo == null) { prova(`MacroWorkflow #${mw.id}: tipo #${mw.tipoProcessoId} tem modalidade`, false, 'Tipo sem modalidade — inconsistência real, abortando este item'); continue }
    if (mw.modalidadeId === modalidadeDoTipo) { console.log(`  · MacroWorkflow #${mw.id} (${mw.name}) já com modalidadeId=${modalidadeDoTipo} — pulando`); continue }
    console.log(`  ${DRY_RUN ? '[dry-run] setaria' : 'setando'}: MacroWorkflow #${mw.id} (${mw.name}) → modalidadeId=${modalidadeDoTipo}`)
    if (!DRY_RUN) await prisma.$executeRawUnsafe('UPDATE "MacroWorkflow" SET "modalidadeId" = $1 WHERE id = $2', modalidadeDoTipo, mw.id)
  }

  // ── 3) MacroWorkflow.cardinalidadeRequerimento — mapeamento nominal confirmado ──
  console.log('\n── 3) MacroWorkflow.cardinalidadeRequerimento (mapeamento nominal confirmado com o usuário) ──')
  // `ModalidadeLegal` já foi removido de prisma/schema.prisma nesta mesma
  // migração — a tabela física ainda existe até o passo 3 (tighten) dropá-la,
  // então a leitura aqui é necessariamente SQL bruto, não Prisma Client.
  const modalidadesLegais = await prisma.$queryRawUnsafe<Array<{ code: string; paisId: number; cardinalidadeRequerimento: string }>>(
    'SELECT code, "paisId", "cardinalidadeRequerimento" FROM "ModalidadeLegal"',
  )
  for (const ml of modalidadesLegais) {
    const cardinalidadeEsperada = CARDINALIDADE_POR_MODALIDADE_LEGAL[ml.code]
    if (!cardinalidadeEsperada) { console.log(`  · ${ml.code}: sem mapeamento nominal definido — pulando (não inventado)`); continue }
    if (cardinalidadeEsperada !== ml.cardinalidadeRequerimento) {
      prova(`${ml.code}: cardinalidade no mapeamento bate com o cadastro real`, false, `mapeamento=${cardinalidadeEsperada}, cadastro=${ml.cardinalidadeRequerimento}`)
      continue
    }
    // Localiza o(s) Tipo(s) reais deste país e a modalidade correspondente pelo nome do code
    // (ex.: IT_JUDICIAL → país Itália, modalidade judicial).
    const sufixo = ml.code.split('_').pop()?.toLowerCase() // "judicial" | "administrativo" -> "administrativa"
    const modalityKey = sufixo === 'administrativo' ? 'administrativa' : sufixo === 'lmd' ? 'administrativa' : 'judicial'
    const tiposDoPais = await prisma.$queryRawUnsafe<Array<{ id: number; code: string }>>(
      'SELECT t.id, t.code FROM "TipoProcessoNacionalidade" t JOIN "ModalidadePais" m ON m.id = t."modalidadeId" WHERE t."paisId" = $1 AND m."modalityKey" = $2',
      ml.paisId, modalityKey,
    )
    if (tiposDoPais.length === 0) { console.log(`  · ${ml.code}: nenhum Tipo real (país #${ml.paisId}, modalidade ${modalityKey}) — nada a migrar, não inventado`); continue }
    for (const t of tiposDoPais) {
      const mw = macros.find((m) => m.tipoProcessoId === t.id)
      if (!mw) { console.log(`  · ${ml.code}: Tipo #${t.id} (${t.code}) sem MacroWorkflow — pulando`); continue }
      console.log(`  ${DRY_RUN ? '[dry-run] setaria' : 'setando'}: MacroWorkflow #${mw.id} (${mw.name}) ← ${ml.code} → cardinalidadeRequerimento=${cardinalidadeEsperada}`)
      if (!DRY_RUN) await prisma.$executeRawUnsafe('UPDATE "MacroWorkflow" SET "cardinalidadeRequerimento" = $1 WHERE id = $2', cardinalidadeEsperada, mw.id)
    }
  }

  // ── 4) Processo.modalidadeId — copia da modalidade do Tipo (mesmo fluxo de sempre) ──
  console.log('\n── 4) Processo.modalidadeId (copiado do Tipo — nenhum processo muda de fluxo) ──')
  const processos = await prisma.$queryRawUnsafe<Array<{ id: number; nome: string; tipoProcessoMotorId: number | null; modalidadeId: number | null }>>(
    'SELECT id, nome, "tipoProcessoMotorId", "modalidadeId" FROM "Processo"',
  )
  let processosSemMapeamento = 0
  for (const p of processos) {
    if (p.tipoProcessoMotorId == null) { console.log(`  · Processo #${p.id} (${p.nome}): sem tipoProcessoMotorId (legacy/pré-v2) — sem modalidade a atribuir`); continue }
    const modalidadeDoTipo = modalidadePorTipo.get(p.tipoProcessoMotorId)
    if (modalidadeDoTipo == null) { processosSemMapeamento++; prova(`Processo #${p.id} (${p.nome}): tipo tem modalidade mapeável`, false, `tipoProcessoMotorId=${p.tipoProcessoMotorId} sem modalidade conhecida`); continue }
    if (p.modalidadeId === modalidadeDoTipo) { console.log(`  · Processo #${p.id} (${p.nome}) já com modalidadeId=${modalidadeDoTipo} — pulando`); continue }
    console.log(`  ${DRY_RUN ? '[dry-run] setaria' : 'setando'}: Processo #${p.id} (${p.nome}) → modalidadeId=${modalidadeDoTipo}`)
    if (!DRY_RUN) await prisma.$executeRawUnsafe('UPDATE "Processo" SET "modalidadeId" = $1 WHERE id = $2', modalidadeDoTipo, p.id)
  }
  prova('zero processos com tipo sem modalidade mapeável (nenhum órfão)', processosSemMapeamento === 0, `${processosSemMapeamento} órfão(s)`)

  // ── 5) MacroWorkflowVersao — congela modalidade + cardinalidade atuais ──
  console.log('\n── 5) MacroWorkflowVersao.modalidadeId/cardinalidadeRequerimento (congela o estado atual do MacroWorkflow pai) ──')
  const versoes = await prisma.$queryRawUnsafe<Array<{ id: number; macroWorkflowId: number; modalidadeId: number | null }>>(
    'SELECT id, "macroWorkflowId", "modalidadeId" FROM "MacroWorkflowVersao"',
  )
  for (const v of versoes) {
    if (v.modalidadeId != null) { console.log(`  · MacroWorkflowVersao #${v.id} já com modalidadeId — pulando`); continue }
    // Lê o estado ATUAL por SQL bruto (nunca Prisma Client): em DRY_RUN a coluna
    // ainda pode ter NULL de verdade no banco, e o client tipa o campo como
    // obrigatório — hidratar um NULL real nesse tipo lança em runtime.
    const macroRows = await prisma.$queryRawUnsafe<Array<{ modalidadeId: number | null; cardinalidadeRequerimento: string }>>(
      'SELECT "modalidadeId", "cardinalidadeRequerimento" FROM "MacroWorkflow" WHERE id = $1', v.macroWorkflowId,
    )
    const modalidadeDoTipo = modalidadePorTipo.get(macros.find((m) => m.id === v.macroWorkflowId)?.tipoProcessoId ?? -1)
    const modalidadeAtual = macroRows[0]?.modalidadeId ?? modalidadeDoTipo ?? null
    const cardinalidadeAtual = macroRows[0]?.cardinalidadeRequerimento ?? 'INDIVIDUAL'
    if (!modalidadeAtual) { console.log(`  · MacroWorkflowVersao #${v.id}: MacroWorkflow pai ainda sem modalidadeId — rode o passo 2 primeiro`); continue }
    console.log(`  ${DRY_RUN ? '[dry-run] congelaria' : 'congelando'}: MacroWorkflowVersao #${v.id} → modalidadeId=${modalidadeAtual}, cardinalidadeRequerimento=${cardinalidadeAtual}`)
    if (!DRY_RUN) await prisma.$executeRawUnsafe('UPDATE "MacroWorkflowVersao" SET "modalidadeId" = $1, "cardinalidadeRequerimento" = $2 WHERE id = $3', modalidadeAtual, cardinalidadeAtual, v.id)
  }

  // ── 6) Limpeza de países/modalidades sintéticos órfãos (leftover de testes) ──
  console.log('\n── 6) Limpeza de leftovers sintéticos órfãos ("Esc", "País CFGRETRO") ──')
  const orfaos = await prisma.$queryRawUnsafe<Array<{ id: number; countryLabel: string }>>(
    `SELECT id, "countryLabel" FROM "CatalogoPais" WHERE "countryLabel" IN ('Esc', 'País CFGRETRO')`,
  )
  for (const pais of orfaos) {
    const usoReal = await prisma.$queryRawUnsafe<Array<{ c: number }>>(
      'SELECT count(*)::int as c FROM "TipoProcessoNacionalidade" WHERE "paisId" = $1', pais.id,
    )
    if (usoReal[0].c > 0) { prova(`país órfão "${pais.countryLabel}" (#${pais.id}) sem uso real`, false, `${usoReal[0].c} Tipo(s) o usam — NÃO removendo`); continue }
    console.log(`  ${DRY_RUN ? '[dry-run] removeria' : 'removendo'}: país sintético órfão "${pais.countryLabel}" (#${pais.id}) e suas modalidades — zero Tipo o usa`)
    if (!DRY_RUN) {
      await prisma.$executeRawUnsafe('DELETE FROM "ModalidadePais" WHERE "paisId" = $1', pais.id)
      await prisma.$executeRawUnsafe('DELETE FROM "CatalogoPais" WHERE id = $1', pais.id)
    }
  }

  // ── DEPOIS ─────────────────────────────────────────────────────────────
  if (!DRY_RUN) {
    const depois = {
      tipos: await prisma.tipoProcessoNacionalidade.count(),
      habilitacoes: await prisma.tipoProcessoModalidadeHabilitada.count(),
      macros: await prisma.macroWorkflow.count(),
      macrosComModalidade: await contarNaoNulos('MacroWorkflow', 'modalidadeId'),
      processos: await prisma.processo.count(),
      processosComTipo: await prisma.processo.count({ where: { tipoProcessoMotorId: { not: null } } }),
      processosComModalidade: await contarNaoNulos('Processo', 'modalidadeId'),
      versoes: await prisma.macroWorkflowVersao.count(),
      versoesComModalidade: await contarNaoNulos('MacroWorkflowVersao', 'modalidadeId'),
    }
    console.log('\n── DEPOIS ──')
    console.log(JSON.stringify(depois, null, 2))

    prova('contagem de Tipos inalterada (nenhum criado/apagado)', depois.tipos === antes.tipos)
    prova('contagem de habilitações = contagem de Tipos (1:1, sem duplicar)', depois.habilitacoes === depois.tipos, `habilitacoes=${depois.habilitacoes}, tipos=${depois.tipos}`)
    prova('contagem de MacroWorkflow inalterada (nenhum criado/apagado)', depois.macros === antes.macros)
    prova('100% dos MacroWorkflow com modalidadeId preenchido', depois.macrosComModalidade === depois.macros, `${depois.macrosComModalidade}/${depois.macros}`)
    prova('contagem de Processo inalterada (nenhum criado/apagado/excluído)', depois.processos === antes.processos)
    prova('100% dos processos COM tipo agora têm modalidade', depois.processosComModalidade === depois.processosComTipo, `${depois.processosComModalidade}/${depois.processosComTipo}`)
    prova('100% das MacroWorkflowVersao com modalidadeId preenchido', depois.versoesComModalidade === depois.versoes, `${depois.versoesComModalidade}/${depois.versoes}`)
  }

  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ${DRY_RUN ? '(DRY-RUN — nada foi escrito)' : ''} ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
