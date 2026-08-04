// scripts/corrigir-phasekeys-macro.ts
// ============================================================================
// CORREÇÃO CANÔNICA de phaseKey legada em FaseMacro — CADASTRO, não motor.
//
// O motor recusa corretamente uma fase cuja phaseKey não existe no catálogo: ele
// não aceita alias, não traduz texto e não tem fallback. Quem estava errado era o
// CADASTRO do macrofluxo, semeado com chaves antigas. É ele que se corrige aqui.
//
// MAPEAMENTO — determinístico e fechado. Só estes dois pares, e só porque a
// equivalência foi confirmada contra o catálogo oficial e contra os Workflows
// Internos publicados. Qualquer outra chave inválida é AMBÍGUA por definição e sai
// no relatório para decisão humana; este script não adivinha.
//
// O QUE ELE PRESERVA: id, macroWorkflowId, label, ordem, required, conditional,
// entryRule, exitRule, slaDays, showInKanban, versao, criadoEm. Muda `phaseKey` e
// `atualizadoEm`. Nada mais é tocado — nem processo, nem ciclo, nem tarefa.
//
// USO
//   npx tsx scripts/corrigir-phasekeys-macro.ts --tipo ALE-ADM              # diagnóstico
//   npx tsx scripts/corrigir-phasekeys-macro.ts --tipo ALE-ADM --execute
// ============================================================================

import { prisma } from "@/lib/prisma"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

/** Equivalências CONFIRMADAS. Fechado de propósito: crescer aqui é decisão humana. */
const MAPEAMENTO_CANONICO: Record<string, string> = {
  traducao: "traducao_juramentada",
  retificacao: "retificacao_registros",
}

const EXECUTE = process.argv.includes("--execute")
const idxTipo = process.argv.indexOf("--tipo")
const TIPO_CODE = idxTipo >= 0 ? process.argv[idxTipo + 1] : null

class ValidacaoFalhou extends Error {}

async function main() {
  if (!TIPO_CODE) {
    console.error("Informe o tipo de processo: --tipo ALE-ADM")
    process.exit(1)
  }
  console.log(`\nCorreção de phaseKey — tipo ${TIPO_CODE} · modo ${EXECUTE ? "EXECUTAR" : "SOMENTE LEITURA"}`)

  // O id do macro é RESOLVIDO pelo identificador oficial, nunca fixado no script.
  const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { code: TIPO_CODE }, select: { id: true, code: true, name: true } })
  if (!tipo) { console.error(`Tipo ${TIPO_CODE} inexistente.`); process.exit(1) }
  const macro = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId: tipo.id }, select: { id: true, name: true, versao: true } })
  if (!macro) { console.error(`Tipo ${TIPO_CODE} sem MacroWorkflow.`); process.exit(1) }
  console.log(`MacroWorkflow #${macro.id} "${macro.name}" (tipo #${tipo.id} ${tipo.code})`)

  const fases = await prisma.faseMacro.findMany({ where: { macroWorkflowId: macro.id }, orderBy: { ordem: "asc" } })
  const alvos = fases.filter((f) => MAPEAMENTO_CANONICO[f.phaseKey] != null)
  const ambiguas = fases.filter((f) => phaseKeyToFaseCode(f.phaseKey) == null && MAPEAMENTO_CANONICO[f.phaseKey] == null)

  console.log(`\nFases a corrigir: ${alvos.length}`)
  for (const f of alvos) console.log(`  #${f.id} "${f.phaseKey}" → "${MAPEAMENTO_CANONICO[f.phaseKey]}" (ordem ${f.ordem}, required=${f.required}, conditional=${f.conditional})`)
  if (ambiguas.length) {
    console.log(`\nFases inválidas AMBÍGUAS (não corrigidas — decisão humana): ${ambiguas.length}`)
    for (const f of ambiguas) console.log(`  #${f.id} "${f.phaseKey}" (ordem ${f.ordem})`)
  }
  if (alvos.length === 0) { console.log("\n✔ Nada a corrigir neste macro."); await prisma.$disconnect(); return }

  // PRÉ-CONDIÇÕES — todas checadas antes de abrir a transação.
  for (const f of alvos) {
    const destino = MAPEAMENTO_CANONICO[f.phaseKey]
    if (phaseKeyToFaseCode(destino) == null) { console.error(`ABORTA: "${destino}" não está no catálogo canônico.`); process.exit(1) }
    const wf = await prisma.phaseInternalWorkflow.count({ where: { phaseKey: destino, active: true, arquivado: false } })
    if (wf === 0) { console.error(`ABORTA: "${destino}" não tem Workflow Interno publicado — corrigir a chave deixaria a fase sem motor.`); process.exit(1) }
    const colide = fases.some((x) => x.phaseKey === destino)
    if (colide) { console.error(`ABORTA: o macro já tem uma fase "${destino}" — corrigir duplicaria a fase.`); process.exit(1) }
  }
  console.log("\n✔ Pré-condições OK: chaves canônicas existem, têm workflow publicado e não colidem.")

  if (!EXECUTE) { console.log("\n(diagnóstico — rode com --execute para corrigir)"); await prisma.$disconnect(); return }

  // Fotografia do que NÃO pode mudar (ordem, regras, contagens).
  const antes = fases.map((f) => ({ id: f.id, ordem: f.ordem, required: f.required, conditional: f.conditional, entryRule: f.entryRule, exitRule: f.exitRule, slaDays: f.slaDays, showInKanban: f.showInKanban, label: f.label, versao: f.versao }))
  const totalFasesAntes = fases.length
  const instAntes = await prisma.phaseWorkflowInstance.count({ where: { processo: { tipoProcessoMotorId: tipo.id } } })
  const idsProcesso = (await prisma.processo.findMany({ where: { tipoProcessoMotorId: tipo.id }, select: { id: true } })).map((p) => p.id)
  const passosAntes = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: { in: idsProcesso } } })
  const tarefasAntes = await prisma.tarefa.count({ where: { processo: { tipoProcessoMotorId: tipo.id } } })

  const correlationId = `phasekey-fix-${tipo.code}-${Date.now()}`
  const agora = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      for (const f of alvos) {
        const destino = MAPEAMENTO_CANONICO[f.phaseKey]
        // WHERE explícito por macro + chave legada: a contagem é a trava.
        const r = await tx.faseMacro.updateMany({
          where: { id: f.id, macroWorkflowId: macro.id, phaseKey: f.phaseKey },
          data: { phaseKey: destino, atualizadoEm: agora },
        })
        if (r.count !== 1) throw new ValidacaoFalhou(`UPDATE de FaseMacro #${f.id} afetou ${r.count} linha(s), esperado 1`)
        console.log(`  ✔ FaseMacro #${f.id}: "${f.phaseKey}" → "${destino}" (1 linha)`)
      }

      // ── VALIDAÇÕES DE INTEGRIDADE, ainda DENTRO da transação ──────────────
      const depois = await tx.faseMacro.findMany({ where: { macroWorkflowId: macro.id }, orderBy: { ordem: "asc" } })
      if (depois.length !== totalFasesAntes) throw new ValidacaoFalhou(`número de fases mudou: ${totalFasesAntes} → ${depois.length}`)

      const legadasRestantes = depois.filter((f) => MAPEAMENTO_CANONICO[f.phaseKey] != null)
      if (legadasRestantes.length !== 0) throw new ValidacaoFalhou(`sobraram ${legadasRestantes.length} chave(s) legada(s)`)

      for (const f of alvos) {
        const d = depois.find((x) => x.id === f.id)
        if (!d) throw new ValidacaoFalhou(`FaseMacro #${f.id} sumiu`)
        if (d.phaseKey !== MAPEAMENTO_CANONICO[f.phaseKey]) throw new ValidacaoFalhou(`FaseMacro #${f.id} não ficou com a chave canônica`)
      }

      // Ordem, obrigatoriedade, condição e regras: idênticas, campo a campo.
      for (const a of antes) {
        const d = depois.find((x) => x.id === a.id)!
        const igual = d.ordem === a.ordem && d.required === a.required && d.conditional === a.conditional
          && d.entryRule === a.entryRule && d.exitRule === a.exitRule && d.slaDays === a.slaDays
          && d.showInKanban === a.showInKanban && d.label === a.label && d.versao === a.versao
        if (!igual) throw new ValidacaoFalhou(`FaseMacro #${a.id} teve regra/ordem alterada`)
      }

      // Nenhuma phaseKey duplicada no macro.
      const chaves = depois.map((f) => f.phaseKey)
      if (new Set(chaves).size !== chaves.length) throw new ValidacaoFalhou("phaseKey duplicada no macro")

      // Toda chave do macro tem de existir no catálogo canônico.
      const foraDoCatalogo = depois.filter((f) => phaseKeyToFaseCode(f.phaseKey) == null)
      if (foraDoCatalogo.length !== ambiguas.length) throw new ValidacaoFalhou(`chaves fora do catálogo mudaram: ${ambiguas.length} → ${foraDoCatalogo.length}`)

      // Nada operacional pode ter sido tocado.
      const instDepois = await tx.phaseWorkflowInstance.count({ where: { processo: { tipoProcessoMotorId: tipo.id } } })
      const passosDepois = await tx.phaseWorkflowStepInstance.count({ where: { processoId: { in: idsProcesso } } })
      const tarefasDepois = await tx.tarefa.count({ where: { processo: { tipoProcessoMotorId: tipo.id } } })
      if (instDepois !== instAntes || passosDepois !== passosAntes || tarefasDepois !== tarefasAntes) {
        throw new ValidacaoFalhou(`dado operacional mudou: instâncias ${instAntes}→${instDepois}, passos ${passosAntes}→${passosDepois}, tarefas ${tarefasAntes}→${tarefasDepois}`)
      }

      // ── AUDITORIA, na mesma transação ─────────────────────────────────────
      await tx.logAuditoria.create({
        data: {
          acao: "MACRO_PHASEKEY_CORRIGIDA",
          entidade: "MACRO_WORKFLOW",
          entidadeId: macro.id,
          descricao: "Correção de phaseKey legada para chave canônica do catálogo oficial",
          detalhes: {
            origem: "CONFIGURACAO_PRODUCAO",
            correlationId,
            tipoProcesso: { id: tipo.id, code: tipo.code, name: tipo.name },
            macroWorkflow: { id: macro.id, name: macro.name, versao: macro.versao },
            alteracoes: alvos.map((f) => ({ faseMacroId: f.id, de: f.phaseKey, para: MAPEAMENTO_CANONICO[f.phaseKey], ordem: f.ordem, required: f.required, conditional: f.conditional })),
            linhasAlteradas: alvos.length,
            ordemPreservada: true,
            regrasPreservadas: true,
            dadoOperacionalIntocado: { instancias: instAntes, passos: passosAntes, tarefas: tarefasAntes },
            ambiguasNaoCorrigidas: ambiguas.map((f) => ({ faseMacroId: f.id, phaseKey: f.phaseKey })),
            em: agora.toISOString(),
          },
        },
      })
      console.log("  ✔ validações de integridade OK — auditoria registrada")
    })
  } catch (e) {
    if (e instanceof ValidacaoFalhou) {
      console.error(`\n❌ ROLLBACK: ${e.message}`)
      console.error("Nada foi alterado.")
      await prisma.$disconnect()
      process.exit(1)
    }
    throw e
  }

  console.log(`\n✅ COMMIT — ${alvos.length} FaseMacro corrigida(s) no MacroWorkflow #${macro.id}.`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
