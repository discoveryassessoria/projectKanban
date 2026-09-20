// scripts/seed-preview-catalogo-fases.ts
// ============================================================================
// SEMEIA dados SINTÉTICOS no banco de TESTE local (discovery_test) para
// validação visual do mandato "Catálogo de Fases" — NUNCA em produção.
//
// Roda contra PRISMA_DATABASE_URL apontado para o banco de teste local
// (node scripts/mrg-banco-teste.mjs up). Recusa-se a rodar se a URL não
// parecer um banco local/teste. NÃO limpa ao final — os dados ficam no banco
// para inspeção visual manual. Tudo prefixado com "PREVIEW" / "preview_".
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   npx tsx scripts/seed-preview-catalogo-fases.ts
// ============================================================================
import { prisma } from "../lib/prisma"
import { garantirOferta } from "./_fixture-oferta"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { movePhaseManual } from "../src/lib/motor/phase-advance"
import { enqueueReconciliacaoFaseMacro, processarReconciliacaoFaseMacro } from "../src/lib/motor/reconciliar-fase-macro"
import { identificador, retratar, classificar, mesmoBanco, CLASSE } from "../lib/db/identidade-banco.mjs"

const url = process.env.PRISMA_DATABASE_URL || ""
const urlProdConhecida = process.env.SEED_PREVIEW_URL_PRODUCAO_REFERENCIA || ""
// GUARD REAL — mesma classificação usada pelo resto do projeto (identidade-banco.mjs),
// não um simples grep na URL. Recusa qualquer alvo classificado como PRODUCAO, ou
// que bata com a URL de produção conhecida (quando informada).
async function verificarAlvoSeguro() {
  if (urlProdConhecida && mesmoBanco(url, urlProdConhecida)) {
    console.error(`[seed-preview] RECUSADO: o alvo (${identificador(url)}) é o MESMO banco de produção. Nada foi escrito.`)
    process.exit(1)
  }
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[seed-preview] alvo ${identificador(url)} classificado como ${classe} (tabelas=${retrato.tabelas}, requerentes=${retrato.requerentes})`)
  if (classe === CLASSE.PRODUCAO || classe === CLASSE.DESCONHECIDO) {
    console.error(`[seed-preview] RECUSADO: classificação ${classe} não é segura para semear dados sintéticos. Nada foi escrito.`)
    process.exit(1)
  }
}

const M = "PREVIEW"
const FASE_NOVA = "preview_triagem_consular_extra"

async function main() {
  await verificarAlvoSeguro()
  console.log(`[seed-preview] alvo: ${url.replace(/:[^:@]+@/, ":***@")}`)

  const senha = "preview123"
  const admin = await prisma.usuario.upsert({
    where: { email: "preview.admin@discovery.test" },
    update: {},
    create: { nome: "Preview Admin", email: "preview.admin@discovery.test", senha, tipo: "admin" },
    select: { id: true, email: true },
  })
  console.log(`[seed-preview] usuário admin: ${admin.email} / senha: ${senha} (só existe neste banco de teste)`)

  const oferta = await garantirOferta(prisma, { countryKey: "preview_pais", countryLabel: "País Preview", modalityKey: "preview_modal", modalityLabel: "Modalidade Preview" })

  let tipo = await prisma.tipoProcessoNacionalidade.findFirst({ where: { code: `${M}_TIPO` }, select: { id: true } })
  if (!tipo) {
    tipo = await prisma.tipoProcessoNacionalidade.create({
      data: { code: `${M}_TIPO`, name: "Nacionalidade Preview · Catálogo de Fases", paisId: oferta.paisId, modalidadeId: oferta.modalidadeId, ativo: true },
      select: { id: true },
    })
  }
  console.log(`[seed-preview] tipo de processo: id=${tipo.id} ("Nacionalidade Preview · Catálogo de Fases")`)

  let macro = await prisma.macroWorkflow.findUnique({ where: { tipoProcessoId: tipo.id }, select: { id: true } })
  if (!macro) {
    macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: "Workflow Macro · Preview", versao: 1 }, select: { id: true } })
  }
  const composicaoInicial = [
    { phaseKey: "genealogia", label: "Genealogia", ordem: 1 },
    { phaseKey: "emissao_documental", label: "Emissão Documental", ordem: 2 },
    { phaseKey: "analise_documental", label: "Análise Documental", ordem: 3 },
    { phaseKey: "aguardando_protocolo", label: "Aguardando Protocolo", ordem: 4 },
    { phaseKey: "protocolado", label: "Protocolado", ordem: 5 },
    { phaseKey: "finalizado", label: "Finalizado", ordem: 6 },
  ]
  for (const f of composicaoInicial) {
    await prisma.faseMacro.upsert({
      where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: f.phaseKey } },
      update: {},
      create: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: true, conditional: false, entryRule: f.ordem === 1 ? "process_created" : "previous_phase_completed", showInKanban: true },
    })
  }
  for (const f of composicaoInicial) {
    const wfUid = `${M}::${f.phaseKey}`
    const jaExiste = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid }, select: { id: true } })
    if (!jaExiste) {
      const wf = await prisma.phaseInternalWorkflow.create({
        data: { wfUid, phaseKey: f.phaseKey, name: `WF Preview ${f.phaseKey}`, tipoProcessoId: tipo.id, versao: 1 },
        select: { id: true },
      })
      await prisma.phaseInternalWorkflowStep.create({
        data: { workflowId: wf.id, key: `${f.phaseKey}_passo`, label: `Trabalho em ${f.label}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 5, cardinalidade: "PROCESSO" },
      })
    }
  }

  let arvore = await prisma.arvore.findFirst({ where: { nome: `${M} Família Rossi` }, select: { id: true } })
  if (!arvore) arvore = await prisma.arvore.create({ data: { nome: `${M} Família Rossi` }, select: { id: true } })

  let processo = await prisma.processo.findFirst({ where: { nome: `${M} Processo Rossi` }, select: { id: true } })
  if (!processo) {
    processo = await prisma.processo.create({
      data: { nome: `${M} Processo Rossi`, arvoreId: arvore.id, workflowRuntime: "v2", faseAtualKey: "genealogia", tipoProcessoMotorId: tipo.id, macroWorkflowVersion: 1 },
      select: { id: true },
    })
  }
  console.log(`[seed-preview] processo em andamento: id=${processo.id} ("${M} Processo Rossi")`)

  await materializarExecucaoDaFase({ processoId: processo.id, fonte: "PROCESSO_CRIADO" })
  const ordemAlvo = ["genealogia", "emissao_documental", "analise_documental", "aguardando_protocolo", "protocolado"]
  for (const alvo of ordemAlvo) {
    const atual = await prisma.processo.findUniqueOrThrow({ where: { id: processo.id }, select: { faseAtualKey: true } })
    if (atual.faseAtualKey !== alvo) {
      await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: processo.id, faseMacroKey: atual.faseAtualKey ?? undefined }, data: { status: "CONCLUIDO" } })
      const mov = await movePhaseManual(processo.id, { faseAlvo: alvo, justificativa: "seed de preview — avanço regular simulado", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
      if (!mov.success) { console.error(`[seed-preview] falha ao avançar para ${alvo}:`, mov.code, mov.message); process.exit(1) }
      await materializarExecucaoDaFase({ processoId: processo.id, fonte: "MOVIMENTACAO_MANUAL" })
    }
  }
  await prisma.phaseWorkflowInstance.updateMany({ where: { processoId: processo.id, faseMacroKey: "protocolado" }, data: { status: "CONCLUIDO" } })

  const jaTemFaseNova = await prisma.faseMacro.findUnique({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: FASE_NOVA } } })
  if (!jaTemFaseNova) {
    await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "aguardando_protocolo" } }, data: { ordem: 5 } })
    await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "protocolado" } }, data: { ordem: 6 } })
    await prisma.faseMacro.update({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "finalizado" } }, data: { ordem: 7 } })
    await prisma.faseMacro.create({
      data: { macroWorkflowId: macro.id, phaseKey: FASE_NOVA, label: "Triagem Consular Extra (fase nova de teste)", ordem: 4, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true },
    })
    await prisma.macroWorkflow.update({ where: { id: macro.id }, data: { versao: { increment: 1 } } })
    const wfUid = `${M}::${FASE_NOVA}`
    const wfNova = await prisma.phaseInternalWorkflow.create({ data: { wfUid, phaseKey: FASE_NOVA, name: "WF Preview Triagem Consular Extra", tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wfNova.id, key: `${FASE_NOVA}_passo`, label: "Conferir triagem consular extra", ordem: 1, createsTask: true, required: false, owner: null, slaDays: 5, cardinalidade: "PROCESSO" } })

    const mwAtualizado = await prisma.macroWorkflow.findUniqueOrThrow({ where: { id: macro.id }, select: { versao: true } })
    const enq = await enqueueReconciliacaoFaseMacro({
      macroWorkflowId: macro.id, tipoProcessoId: tipo.id, versaoAnterior: mwAtualizado.versao - 1, versaoNova: mwAtualizado.versao,
      fasesNovas: [{ phaseKey: FASE_NOVA, required: true, conditional: false }], publicadoPorId: admin.id,
    })
    console.log(`[seed-preview] PUBLICAÇÃO da fase nova "${FASE_NOVA}": ${enq.processosAlcancados} processo(s) alcançado(s), ${enq.outboxRegistrados} outbox registrado(s)`)
    for (const row of await prisma.domainOutbox.findMany({ where: { tipo: "fase.macro.reconciliar", status: "PENDENTE" } })) {
      await processarReconciliacaoFaseMacro(row.payload as { processoId: number; phaseKey: string; versaoNova?: number }, row.correlationId ?? undefined)
      await prisma.domainOutbox.update({ where: { id: row.id }, data: { status: "ENVIADO", processadoEm: new Date() } })
    }
    console.log(`[seed-preview] reconciliação processada — fase nova materializada retroativamente no processo ${processo.id}`)
  } else {
    console.log("[seed-preview] fase nova já existia na composição — pulando republicação")
  }

  console.log("\n[seed-preview] RESUMO")
  console.log(`  login          : preview.admin@discovery.test / ${senha}`)
  console.log(`  processo       : id ${processo.id} — "${M} Processo Rossi" (tipo "${M}_TIPO")`)
  console.log(`  fase nova      : "${FASE_NOVA}" ("Triagem Consular Extra") — materializada, PENDENTE (obrigação retroativa)`)
  console.log("  esperado       : finalização deste processo fica BLOQUEADA até concluir a fase nova")
  console.log(`  Gerenciamento  : /administrator → Processos → Estrutura → Fases / Workflow Macro (tipo "${M}_TIPO", id ${tipo.id})`)
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
