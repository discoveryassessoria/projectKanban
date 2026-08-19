// scripts/canonicalizar-fases.ts
// ============================================================================
// RECONCILIAÇÃO CANÔNICA DAS CHAVES DE FASE — configuração, nunca operação.
//
//   npx tsx scripts/canonicalizar-fases.ts              SOMENTE LEITURA (dry-run)
//   npx tsx scripts/canonicalizar-fases.ts --execute
//
// ─── O QUE ACONTECEU ────────────────────────────────────────────────────────
// As fases nasceram com chaves antigas (`retificacao`, `traducao`) e o catálogo
// oficial passou a usar as canônicas (`retificacao_registros`,
// `traducao_juramentada`). Em 03/08 os WORKFLOWS INTERNOS foram corrigidos; o
// CADASTRO e os MACROFLUXOS não. Ficaram os dois vocabulários no mesmo banco —
// e, como o motor resolve fase por igualdade exata, a fase de Retificação de
// qualquer processo passou a não encontrar workflow nenhum.
//
// O guard de composição, ao recusar a chave antiga, tornou isso visível: salvar um
// macrofluxo que já tinha `retificacao` passou a falhar. O guard está certo. O que
// estava errado era o dado.
//
// ─── O QUE ESTE SCRIPT É ────────────────────────────────────────────────────
// Uma TROCA DE IDENTIDADE, cirúrgica, feita com UPDATE na linha existente:
// preserva id, ordem, SLA, obrigatoriedade, condicionalidade, kanban, vínculos,
// datas — tudo menos a chave. Não apaga, não recria, não duplica, não move
// processo, não cria nem conclui tarefa, não dispara o motor de fases.
//
// ─── O QUE ELE RECUSA A FAZER ───────────────────────────────────────────────
// Quando a chave canônica JÁ EXISTE no mesmo escopo, trocar a antiga produziria
// duas configurações para a mesma fase — e fundi-las seria adivinhar qual vale.
// Nesses casos o script PARA naquele registro e reporta o conflito, com os dois
// lados lado a lado. Só o que é inequívoco é migrado.
//
// IDEMPOTENTE: a segunda execução não encontra nada para fazer.
// ============================================================================
import { prisma } from '../lib/prisma'
import { EQUIVALENCIA_LEGADA } from '../src/lib/process-stage/verificar-phasekeys'

const EXECUTAR = process.argv.includes('--execute')
const LEGADAS = Object.keys(EQUIVALENCIA_LEGADA)

interface Conflito {
  tabela: string
  registro: string
  motivo: string
  legado: unknown
  canonico: unknown
}

const conflitos: Conflito[] = []
const alteracoes: Array<{ tabela: string; id: number | string; de: string; para: string; detalhe?: string }> = []

async function auditar(acao: string, entidade: string, entidadeId: number, descricao: string, detalhes: Record<string, unknown>) {
  if (!EXECUTAR) return
  await prisma.logAuditoria.create({
    data: { acao, entidade, entidadeId, descricao, detalhes: detalhes as never, usuarioId: null },
  }).catch(() => null)
}

async function main() {
  console.log(EXECUTAR ? 'CANONICALIZAÇÃO — APLICANDO\n' : 'CANONICALIZAÇÃO — SOMENTE LEITURA (use --execute para aplicar)\n')
  console.log('MAPA LEGADO → CANÔNICO (fechado, confirmado):')
  for (const [de, para] of Object.entries(EQUIVALENCIA_LEGADA)) console.log(`  ${de.padEnd(16)} → ${para}`)

  // ── 1) O CADASTRO CANÔNICO ────────────────────────────────────────────────
  // A fase é a MESMA: o id não muda, o rótulo não muda, a ordem não muda. Muda a
  // chave, que é o identificador de domínio — e é justamente ela que estava velha.
  console.log('\n── CatalogoFase ──')
  for (const de of LEGADAS) {
    const para = EQUIVALENCIA_LEGADA[de]
    const antiga = await prisma.catalogoFase.findUnique({ where: { phaseKey: de } })
    if (!antiga) { console.log(`  ${de}: nada a fazer`); continue }
    const canonica = await prisma.catalogoFase.findUnique({ where: { phaseKey: para } })
    if (canonica) {
      conflitos.push({
        tabela: 'CatalogoFase', registro: `#${antiga.id}`,
        motivo: `Já existe a fase canônica "${para}" (#${canonica.id}). Trocar a chave criaria duas fases para o mesmo conceito.`,
        legado: antiga, canonico: canonica,
      })
      console.log(`  ⚠ CONFLITO ${de} → ${para}: a canônica já existe (#${canonica.id})`)
      continue
    }
    console.log(`  ${EXECUTAR ? '✔' : '→'} #${antiga.id} "${antiga.label}" · ${de} → ${para} (id, rótulo, ordem, SLA e flags preservados)`)
    alteracoes.push({ tabela: 'CatalogoFase', id: antiga.id, de, para })
    if (EXECUTAR) {
      await prisma.catalogoFase.update({ where: { id: antiga.id }, data: { phaseKey: para } })
      await auditar('PHASE_CANONICALIZED', 'CatalogoFase', antiga.id,
        `Chave da fase "${antiga.label}" reconciliada de "${de}" para "${para}". Mesma fase, mesmo id — só a identidade de domínio foi normalizada.`,
        { antes: { phaseKey: de }, depois: { phaseKey: para }, campos_preservados: ['id', 'label', 'ordemPadrao', 'requiredPadrao', 'conditionalPadrao', 'slaDiasPadrao', 'ativo', 'escopo'] })
    }
  }

  // ── 2) OS MACROFLUXOS ─────────────────────────────────────────────────────
  console.log('\n── FaseMacro (a composição dos fluxos) ──')
  const fases = await prisma.faseMacro.findMany({
    where: { phaseKey: { in: LEGADAS } },
    orderBy: [{ macroWorkflowId: 'asc' }, { ordem: 'asc' }],
    include: { macroWorkflow: { select: { name: true, tipoProcessoId: true } } },
  })
  for (const f of fases) {
    const para = EQUIVALENCIA_LEGADA[f.phaseKey]
    // A trava `@@unique([macroWorkflowId, phaseKey])` é o que impede a duplicata —
    // e é também onde um conflito real apareceria: o fluxo já ter as DUAS.
    const jaTem = await prisma.faseMacro.findUnique({
      where: { macroWorkflowId_phaseKey: { macroWorkflowId: f.macroWorkflowId, phaseKey: para } },
    })
    if (jaTem) {
      conflitos.push({
        tabela: 'FaseMacro', registro: `#${f.id}`,
        motivo: `O fluxo "${f.macroWorkflow.name}" já tem a fase canônica "${para}" (#${jaTem.id}, ordem ${jaTem.ordem}). Fundir as duas configurações seria escolher uma sem base.`,
        legado: f, canonico: jaTem,
      })
      console.log(`  ⚠ CONFLITO #${f.id} (${f.macroWorkflow.name}): o fluxo já tem "${para}"`)
      continue
    }
    console.log(`  ${EXECUTAR ? '✔' : '→'} #${f.id} ${f.macroWorkflow.name} · ordem ${f.ordem} · ${f.phaseKey} → ${para} (ordem/SLA/obrigatória/condicional/kanban preservados)`)
    alteracoes.push({ tabela: 'FaseMacro', id: f.id, de: f.phaseKey, para, detalhe: `${f.macroWorkflow.name} · ordem ${f.ordem}` })
    if (EXECUTAR) {
      await prisma.faseMacro.update({ where: { id: f.id }, data: { phaseKey: para } })
      await auditar('WORKFLOW_PHASE_CANONICALIZED', 'FaseMacro', f.id,
        `Fase "${f.label}" do fluxo "${f.macroWorkflow.name}" passou a referenciar a chave canônica "${para}" (era "${f.phaseKey}"). Ordem, SLA, obrigatoriedade, condicionalidade e exibição no Kanban preservados.`,
        {
          macroWorkflowId: f.macroWorkflowId, tipoProcessoId: f.macroWorkflow.tipoProcessoId,
          antes: { phaseKey: f.phaseKey, ordem: f.ordem, required: f.required, conditional: f.conditional, slaDays: f.slaDays, showInKanban: f.showInKanban },
          depois: { phaseKey: para, ordem: f.ordem, required: f.required, conditional: f.conditional, slaDays: f.slaDays, showInKanban: f.showInKanban },
        })
    }
  }

  // ── 3) REGRAS ECONÔMICAS POR FASE ─────────────────────────────────────────
  console.log('\n── PhaseEconomicRule ──')
  const regras = await prisma.phaseEconomicRule.findMany({ where: { phaseKey: { in: LEGADAS } }, orderBy: { id: 'asc' } })
  for (const r of regras) {
    const para = EQUIVALENCIA_LEGADA[r.phaseKey]
    console.log(`  ${EXECUTAR ? '✔' : '→'} #${r.id} "${r.componentName}" · ${r.phaseKey} → ${para} (ativo=${r.ativo}, valores e vínculos preservados)`)
    alteracoes.push({ tabela: 'PhaseEconomicRule', id: r.id, de: r.phaseKey, para, detalhe: r.componentName ?? '' })
    if (EXECUTAR) {
      await prisma.phaseEconomicRule.update({ where: { id: r.id }, data: { phaseKey: para } })
      await auditar('PHASE_CANONICALIZED', 'PhaseEconomicRule', r.id,
        `Regra econômica "${r.componentName}" passou a referenciar a fase canônica "${para}" (era "${r.phaseKey}").`,
        { antes: { phaseKey: r.phaseKey }, depois: { phaseKey: para }, ativo: r.ativo })
    }
  }

  // ── 4) WORKFLOWS INTERNOS ─────────────────────────────────────────────────
  // Aqui o conflito é a regra, não a exceção: o workflow canônico já existe desde o
  // backfill de 03/08. Trocar a chave do legado criaria um SEGUNDO workflow para a
  // mesma fase — e, por ser específico de tipo, ele venceria o canônico na resolução.
  console.log('\n── PhaseInternalWorkflow ──')
  const wfs = await prisma.phaseInternalWorkflow.findMany({
    where: { phaseKey: { in: LEGADAS } },
    include: { passos: { select: { key: true, label: true, ordem: true, required: true } } },
  })
  for (const w of wfs) {
    const para = EQUIVALENCIA_LEGADA[w.phaseKey]
    const canonico = await prisma.phaseInternalWorkflow.findMany({
      where: { phaseKey: para, arquivado: false },
      include: { passos: { select: { key: true, label: true, ordem: true, required: true } } },
    })
    if (canonico.length > 0) {
      const equivalente = canonico.some((c) =>
        JSON.stringify(c.passos.map((p) => [p.key, p.ordem, p.required])) ===
        JSON.stringify(w.passos.map((p) => [p.key, p.ordem, p.required])))
      conflitos.push({
        tabela: 'PhaseInternalWorkflow', registro: `wf#${w.id}`,
        motivo: equivalente
          ? `Já existe workflow para "${para}" com os MESMOS passos (wf#${canonico[0].id}). Trocar a chave criaria uma duplicata que venceria o canônico na resolução.`
          : `Já existe workflow para "${para}" (wf#${canonico[0].id}, ${canonico[0].passos.length} passo(s)) e este tem ${w.passos.length}. As configurações NÃO são equivalentes — fundir seria escolher uma sem base.`,
        legado: { id: w.id, wfUid: w.wfUid, tipoProcessoId: w.tipoProcessoId, passos: w.passos.length, active: w.active },
        canonico: canonico.map((c) => ({ id: c.id, wfUid: c.wfUid, tipoProcessoId: c.tipoProcessoId, passos: c.passos.length })),
      })
      console.log(`  ⚠ CONFLITO wf#${w.id} (${w.wfUid}, ${w.passos.length} passos) × wf#${canonico[0].id} (${canonico[0].passos.length} passos) — NÃO migrado`)
      continue
    }
    console.log(`  ${EXECUTAR ? '✔' : '→'} wf#${w.id} ${w.wfUid} · ${w.phaseKey} → ${para}`)
    alteracoes.push({ tabela: 'PhaseInternalWorkflow', id: w.id, de: w.phaseKey, para })
    if (EXECUTAR) {
      const novoUid = `${w.tipoProcessoId ?? 'all'}::${para}`
      await prisma.phaseInternalWorkflow.update({ where: { id: w.id }, data: { phaseKey: para, wfUid: novoUid } })
      await auditar('PHASE_CANONICALIZED', 'PhaseInternalWorkflow', w.id,
        `Workflow interno "${w.name}" passou a referenciar a fase canônica "${para}" (era "${w.phaseKey}"). Passos preservados.`,
        { antes: { phaseKey: w.phaseKey, wfUid: w.wfUid }, depois: { phaseKey: para, wfUid: novoUid } })
    }
  }

  // ── RELATÓRIO ─────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(74)}`)
  console.log(`Alterações ${EXECUTAR ? 'aplicadas' : 'previstas'}: ${alteracoes.length}`)
  const porTabela = new Map<string, number>()
  for (const a of alteracoes) porTabela.set(a.tabela, (porTabela.get(a.tabela) ?? 0) + 1)
  for (const [t, n] of porTabela) console.log(`   ${t}: ${n}`)

  if (conflitos.length > 0) {
    console.log(`\nCONFLITOS NÃO MIGRADOS: ${conflitos.length} — decisão humana, não automática:`)
    for (const c of conflitos) {
      console.log(`   ${c.tabela} ${c.registro}`)
      console.log(`      ${c.motivo}`)
      console.log(`      legado  : ${JSON.stringify(c.legado).slice(0, 200)}`)
      console.log(`      canônico: ${JSON.stringify(c.canonico).slice(0, 200)}`)
    }
  } else {
    console.log('\nNenhum conflito.')
  }

  // ── ESTADO OPERACIONAL — a prova de que isto é configuração ────────────────
  console.log('\nESTADO OPERACIONAL com chave legada (tem de ser zero — nada aqui é tocado):')
  for (const [nome, n] of [
    ['Processo.faseAtualKey', await prisma.processo.count({ where: { faseAtualKey: { in: LEGADAS } } })],
    ['PhaseWorkflowInstance', await prisma.phaseWorkflowInstance.count({ where: { faseMacroKey: { in: LEGADAS } } })],
    ['PhaseWorkflowStepInstance', await prisma.phaseWorkflowStepInstance.count({ where: { faseMacroKey: { in: LEGADAS } } })],
    ['Tarefa', await prisma.tarefa.count({ where: { faseMacroKey: { in: LEGADAS } } })],
  ] as Array<[string, number]>) console.log(`   ${nome.padEnd(28)} ${n}`)

  if (!EXECUTAR) console.log('\nNada foi alterado. Para aplicar: --execute')
  process.exit(conflitos.length > 0 && EXECUTAR ? 0 : 0)
}

void main().finally(() => prisma.$disconnect())
