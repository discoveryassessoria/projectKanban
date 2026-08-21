// src/services/versao-publicada.ts
// ============================================================================
// A VERSÃO PUBLICADA DE UM WORKFLOW INTERNO — congelar e ler.
//
// ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
// `PhaseWorkflowInstance` sempre gravou `workflowDefinitionId` + `workflowVersion`:
// o vínculo com a versão já existia. O que não existia era o CONTEÚDO dela.
// `PhaseInternalWorkflow.versao` nunca era incrementada, e a edição apagava e
// recriava os passos — de modo que uma execução iniciada semana passada passava a
// ser lida pela configuração de hoje, sem que nada no dado registrasse a troca.
//
// Não é um risco teórico: `politicaDeSla` decidia se o relógio de uma tarefa EM
// ANDAMENTO pausa lendo a definição VIVA. Marcar "pausar na espera externa" hoje
// mudava o prazo de tarefas que começaram sob a regra anterior.
//
// ─── O QUE ESTE MÓDULO FAZ ──────────────────────────────────────────────────
// CONGELAR: copia o conteúdo da definição para `PhaseInternalWorkflowVersao` no
// momento em que a versão passa a valer. A identidade é o par que a instância já
// guarda — `(workflowId, versao)` —, e é por isso que nenhuma coluna nova nasceu na
// instância: o ponteiro existia; faltava o alvo.
//
// LER: devolve o que a versão dizia, não o que a definição diz agora.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não atualiza versão congelada — nada no runtime escreve numa linha destas depois
// de criada. Não migra processo de versão. Não decide qual versão vale: quem decide
// é a instância, que já registrou a sua no dia em que materializou.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

type DB = Prisma.TransactionClient | typeof prisma

/** Origem de uma versão congelada. Descreve POR QUE ela nasceu. */
export type OrigemVersao = "CRIACAO" | "PUBLICACAO" | "BACKFILL"

/** Um passo como ele estava quando a versão foi congelada. */
export interface PassoCongelado {
  key: string
  label: string
  description: string | null
  ordem: number
  createsTask: boolean
  required: boolean
  owner: string | null
  priority: string
  slaDays: number
  cardinalidade: string | null
  completionRule: string | null
  checklist: unknown
  versao: number
  /// CONFIGURAÇÃO CADASTRADA, congelada junto. Sem isto, acrescentar um resultado em
  /// V2 apareceria dentro de um processo que roda V1 — que é a contaminação que o
  /// versionamento existe para impedir. A ação é dado; dado versionado vive aqui.
  executorKey: string | null
  dependeDe: string[]
  /// A política de reabertura da época. Congelada como o resto: mudar a política hoje
  /// não muda o que valia para uma execução que começou ontem.
  reaberturaPermitida: boolean
  reaberturaEstrategia: string
  reaberturaExigeJustificativa: boolean
  reaberturaPermissao: string | null
  acoes: AcaoCongelada[]
  campos: CampoCongelado[]
  checkItens: ItemChecklistCongelado[]
  canais: CanalCongelado[]
  requisitos: RequisitoCongelado[]
  /// A REGRA DE CONCLUSÃO da época. Mudar hoje "conclui quando todas as subtarefas
  /// obrigatórias estiverem feitas" não muda o que valia para quem já estava rodando.
  regraDeConclusao: string
  /// AS SUBTAREFAS como o passo as oferecia. Sem congelá-las, acrescentar uma em V2
  /// apareceria dentro de um processo que roda V1 — a mesma contaminação que o
  /// versionamento já impede um nível acima.
  subtarefas: SubtarefaCongelada[]
}

/// Uma subtarefa como ESTE passo a definia, com tudo o que era dela.
export interface SubtarefaCongelada {
  key: string
  label: string
  descricao: string | null
  ordem: number
  ativo: boolean
  obrigatoria: boolean
  repetivel: boolean
  maxOcorrencias: number | null
  modoExecucao: string
  responsavelRegra: string
  responsavelId: number | null
  slaDays: number | null
  condicaoEntrada: unknown
  condicaoConclusao: unknown
  condicaoVisibilidade: unknown
  dependeDe: string[]
  executorKey: string | null
  cardinalidade: string | null
  fonteDeCanais: string
  tiposDeCanal: string[]
  reaberturaPermitida: boolean | null
  reaberturaExigeJustificativa: boolean | null
  reaberturaPermissao: string | null
  /// Os filhos DELA — os que o passo tem para si ficam no passo.
  acoes: AcaoCongelada[]
  campos: CampoCongelado[]
  checkItens: ItemChecklistCongelado[]
  requisitos: RequisitoCongelado[]
}

/**
 * O CANAL DO PASSO, COM A EXIGÊNCIA JÁ RESOLVIDA — em UM lugar só.
 *
 * A EXIGÊNCIA DO PASSO SÓ ACRESCENTA. `null` = não decidiu, vale o catálogo; `true` =
 * soma. O passo nunca DISPENSA o que o canal exige de origem — se pudesse, um passo
 * mal configurado deixaria passar solicitação sem protocolo por um canal que só existe
 * com protocolo, e a exigência do catálogo viraria sugestão.
 *
 * Esta função existe porque a mesma conta era feita em dois lugares — aqui, ao
 * congelar, e no retrato da definição viva, para o diff. Duas contas para o mesmo fato
 * fazem a prévia mentir exatamente onde elas discordam.
 */
export function resolverCanalDoPasso(sc: {
  ordem: number
  ativo: boolean
  exigeProtocolo: boolean | null
  exigeAnexo: boolean | null
  exigeRastreio: boolean | null
  exigeObservacao: boolean | null
  camposObrigatorios: unknown
  condicao: unknown
  canal: {
    key: string; label: string; descricao: string | null; ativo: boolean
    protocoloObrigatorio: boolean; anexoObrigatorioLabel: string | null
    rastreioObrigatorio: boolean; observacaoObrigatoria: boolean
  }
}): CanalCongelado {
  return {
    key: sc.canal.key, label: sc.canal.label, descricao: sc.canal.descricao,
    ordem: sc.ordem, ativo: sc.ativo && sc.canal.ativo,
    exigeProtocolo: sc.exigeProtocolo === true || sc.canal.protocoloObrigatorio,
    exigeAnexo: sc.exigeAnexo === true || sc.canal.anexoObrigatorioLabel != null,
    anexoLabel: sc.canal.anexoObrigatorioLabel,
    exigeRastreio: sc.exigeRastreio === true || sc.canal.rastreioObrigatorio,
    exigeObservacao: sc.exigeObservacao === true || sc.canal.observacaoObrigatoria,
    camposObrigatorios: Array.isArray(sc.camposObrigatorios) ? (sc.camposObrigatorios as string[]) : [],
    condicao: sc.condicao ?? null,
  }
}

/// Um canal como ESTE passo o oferecia, com o que ele exigia aqui.
export interface CanalCongelado {
  key: string
  label: string
  descricao: string | null
  ordem: number
  ativo: boolean
  exigeProtocolo: boolean
  exigeAnexo: boolean
  anexoLabel: string | null
  exigeRastreio: boolean
  exigeObservacao: boolean
  camposObrigatorios: string[]
  condicao: unknown
}

export interface RequisitoCongelado {
  key: string
  label: string
  descricao: string | null
  tipo: string
  alvoKey: string | null
  minimo: number
  obrigatorio: boolean
  condicao: unknown
  acaoKey: string | null
  ordem: number
  ativo: boolean
  /// EVIDÊNCIA — qual documento mestre, que formatos, e em que momento é cobrada.
  evidenciaTipoId: number | null
  mimesPermitidos: string[] | null
  momento: string
}

export interface AcaoCongelada {
  key: string
  label: string
  descricao: string | null
  ordem: number
  effectKey: string
  requerCampos: string[]
  permissao: string | null
  condicao: unknown
  metadata: unknown
  ativo: boolean
}

export interface OpcaoCongelada {
  key: string
  label: string
  descricao: string | null
  ordem: number
  ativo: boolean
  condicao: unknown
}

export interface CampoCongelado {
  key: string
  label: string
  tipo: string
  obrigatorio: boolean
  /// Opções CADASTRADAS, com identidade. `opcoes` (JSON) segue como o formato antigo.
  opcoesCadastradas: OpcaoCongelada[]
  opcoes: unknown
  condicao: unknown
  ajuda: string | null
  ordem: number
  ativo: boolean
}

export interface ItemChecklistCongelado {
  key: string
  label: string
  descricao: string | null
  obrigatorio: boolean
  ordem: number
  ativo: boolean
}

export interface VersaoPublicada {
  workflowId: number
  versao: number
  phaseKey: string
  tipoProcessoId: number | null
  name: string
  execucao: string
  escopoExecucao: string | null
  familiaDocumentalId: number | null
  exigeDocumento: boolean
  exigePessoa: boolean
  pausarSlaEmEsperaExterna: boolean
  pausarSlaEmBloqueio: boolean
  passos: PassoCongelado[]
  congeladoEm: Date
  origem: string
}

/**
 * CONGELA a versão vigente de um workflow, se ela ainda não estiver congelada.
 *
 * Idempotente por construção: a chave `(workflowId, versao)` é única e o congelamento
 * usa `skipDuplicates`. Chamar duas vezes não cria duas linhas nem reescreve a
 * primeira — e não poderia: uma versão congelada é um fato passado.
 *
 * Devolve `true` quando esta chamada foi a que congelou.
 */
/**
 * O QUE PRECISA SER LIDO para montar o retrato de uma definição.
 *
 * Exportado porque o congelamento e a PRÉVIA DE PUBLICAÇÃO leem a mesma coisa: um
 * compara o congelado com o vivo, o outro grava o vivo. Dois `include` diferentes para
 * a mesma leitura fariam a prévia acusar mudança em campo que o congelamento nem lê.
 */
export const INCLUDE_DA_DEFINICAO = {
  orderBy: { ordem: "asc" },
  include: {
    acoes: { where: { subtaskId: null }, orderBy: { ordem: "asc" } },
    campos: { where: { subtaskId: null }, orderBy: { ordem: "asc" }, include: { opcoesCadastradas: { orderBy: { ordem: "asc" } } } },
    checkItens: { where: { subtaskId: null }, orderBy: { ordem: "asc" } },
    canais: { orderBy: { ordem: "asc" }, include: { canal: true } },
    requisitos: { where: { subtaskId: null }, orderBy: { ordem: "asc" } },
    subtarefas: {
      orderBy: { ordem: "asc" },
      include: {
        acoes: { orderBy: { ordem: "asc" } },
        campos: { orderBy: { ordem: "asc" }, include: { opcoesCadastradas: { orderBy: { ordem: "asc" } } } },
        checkItens: { orderBy: { ordem: "asc" } },
        requisitos: { orderBy: { ordem: "asc" } },
      },
    },
  },
} as const

// ── OS MAPEADORES SÃO COMPARTILHADOS ENTRE PASSO E SUBTAREFA ────────────────
//
// Campo, ação, checklist e requisito são a MESMA coisa nos dois lugares — o que muda
// é a quem pertencem. Duplicar o mapeamento faria a subtarefa congelar menos atributos
// que o passo, e a diferença só apareceria meses depois, num histórico incompleto.

function congelarAcao(a: {
  key: string; label: string; descricao: string | null; ordem: number; effectKey: string
  requerCampos: unknown; permissao: string | null; condicao: unknown; metadata: unknown; ativo: boolean
}): AcaoCongelada {
  return {
    key: a.key, label: a.label, descricao: a.descricao, ordem: a.ordem, effectKey: a.effectKey,
    requerCampos: Array.isArray(a.requerCampos) ? (a.requerCampos as string[]) : [],
    permissao: a.permissao, condicao: a.condicao ?? null, metadata: a.metadata ?? null,
    ativo: a.ativo,
  }
}

function congelarCampo(c: {
  key: string; label: string; tipo: string; obrigatorio: boolean; ajuda: string | null
  ordem: number; ativo: boolean; opcoes: unknown; condicao: unknown
  opcoesCadastradas: Array<{ key: string; label: string; descricao: string | null; ordem: number; ativo: boolean; condicao: unknown }>
}): CampoCongelado {
  return {
    key: c.key, label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio,
    opcoesCadastradas: c.opcoesCadastradas.map((o) => ({
      key: o.key, label: o.label, descricao: o.descricao, ordem: o.ordem,
      ativo: o.ativo, condicao: o.condicao ?? null,
    })),
    opcoes: c.opcoes ?? null, condicao: c.condicao ?? null, ajuda: c.ajuda,
    ordem: c.ordem, ativo: c.ativo,
  }
}

function congelarItem(i: {
  key: string; label: string; descricao: string | null; obrigatorio: boolean; ordem: number; ativo: boolean
}): ItemChecklistCongelado {
  return { key: i.key, label: i.label, descricao: i.descricao, obrigatorio: i.obrigatorio, ordem: i.ordem, ativo: i.ativo }
}

function congelarRequisito(r: {
  key: string; label: string; descricao: string | null; tipo: string; alvoKey: string | null
  minimo: number; obrigatorio: boolean; condicao: unknown; acaoKey: string | null
  ordem: number; ativo: boolean; evidenciaTipoId: number | null; mimesPermitidos: unknown; momento: string
}): RequisitoCongelado {
  return {
    key: r.key, label: r.label, descricao: r.descricao, tipo: r.tipo, alvoKey: r.alvoKey,
    minimo: r.minimo, obrigatorio: r.obrigatorio, condicao: r.condicao ?? null,
    acaoKey: r.acaoKey, ordem: r.ordem, ativo: r.ativo,
    evidenciaTipoId: r.evidenciaTipoId,
    mimesPermitidos: Array.isArray(r.mimesPermitidos) ? (r.mimesPermitidos as string[]) : null,
    momento: r.momento,
  }
}

/**
 * O RETRATO DE UMA DEFINIÇÃO — o mesmo formato do congelado, a partir do vivo.
 *
 * Exportado porque a prévia de publicação precisa comparar maçã com maçã: o congelado
 * de ontem contra o vivo de hoje. Antes cada lado montava o seu retrato, e a prévia
 * mentia exatamente nos atributos em que os dois discordavam.
 */
export function retratarPassos(passos: PassosComFilhos): PassoCongelado[] {
  return passos.map((p) => ({
    key: p.key, label: p.label, description: p.description, ordem: p.ordem,
    createsTask: p.createsTask, required: p.required, owner: p.owner,
    priority: p.priority, slaDays: p.slaDays, cardinalidade: p.cardinalidade,
    completionRule: p.completionRule, checklist: p.checklist ?? null, versao: p.versao,
    executorKey: p.executorKey,
    dependeDe: Array.isArray(p.dependeDe) ? (p.dependeDe as string[]) : [],
    reaberturaPermitida: p.reaberturaPermitida,
    reaberturaEstrategia: p.reaberturaEstrategia,
    reaberturaExigeJustificativa: p.reaberturaExigeJustificativa,
    reaberturaPermissao: p.reaberturaPermissao,
    regraDeConclusao: p.regraDeConclusao,
    subtarefas: p.subtarefas.map((st) => ({
      key: st.key, label: st.label, descricao: st.descricao, ordem: st.ordem, ativo: st.ativo,
      obrigatoria: st.obrigatoria, repetivel: st.repetivel, maxOcorrencias: st.maxOcorrencias,
      modoExecucao: st.modoExecucao, responsavelRegra: st.responsavelRegra,
      responsavelId: st.responsavelId, slaDays: st.slaDays,
      condicaoEntrada: st.condicaoEntrada ?? null,
      condicaoConclusao: st.condicaoConclusao ?? null,
      condicaoVisibilidade: st.condicaoVisibilidade ?? null,
      dependeDe: Array.isArray(st.dependeDe) ? (st.dependeDe as string[]) : [],
      executorKey: st.executorKey, cardinalidade: st.cardinalidade,
      fonteDeCanais: st.fonteDeCanais,
      tiposDeCanal: Array.isArray(st.tiposDeCanal) ? (st.tiposDeCanal as string[]) : [],
      reaberturaPermitida: st.reaberturaPermitida,
      reaberturaExigeJustificativa: st.reaberturaExigeJustificativa,
      reaberturaPermissao: st.reaberturaPermissao,
      acoes: st.acoes.map(congelarAcao),
      campos: st.campos.map(congelarCampo),
      checkItens: st.checkItens.map(congelarItem),
      requisitos: st.requisitos.map(congelarRequisito),
    })),
    acoes: p.acoes.map(congelarAcao),
    campos: p.campos.map(congelarCampo),
    // O CANAL É CONGELADO COM O QUE ELE EXIGIA. Inativar um canal no catálogo não pode
    // mudar o que uma execução antiga oferecia — nem apagar o que ela escolheu.
    canais: p.canais.map((sc) => resolverCanalDoPasso(sc)),
    requisitos: p.requisitos.map(congelarRequisito),
    checkItens: p.checkItens.map(congelarItem),
  }))
}

/** O tipo que `INCLUDE_DA_DEFINICAO` produz. */
export type PassosComFilhos = Prisma.PhaseInternalWorkflowStepGetPayload<typeof INCLUDE_DA_DEFINICAO>[]

export async function congelarVersaoVigente(
  workflowId: number,
  origem: OrigemVersao,
  db: DB = prisma,
  congeladoPorId?: number | null,
): Promise<boolean> {
  const wf = await db.phaseInternalWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      // OS FILHOS DO PASSO são os que NÃO pertencem a subtarefa nenhuma (ver
      // INCLUDE_DA_DEFINICAO). Sem esse filtro, um campo da subtarefa apareceria duas
      // vezes na versão congelada — uma como campo do passo, outra como campo dela.
      passos: INCLUDE_DA_DEFINICAO,
    },
  })
  if (!wf) return false

  const jaCongelada = await db.phaseInternalWorkflowVersao.findUnique({
    where: { workflowId_versao: { workflowId, versao: wf.versao } },
    select: { id: true },
  })
  if (jaCongelada) return false

  const passos = retratarPassos(wf.passos)

  const r = await db.phaseInternalWorkflowVersao.createMany({
    data: [{
      workflowId, versao: wf.versao, phaseKey: wf.phaseKey, tipoProcessoId: wf.tipoProcessoId,
      name: wf.name, execucao: wf.execucao, escopoExecucao: wf.escopoExecucao,
      familiaDocumentalId: wf.familiaDocumentalId, exigeDocumento: wf.exigeDocumento,
      exigePessoa: wf.exigePessoa, pausarSlaEmEsperaExterna: wf.pausarSlaEmEsperaExterna,
      pausarSlaEmBloqueio: wf.pausarSlaEmBloqueio,
      passos: passos as unknown as Prisma.InputJsonValue,
      congeladoPorId: congeladoPorId ?? null, origem,
    }],
    skipDuplicates: true,
  })
  return r.count > 0
}

/**
 * PUBLICA UMA NOVA VERSÃO: congela a vigente e incrementa o número.
 *
 * A ordem importa e é o coração do gate. Congelar ANTES de alterar é o que preserva
 * o que a versão anterior dizia; incrementar DEPOIS é o que faz as instâncias novas
 * nascerem apontando para outra coisa. Quem já estava em execução continua com o
 * número que registrou — e agora esse número tem conteúdo.
 *
 * Devolve o número da versão NOVA. O chamador aplica a edição na mesma transação,
 * entre o congelamento e o incremento não há janela: tudo é uma transação só.
 */
export async function publicarNovaVersao(
  workflowId: number,
  db: DB = prisma,
  congeladoPorId?: number | null,
): Promise<{ anterior: number; nova: number }> {
  await congelarVersaoVigente(workflowId, "PUBLICACAO", db, congeladoPorId)
  const wf = await db.phaseInternalWorkflow.update({
    where: { id: workflowId },
    data: { versao: { increment: 1 } },
    select: { versao: true },
  })
  return { anterior: wf.versao - 1, nova: wf.versao }
}

/**
 * O QUE A VERSÃO DIZIA. `null` quando aquela versão nunca foi congelada — caso que
 * o chamador precisa tratar explicitamente em vez de cair na definição viva, que é
 * exatamente o erro que este módulo existe para impedir.
 */
export async function lerVersaoPublicada(
  workflowId: number,
  versao: number,
  db: DB = prisma,
): Promise<VersaoPublicada | null> {
  const v = await db.phaseInternalWorkflowVersao.findUnique({
    where: { workflowId_versao: { workflowId, versao } },
  })
  if (!v) return null
  return {
    workflowId: v.workflowId, versao: v.versao, phaseKey: v.phaseKey,
    tipoProcessoId: v.tipoProcessoId, name: v.name, execucao: v.execucao,
    escopoExecucao: v.escopoExecucao, familiaDocumentalId: v.familiaDocumentalId,
    exigeDocumento: v.exigeDocumento, exigePessoa: v.exigePessoa,
    pausarSlaEmEsperaExterna: v.pausarSlaEmEsperaExterna,
    pausarSlaEmBloqueio: v.pausarSlaEmBloqueio,
    // VERSÃO CONGELADA ANTES DA CONFIGURAÇÃO CADASTRADA existe — as do Gate 1 não têm
    // ações, campos nem checklist. Lê-las como listas vazias é a resposta certa, e é
    // a verdade: naquela versão o cadastro não tinha nada disso. Não é fallback para
    // a definição viva, que é o que este módulo existe para impedir.
    passos: ((v.passos as unknown as Partial<PassoCongelado>[]) ?? []).map((p) => ({
      ...(p as PassoCongelado),
      executorKey: p.executorKey ?? null,
      dependeDe: Array.isArray(p.dependeDe) ? p.dependeDe : [],
      // VERSÃO CONGELADA ANTES DA POLÍTICA: `true`/`ESCOLHA_MANUAL` é o que valia
      // então — permitido, perguntando o que reabrir. Não é suposição: é o
      // comportamento que aquelas versões de fato tinham.
      reaberturaPermitida: p.reaberturaPermitida ?? true,
      reaberturaEstrategia: p.reaberturaEstrategia ?? "ESCOLHA_MANUAL",
      reaberturaExigeJustificativa: p.reaberturaExigeJustificativa ?? true,
      reaberturaPermissao: p.reaberturaPermissao ?? null,
      acoes: Array.isArray(p.acoes) ? p.acoes : [],
      campos: (Array.isArray(p.campos) ? p.campos : []).map((c) => ({
        ...(c as CampoCongelado),
        opcoesCadastradas: Array.isArray((c as CampoCongelado).opcoesCadastradas)
          ? (c as CampoCongelado).opcoesCadastradas : [],
      })),
      checkItens: Array.isArray(p.checkItens) ? p.checkItens : [],
      canais: Array.isArray(p.canais) ? p.canais : [],
      requisitos: Array.isArray(p.requisitos) ? p.requisitos : [],
    })),
    congeladoEm: v.congeladoEm, origem: v.origem,
  }
}

/**
 * A VERSÃO DE UMA INSTÂNCIA EM EXECUÇÃO — o atalho que os consumidores usam.
 *
 * Resolve pelo par que a instância já guarda. Devolve `null` se a instância não
 * registrou versão (dado anterior ao versionamento) ou se a versão não foi
 * congelada: nos dois casos, quem chama decide o que fazer, e a decisão fica visível
 * no código do chamador em vez de virar um fallback silencioso aqui.
 */
export async function versaoDaInstancia(
  workflowInstanceId: number,
  db: DB = prisma,
): Promise<VersaoPublicada | null> {
  const inst = await db.phaseWorkflowInstance.findUnique({
    where: { id: workflowInstanceId },
    select: { workflowDefinitionId: true, workflowVersion: true },
  })
  if (!inst?.workflowDefinitionId || inst.workflowVersion == null) return null
  return lerVersaoPublicada(inst.workflowDefinitionId, inst.workflowVersion, db)
}

/**
 * A DEFINIÇÃO HISTÓRICA DE UM PASSO — a que o originou, não a de hoje.
 *
 * `PhaseWorkflowStepInstance.stepDefinitionId` aponta para uma linha de
 * `PhaseInternalWorkflowStep` que a edição do workflow apaga e recria: publicar uma
 * versão nova deixava o ponteiro pendurado, e a instância histórica perdia a
 * definição que a gerou. Era a pendência declarada no Gate 1.
 *
 * A resposta não é ressuscitar a linha: é perguntar à VERSÃO CONGELADA da instância
 * — que existe desde o Gate 1 e é imutável — pelo passo com aquela `stepKey`. O
 * ponteiro frágil (id de linha) dá lugar ao par estável (versão, chave).
 *
 * `null` quando a instância não registra versão ou quando a versão não contém a
 * chave (passo removido numa publicação posterior — caso legítimo, e é justamente o
 * que o chamador precisa poder distinguir).
 */
export async function definicaoHistoricaDoPasso(
  stepInstanceId: number,
  db: DB = prisma,
): Promise<{ versao: number; passo: PassoCongelado } | null> {
  const passo = await db.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: { stepKey: true, workflowInstanceId: true },
  })
  if (!passo) return null
  const versao = await versaoDaInstancia(passo.workflowInstanceId, db)
  if (!versao) return null
  const def = versao.passos.find((p) => p.key === passo.stepKey)
  return def ? { versao: versao.versao, passo: def } : null
}
