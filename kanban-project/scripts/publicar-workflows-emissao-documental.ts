// scripts/publicar-workflows-emissao-documental.ts
// ============================================================================
// CORREÇÃO DO CONTEÚDO — Emissão Documental (4 passos) e Emissão Documental
// Retificada (5 passos), mandato "Catálogo de Fases", correção 20/09/2026,
// itens 2 e 3. Usa a MESMA rota de gravação/publicação que a tela de
// Gerenciamento usa (`buildSteps`/`buildFilhos`/`publicarWorkflow`, importados
// diretamente — não uma segunda lógica de construção).
//
// emissao_documental (workflowId conhecido em produção: 12) REGRIDIU de 4
// passos corretos (v6, 14/09) para 1 passo (v8+, publicado por engano via UI
// em 15/09) — confirmado por leitura direta do histórico de
// PhaseInternalWorkflowVersao em produção. emissao_documental_retificada
// (workflowId 15) nunca teve passo nenhum (0 desde a criação) — confirmado
// PhaseWorkflowInstance = [] em produção, zero risco de romper trabalho já
// materializado para ESTA fase especificamente.
//
// Vocabulário de efeito REUTILIZADO (nenhum efeito novo inventado — todos já
// existem em src/lib/motor/catalogo-de-efeitos.ts e já estão liberados para
// estas duas fases desde o backfill de 20/09/2026):
//   COMPLETE_STEP, PAUSE_FOR_EXTERNAL_WAIT, RESUME, MARK_DOCUMENT_RECEIVED,
//   APPROVE_FOR_ANALYSIS (= "válida"), INVALIDATE_DOCUMENT (= "inválida").
//
// Campos reaproveitados do modelo de campos das versões anteriores que
// funcionavam (canal com catálogo "canais", texto para destinatário/protocolo,
// upload para evidência) — ver PhaseInternalWorkflowVersao histórica id=12
// versões 1-6 em produção.
//
// USO:
//   npx tsx scripts/publicar-workflows-emissao-documental.ts                 → dry-run (só valida e relata, nada escrito)
//   npx tsx scripts/publicar-workflows-emissao-documental.ts --aplicar        → grava rascunho + publica no banco do PRISMA_DATABASE_URL atual
//   npx tsx scripts/publicar-workflows-emissao-documental.ts --aplicar --prod → exige também EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { buildSteps, buildFilhos } from "../src/app/api/gerenciamento/workflows-fase/[id]/route"
import { publicarWorkflow } from "../src/services/publicacao-de-workflow"
import { publicarRevisaoCatalogoFase } from "../src/lib/motor/catalogo-fase-revisao"
import { efeitosPorCompetenciaPadrao } from "../src/lib/motor/catalogo-de-efeitos"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")

// ── EMISSÃO DOCUMENTAL — exatamente 4 passos ────────────────────────────────
const PASSOS_EMISSAO_DOCUMENTAL = [
  {
    key: "enviar_requerimento_ao_cartorio",
    label: "Enviar requerimento ao cartório",
    description: "Envio do requerimento inicial de emissão ao cartório ou órgão competente.",
    createsTask: true, required: true, slaDays: 0,
    esperaExternaAoLiberar: false,
    campos: [
      { key: "canal", label: "Canal de envio", tipo: "select", obrigatorio: true, opcoes: { catalogo: "canais" }, ordem: 1 },
      { key: "destinatario", label: "Cartório / órgão destinatário", tipo: "texto", obrigatorio: true, ordem: 2 },
      { key: "requerimento", label: "Requerimento enviado", tipo: "upload", obrigatorio: true, ordem: 3 },
      { key: "numero_protocolo", label: "Número do protocolo", tipo: "texto", obrigatorio: false, ajuda: "Obrigatório nos canais que devolvem número no ato do envio.", ordem: 4 },
    ],
    acoes: [
      { key: "enviado", label: "Requerimento enviado", effectKey: "COMPLETE_STEP", ordem: 1, requerCampos: ["canal", "destinatario", "requerimento"] },
    ],
  },
  {
    key: "receber_confirmacao_do_pedido",
    label: "Receber confirmação do pedido",
    description: "Espera externa: o cartório confirma o recebimento do pedido antes de emitir a certidão.",
    createsTask: true, required: true, slaDays: 10,
    esperaExternaAoLiberar: true,
    dependeDe: ["enviar_requerimento_ao_cartorio"],
    campos: [
      { key: "comprovante_confirmacao", label: "Comprovante / confirmação do cartório", tipo: "upload", obrigatorio: true, ordem: 1 },
      { key: "numero_protocolo_confirmado", label: "Número / protocolo", tipo: "texto", obrigatorio: false, ordem: 2 },
      { key: "valor", label: "Valor", tipo: "moeda", obrigatorio: false, ordem: 3 },
      { key: "forma_pagamento", label: "Forma de pagamento", tipo: "select", obrigatorio: false, opcoes: { catalogo: "formas_pagamento" }, ordem: 4 },
      { key: "situacao_pagamento", label: "Situação do pagamento", tipo: "select", obrigatorio: false, opcoesCadastradas: [{ key: "pendente", label: "Pendente" }, { key: "pago", label: "Pago" }], ordem: 5 },
      { key: "previsao_informada", label: "Previsão informada pelo cartório", tipo: "data", obrigatorio: false, ordem: 6 },
    ],
    acoes: [
      { key: "confirmado", label: "Registrar confirmação recebida", effectKey: "COMPLETE_STEP", ordem: 1, requerCampos: ["comprovante_confirmacao"] },
    ],
  },
  {
    key: "receber_certidao",
    label: "Receber certidão",
    description: "Espera externa: aguarda a emissão e o envio da certidão pelo cartório.",
    createsTask: true, required: true, slaDays: 15,
    esperaExternaAoLiberar: true,
    dependeDe: ["receber_confirmacao_do_pedido"],
    campos: [
      { key: "certidao_recebida", label: "Certidão recebida", tipo: "upload", obrigatorio: true, ordem: 1 },
    ],
    acoes: [
      { key: "recebida", label: "Certidão recebida", effectKey: "MARK_DOCUMENT_RECEIVED", ordem: 1, requerCampos: ["certidao_recebida"] },
    ],
  },
  {
    key: "conferir_e_validar_certidao",
    label: "Conferir e validar certidão",
    description: "Conferência final: a certidão recebida é validada ou invalidada, com justificativa quando inválida.",
    createsTask: true, required: true, slaDays: 3,
    esperaExternaAoLiberar: false,
    dependeDe: ["receber_certidao"],
    reaberturaPermitida: true, reaberturaEstrategia: "ESCOLHA_MANUAL", reaberturaExigeJustificativa: true,
    campos: [
      { key: "motivo", label: "Justificativa (quando inválida)", tipo: "textarea", obrigatorio: false, ordem: 1 },
    ],
    acoes: [
      { key: "validar", label: "Válida", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 },
      // "A Emissão não decide retificação" (competência de fase, ver
      // registro-de-executores.ts): a certidão inválida NÃO usa INVALIDATE_
      // DOCUMENT aqui (competência ANALISE, fora do escopo desta fase) — usa
      // REQUEST_NEW_COPY, já competência EMISSAO, que cria um documento novo
      // derivado do atual e reabre o pedido sem duplicar a necessidade —
      // exatamente "preservar a certidão recebida... permitir retrabalho a
      // partir do passo 1 ou do passo 2... não duplicar a operação".
      { key: "invalidar", label: "Inválida", effectKey: "REQUEST_NEW_COPY", ordem: 2, requerCampos: ["motivo"] },
    ],
    requisitos: [
      { key: "justificativa_obrigatoria_ao_invalidar", label: "Justificativa obrigatória ao invalidar", tipo: "CAMPO_PREENCHIDO", alvoKey: "motivo", acaoKey: "invalidar", momento: "AO_EXECUTAR_ACAO" },
    ],
  },
]

// ── EMISSÃO DOCUMENTAL RETIFICADA — exatamente 5 passos ─────────────────────
const PASSOS_EMISSAO_DOCUMENTAL_RETIFICADA = [
  {
    key: "enviar_pedido_averbacao_ao_cartorio",
    label: "Enviar pedido de averbação ao cartório",
    description: "Envio ao cartório do pedido para lançar a averbação/correção no registro.",
    createsTask: true, required: true, slaDays: 0,
    esperaExternaAoLiberar: false,
    campos: [
      { key: "canal", label: "Canal de envio", tipo: "select", obrigatorio: true, opcoes: { catalogo: "canais" }, ordem: 1 },
      { key: "destinatario", label: "Cartório", tipo: "texto", obrigatorio: true, ordem: 2 },
      { key: "pedido_averbacao", label: "Pedido de averbação enviado", tipo: "upload", obrigatorio: true, ordem: 3 },
    ],
    acoes: [
      { key: "enviado", label: "Pedido de averbação enviado", effectKey: "COMPLETE_STEP", ordem: 1, requerCampos: ["canal", "destinatario", "pedido_averbacao"] },
    ],
  },
  {
    key: "solicitar_certidao_retificada",
    label: "Solicitar certidão retificada",
    description: "Solicitação da nova certidão já com a correção averbada.",
    createsTask: true, required: true, slaDays: 0,
    esperaExternaAoLiberar: false,
    dependeDe: ["enviar_pedido_averbacao_ao_cartorio"],
    campos: [
      { key: "canal", label: "Canal de envio", tipo: "select", obrigatorio: true, opcoes: { catalogo: "canais" }, ordem: 1 },
      { key: "destinatario", label: "Cartório", tipo: "texto", obrigatorio: true, ordem: 2 },
      { key: "comprovante_solicitacao", label: "Comprovante da solicitação", tipo: "upload", obrigatorio: true, ordem: 3 },
      { key: "numero_protocolo", label: "Número do protocolo", tipo: "texto", obrigatorio: false, ordem: 4 },
      { key: "valor", label: "Valor", tipo: "moeda", obrigatorio: false, ordem: 5 },
      { key: "forma_pagamento", label: "Forma de pagamento", tipo: "select", obrigatorio: false, opcoes: { catalogo: "formas_pagamento" }, ordem: 6 },
      { key: "situacao_pagamento", label: "Situação do pagamento", tipo: "select", obrigatorio: false, opcoesCadastradas: [{ key: "pendente", label: "Pendente" }, { key: "pago", label: "Pago" }], ordem: 7 },
      { key: "previsao_informada", label: "Previsão informada", tipo: "data", obrigatorio: false, ordem: 8 },
    ],
    acoes: [
      { key: "solicitada", label: "Solicitação registrada", effectKey: "COMPLETE_STEP", ordem: 1, requerCampos: ["canal", "destinatario", "comprovante_solicitacao"] },
    ],
  },
  {
    key: "aguardar_retorno_do_cartorio",
    label: "Aguardar retorno do cartório",
    description: "Espera externa pelo retorno do cartório sobre a certidão retificada solicitada.",
    createsTask: true, required: true, slaDays: 15,
    esperaExternaAoLiberar: true,
    dependeDe: ["solicitar_certidao_retificada"],
    acoes: [
      // Nunca conclui sozinho pela passagem do tempo — RESUME é ação explícita de
      // quem retoma o fluxo ao ver o retorno do cartório (nenhum cron conclui isto).
      { key: "retorno_recebido", label: "Retorno do cartório recebido", effectKey: "RESUME", ordem: 1 },
    ],
  },
  {
    key: "receber_certidao_retificada",
    label: "Receber certidão retificada",
    description: "Recebimento e anexação da certidão retificada.",
    createsTask: true, required: true, slaDays: 3,
    esperaExternaAoLiberar: false,
    dependeDe: ["aguardar_retorno_do_cartorio"],
    campos: [
      { key: "certidao_retificada_recebida", label: "Certidão retificada recebida", tipo: "upload", obrigatorio: true, ordem: 1 },
    ],
    acoes: [
      { key: "recebida", label: "Certidão retificada recebida", effectKey: "MARK_DOCUMENT_RECEIVED", ordem: 1, requerCampos: ["certidao_retificada_recebida"] },
    ],
  },
  {
    key: "conferir_e_validar_certidao_retificada",
    label: "Conferir e Validar certidão retificada",
    description: "Conferência final da certidão retificada: validação ou invalidação com justificativa.",
    createsTask: true, required: true, slaDays: 3,
    esperaExternaAoLiberar: false,
    dependeDe: ["receber_certidao_retificada"],
    reaberturaPermitida: true, reaberturaEstrategia: "ESCOLHA_MANUAL", reaberturaExigeJustificativa: true,
    campos: [
      { key: "motivo", label: "Justificativa (quando inválida)", tipo: "textarea", obrigatorio: false, ordem: 1 },
    ],
    acoes: [
      { key: "validar", label: "Válida", effectKey: "APPROVE_FOR_ANALYSIS", ordem: 1 },
      { key: "invalidar", label: "Inválida", effectKey: "INVALIDATE_DOCUMENT", ordem: 2, requerCampos: ["motivo"] },
    ],
    requisitos: [
      { key: "justificativa_obrigatoria_ao_invalidar", label: "Justificativa obrigatória ao invalidar", tipo: "CAMPO_PREENCHIDO", alvoKey: "motivo", acaoKey: "invalidar", momento: "AO_EXECUTAR_ACAO" },
    ],
  },
]

async function verificarAlvoSeguro() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[publicar-workflows-emissao] alvo ${identificador(url)} classificado como ${classe} (tabelas=${retrato.tabelas}, requerentes=${retrato.requerentes})`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) {
      console.error(`[publicar-workflows-emissao] RECUSADO: --prod foi passado mas o alvo não classifica como PRODUCAO (classe=${classe}). Nada foi escrito.`)
      process.exit(1)
    }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
      console.error(`[publicar-workflows-emissao] RECUSADO: --prod exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Nada foi escrito.`)
      process.exit(1)
    }
  }
  if (APLICAR && !ALVO_PROD && classe === CLASSE.PRODUCAO) {
    console.error(`[publicar-workflows-emissao] RECUSADO: o alvo classifica como PRODUCAO mas --prod não foi passado. Nada foi escrito.`)
    process.exit(1)
  }
}

async function gravarERepublicar(phaseKey: string, passos: any[]) {
  const wf = await prisma.phaseInternalWorkflow.findFirst({ where: { phaseKey, wfUid: `all::${phaseKey}` }, select: { id: true, versao: true } })
  if (!wf) {
    console.error(`[publicar-workflows-emissao] CONFLITO: workflow global "all::${phaseKey}" não encontrado — nada foi escrito para esta fase.`)
    return { phaseKey, ok: false as const }
  }

  if (!APLICAR) {
    return { phaseKey, ok: true as const, dryRun: true, workflowId: wf.id, versaoAtual: wf.versao, passosPrevistos: passos.length }
  }

  await prisma.$transaction(async (tx) => {
    const stepData = buildSteps(passos, wf.id)
    await tx.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: wf.id } })
    for (let i = 0; i < stepData.length; i++) {
      const criado = await tx.phaseInternalWorkflowStep.create({ data: stepData[i], select: { id: true } })
      const filhos = buildFilhos(passos[i], criado.id)
      if (filhos.acoes.length) await tx.stepAction.createMany({ data: filhos.acoes })
      if (filhos.campos.length) await tx.stepField.createMany({ data: filhos.campos })
      if (filhos.requisitos.length) {
        await tx.stepRequirement.createMany({ data: filhos.requisitos.map((r) => ({ ...r, stepId: criado.id })) })
      }
      for (const grupo of filhos.opcoesPorCampo) {
        if (grupo.opcoes.length === 0) continue
        const campo = await tx.stepField.findFirst({ where: { stepId: criado.id, subtaskId: null, key: grupo.campoKey }, select: { id: true } })
        if (!campo) continue
        await tx.stepFieldOption.createMany({ data: grupo.opcoes.map((o: Record<string, unknown>) => ({ ...o, fieldId: campo.id })) })
      }
    }
  }, { maxWait: 20_000, timeout: 60_000 })

  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null })
  return { phaseKey, ok: pub.ok, workflowId: wf.id, versaoAnterior: wf.versao, publicacao: pub }
}

async function garantirCompetenciaAnalise(phaseKey: string) {
  const atual = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey } })
  const necessarios = efeitosPorCompetenciaPadrao(phaseKey)
  const atuais = ((atual.efeitosPermitidos as string[] | null) ?? []).slice().sort()
  const bateExato = atuais.length === necessarios.length && atuais.every((e, i) => e === [...necessarios].sort()[i])
  if (bateExato) return { phaseKey, jaCorrigido: true }
  if (!APLICAR) return { phaseKey, previsto: necessarios }
  const r = await publicarRevisaoCatalogoFase(prisma, atual, { ...atual, efeitosPermitidos: necessarios as never }, null)
  return { phaseKey, revisaoNova: r.revisaoNova, efeitosPermitidos: necessarios }
}

async function main() {
  await verificarAlvoSeguro()
  console.log(`[publicar-workflows-emissao] modo: ${APLICAR ? "APLICAR" : "DRY-RUN (nada será escrito)"}`)

  // Competência ANALISE (efeito INVALIDATE_DOCUMENT — "conferir e validar" pode dizer
  // inválida) precisa estar declarada ANTES de publicar os passos que a usam.
  const compEmissao = await garantirCompetenciaAnalise("emissao_documental")
  const compRetificada = await garantirCompetenciaAnalise("emissao_documental_retificada")
  console.log(JSON.stringify({ competenciaAmpliada: [compEmissao, compRetificada] }, null, 2))

  const r1 = await gravarERepublicar("emissao_documental", PASSOS_EMISSAO_DOCUMENTAL)
  const r2 = await gravarERepublicar("emissao_documental_retificada", PASSOS_EMISSAO_DOCUMENTAL_RETIFICADA)

  console.log(JSON.stringify({ emissao_documental: r1, emissao_documental_retificada: r2 }, null, 2))
  if (!r1.ok || !r2.ok) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
