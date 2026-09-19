// scripts/auditoria-legado-controle-temporal.ts
//
// AUDITORIA (SOMENTE LEITURA) DO LEGADO — mandato "correção definitiva do
// modelo temporal" (19-20/09/2026), seção 9/17: "reconciliação segura do
// legado" começa por PROVAR o que existe antes de decidir o que fazer.
// Nunca escreve. Nunca infere data que não está no banco.
//
// A PERGUNTA: dos registros que já existem, quantos precisam de
// reconciliação para o controle temporal novo (acompanhamentoAtivo/
// regraTemporalAtiva/proximoAcompanhamentoEm/previstoPara), quantos são
// ambíguos, e quantos já estão corretos por construção?
//
// A RESPOSTA ESPERADA (e o motivo de ela ser trivial): os 6 campos novos
// são TODOS opt-in (default false/null) — StepSubtaskDefinition.
// acompanhamentoAtivo/regraTemporalAtiva nascem `false`,
// SubtaskExecution.proximoAcompanhamentoEm nasce `null`. Nenhuma subtarefa
// já cadastrada ganha comportamento novo sem decisão EXPLÍCITA do
// administrador em Gerenciamento — não existe "valor antigo" para
// reconciliar, porque o campo não existia até esta rodada. A auditoria
// prova isso com números reais, não com a suposição de que devia ser
// assim.
//
//   npx tsx scripts/auditoria-legado-controle-temporal.ts
//   (roda contra QUALQUER banco apontado por PRISMA_DATABASE_URL — inclusive
//   produção; é 100% leitura, sem `--aplicar` porque não há o que aplicar)

import { prisma } from "@/lib/prisma"

async function main() {
  console.log("AUDITORIA DE LEGADO — CONTROLE TEMPORAL DA ESPERA (mandato 19-20/09/2026)\n")

  // ── 1) CADASTRO — StepSubtaskDefinition ──────────────────────────────────
  const totalDefs = await prisma.stepSubtaskDefinition.count()
  const comEsperaExterna = await prisma.stepSubtaskDefinition.count({ where: { esperaExternaAoLiberar: true } })
  const comAcompanhamentoLigado = await prisma.stepSubtaskDefinition.count({ where: { acompanhamentoAtivo: true } })
  const comRegraTemporalLigada = await prisma.stepSubtaskDefinition.count({ where: { regraTemporalAtiva: true } })
  const comGatilhoConfigurado = await prisma.stepSubtaskDefinition.count({ where: { regraTemporalGatilhoChave: { not: null } } })

  console.log("── CADASTRO (StepSubtaskDefinition) ──────────────────────────")
  console.log(`  total de subtarefas cadastradas: ${totalDefs}`)
  console.log(`  esperaExternaAoLiberar = true:    ${comEsperaExterna}`)
  console.log(`  acompanhamentoAtivo = true:       ${comAcompanhamentoLigado}`)
  console.log(`  regraTemporalAtiva = true:        ${comRegraTemporalLigada}`)
  console.log(`  regraTemporalGatilhoChave setado: ${comGatilhoConfigurado}`)

  if (comAcompanhamentoLigado === 0 && comRegraTemporalLigada === 0) {
    console.log("  → NENHUMA subtarefa liga os campos novos ainda — esperado, são opt-in e a UI para configurá-los\n" +
      "    (Gerenciamento → Controle temporal) só foi construída nesta rodada. CLASSIFICAÇÃO: nada a reconciliar.")
  } else {
    console.log(`  → ${comAcompanhamentoLigado + comRegraTemporalLigada} configuração(ões) já ligada(s) — provavelmente pelos scripts de deploy da Emissão Documental (esperado, ver relatório).`)
  }

  // Subtarefas com esperaExternaAoLiberar=true MAS sem nenhum dos dois
  // controles ligados — não é problema (os dois são opcionais), mas é
  // informação útil pro Administrador decidir se quer configurar.
  const esperaSemControle = await prisma.stepSubtaskDefinition.count({
    where: { esperaExternaAoLiberar: true, acompanhamentoAtivo: false, regraTemporalAtiva: false },
  })
  console.log(`  esperas de terceiro SEM acompanhamento nem regra temporal: ${esperaSemControle} (legítimo — os dois são opcionais)`)

  // ── 2) GATILHOS — todos apontam para uma subtarefa REAL do mesmo passo? ──
  const comGatilho = await prisma.stepSubtaskDefinition.findMany({
    where: { regraTemporalAtiva: true, regraTemporalGatilhoChave: { not: null } },
    select: { id: true, key: true, label: true, stepId: true, regraTemporalGatilhoChave: true },
  })
  const gatilhosQuebrados: typeof comGatilho = []
  for (const s of comGatilho) {
    const irma = await prisma.stepSubtaskDefinition.findFirst({
      where: { stepId: s.stepId, key: s.regraTemporalGatilhoChave! },
      select: { id: true },
    })
    if (!irma) gatilhosQuebrados.push(s)
  }
  console.log(`\n  gatilhos configurados: ${comGatilho.length}, quebrados (irmã inexistente): ${gatilhosQuebrados.length}`)
  for (const g of gatilhosQuebrados) {
    console.log(`    ⚠ #${g.id} "${g.key}" (passo ${g.stepId}) aponta para "${g.regraTemporalGatilhoChave}", que não existe nesse passo.`)
  }

  // ── 3) EXECUÇÃO — SubtaskExecution vigentes ──────────────────────────────
  const totalExecucoesVigentes = await prisma.subtaskExecution.count({ where: { supersededAt: null } })
  const aguardandoExternoVigentes = await prisma.subtaskExecution.count({
    where: { supersededAt: null, status: "AGUARDANDO_EXTERNO" },
  })
  const comProximoAcompanhamento = await prisma.subtaskExecution.count({
    where: { supersededAt: null, proximoAcompanhamentoEm: { not: null } },
  })
  const comPrevistoParaEAguardando = await prisma.subtaskExecution.count({
    where: { supersededAt: null, status: "AGUARDANDO_EXTERNO", previstoPara: { not: null } },
  })
  // O CASO QUE JÁ NÃO PODE MAIS EXISTIR: AGUARDANDO_EXTERNO com `prazo`
  // preenchido — o próprio bug que este mandato corrigiu (dimensão B nunca
  // se aplica a espera de terceiro). Se aparecer, é dado gravado ANTES da
  // correção (18-19/09/2026) e precisa de decisão — nunca sobrescrever
  // silenciosamente um `prazo` histórico.
  const aguardandoComPrazoInterno = await prisma.subtaskExecution.count({
    where: { supersededAt: null, status: "AGUARDANDO_EXTERNO", prazo: { not: null } },
  })

  console.log("\n── EXECUÇÃO (SubtaskExecution vigentes) ───────────────────────")
  console.log(`  total vigentes:                          ${totalExecucoesVigentes}`)
  console.log(`  AGUARDANDO_EXTERNO vigentes:              ${aguardandoExternoVigentes}`)
  console.log(`  com proximoAcompanhamentoEm preenchido:   ${comProximoAcompanhamento}`)
  console.log(`  AGUARDANDO_EXTERNO com previstoPara:      ${comPrevistoParaEAguardando}`)
  console.log(`  AGUARDANDO_EXTERNO com \`prazo\` (dado ANTIGO, pré-correção): ${aguardandoComPrazoInterno}`)

  if (aguardandoComPrazoInterno > 0) {
    console.log(`  → AMBÍGUO, não migrável automaticamente: ${aguardandoComPrazoInterno} execução(ões) carrega(m) um \`prazo\`\n` +
      `    gravado quando o motor ainda tratava espera de terceiro como deadline. O CÓDIGO já ignora esse campo\n` +
      `    para AGUARDANDO_EXTERNO (não é mais lido em lugar nenhum) — o valor fica como HISTÓRICO, nunca apagado\n` +
      `    nem reinterpretado como acompanhamento/regra temporal (isso SERIA inventar dado). Nenhuma ação necessária\n` +
      `    além desta constatação.`)
  } else {
    console.log(`  → nenhuma execução no estado que o bug antigo produzia — a correção já convergiu o que existia.`)
  }

  // ── 4) CLASSIFICAÇÃO FINAL ───────────────────────────────────────────────
  console.log("\n── CLASSIFICAÇÃO FINAL ─────────────────────────────────────────")
  console.log(`  MIGRÁVEIS automaticamente:  0 (não existe transformação necessária — campos nasceram vazios)`)
  console.log(`  AMBÍGUOS (decisão humana):  ${gatilhosQuebrados.length} gatilho(s) quebrado(s) + ${aguardandoComPrazoInterno} execução(ões) com \`prazo\` histórico (informativo, sem ação)`)
  console.log(`  INCORRETOS:                 ${gatilhosQuebrados.length} (gatilho apontando pra subtarefa inexistente — corrigir no cadastro, não em massa)`)
  console.log(`  CORRETOS por construção:    ${totalExecucoesVigentes - aguardandoComPrazoInterno} de ${totalExecucoesVigentes} execuções vigentes`)
  console.log(`\nO QUE SERÁ FEITO NO DEPLOY: nada além da migration aditiva em si (colunas novas,\ntodas nullable/default false) — nenhum UPDATE em massa é necessário nem seguro de inventar.`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
