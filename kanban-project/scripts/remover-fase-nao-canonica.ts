// scripts/remover-fase-nao-canonica.ts
// ============================================================================
// REMOÇÃO de registro do CatalogoFase que não é fase.
//
// O CatalogoFase é o molde de onde todo MacroWorkflow copia as fases. Um registro
// ali que não corresponde a nenhuma fase do catálogo canônico não é "fase inativa"
// nem "pendência": é um conceito de outro domínio cadastrado no lugar errado, e
// enquanto existir, ou contamina macros novos, ou bloqueia a criação deles.
//
// SÓ REMOVE COM ZERO REFERÊNCIA. Se qualquer estrutura operacional apontar para a
// chave — macro, workflow publicado, modo, instância, processo, tarefa, automação,
// regra econômica, matriz documental — o script PARA e relata. Migrar referência é
// decisão de domínio, nunca efeito colateral de uma limpeza.
//
// USO
//   npx tsx scripts/remover-fase-nao-canonica.ts --phaseKey transcricoes
//   npx tsx scripts/remover-fase-nao-canonica.ts --phaseKey transcricoes --execute
// ============================================================================

import { prisma } from "@/lib/prisma"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

const EXECUTE = process.argv.includes("--execute")
const idx = process.argv.indexOf("--phaseKey")
const PHASE_KEY = idx >= 0 ? process.argv[idx + 1] : null

async function main() {
  if (!PHASE_KEY) { console.error("Informe --phaseKey <chave>"); process.exit(1) }
  console.log(`\nRemoção de fase não canônica "${PHASE_KEY}" · modo ${EXECUTE ? "EXECUTAR" : "SOMENTE LEITURA"}`)

  if (phaseKeyToFaseCode(PHASE_KEY) != null) {
    console.error(`ABORTA: "${PHASE_KEY}" É uma fase canônica do catálogo. Este script só remove o que não é fase.`)
    process.exit(1)
  }

  const registro = await prisma.catalogoFase.findUnique({ where: { phaseKey: PHASE_KEY } })
  if (!registro) { console.log("✔ Já não existe no CatalogoFase. Nada a fazer."); await prisma.$disconnect(); return }
  console.log("Registro:", JSON.stringify(registro))

  // TODA estrutura que pode apontar para uma fase, por chave.
  const referencias: Array<[string, number]> = [
    ["FaseMacro", await prisma.faseMacro.count({ where: { phaseKey: PHASE_KEY } })],
    ["PhaseInternalWorkflow", await prisma.phaseInternalWorkflow.count({ where: { phaseKey: PHASE_KEY } })],
    ["PhaseInternalMode", await prisma.phaseInternalMode.count({ where: { phaseKey: PHASE_KEY } })],
    ["PhaseWorkflowInstance", await prisma.phaseWorkflowInstance.count({ where: { faseMacroKey: PHASE_KEY } })],
    ["PhaseWorkflowStepInstance", await prisma.phaseWorkflowStepInstance.count({ where: { faseMacroKey: PHASE_KEY } })],
    ["Processo.faseAtualKey", await prisma.processo.count({ where: { faseAtualKey: PHASE_KEY } })],
    ["Tarefa.faseMacroKey", await prisma.tarefa.count({ where: { faseMacroKey: PHASE_KEY } })],
    ["PhaseAdvanceLog", await prisma.phaseAdvanceLog.count({ where: { OR: [{ faseAtual: PHASE_KEY }, { fasePretendida: PHASE_KEY }] } })],
    ["PhaseAutomationRule", await prisma.phaseAutomationRule.count({ where: { phaseKey: PHASE_KEY } })],
    ["PhaseEconomicRule", await prisma.phaseEconomicRule.count({ where: { phaseKey: PHASE_KEY } })],
    ["MatrizDocumental", await prisma.matrizDocumental.count({ where: { phaseKey: PHASE_KEY } })],
  ]
  console.log("\nReferências estruturais:")
  for (const [nome, n] of referencias) console.log(`  ${n === 0 ? "✔" : "✗"} ${nome}: ${n}`)

  const comReferencia = referencias.filter(([, n]) => n > 0)
  if (comReferencia.length > 0) {
    console.error(`\nABORTA: ${comReferencia.length} estrutura(s) ainda apontam para "${PHASE_KEY}".`)
    console.error("        Migrar referência é decisão de domínio — não é limpeza. Relatório acima.")
    process.exit(1)
  }
  console.log("\n✔ Zero referências operacionais. A remoção não quebra nada.")

  if (!EXECUTE) { console.log("\n(diagnóstico — rode com --execute para remover)"); await prisma.$disconnect(); return }

  await prisma.$transaction(async (tx) => {
    // Confere DENTRO da transação: entre o diagnóstico e o commit, alguém pode ter
    // cadastrado um macro usando a chave.
    const aindaSemUso = await tx.faseMacro.count({ where: { phaseKey: PHASE_KEY } })
    if (aindaSemUso !== 0) throw new Error(`corrida: ${aindaSemUso} FaseMacro passou a usar "${PHASE_KEY}"`)

    const r = await tx.catalogoFase.deleteMany({ where: { id: registro.id, phaseKey: PHASE_KEY } })
    if (r.count !== 1) throw new Error(`DELETE afetou ${r.count} linha(s), esperado 1`)

    await tx.logAuditoria.create({
      data: {
        acao: "CATALOGO_FASE_REMOVIDA",
        entidade: "CATALOGO_FASE",
        entidadeId: registro.id,
        descricao: `Registro "${registro.label}" removido do CatalogoFase — não é fase do catálogo canônico`,
        detalhes: {
          origem: "CORRECAO_CATALOGO_PHASEKEY",
          registro: {
            id: registro.id, phaseKey: registro.phaseKey, label: registro.label,
            ordemPadrao: registro.ordemPadrao, requiredPadrao: registro.requiredPadrao,
            conditionalPadrao: registro.conditionalPadrao, slaDiasPadrao: registro.slaDiasPadrao,
            ativo: registro.ativo, criadoEm: registro.criadoEm.toISOString(),
          },
          referenciasEncontradas: Object.fromEntries(referencias),
          em: new Date().toISOString(),
        } as never,
      },
    })
  })

  console.log(`\n✅ COMMIT — CatalogoFase #${registro.id} "${PHASE_KEY}" removido, com auditoria.`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
