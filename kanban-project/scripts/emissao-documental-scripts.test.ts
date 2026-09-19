// scripts/emissao-documental-scripts.test.ts
// ============================================================================
// PROVA, CONTRA O BANCO DE TESTE, dos dois scripts que vão rodar em produção
// no deploy (mandato "correção definitiva do modelo temporal", 19-20/09/2026,
// seções 3/4/7): renomear-aguardar-retorno-cartorio.ts e
// configurar-emissao-documental-temporal.ts.
//
// Um fixture com a MESMA estrutura do cadastro real (stepId 454, 4
// subtarefas) — chaves próprias (prefixo EDST_), para nunca colidir com o
// cadastro de produção nem com outro teste.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=<banco de teste> npx tsx scripts/emissao-documental-scripts.test.ts
// ============================================================================
import { PrismaClient } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { renomearAguardarRetornoCartorio } from "./renomear-aguardar-retorno-cartorio"
import { configurarEmissaoDocumentalTemporal, KEY_CONFIRMACAO as KEY_CONFIRMACAO_REAL, KEY_CERTIDAO as KEY_CERTIDAO_REAL } from "./configurar-emissao-documental-temporal"

const prisma = new PrismaClient()
const M = "EDST"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

const KEY_ANTIGA = `${M}_aguardar_retorno_do_cartorio`
const KEY_NOVA = `${M}_receber_confirmacao_do_pedido`
const KEY_CERTIDAO = `${M}_receber_certidao`

async function limpar() {
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    const passos = await prisma.phaseInternalWorkflowStep.findMany({ where: { workflowId: wf.id }, select: { id: true } })
    await prisma.stepSubtaskDefinition.deleteMany({ where: { stepId: { in: passos.map((p) => p.id) } } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: `${M}_fase` } })
}

async function main() {
  exigirBancoDeTeste("prova os scripts de renomeação + configuração temporal da Emissão Documental")
  await limpar()
  console.log("SCRIPTS DE DEPLOY DA EMISSÃO DOCUMENTAL — renomeação + controle temporal\n")

  const fase = await prisma.catalogoFase.create({
    data: { phaseKey: `${M}_fase`, label: "Fase de Teste EDST", escopo: "PROCESSO", ordemPadrao: 97, efeitosPermitidos: ["REGISTER_ONLY"] },
    select: { phaseKey: true },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${M}::wf`, phaseKey: fase.phaseKey, name: "Solicitar certidão (teste)", versao: 1, execucao: "SEQUENCIAL" },
    select: { id: true },
  })
  const passo = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${M}_solicitar_certidao`, label: "Solicitar certidão", ordem: 1, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never, slaDays: 8,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true },
  })
  // Réplica EXATA da estrutura real (stepId 454): 4 subtarefas, mesmas
  // dependências, mesmo slaDays "morto" (7) na certidão.
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: `${M}_enviar_requerimento_ao_cartorio`, label: "Enviar requerimento ao cartório", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never, slaDays: 1 },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: KEY_ANTIGA, label: "Aguardar retorno do cartório", ordem: 2, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [`${M}_enviar_requerimento_ao_cartorio`] as never, slaDays: 1, esperaExternaAoLiberar: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: KEY_CERTIDAO, label: "Receber certidão", ordem: 3, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [KEY_ANTIGA] as never, slaDays: 7, esperaExternaAoLiberar: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: `${M}_conferir_e_validar_certidao`, label: "Conferir e validar certidão", ordem: 4, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [KEY_CERTIDAO] as never, slaDays: 1 },
  })

  // ══════════════════════════════════════════════════════════════
  console.log("\nA) Renomeação — seco não escreve")
  // ══════════════════════════════════════════════════════════════
  const secoA = await renomearAguardarRetornoCartorio({ aplicar: false, keyAntiga: KEY_ANTIGA, keyNova: KEY_NOVA, db: prisma })
  check("dry-run reporta sucesso sem aplicar", secoA.ok && secoA.aplicado === false)
  const aindaAntiga = await prisma.stepSubtaskDefinition.findFirst({ where: { key: KEY_ANTIGA } })
  check("a key antiga continua intacta (seco não escreveu)", aindaAntiga != null)

  // ══════════════════════════════════════════════════════════════
  console.log("\nB) Renomeação aplicada — key, label e dependeDe da irmã")
  // ══════════════════════════════════════════════════════════════
  const rB = await renomearAguardarRetornoCartorio({ aplicar: true, keyAntiga: KEY_ANTIGA, keyNova: KEY_NOVA, db: prisma })
  check("aplicado com sucesso", rB.ok && rB.aplicado === true)
  const renomeada = await prisma.stepSubtaskDefinition.findFirst({ where: { key: KEY_NOVA } })
  check("a subtarefa está com a key nova", renomeada != null)
  check("e o label novo", renomeada?.label === "Receber confirmação do pedido")
  const certidaoDepoisB = await prisma.stepSubtaskDefinition.findFirst({ where: { key: KEY_CERTIDAO } })
  check("a irmã (certidão) teve o dependeDe corrigido para a key nova",
    JSON.stringify(certidaoDepoisB?.dependeDe) === JSON.stringify([KEY_NOVA]), JSON.stringify(certidaoDepoisB?.dependeDe))

  // ══════════════════════════════════════════════════════════════
  console.log("\nC) Renomeação de novo — idempotente, não encontra mais a antiga")
  // ══════════════════════════════════════════════════════════════
  const rC = await renomearAguardarRetornoCartorio({ aplicar: true, keyAntiga: KEY_ANTIGA, keyNova: KEY_NOVA, db: prisma })
  check("2ª rodada não aplica nada (já renomeada)", rC.ok && rC.aplicado === false && rC.motivo === "JA_RENOMEADA_OU_INEXISTENTE")

  // ══════════════════════════════════════════════════════════════
  console.log("\nD) Colisão de chave é recusada, nada é escrito")
  // ══════════════════════════════════════════════════════════════
  const outraKeyAntiga = `${M}_outra_antiga`
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo.id, key: outraKeyAntiga, label: "Outra", ordem: 5, obrigatoria: false, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never },
  })
  const rD = await renomearAguardarRetornoCartorio({ aplicar: true, keyAntiga: outraKeyAntiga, keyNova: KEY_NOVA, db: prisma })
  check("colisão detectada e recusada", !rD.ok && rD.motivo === "COLISAO_DE_CHAVE")
  const outraIntacta = await prisma.stepSubtaskDefinition.findFirst({ where: { key: outraKeyAntiga } })
  check("a que ia ser renomeada continua com a key antiga (nada foi escrito)", outraIntacta != null)
  await prisma.stepSubtaskDefinition.delete({ where: { id: outraIntacta!.id } })

  // ══════════════════════════════════════════════════════════════
  console.log("\nE) Configuração temporal — recusa se a subtarefa renomeada não existe")
  // ══════════════════════════════════════════════════════════════
  const rENaoAchou = await configurarEmissaoDocumentalTemporal({
    aplicar: true, stepId: -999999, db: prisma,
  })
  check("stepId inexistente é recusado", !rENaoAchou.ok && rENaoAchou.motivo === "STEP_NAO_ENCONTRADO")

  // ══════════════════════════════════════════════════════════════
  console.log("\nF) Configuração temporal aplicada — 7 dias, gatilho pela key NOVA, SLA morto zerado")
  // ══════════════════════════════════════════════════════════════
  // A função real usa as keys de produção; para o teste, chamamos com as
  // mesmas keys de PRODUÇÃO por injeção de dependência não existe aqui —
  // então validamos a MESMA lógica através de uma segunda réplica cujo
  // stepId e keys IMITAM exatamente as constantes exportadas do script.
  const passo2 = await prisma.phaseInternalWorkflowStep.create({
    data: {
      workflowId: wf.id, key: `${M}_solicitar_certidao_2`, label: "Solicitar certidão 2", ordem: 2, createsTask: true,
      required: true, cardinalidade: "DOCUMENTO", executorKey: "padrao", dependeDe: [] as never, slaDays: 8,
      regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    },
    select: { id: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo2.id, key: "enviar_requerimento_ao_cartorio", label: "Enviar requerimento", ordem: 1, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [] as never, slaDays: 1 },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo2.id, key: KEY_CONFIRMACAO_REAL, label: "Receber confirmação do pedido", ordem: 2, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: ["enviar_requerimento_ao_cartorio"] as never, slaDays: 1, esperaExternaAoLiberar: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo2.id, key: KEY_CERTIDAO_REAL, label: "Receber certidão", ordem: 3, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [KEY_CONFIRMACAO_REAL] as never, slaDays: 7, esperaExternaAoLiberar: true },
  })
  await prisma.stepSubtaskDefinition.create({
    data: { stepId: passo2.id, key: "conferir_e_validar_certidao", label: "Conferir e validar", ordem: 4, obrigatoria: true, modoExecucao: "MANUAL", responsavelRegra: "HERDA", fonteDeCanais: "NENHUMA", dependeDe: [KEY_CERTIDAO_REAL] as never, slaDays: 1 },
  })

  const secoF = await configurarEmissaoDocumentalTemporal({ aplicar: false, stepId: passo2.id, db: prisma })
  check("dry-run não escreve", secoF.ok && secoF.aplicado === false)
  const certidaoAntesF = await prisma.stepSubtaskDefinition.findFirst({ where: { stepId: passo2.id, key: KEY_CERTIDAO_REAL } })
  check("slaDays ainda 7 (seco não tocou)", certidaoAntesF?.slaDays === 7)

  const rF = await configurarEmissaoDocumentalTemporal({ aplicar: true, stepId: passo2.id, db: prisma })
  check("aplicado com sucesso", rF.ok && rF.aplicado === true)
  const certidaoDepoisF = await prisma.stepSubtaskDefinition.findFirst({ where: { stepId: passo2.id, key: KEY_CERTIDAO_REAL } })
  check("regraTemporalAtiva ligada", certidaoDepoisF?.regraTemporalAtiva === true)
  check("regraTemporalDias = 7 (o número do mandato, não inventado)", certidaoDepoisF?.regraTemporalDias === 7)
  check("gatilho aponta para a key NOVA da confirmação", certidaoDepoisF?.regraTemporalGatilhoChave === KEY_CONFIRMACAO_REAL)
  check("slaDays zerado — dead data para AGUARDANDO_TERCEIRO", certidaoDepoisF?.slaDays == null)
  const confirmacaoDepoisF = await prisma.stepSubtaskDefinition.findFirst({ where: { stepId: passo2.id, key: KEY_CONFIRMACAO_REAL } })
  check("a confirmação NÃO ganhou acompanhamento/regra temporal inventados",
    confirmacaoDepoisF?.acompanhamentoAtivo === false && confirmacaoDepoisF?.regraTemporalAtiva === false)

  // ══════════════════════════════════════════════════════════════
  console.log("\nG) Configuração temporal de novo — idempotente")
  // ══════════════════════════════════════════════════════════════
  const rG = await configurarEmissaoDocumentalTemporal({ aplicar: true, stepId: passo2.id, db: prisma })
  check("2ª rodada não aplica nada (já no estado-alvo)", rG.ok && rG.aplicado === false && rG.motivo === "JA_APLICADO")

  await limpar()
  console.log(`\n${ok} passaram, ${falhas.length} falharam`)
  if (falhas.length > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
