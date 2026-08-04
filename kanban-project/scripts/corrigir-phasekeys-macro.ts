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
//   npx tsx scripts/corrigir-phasekeys-macro.ts --tipo ALE-ADM              # um macro
//   npx tsx scripts/corrigir-phasekeys-macro.ts --tipo ALE-ADM --execute
//   npx tsx scripts/corrigir-phasekeys-macro.ts --coordenado               # tudo, em 1 tx
//   npx tsx scripts/corrigir-phasekeys-macro.ts --coordenado --execute
//
// MODO COORDENADO: corrige o CatalogoFase (o molde de onde macros novos nascem) e
// TODOS os macros com chave legada numa ÚNICA transação. Molde e cópias têm de mudar
// juntos — corrigir só um lado deixa o sistema semeando o defeito de novo, e corrigir
// o CatalogoFase sem o seed faz o próximo seed criar uma linha canônica NOVA e deixar
// a legada de pé (o seed é upsert por phaseKey).
// ============================================================================

import { prisma } from "@/lib/prisma"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"

/** Equivalências CONFIRMADAS. Fechado de propósito: crescer aqui é decisão humana. */
const MAPEAMENTO_CANONICO: Record<string, string> = {
  traducao: "traducao_juramentada",
  retificacao: "retificacao_registros",
}

const EXECUTE = process.argv.includes("--execute")
const COORDENADO = process.argv.includes("--coordenado")
const idxTipo = process.argv.indexOf("--tipo")
const TIPO_CODE = idxTipo >= 0 ? process.argv[idxTipo + 1] : null

class ValidacaoFalhou extends Error {}

async function main() {
  if (COORDENADO) return coordenado()
  if (!TIPO_CODE) {
    console.error("Informe o tipo de processo (--tipo ALE-ADM) ou use --coordenado")
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

// ============================================================================
// MODO COORDENADO — CatalogoFase + todos os macros, numa transação só.
// ============================================================================
async function coordenado() {
  console.log(`\nCorreção COORDENADA de phaseKey · modo ${EXECUTE ? "EXECUTAR" : "SOMENTE LEITURA"}`)

  const catalogo = await prisma.catalogoFase.findMany({ orderBy: { ordemPadrao: "asc" } })
  const catAlvos = catalogo.filter((c) => MAPEAMENTO_CANONICO[c.phaseKey] != null)
  const catAmbiguas = catalogo.filter((c) => phaseKeyToFaseCode(c.phaseKey) == null && MAPEAMENTO_CANONICO[c.phaseKey] == null)

  const fases = await prisma.faseMacro.findMany({
    orderBy: [{ macroWorkflowId: "asc" }, { ordem: "asc" }],
    include: { macroWorkflow: { select: { id: true, name: true, tipoProcesso: { select: { code: true } } } } },
  })
  const faseAlvos = fases.filter((f) => MAPEAMENTO_CANONICO[f.phaseKey] != null)

  // MODOS INTERNOS DA FASE — keyed por phaseKey, e o `modeUid` (@unique) EMBUTE a
  // chave: `{tipo|all}::{phaseKey}::{key}`. Trocar só a coluna deixaria o uid mentindo,
  // e o seed (upsert por modeUid) criaria uma linha nova em vez de reconhecer esta.
  // Os dois campos mudam no mesmo UPDATE.
  const modos = await prisma.phaseInternalMode.findMany({ orderBy: { id: "asc" } })
  const modoAlvos = modos.filter((m) => MAPEAMENTO_CANONICO[m.phaseKey] != null)

  console.log(`\nCatalogoFase a corrigir: ${catAlvos.length}`)
  for (const c of catAlvos) console.log(`  #${c.id} "${c.phaseKey}" → "${MAPEAMENTO_CANONICO[c.phaseKey]}" (label "${c.label}", ordem ${c.ordemPadrao})`)
  console.log(`FaseMacro a corrigir: ${faseAlvos.length}`)
  for (const f of faseAlvos) console.log(`  #${f.id} macro ${f.macroWorkflowId} (${f.macroWorkflow.tipoProcesso?.code}) "${f.phaseKey}" → "${MAPEAMENTO_CANONICO[f.phaseKey]}" (ordem ${f.ordem})`)
  console.log(`PhaseInternalMode a corrigir: ${modoAlvos.length}`)
  for (const m of modoAlvos) console.log(`  #${m.id} "${m.phaseKey}::${m.key}" → "${MAPEAMENTO_CANONICO[m.phaseKey]}::${m.key}" (uid ${m.modeUid})`)
  if (catAmbiguas.length) {
    console.log(`\nCatalogoFase AMBÍGUO (INTOCADO — decisão arquitetural): ${catAmbiguas.length}`)
    for (const c of catAmbiguas) console.log(`  #${c.id} "${c.phaseKey}" ("${c.label}")`)
  }
  if (catAlvos.length + faseAlvos.length + modoAlvos.length === 0) { console.log("\n✔ Nada a corrigir."); await prisma.$disconnect(); return }

  // PRÉ-CONDIÇÕES
  const destinos = [...new Set([...catAlvos, ...faseAlvos, ...modoAlvos].map((x) => MAPEAMENTO_CANONICO[x.phaseKey]))]
  for (const destino of destinos) {
    if (phaseKeyToFaseCode(destino) == null) { console.error(`ABORTA: "${destino}" fora do catálogo canônico.`); process.exit(1) }
    if ((await prisma.phaseInternalWorkflow.count({ where: { phaseKey: destino, active: true, arquivado: false } })) === 0) {
      console.error(`ABORTA: "${destino}" sem Workflow Interno publicado.`); process.exit(1)
    }
  }
  // CatalogoFase.phaseKey é @unique. A colisão só existe se OUTRA linha do catálogo já
  // ocupa o destino — a própria linha corrigida não colide consigo mesma, e uma linha
  // já canônica (de uma correção anterior) não é obstáculo para nada.
  for (const c of catAlvos) {
    const destino = MAPEAMENTO_CANONICO[c.phaseKey]
    const ocupada = catalogo.filter((x) => x.phaseKey === destino && x.id !== c.id)
    if (ocupada.length > 0) {
      console.error(`ABORTA: CatalogoFase #${ocupada.map((x) => x.id).join(", ")} já ocupa "${destino}".`)
      console.error("        Corrigir violaria o unique. Consolidação é decisão humana, nunca merge automático:")
      console.error(`        origem  #${c.id} "${c.phaseKey}" (label "${c.label}", ordem ${c.ordemPadrao}, ativo=${c.ativo})`)
      for (const x of ocupada) console.error(`        destino #${x.id} "${x.phaseKey}" (label "${x.label}", ordem ${x.ordemPadrao}, ativo=${x.ativo})`)
      process.exit(1)
    }
  }
  for (const f of faseAlvos) {
    const destino = MAPEAMENTO_CANONICO[f.phaseKey]
    if (fases.some((x) => x.macroWorkflowId === f.macroWorkflowId && x.phaseKey === destino)) {
      console.error(`ABORTA: macro ${f.macroWorkflowId} já tem "${destino}" — corrigir duplicaria a fase.`); process.exit(1)
    }
  }
  for (const m of modoAlvos) {
    const uidNovo = m.modeUid.replace(`::${m.phaseKey}::`, `::${MAPEAMENTO_CANONICO[m.phaseKey]}::`)
    if (uidNovo === m.modeUid) { console.error(`ABORTA: modeUid "${m.modeUid}" não contém a phaseKey — formato inesperado.`); process.exit(1) }
    if (modos.some((x) => x.modeUid === uidNovo)) { console.error(`ABORTA: já existe modo com uid "${uidNovo}" — consolidação é decisão humana.`); process.exit(1) }
  }
  console.log("\n✔ Pré-condições OK: canônicas existem, têm workflow publicado e não colidem em lugar nenhum.")
  if (!EXECUTE) { console.log("\n(diagnóstico — rode com --execute para corrigir)"); await prisma.$disconnect(); return }

  // Fotografia do que NÃO pode mudar.
  const catAntes = catalogo.map((c) => ({ id: c.id, label: c.label, ordemPadrao: c.ordemPadrao, requiredPadrao: c.requiredPadrao, conditionalPadrao: c.conditionalPadrao, slaDiasPadrao: c.slaDiasPadrao, ativo: c.ativo }))
  const faseAntes = fases.map((f) => ({ id: f.id, macroWorkflowId: f.macroWorkflowId, ordem: f.ordem, required: f.required, conditional: f.conditional, entryRule: f.entryRule, exitRule: f.exitRule, slaDays: f.slaDays, showInKanban: f.showInKanban, label: f.label, versao: f.versao }))
  const modoAntes = modos.map((m) => ({ id: m.id, key: m.key, label: m.label, tipoProcessoId: m.tipoProcessoId }))
  const opAntes = {
    instancias: await prisma.phaseWorkflowInstance.count(),
    passos: await prisma.phaseWorkflowStepInstance.count(),
    tarefas: await prisma.tarefa.count(),
    processos: await prisma.processo.count(),
  }

  const correlationId = `phasekey-coord-${Date.now()}`
  const agora = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      // 3) CatalogoFase — o molde
      for (const c of catAlvos) {
        const destino = MAPEAMENTO_CANONICO[c.phaseKey]
        const r = await tx.catalogoFase.updateMany({ where: { id: c.id, phaseKey: c.phaseKey }, data: { phaseKey: destino, atualizadoEm: agora } })
        if (r.count !== 1) throw new ValidacaoFalhou(`CatalogoFase #${c.id} afetou ${r.count} linha(s), esperado 1`)
        console.log(`  ✔ CatalogoFase #${c.id}: "${c.phaseKey}" → "${destino}"`)
      }
      // 4/5) FaseMacro — as cópias
      for (const f of faseAlvos) {
        const destino = MAPEAMENTO_CANONICO[f.phaseKey]
        const r = await tx.faseMacro.updateMany({ where: { id: f.id, macroWorkflowId: f.macroWorkflowId, phaseKey: f.phaseKey }, data: { phaseKey: destino, atualizadoEm: agora } })
        if (r.count !== 1) throw new ValidacaoFalhou(`FaseMacro #${f.id} afetou ${r.count} linha(s), esperado 1`)
        console.log(`  ✔ FaseMacro #${f.id} (macro ${f.macroWorkflowId} ${f.macroWorkflow.tipoProcesso?.code}): "${f.phaseKey}" → "${destino}"`)
      }

      // Modos internos da fase — phaseKey e modeUid no mesmo UPDATE.
      for (const m of modoAlvos) {
        const destino = MAPEAMENTO_CANONICO[m.phaseKey]
        const uidNovo = m.modeUid.replace(`::${m.phaseKey}::`, `::${destino}::`)
        const r = await tx.phaseInternalMode.updateMany({ where: { id: m.id, phaseKey: m.phaseKey }, data: { phaseKey: destino, modeUid: uidNovo } })
        if (r.count !== 1) throw new ValidacaoFalhou(`PhaseInternalMode #${m.id} afetou ${r.count} linha(s), esperado 1`)
        console.log(`  ✔ PhaseInternalMode #${m.id}: "${m.modeUid}" → "${uidNovo}"`)
      }

      // 6..9) VALIDAÇÕES, ainda dentro da transação
      const catDepois = await tx.catalogoFase.findMany({ orderBy: { ordemPadrao: "asc" } })
      const faseDepois = await tx.faseMacro.findMany({ orderBy: [{ macroWorkflowId: "asc" }, { ordem: "asc" }] })

      if (catDepois.length !== catalogo.length) throw new ValidacaoFalhou(`CatalogoFase mudou de tamanho: ${catalogo.length} → ${catDepois.length}`)
      if (faseDepois.length !== fases.length) throw new ValidacaoFalhou(`FaseMacro mudou de tamanho: ${fases.length} → ${faseDepois.length}`)

      const modoDepois = await tx.phaseInternalMode.findMany({ orderBy: { id: "asc" } })
      if (modoDepois.length !== modos.length) throw new ValidacaoFalhou(`PhaseInternalMode mudou de tamanho: ${modos.length} → ${modoDepois.length}`)

      const legadaSobrou = [...catDepois, ...faseDepois, ...modoDepois].filter((x) => MAPEAMENTO_CANONICO[x.phaseKey] != null)
      if (legadaSobrou.length !== 0) throw new ValidacaoFalhou(`sobraram ${legadaSobrou.length} chave(s) legada(s)`)

      // O uid tem de continuar descrevendo a própria linha, e key/label/escopo intactos.
      for (const a of modoAntes) {
        const d = modoDepois.find((x) => x.id === a.id)!
        if (d.key !== a.key || d.label !== a.label || d.tipoProcessoId !== a.tipoProcessoId) throw new ValidacaoFalhou(`PhaseInternalMode #${a.id} teve atributo alterado`)
        const esperado = `${d.tipoProcessoId ?? "all"}::${d.phaseKey}::${d.key}`
        if (d.modeUid !== esperado) throw new ValidacaoFalhou(`PhaseInternalMode #${a.id}: modeUid "${d.modeUid}" não bate com "${esperado}"`)
      }
      if (new Set(modoDepois.map((m) => m.modeUid)).size !== modoDepois.length) throw new ValidacaoFalhou("modeUid duplicado")

      // ordem/regras do CatalogoFase intactas (e 'transcricoes' idêntica)
      for (const a of catAntes) {
        const d = catDepois.find((x) => x.id === a.id)!
        if (d.label !== a.label || d.ordemPadrao !== a.ordemPadrao || d.requiredPadrao !== a.requiredPadrao || d.conditionalPadrao !== a.conditionalPadrao || d.slaDiasPadrao !== a.slaDiasPadrao || d.ativo !== a.ativo) {
          throw new ValidacaoFalhou(`CatalogoFase #${a.id} teve atributo alterado`)
        }
      }
      for (const c of catAmbiguas) {
        const d = catDepois.find((x) => x.id === c.id)!
        if (d.phaseKey !== c.phaseKey) throw new ValidacaoFalhou(`chave AMBÍGUA "${c.phaseKey}" (#${c.id}) foi alterada — ela é intocável neste trabalho`)
      }
      // ordem/regras das FaseMacro intactas
      for (const a of faseAntes) {
        const d = faseDepois.find((x) => x.id === a.id)!
        const igual = d.macroWorkflowId === a.macroWorkflowId && d.ordem === a.ordem && d.required === a.required && d.conditional === a.conditional
          && d.entryRule === a.entryRule && d.exitRule === a.exitRule && d.slaDays === a.slaDays && d.showInKanban === a.showInKanban && d.label === a.label && d.versao === a.versao
        if (!igual) throw new ValidacaoFalhou(`FaseMacro #${a.id} teve ordem/regra alterada`)
      }
      // duplicidade: no catálogo (unique) e dentro de cada macro
      if (new Set(catDepois.map((c) => c.phaseKey)).size !== catDepois.length) throw new ValidacaoFalhou("phaseKey duplicada no CatalogoFase")
      const porMacro = new Map<string, number>()
      for (const f of faseDepois) { const k = `${f.macroWorkflowId}|${f.phaseKey}`; porMacro.set(k, (porMacro.get(k) ?? 0) + 1) }
      const dupMacro = [...porMacro].filter(([, n]) => n > 1)
      if (dupMacro.length) throw new ValidacaoFalhou(`phaseKey duplicada em macro: ${JSON.stringify(dupMacro)}`)

      // nada operacional pode ter mudado
      const opDepois = {
        instancias: await tx.phaseWorkflowInstance.count(),
        passos: await tx.phaseWorkflowStepInstance.count(),
        tarefas: await tx.tarefa.count(),
        processos: await tx.processo.count(),
      }
      if (JSON.stringify(opAntes) !== JSON.stringify(opDepois)) throw new ValidacaoFalhou(`dado operacional mudou: ${JSON.stringify(opAntes)} → ${JSON.stringify(opDepois)}`)

      // 10) auditoria
      await tx.logAuditoria.create({
        data: {
          acao: "MACRO_PHASEKEY_CORRIGIDA",
          entidade: "CATALOGO_FASE",
          entidadeId: null,
          descricao: "Correção coordenada de phaseKey legada para chave canônica (CatalogoFase + MacroWorkflows)",
          detalhes: {
            origem: "CORRECAO_CATALOGO_PHASEKEY",
            correlationId,
            catalogoFase: catAlvos.map((c) => ({ id: c.id, de: c.phaseKey, para: MAPEAMENTO_CANONICO[c.phaseKey], label: c.label, ordemPadrao: c.ordemPadrao })),
            faseMacro: faseAlvos.map((f) => ({ id: f.id, macroWorkflowId: f.macroWorkflowId, tipoProcesso: f.macroWorkflow.tipoProcesso?.code ?? null, de: f.phaseKey, para: MAPEAMENTO_CANONICO[f.phaseKey], ordem: f.ordem, required: f.required, conditional: f.conditional })),
            phaseInternalMode: modoAlvos.map((m) => ({ id: m.id, de: m.phaseKey, para: MAPEAMENTO_CANONICO[m.phaseKey], key: m.key, uidDe: m.modeUid })),
            linhasAlteradas: catAlvos.length + faseAlvos.length + modoAlvos.length,
            ordemPreservada: true,
            condicoesPreservadas: true,
            ambiguasIntocadas: catAmbiguas.map((c) => ({ id: c.id, phaseKey: c.phaseKey })),
            dadoOperacionalIntocado: opAntes,
            em: agora.toISOString(),
          } as never,
        },
      })
      console.log("  ✔ validações de integridade OK — auditoria registrada")
    })
  } catch (e) {
    if (e instanceof ValidacaoFalhou) {
      console.error(`\n❌ ROLLBACK: ${e.message}`)
      console.error("Nada foi alterado.")
      await prisma.$disconnect(); process.exit(1)
    }
    throw e
  }

  console.log(`\n✅ COMMIT — ${catAlvos.length} CatalogoFase + ${faseAlvos.length} FaseMacro + ${modoAlvos.length} PhaseInternalMode corrigidas.`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
