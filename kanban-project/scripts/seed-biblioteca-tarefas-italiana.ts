// scripts/seed-biblioteca-tarefas-italiana.ts
// ============================================================================
// CADASTRO — SOMENTE os Modelos da Biblioteca de Tarefas da nacionalidade
// Italiana (mandato 22/09/2026, escopo reduzido a pedido explícito de
// 22/09/2026: "somente a Biblioteca de Tarefas, sem vínculo, cutover ou
// publicação de Workflow"). Cria e publica cada Modelo (identidade + versão
// congelada); NUNCA cria `BibliotecaVinculo`, NUNCA chama
// `motorVigenteDaFase`/materialização, NUNCA toca um Processo real — nada
// aqui "ativa" o Modelo em fase nenhuma. Ato administrativo, não teste: roda
// uma vez no banco de teste local para provar, e (só quando explicitamente
// autorizado) uma vez em produção, via `exigirConfirmacaoDeEscritaEmProducao`.
//
// Idempotente: cada modelo é identificado por `chave` — rodar de novo sobre
// um cadastro já criado pula o que já existe (não duplica, não sobrescreve
// conteúdo já publicado).
// ============================================================================
import { exigirBancoDeTeste, exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"

const ehTeste = (process.env.PRISMA_DATABASE_URL ?? "").includes("test") || (process.env.DIRECT_DATABASE_URL ?? "").includes("test")
if (ehTeste) exigirBancoDeTeste("seed-biblioteca-tarefas-italiana")
else exigirConfirmacaoDeEscritaEmProducao(
  "Cadastro (SOMENTE) dos modelos da Biblioteca de Tarefas para a Nacionalidade Italiana (genealogia reaproveitada, emissão documental, emissão retificada, tradução juramentada, apostilamento, análise/retificação provisórios) — RASCUNHO→PUBLICADO da definição. Não cria nem publica nenhum Vínculo; nenhum processo real é afetado por este script.",
  "seed-biblioteca-tarefas-italiana",
)

import { prisma } from "@/lib/prisma"
import { criarModelo, publicarModelo } from "@/src/services/biblioteca-tarefas/modelo"

interface AcaoSeed {
  key: string
  label: string
  effectKey: string
}

interface SubtarefaSeed {
  key: string
  label: string
  ordem: number
  obrigatoria?: boolean
  dependeDe?: string[]
  esperaExternaAoLiberar?: boolean
  /**
   * TODA subtarefa MANUAL (o default — `modoExecucao="MANUAL"`) precisa de
   * pelo menos uma ação: sem isso o operador veria a subtarefa sem poder
   * concluí-la (`SUBTAREFA_SEM_ACAO`, validacao-de-publicacao.ts). Usamos
   * `COMPLETE_STEP` (competência GERAL) em todo lugar — já declarado em
   * `CatalogoFase.efeitosPermitidos` das 9 fases italianas (confirmado em
   * produção 22/09/2026) e suportado por todo executor do registro,
   * inclusive o "padrao" — sem precisar inventar um efeito por subtarefa.
   */
  acoes: AcaoSeed[]
}

const CONCLUIR: AcaoSeed = { key: "concluir", label: "Concluir", effectKey: "COMPLETE_STEP" }

interface ModeloSeed {
  chave: string
  nome: string
  descricao: string
  phaseKey: string
  passo: {
    label: string
    description?: string
    owner?: string
    slaDays?: number
    completionRule?: string
    regraDeConclusao: "ACAO_DO_PASSO" | "TODAS_SUBTAREFAS_OBRIGATORIAS" | "QUALQUER_SUBTAREFA"
    /** Só para passo com `regraDeConclusao: "ACAO_DO_PASSO"` E zero subtarefas — ver comentário nos dois provisórios abaixo. */
    acoes?: AcaoSeed[]
  }
  subtarefas: SubtarefaSeed[]
}

const MODELOS: ModeloSeed[] = [
  // ── GENEALOGIA — reaproveita, byte a byte, o "Localizar registro" já
  // publicado (PhaseInternalWorkflow #11, v2, congelado 15/09/2026 16:46 —
  // única fase entre as 10 italianas cujo publicado sobreviveu à limpeza de
  // hoje). Não inventa nada novo.
  {
    chave: "localizar_registro",
    nome: "Localizar registro",
    descricao: "Genealogia — reaproveitamento integral do passo publicado v2 de PhaseInternalWorkflow #11 (genealogia), congelado em 15/09/2026.",
    phaseKey: "genealogia",
    passo: {
      label: "Localizar registro da certidão",
      description: "Localizar o registro civil e preencher os dados registrais necessários.",
      owner: "equipe_documental", slaDays: 1,
      completionRule: "Cartório preenchido e pelo menos um entre Livro, Folha ou Termo.",
      regraDeConclusao: "ACAO_DO_PASSO",
    },
    subtarefas: [],
  },
  // ── EMISSÃO DOCUMENTAL — "Solicitar certidão". UMA instância por certidão
  // (o Vínculo liga o Modelo à fase; a MULTIPLICAÇÃO por certidão é do motor
  // de escopo — DOCUMENTO —, já existente, nunca deste cadastro). Espera do
  // cartório = espera de terceiro na subtarefa 2, nunca tarefa nova.
  {
    chave: "solicitar_certidao",
    nome: "Solicitar certidão",
    descricao: "Emissão Documental — uma tarefa principal por certidão necessária.",
    phaseKey: "emissao_documental",
    passo: { label: "Solicitar certidão", owner: "equipe_documental", slaDays: 15, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS" },
    subtarefas: [
      { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 0, obrigatoria: true, acoes: [CONCLUIR] },
      { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 1, obrigatoria: true, dependeDe: ["enviar_requerimento_cartorio"], esperaExternaAoLiberar: true, acoes: [CONCLUIR] },
      { key: "receber_certidao", label: "Receber certidão", ordem: 2, obrigatoria: true, dependeDe: ["receber_confirmacao_pedido"], acoes: [CONCLUIR] },
      { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 3, obrigatoria: true, dependeDe: ["receber_certidao"], acoes: [CONCLUIR] },
    ],
  },
  // ── ANÁLISE DOCUMENTAL — tarefa provisória de controle manual (registra que
  // a análise aconteceu + a decisão). Desenho detalhado fica para entrega
  // futura — mandato explícito de não inventar um fluxo automático agora.
  {
    chave: "analise_documental_provisoria",
    nome: "Registrar análise documental",
    descricao: "Análise Documental — controle manual provisório (registra que a análise ocorreu e sua decisão). Desenho completo (uma tarefa por documento vs. por processo, taxonomia de decisão) fica para entrega futura.",
    phaseKey: "analise_documental",
    passo: {
      label: "Registrar análise documental", owner: "equipe_documental", regraDeConclusao: "ACAO_DO_PASSO",
      // Diferente de Genealogia (executor "registral", conclusão bespoke sem
      // ação cadastrada): este passo usa o executor "padrao" (sem
      // EDITOR_POR_STEP_KEY para "analise_documental_provisoria"), que exige
      // ação cadastrada para concluir — sem isso a tela ficaria sem botão.
      acoes: [CONCLUIR],
    },
    subtarefas: [],
  },
  // ── RETIFICAÇÃO DE REGISTROS — tarefa provisória de controle manual
  // (registra a necessidade/andamento da retificação). Nunca altera a
  // modalidade do processo. Fluxo judicial/administrativo completo fica para
  // entrega futura.
  {
    chave: "retificacao_provisoria",
    nome: "Registrar necessidade de retificação",
    descricao: "Retificação de Registros — controle manual provisório (registra a necessidade e o andamento da retificação). Nunca altera a modalidade do processo. Fluxo completo fica para entrega futura.",
    phaseKey: "retificacao_registros",
    passo: { label: "Registrar necessidade de retificação", owner: "equipe_documental", regraDeConclusao: "ACAO_DO_PASSO", acoes: [CONCLUIR] },
    subtarefas: [],
  },
  // ── EMISSÃO DOCUMENTAL RETIFICADA — 5 subtarefas exatas. Passo 3
  // (aguardar retorno do cartório) é espera/acompanhamento de terceiro — SEM
  // duração inventada (acompanhamentoAtivo permanece false: nenhuma decisão
  // de negócio sobre quantos dias até o primeiro retorno foi encontrada em
  // cadastro vivo ou congelado nenhum).
  {
    chave: "emissao_retificada_certidao",
    nome: "Emitir certidão retificada",
    descricao: "Emissão Documental Retificada — executado uma vez por certidão retificada necessária. NÃO reaproveita automaticamente a política de prazo da Emissão normal — decisão explícita pendente (ver relatório).",
    phaseKey: "emissao_documental_retificada",
    passo: { label: "Emitir certidão retificada", owner: "equipe_documental", slaDays: 20, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS" },
    subtarefas: [
      { key: "enviar_pedido_averbacao_cartorio", label: "Enviar pedido de averbação ao cartório", ordem: 0, obrigatoria: true, acoes: [CONCLUIR] },
      { key: "solicitar_certidao_retificada", label: "Solicitar certidão retificada", ordem: 1, obrigatoria: true, dependeDe: ["enviar_pedido_averbacao_cartorio"], acoes: [CONCLUIR] },
      { key: "aguardar_retorno_cartorio", label: "Aguardar retorno do cartório", ordem: 2, obrigatoria: true, dependeDe: ["solicitar_certidao_retificada"], esperaExternaAoLiberar: true, acoes: [CONCLUIR] },
      { key: "receber_certidao_retificada", label: "Receber certidão retificada", ordem: 3, obrigatoria: true, dependeDe: ["aguardar_retorno_cartorio"], acoes: [CONCLUIR] },
      { key: "conferir_validar_certidao_retificada", label: "Conferir e validar certidão retificada", ordem: 4, obrigatoria: true, dependeDe: ["receber_certidao_retificada"], acoes: [CONCLUIR] },
    ],
  },
  // ── TRADUÇÃO JURAMENTADA — 4 subtarefas, modelo próprio.
  {
    chave: "traducao_juramentada",
    nome: "Traduzir documento (juramentada)",
    descricao: "Tradução Juramentada — granularidade (por documento vs. por lote) configurável; hoje uma instância por vínculo de fase, sem presumir a unidade.",
    phaseKey: "traducao_juramentada",
    passo: { label: "Traduzir documento (juramentada)", owner: "equipe_documental", slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS" },
    subtarefas: [
      { key: "preparar_documentos", label: "Preparar documentos", ordem: 0, obrigatoria: true, acoes: [CONCLUIR] },
      { key: "enviar_documentos", label: "Enviar documentos", ordem: 1, obrigatoria: true, dependeDe: ["preparar_documentos"], acoes: [CONCLUIR] },
      { key: "receber_documentos", label: "Receber documentos", ordem: 2, obrigatoria: true, dependeDe: ["enviar_documentos"], esperaExternaAoLiberar: true, acoes: [CONCLUIR] },
      { key: "conferir_validar_documentos", label: "Conferir e validar documentos", ordem: 3, obrigatoria: true, dependeDe: ["receber_documentos"], acoes: [CONCLUIR] },
    ],
  },
  // ── APOSTILAMENTO — modelo INDEPENDENTE da Tradução (mesma sequência de
  // nomes/ordem por semelhança operacional, execuções/estados/vínculos
  // sempre próprios).
  {
    chave: "apostilamento",
    nome: "Apostilar documento",
    descricao: "Apostilamento — modelo independente da Tradução Juramentada (execuções/estados/vínculos próprios), mesma sequência por semelhança operacional. Granularidade (por documento vs. por lote) configurável.",
    phaseKey: "apostilamento",
    passo: { label: "Apostilar documento", owner: "equipe_documental", slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS" },
    subtarefas: [
      { key: "preparar_documentos", label: "Preparar documentos", ordem: 0, obrigatoria: true, acoes: [CONCLUIR] },
      { key: "enviar_documentos", label: "Enviar documentos", ordem: 1, obrigatoria: true, dependeDe: ["preparar_documentos"], acoes: [CONCLUIR] },
      { key: "receber_documentos", label: "Receber documentos", ordem: 2, obrigatoria: true, dependeDe: ["enviar_documentos"], esperaExternaAoLiberar: true, acoes: [CONCLUIR] },
      { key: "conferir_validar_documentos", label: "Conferir e validar documentos", ordem: 3, obrigatoria: true, dependeDe: ["receber_documentos"], acoes: [CONCLUIR] },
    ],
  },
  // Aguardando Protocolo / Protocolado: DELIBERADAMENTE fora desta lista —
  // fases só de controle, sem prazo/SLA, sem tarefa "decorativa". Nada a
  // cadastrar aqui (mandato §3).
]

async function garantirModelo(seed: ModeloSeed, criadoPorId: number | null): Promise<{ modeloId: number; workflowId: number; jaExistia: boolean }> {
  const existente = await prisma.bibliotecaModeloTarefa.findUnique({ where: { chave: seed.chave } })
  if (existente) return { modeloId: existente.id, workflowId: existente.workflowId, jaExistia: true }

  const criado = await criarModelo({ chave: seed.chave, nome: seed.nome, descricao: seed.descricao, criadoPorId })
  if (!criado.ok) throw new Error(`Falha ao criar modelo "${seed.chave}": ${criado.mensagem}`)

  const passoVivo = await prisma.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: criado.workflowId } })
  await prisma.phaseInternalWorkflowStep.update({
    where: { id: passoVivo.id },
    data: {
      label: seed.passo.label, description: seed.passo.description ?? null, owner: seed.passo.owner ?? null,
      slaDays: seed.passo.slaDays ?? 0, completionRule: seed.passo.completionRule ?? null,
      regraDeConclusao: seed.passo.regraDeConclusao,
    },
  })
  for (const a of seed.passo.acoes ?? []) {
    await prisma.stepAction.create({
      data: { stepId: passoVivo.id, key: a.key, label: a.label, effectKey: a.effectKey, ordem: 0 },
    })
  }
  for (const st of seed.subtarefas) {
    const subtarefaCriada = await prisma.stepSubtaskDefinition.create({
      data: {
        stepId: passoVivo.id, key: st.key, label: st.label, ordem: st.ordem,
        obrigatoria: st.obrigatoria ?? true, dependeDe: st.dependeDe ?? undefined,
        esperaExternaAoLiberar: st.esperaExternaAoLiberar ?? false,
      },
    })
    for (const a of st.acoes) {
      await prisma.stepAction.create({
        data: { stepId: passoVivo.id, subtaskId: subtarefaCriada.id, key: a.key, label: a.label, effectKey: a.effectKey, ordem: 0 },
      })
    }
  }
  return { modeloId: criado.modeloId, workflowId: criado.workflowId, jaExistia: false }
}

async function main() {
  console.log(`Alvo: ${process.env.PRISMA_DATABASE_URL ?? "(default .env)"}`)
  console.log("Escopo desta execução: SOMENTE os Modelos (identidade + versão publicada). Nenhum Vínculo é criado; nenhum processo real é afetado.")
  const relatorio: Array<{ chave: string; fase_alvo_futura: string; modeloId: number; workflowId: number; status: string; versaoPublicada: number | null }> = []

  for (const seed of MODELOS) {
    const { modeloId, workflowId, jaExistia } = await garantirModelo(seed, null)
    console.log(`Modelo "${seed.chave}" (#${modeloId}) — ${jaExistia ? "já existia" : "criado"}.`)

    const modeloAtual = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: modeloId } })
    if (modeloAtual.status !== "PUBLICADO") {
      const pub = await publicarModelo(modeloId, null)
      if (!pub.ok) throw new Error(`Falha ao publicar modelo "${seed.chave}": ${pub.mensagem}`)
      console.log(`  publicado v${pub.versaoNova}.`)
    } else {
      console.log(`  já publicado v${modeloAtual.versaoPublicada}.`)
    }

    const modeloFinal = await prisma.bibliotecaModeloTarefa.findUniqueOrThrow({ where: { id: modeloId } })
    relatorio.push({
      chave: seed.chave, fase_alvo_futura: seed.phaseKey, modeloId, workflowId,
      status: modeloFinal.status, versaoPublicada: modeloFinal.versaoPublicada,
    })
  }

  console.log("\n=== RESUMO — SOMENTE MODELOS (nenhum Vínculo criado, nenhum processo afetado) ===")
  console.table(relatorio)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
