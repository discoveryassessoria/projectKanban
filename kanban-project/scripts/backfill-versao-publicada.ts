// scripts/backfill-versao-publicada.ts
// ============================================================================
// CONGELA A VERSÃO VIGENTE DE CADA WORKFLOW INTERNO JÁ PUBLICADO.
//
//   npx tsx scripts/backfill-versao-publicada.ts              SOMENTE LEITURA
//   npx tsx scripts/backfill-versao-publicada.ts --execute
//
// ─── O QUE ELE CONGELA, E O QUE ELE NÃO SABE ────────────────────────────────
// Congela o conteúdo ATUAL de cada workflow como a versão que ele declara ter
// (`versao`, hoje 1 em todos). É o único mapeamento determinístico disponível: o
// conteúdo anterior a edições passadas nunca foi registrado em lugar nenhum e não
// pode ser reconstruído sem adivinhar — e adivinhar histórico é exatamente o que
// esta rodada existe para tornar impossível.
//
// Isso significa, dito sem rodeio: para um workflow editado ANTES deste gate, a V1
// congelada é o conteúdo de hoje, não o de quando a instância materializou. O gate
// garante a imutabilidade DAQUI PARA A FRENTE; ele não inventa o passado que o
// sistema não guardou. Cada linha congelada registra `origem = BACKFILL` para que
// essa diferença fique legível em vez de virar suposição.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não altera workflow, passo, instância, processo ou tarefa. Não muda `versao`.
// Não migra ninguém de versão. Só cria linhas numa tabela que estava vazia.
//
// IDEMPOTENTE: a chave `(workflowId, versao)` é única; a segunda execução não
// congela nada.
// ============================================================================
import { prisma } from '../lib/prisma'
import { congelarVersaoVigente, lerVersaoPublicada } from '../src/services/versao-publicada'

const EXECUTAR = process.argv.includes('--execute')

async function main() {
  console.log(EXECUTAR ? 'BACKFILL — APLICANDO\n' : 'BACKFILL — SOMENTE LEITURA (use --execute)\n')

  const wfs = await prisma.phaseInternalWorkflow.findMany({
    orderBy: { id: 'asc' },
    include: { passos: { select: { id: true } } },
  })

  let congelados = 0
  let jaExistiam = 0

  for (const w of wfs) {
    const ja = await lerVersaoPublicada(w.id, w.versao)
    if (ja) {
      jaExistiam++
      console.log(`  = wf#${w.id} ${w.wfUid} v${w.versao} — já congelada (${ja.passos.length} passos, origem ${ja.origem})`)
      continue
    }
    console.log(`  ${EXECUTAR ? '✔' : '→'} wf#${w.id} ${w.wfUid.padEnd(34)} v${w.versao} · ${w.passos.length} passo(s)`)
    if (EXECUTAR) {
      const ok = await congelarVersaoVigente(w.id, 'BACKFILL')
      if (ok) congelados++
    }
  }

  // AS INSTÂNCIAS: quantas passam a ter conteúdo para a versão que registraram.
  const instancias = await prisma.phaseWorkflowInstance.findMany({
    select: { id: true, workflowDefinitionId: true, workflowVersion: true },
  })
  let comConteudo = 0
  let semPonteiro = 0
  for (const i of instancias) {
    if (i.workflowDefinitionId == null || i.workflowVersion == null) { semPonteiro++; continue }
    const v = await lerVersaoPublicada(i.workflowDefinitionId, i.workflowVersion)
    if (v) comConteudo++
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Workflows: ${wfs.length} · congelados agora: ${congelados} · já congelados: ${jaExistiam}`)
  console.log(`Instâncias: ${instancias.length} · com versão legível: ${comConteudo} · sem ponteiro de versão: ${semPonteiro}`)
  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
}

void main().finally(() => prisma.$disconnect())
