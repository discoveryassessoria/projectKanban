// src/services/biblioteca-tarefas/modelo.ts
// ============================================================================
// CICLO DE VIDA DO MODELO DA BIBLIOTECA DE TAREFAS (mandato 22/09/2026).
//
// Um Modelo é armazenado como a "casca" de um `PhaseInternalWorkflow`
// (`origemBiblioteca=true`, `phaseKey="biblioteca"`, `tipoProcessoId=null`) com
// EXATAMENTE UM `PhaseInternalWorkflowStep` — reaproveita 100% do editor
// existente (`ConfiguracaoDoPassoModal`/`PUT /api/gerenciamento/workflows-fase/
// [id]`) e do versionamento existente (`PhaseInternalWorkflowVersao`/
// `publicarWorkflow`) sem alterar nenhum dos dois. Esta camada só dá ao
// conjunto uma identidade estável (`chave`) e um vocabulário de ciclo de vida
// (RASCUNHO/PUBLICADO/INATIVO) que faz sentido para "modelo reutilizável" —
// vocabulário diferente do de "Workflow Interno de uma fase real".
//
// Criar/editar um Modelo NUNCA cria Tarefa, altera processo ou muda outro
// Workflow — só o `BibliotecaVinculo` (vinculo.ts), quando PUBLICADO, alcança
// processos reais.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { congelarVersaoVigente } from "@/src/services/versao-publicada"
import { publicarWorkflow } from "@/src/services/publicacao-de-workflow"

const PHASE_KEY_BIBLIOTECA = "biblioteca"

export interface CriarModeloInput {
  chave: string
  nome: string
  descricao?: string | null
  criadoPorId: number | null
}

function normalizarChave(chave: string): string {
  return chave
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
}

export type CriarModeloResultado =
  | { ok: true; modeloId: number; workflowId: number }
  | { ok: false; erro: string; mensagem: string }

/** Cria o Modelo (casca + um passo em branco), sempre RASCUNHO. */
export async function criarModelo(input: CriarModeloInput): Promise<CriarModeloResultado> {
  const chave = normalizarChave(input.chave)
  if (!chave) return { ok: false, erro: "CHAVE_INVALIDA", mensagem: "Informe um nome do qual seja possível gerar uma identidade estável." }
  const nome = input.nome.trim()
  if (!nome) return { ok: false, erro: "NOME_OBRIGATORIO", mensagem: "Informe o nome do modelo." }

  const existente = await prisma.bibliotecaModeloTarefa.findUnique({ where: { chave } })
  if (existente) return { ok: false, erro: "CHAVE_EM_USO", mensagem: `Já existe um modelo com a identidade "${chave}".` }

  const wfUid = `biblioteca::${chave}`
  const resultado = await prisma.$transaction(async (tx) => {
    const wf = await tx.phaseInternalWorkflow.create({
      data: {
        wfUid, phaseKey: PHASE_KEY_BIBLIOTECA, tipoProcessoId: null,
        name: nome, origemBiblioteca: true,
      },
    })
    // A CHAVE DO PASSO É A `chave` DO MODELO — nunca um placeholder genérico
    // ("principal"). `EDITOR_POR_STEP_KEY` (step-editor-registry.ts) resolve o
    // executor operacional PELO stepKey ("solicitar_certidao" →
    // "solicitacao_cartorio", "localizar_registro" → "registral"); um passo
    // materializado a partir deste Modelo carrega este MESMO key (ver
    // `resolverViaBibliotecaVinculo`, phase-workflow.ts) — só assim a fase
    // real herda o editor certo, e não o painel genérico por engano. Também é
    // o que faz a Genealogia ser reaproveitamento BYTE A BYTE: a chave
    // publicada continua "localizar_registro", igual ao passo #11 v2 que
    // este Modelo espelha.
    await tx.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: chave, label: nome, ordem: 0 },
    })
    // A v1 nasce congelada VAZIA (mesmo padrão de "criar workflow vazio"), e o
    // passo criado logo acima entra como alteração de rascunho pendente —
    // publicar pela primeira vez é o que vai congelar o passo de verdade.
    await congelarVersaoVigente(wf.id, "CRIACAO", tx, input.criadoPorId)
    await tx.phaseInternalWorkflow.update({
      where: { id: wf.id },
      data: { rascunhoAlteradoEm: new Date(), rascunhoAlteradoPor: input.criadoPorId },
    })
    const modelo = await tx.bibliotecaModeloTarefa.create({
      data: {
        chave, workflowId: wf.id, nome, descricao: input.descricao ?? null,
        status: "RASCUNHO", criadoPorId: input.criadoPorId,
      },
    })
    return { modeloId: modelo.id, workflowId: wf.id }
  })
  return { ok: true, ...resultado }
}

export type PublicarModeloResultado =
  | { ok: true; versaoAnterior: number; versaoNova: number }
  | { ok: false; erro: string; mensagem: string; problemas?: unknown }

/**
 * PUBLICA o Modelo — delega a `publicarWorkflow` (mesma trava de conflito de
 * versão, mesmo congelamento) e SÓ ENTÃO atualiza o próprio ciclo de vida do
 * Modelo. `publicarWorkflow` não reconcilia nada sozinho aqui: `phaseKey`
 * "biblioteca" nunca casa com um `CatalogoFase` real (ver comentário em
 * `publicarWorkflow`), então o gatilho de reconciliação de fase que ele
 * dispara automaticamente é, para este workflow, sempre um no-op silencioso.
 * A reconciliação de processos reais é responsabilidade EXCLUSIVA do Vínculo
 * (vinculo.ts) — nunca do Modelo.
 */
export async function publicarModelo(modeloId: number, actorId: number | null): Promise<PublicarModeloResultado> {
  const modelo = await prisma.bibliotecaModeloTarefa.findUnique({ where: { id: modeloId } })
  if (!modelo) return { ok: false, erro: "MODELO_INEXISTENTE", mensagem: "Modelo não encontrado." }
  if (modelo.status === "INATIVO") return { ok: false, erro: "MODELO_INATIVO", mensagem: "Reative o modelo antes de publicar uma nova versão." }

  const r = await publicarWorkflow({ workflowId: modelo.workflowId, actorId, pularCompetenciaDeEfeito: true })
  if (!r.ok) return { ok: false, erro: r.code ?? "FALHA_PUBLICACAO", mensagem: r.mensagem ?? "Não foi possível publicar o modelo.", problemas: r.problemas }

  await prisma.bibliotecaModeloTarefa.update({
    where: { id: modeloId },
    data: { status: "PUBLICADO", versaoPublicada: r.versaoNova ?? modelo.versaoPublicada },
  })
  return { ok: true, versaoAnterior: r.versaoAnterior ?? 0, versaoNova: r.versaoNova ?? 0 }
}

/** INATIVA — nunca apaga. Vínculos publicados continuam lendo a versão congelada que já usavam. */
export async function inativarModelo(modeloId: number): Promise<{ ok: boolean; mensagem?: string }> {
  const modelo = await prisma.bibliotecaModeloTarefa.findUnique({ where: { id: modeloId } })
  if (!modelo) return { ok: false, mensagem: "Modelo não encontrado." }
  await prisma.bibliotecaModeloTarefa.update({ where: { id: modeloId }, data: { status: "INATIVO", ativo: false } })
  return { ok: true }
}

export async function reativarModelo(modeloId: number): Promise<{ ok: boolean; mensagem?: string }> {
  const modelo = await prisma.bibliotecaModeloTarefa.findUnique({ where: { id: modeloId } })
  if (!modelo) return { ok: false, mensagem: "Modelo não encontrado." }
  const status = modelo.versaoPublicada != null ? "PUBLICADO" : "RASCUNHO"
  await prisma.bibliotecaModeloTarefa.update({ where: { id: modeloId }, data: { status, ativo: true } })
  return { ok: true }
}

/**
 * DUPLICA — cria um Modelo NOVO (chave/identidade própria) com o conteúdo VIVO
 * do passo de origem copiado (campos/ações/checklist/requisitos/subtarefas
 * completos, cada um com nova identidade de linha). Nunca copia o histórico de
 * versões nem os Vínculos: duplicar não herda quem usa o original.
 */
export async function duplicarModelo(
  modeloOrigemId: number,
  novaChave: string,
  novoNome: string,
  criadoPorId: number | null,
): Promise<CriarModeloResultado> {
  const origem = await prisma.bibliotecaModeloTarefa.findUnique({
    where: { id: modeloOrigemId },
    include: {
      workflow: {
        include: {
          passos: {
            include: {
              // OS FILHOS DO PASSO são os que não pertencem a subtarefa nenhuma —
              // mesmo filtro de `validarWorkflowParaPublicar`
              // (validacao-de-publicacao.ts). Sem ele, cada ação/campo/checklist/
              // requisito de SUBTAREFA aparece TAMBÉM na lista do passo (a
              // relação Prisma não filtra por `subtaskId`) e o loop abaixo tenta
              // recriá-lo duas vezes — a segunda vez colide com a unique
              // (stepId, key) e a duplicação falha.
              acoes: { where: { subtaskId: null } },
              campos: { where: { subtaskId: null }, include: { opcoesCadastradas: true } },
              checkItens: { where: { subtaskId: null } },
              canais: true, requisitos: { where: { subtaskId: null } },
              subtarefas: {
                include: { acoes: true, campos: { include: { opcoesCadastradas: true } }, checkItens: true, requisitos: true },
              },
            },
          },
        },
      },
    },
  })
  if (!origem) return { ok: false, erro: "MODELO_INEXISTENTE", mensagem: "Modelo de origem não encontrado." }

  const criado = await criarModelo({ chave: novaChave, nome: novoNome, criadoPorId })
  if (!criado.ok) return criado

  const passoOrigem = origem.workflow.passos[0]
  if (!passoOrigem) return criado

  await prisma.$transaction(async (tx) => {
    const passoNovo = await tx.phaseInternalWorkflowStep.findFirstOrThrow({ where: { workflowId: criado.workflowId } })
    await tx.phaseInternalWorkflowStep.update({
      where: { id: passoNovo.id },
      data: {
        description: passoOrigem.description, owner: passoOrigem.owner, priority: passoOrigem.priority,
        slaDays: passoOrigem.slaDays, cardinalidade: passoOrigem.cardinalidade, completionRule: passoOrigem.completionRule,
        checklist: passoOrigem.checklist ?? undefined, dependeDe: passoOrigem.dependeDe ?? undefined,
        executorKey: passoOrigem.executorKey, reaberturaPermitida: passoOrigem.reaberturaPermitida,
        reaberturaEstrategia: passoOrigem.reaberturaEstrategia, reaberturaExigeJustificativa: passoOrigem.reaberturaExigeJustificativa,
        reaberturaPermissao: passoOrigem.reaberturaPermissao, esperaExternaAoLiberar: passoOrigem.esperaExternaAoLiberar,
        regraDeConclusao: passoOrigem.regraDeConclusao,
      },
    })
    for (const a of passoOrigem.acoes) {
      await tx.stepAction.create({ data: { stepId: passoNovo.id, key: a.key, label: a.label, descricao: a.descricao, ordem: a.ordem, effectKey: a.effectKey, requerCampos: a.requerCampos ?? undefined, permissao: a.permissao, condicao: a.condicao ?? undefined, metadata: a.metadata ?? undefined, ativo: a.ativo } })
    }
    for (const c of passoOrigem.campos) {
      const campoNovo = await tx.stepField.create({ data: { stepId: passoNovo.id, key: c.key, label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio, opcoes: c.opcoes ?? undefined, condicao: c.condicao ?? undefined, ajuda: c.ajuda, ordem: c.ordem, ativo: c.ativo } })
      for (const o of c.opcoesCadastradas) {
        await tx.stepFieldOption.create({ data: { fieldId: campoNovo.id, key: o.key, label: o.label, descricao: o.descricao, ordem: o.ordem, ativo: o.ativo, condicao: o.condicao ?? undefined } })
      }
    }
    for (const i of passoOrigem.checkItens) {
      await tx.stepChecklistItem.create({ data: { stepId: passoNovo.id, key: i.key, label: i.label, descricao: i.descricao, obrigatorio: i.obrigatorio, ordem: i.ordem, ativo: i.ativo } })
    }
    for (const r of passoOrigem.requisitos) {
      await tx.stepRequirement.create({ data: { stepId: passoNovo.id, key: r.key, label: r.label, descricao: r.descricao, tipo: r.tipo, alvoKey: r.alvoKey, minimo: r.minimo, obrigatorio: r.obrigatorio, condicao: r.condicao ?? undefined, acaoKey: r.acaoKey, ordem: r.ordem, ativo: r.ativo, evidenciaTipoId: r.evidenciaTipoId, mimesPermitidos: r.mimesPermitidos ?? undefined, momento: r.momento } })
    }
    for (const st of passoOrigem.subtarefas) {
      const subNova = await tx.stepSubtaskDefinition.create({
        data: {
          stepId: passoNovo.id, key: st.key, label: st.label, descricao: st.descricao, ordem: st.ordem, ativo: st.ativo,
          obrigatoria: st.obrigatoria, repetivel: st.repetivel, maxOcorrencias: st.maxOcorrencias, modoExecucao: st.modoExecucao,
          responsavelRegra: st.responsavelRegra, responsavelId: st.responsavelId, slaDays: st.slaDays,
          condicaoEntrada: st.condicaoEntrada ?? undefined, condicaoConclusao: st.condicaoConclusao ?? undefined, condicaoVisibilidade: st.condicaoVisibilidade ?? undefined,
          dependeDe: st.dependeDe ?? undefined, executorKey: st.executorKey, cardinalidade: st.cardinalidade,
          fonteDeCanais: st.fonteDeCanais, tiposDeCanal: st.tiposDeCanal ?? undefined,
          reaberturaPermitida: st.reaberturaPermitida, reaberturaExigeJustificativa: st.reaberturaExigeJustificativa, reaberturaPermissao: st.reaberturaPermissao,
          esperaExternaAoLiberar: st.esperaExternaAoLiberar, acompanhamentoAtivo: st.acompanhamentoAtivo, acompanhamentoPrimeiroDias: st.acompanhamentoPrimeiroDias,
          regraTemporalAtiva: st.regraTemporalAtiva, regraTemporalDias: st.regraTemporalDias, regraTemporalGatilhoChave: st.regraTemporalGatilhoChave,
        },
      })
      for (const a of st.acoes) await tx.stepAction.create({ data: { stepId: passoNovo.id, subtaskId: subNova.id, key: a.key, label: a.label, descricao: a.descricao, ordem: a.ordem, effectKey: a.effectKey, requerCampos: a.requerCampos ?? undefined, permissao: a.permissao, condicao: a.condicao ?? undefined, metadata: a.metadata ?? undefined, ativo: a.ativo } })
      for (const c of st.campos) {
        const campoNovo = await tx.stepField.create({ data: { stepId: passoNovo.id, subtaskId: subNova.id, key: c.key, label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio, opcoes: c.opcoes ?? undefined, condicao: c.condicao ?? undefined, ajuda: c.ajuda, ordem: c.ordem, ativo: c.ativo } })
        for (const o of c.opcoesCadastradas) await tx.stepFieldOption.create({ data: { fieldId: campoNovo.id, key: o.key, label: o.label, descricao: o.descricao, ordem: o.ordem, ativo: o.ativo, condicao: o.condicao ?? undefined } })
      }
      for (const i of st.checkItens) await tx.stepChecklistItem.create({ data: { stepId: passoNovo.id, subtaskId: subNova.id, key: i.key, label: i.label, descricao: i.descricao, obrigatorio: i.obrigatorio, ordem: i.ordem, ativo: i.ativo } })
      for (const r of st.requisitos) await tx.stepRequirement.create({ data: { stepId: passoNovo.id, subtaskId: subNova.id, key: r.key, label: r.label, descricao: r.descricao, tipo: r.tipo, alvoKey: r.alvoKey, minimo: r.minimo, obrigatorio: r.obrigatorio, condicao: r.condicao ?? undefined, acaoKey: r.acaoKey, ordem: r.ordem, ativo: r.ativo, evidenciaTipoId: r.evidenciaTipoId, mimesPermitidos: r.mimesPermitidos ?? undefined, momento: r.momento } })
    }
  })

  return criado
}
