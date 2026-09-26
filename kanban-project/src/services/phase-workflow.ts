// src/services/phase-workflow.ts
// CP-4B — serviço CANÔNICO de instanciação versionada de Workflow Interno → Passos.
//
// Só ESCREVE quando runtime v2 permitido (kill switch global) E Processo.workflowRuntime="v2".
// Falha => diagnóstico explícito, ZERO escrita, sem tocar legado, sem instância parcial.
// Idempotente (chaves determinísticas). Snapshot imutável/versionado. Transação única.
// NÃO cria Tarefa, NÃO sincroniza, NÃO avança fase, NÃO toca legado.

import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { Prisma, type PhaseWorkflowInstance, type PhaseWorkflowStepInstance, type StepInstanceStatus } from "@prisma/client"
import { resolveWorkflowRuntime } from "@/src/lib/workflow-runtime"
import { validarDefinicao } from "@/src/services/workflow-definition-validator"
import { exigirDocumentoNoPasso } from "@/src/services/invariante-documental"
import { phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { resolverEscopoDaFase } from "@/src/lib/process-stage/escopo-operacional-da-fase"
import { lerVersaoPublicada, resolverConteudoDaBiblioteca } from "@/src/services/versao-publicada"
import {
  type DefWorkflow,
  type DefStep,
  type WorkflowValidationIssue,
  montarChaveWorkflow,
  montarChavePasso,
  montarChaveEvento,
  mapearTipoPasso,
  construirSnapshotWorkflow,
  construirSnapshotPasso,
  normalizarModoExecucao,
  normalizarCardinalidade,
  type Cardinalidade,
} from "@/src/services/phase-workflow-helpers"
import { planejarMaterializacao, cardinalidadeEfetiva, type ContextoEscopo, type AlvoDePasso } from "@/src/services/phase-workflow-escopo"
import { itemCatalogosDeCertidao } from "@/src/lib/documentos/natureza-certidao"
import { garantirTentativa, MOTIVOS_DE_TENTATIVA } from "@/src/services/execucao-do-passo"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"
import type { PassoCongelado, SubtarefaCongelada } from "@/src/services/versao-publicada"
import { supersederPasso } from "@/src/services/task-step-sync"

export type OrigemInstanciaStr = "MOTOR" | "MANUAL" | "MIGRACAO" | "REABERTURA"

export interface InstanciarWorkflowDaFaseInput {
  processoId: number
  faseMacroKey: string
  faseMacroId?: number
  modoKey?: string
  ciclo?: number
  correlationId?: string
  causationId?: string
  origem?: OrigemInstanciaStr
  solicitadoPorId?: number
  /**
   * REABERTURA EXPLÍCITA: materializa a fase do zero, sem herdar o que a visita
   * anterior concluiu. Só a reabertura pede isso — reentrar numa fase (voltar,
   * retornar, avançar de novo) preserva o trabalho já feito.
   */
  reexecutarDoZero?: boolean
}

export type FailureCode =
  | "RUNTIME_V2_DESABILITADO"
  | "PROCESSO_LEGACY"
  | "WORKFLOW_NAO_ENCONTRADO"
  | "MODO_AMBIGUO"
  | "SEM_VERSAO_ATIVA"
  | "WORKFLOW_SEM_PASSOS"
  | "STEP_SEM_KEY"
  | "DEPENDENCIA_INVALIDA"
  | "CICLO_DE_DEPENDENCIA"
  | "CONFIGURACAO_TIPO_INVALIDA"
  | "CONFIGURACAO_INVALIDA"

export type InstanciarResultado =
  | {
      success: true
      created: boolean
      workflowInstance: PhaseWorkflowInstance
      stepInstances: PhaseWorkflowStepInstance[]
      warnings: WorkflowValidationIssue[]
      correlationId: string
    }
  | {
      success: false
      code: FailureCode
      errors: WorkflowValidationIssue[]
      correlationId: string
    }

const CODES = new Set<FailureCode>([
  "SEM_VERSAO_ATIVA", "WORKFLOW_SEM_PASSOS", "STEP_SEM_KEY", "DEPENDENCIA_INVALIDA",
  "CICLO_DE_DEPENDENCIA", "CONFIGURACAO_TIPO_INVALIDA", "CONFIGURACAO_INVALIDA",
])

/**
 * Resolve o Workflow Interno aplicável (precedência: tipo específico > 'all').
 *
 * `db` é OBRIGATORIAMENTE o cliente de quem chama. Quando a resolução acontece
 * DENTRO de uma transação já aberta (criação V2-nativa, avanço de fase), ler pelo
 * cliente global significa pedir uma SEGUNDA conexão enquanto a primeira está retida
 * pela transação. O pool por instância é pequeno e explícito (ver `connection_limit`
 * em lib/prisma.ts): a transação fica esperando uma conexão que pode não vir, consome
 * o `pool_timeout` e estoura — foi isso que derrubou "criar processo" e o avanço de
 * fase em produção, e pôs as demais requisições da instância na fila.
 *
 * Aumentar o pool alivia mas NÃO cura: N transações simultâneas pedindo uma conexão
 * extra cada esgotam qualquer N. A cura é a transação se bastar na própria conexão.
 *
 * Ler pela MESMA transação também é o correto do ponto de vista de consistência: é a
 * única forma de enxergar o que a própria transação acabou de escrever.
 */
export async function resolverWorkflowAplicavel(
  tipoProcessoId: number | null,
  faseMacroKey: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ workflow: DefWorkflow; steps: DefStep[] } | { erro: FailureCode; detalhe?: string }> {
  const base = { phaseKey: faseMacroKey, arquivado: false, active: true }
  // 1) específico do tipo
  let wf =
    tipoProcessoId != null
      ? await db.phaseInternalWorkflow.findFirst({ where: { ...base, tipoProcessoId } })
      : null
  // 2) fallback 'all'
  if (!wf) wf = await db.phaseInternalWorkflow.findFirst({ where: { ...base, tipoProcessoId: null } })
  if (!wf) {
    // DIAGNÓSTICO ADMINISTRATIVO EXPLÍCITO: a causa mais provável de "não achei o
    // workflow da fase" é um workflow publicado com phaseKey fora do catálogo oficial
    // (ex.: "retificacao" quando a fase canônica é "retificacao_registros"). Sem isto,
    // a fase apenas não materializa nada e o operador não tem como saber por quê.
    const candidatos = await db.phaseInternalWorkflow.findMany({
      where: { arquivado: false, active: true },
      select: { id: true, name: true, phaseKey: true },
    })
    const foraDoCatalogo = candidatos.filter((c) => phaseKeyToFaseCode(c.phaseKey) == null)
    const detalhe = foraDoCatalogo.length
      ? `Nenhum Workflow Interno publicado para a fase "${faseMacroKey}". Há ${foraDoCatalogo.length} workflow(s) publicado(s) com phaseKey fora do catálogo oficial de fases: ${foraDoCatalogo.map((c) => `#${c.id} "${c.name}" (phaseKey="${c.phaseKey}")`).join("; ")}. Corrija o cadastro para uma phaseKey do catálogo.`
      : `Nenhum Workflow Interno publicado para a fase "${faseMacroKey}".`
    return { erro: "WORKFLOW_NAO_ENCONTRADO", detalhe }
  }

  const passos = await db.phaseInternalWorkflowStep.findMany({
    where: { workflowId: wf.id },
    orderBy: { ordem: "asc" },
  })
  const workflow: DefWorkflow = {
    id: wf.id, wfUid: wf.wfUid, name: wf.name, phaseKey: wf.phaseKey,
    tipoProcessoId: wf.tipoProcessoId, versao: wf.versao, active: wf.active, arquivado: wf.arquivado,
    execucao: normalizarModoExecucao(wf.execucao),
  }
  const steps: DefStep[] = passos.map((p) => ({
    id: p.id, key: p.key, label: p.label, description: p.description, ordem: p.ordem,
    createsTask: p.createsTask, required: p.required, owner: p.owner, priority: p.priority,
    slaDays: p.slaDays, completionRule: p.completionRule, checklist: p.checklist, versao: p.versao,
    cardinalidade: normalizarCardinalidade(p.cardinalidade),
    tipo: null,
    // A DEPENDÊNCIA DECLARADA vem do cadastro; quando ela não existe, o modo de
    // execução responde no planejamento (phase-workflow-escopo). Aqui não se decide
    // nada — só se carrega o que foi declarado.
    dependeDe: Array.isArray(p.dependeDe) ? (p.dependeDe as string[]) : null,
    executorKey: p.executorKey,
    dependeDeStepKeys: null,
  }))

  // PASSO SELECIONADO DA BIBLIOTECA não tem conteúdo próprio — as colunas
  // acima (`label`, `slaDays`, `description`...) na linha viva de
  // `PhaseInternalWorkflowStep` NUNCA são sincronizadas depois da seleção
  // (mandato "separação Biblioteca × Workflow Interno", 22/09/2026): "a
  // fase e o passo são a única configuração que não vem do Modelo" — key/
  // ordem/dependeDe são do PASSO, o resto é do MODELO. Sem esta
  // substituição, toda materialização SEM rascunho pendente no Workflow
  // (o caminho comum) usava as colunas cruas, obsoletas desde a seleção —
  // achado real, produção, 23/09/2026: prazo do passo "Localizar registro"
  // materializava 0/null em vez do 1 dia configurado no Modelo, porque
  // `ancorarNaVersaoPublicada` só substitui quando há rascunho pendente NO
  // WORKFLOW (eixo diferente do rascunho do Modelo). Mesma fonte que
  // `retratarPassos` já usa para a versão congelada — aqui, para o caminho
  // vivo (validação e materialização sem rascunho).
  for (let i = 0; i < passos.length; i++) {
    const p = passos[i]
    if (p.bibliotecaModeloId == null || p.bibliotecaModeloVersao == null) continue
    const doModelo = await resolverConteudoDaBiblioteca(p.bibliotecaModeloId, p.bibliotecaModeloVersao, db)
    if (!doModelo) continue
    const local = steps[i]
    steps[i] = {
      ...local,
      label: doModelo.label, description: doModelo.description,
      createsTask: doModelo.createsTask, required: doModelo.required,
      owner: doModelo.owner, priority: doModelo.priority, slaDays: doModelo.slaDays,
      completionRule: doModelo.completionRule, checklist: doModelo.checklist,
      executorKey: doModelo.executorKey,
    }
  }

  // ANCORAR NA VERSÃO PUBLICADA SEMPRE — dentro da própria função, não como
  // um segundo passo que cada chamador precisa lembrar de dar. Achado real
  // 25/09/2026: só 2 dos 5 chamadores de `resolverWorkflowAplicavel` no
  // código faziam esse segundo passo (`ancorarNaVersaoPublicada`) depois de
  // chamar esta função — os outros 3 (`phase-simulation.ts`,
  // `workflow-activation.ts`, `materializar-genealogia.ts`) liam a tabela
  // viva direto, exposta a um rascunho pendente sem publicar. Dobrar a
  // chamada nos 2 que já a faziam é inofensivo (idempotente, mesmo `db`); os
  // outros 3 ganham a proteção sem precisar de nenhuma mudança própria.
  return ancorarNaVersaoPublicada({ workflow, steps }, db)
}

/**
 * ÂNCORA NA VERSÃO PUBLICADA — mandato Bloco 3 (rascunho/publicação), FECHADO
 * na Etapa 2/fechamento (26/09/2026): a ancoragem é INCONDICIONAL agora, não
 * mais "só quando há rascunho pendente".
 *
 * `resolverWorkflowAplicavel` lê `PhaseInternalWorkflowStep` — a definição VIVA,
 * que É o rascunho editável (comentário original de `publicacao-de-workflow.ts`:
 * "a definição viva SEMPRE foi o rascunho"). A versão anterior desta função só
 * ancorava quando `PhaseInternalWorkflow.rascunhoAlteradoEm` estava preenchido
 * — um atalho: "sem rascunho pendente, tabela viva e última publicação
 * coincidem, então ler a viva direto é grátis e sem risco". Essa premissa
 * FALHOU na prática: o editor pode escrever na tabela viva (ou zerá-la, como
 * em 24/09/2026) por um caminho que não atualiza `rascunhoAlteradoEm`
 * corretamente — e nesse instante a tabela viva deixa de coincidir com o
 * publicado SEM que o atalho perceba. FONTE DA VERDADE = versão publicada,
 * SEMPRE, é a única regra que não depende de mais ninguém lembrar de manter
 * uma flag em sincronia. O único caso em que ainda se cai na tabela viva é
 * "workflow nunca publicado" — aí não existe snapshot nenhum pra ancorar, e
 * a viva (o rascunho) é, por definição, a única fonte que já existe.
 *
 * Esta função ANCORA a materialização de uma instância NOVA na última versão
 * REALMENTE publicada, sempre: substitui o CONJUNTO de passos (quais existem, quantos, ordem, `slaDays` —
 * o campo do qual os 4 relógios do mandato dependem, Bloco 1/2) pelo
 * CONGELADO, e ancora `workflow.versao` na versão que o congelamento
 * comprova existir, nunca no contador "próxima versão" que
 * `PhaseInternalWorkflow.versao` passa a representar assim que alguém edita.
 *
 * Reconstrói a LISTA de passos a partir da versão congelada (`PassoCongelado`
 * já carrega tudo que `DefStep` precisa). `stepDefinitionId` é resolvido por
 * `key` contra a tabela viva quando uma linha ainda existe com essa chave;
 * quando não existe (passo removido/recriado numa edição posterior — o
 * comentário de `versaoDaInstancia` já documenta que esse ponteiro é
 * inerentemente frágil: TODA edição de workflow apaga e recria as linhas de
 * `PhaseInternalWorkflowStep`, mesmo sem trocar a versão publicada), cai para
 * `null` — a coluna é opcional e sem FK forte exatamente por isto; quem
 * resolve a definição de verdade em runtime é `versaoDaInstancia`/
 * `definicaoHistoricaDoPasso`, pelo par (versão, chave), nunca por este id.
 *
 * O QUE AINDA NÃO SE COBRE: ações/campos/canais/checklist/requisitos de CADA
 * passo continuam sendo lidos, em EXECUÇÃO, pelo par (workflowVersion, key)
 * via `definicaoHistoricaDoPasso` — e `workflowVersion` já vem ancorado aqui.
 * Ou seja: mesmo antes desta função existir, o conteúdo interno de cada passo
 * (o que a tela de execução cobra) já nunca vazava do rascunho — só o
 * CONJUNTO de passos vazava. Esta função fecha essa lacuna também.
 *
 * Sem rascunho pendente (`rascunhoAlteradoEm == null`), não há nada a
 * ancorar: devolve o resolvido tal como veio — é o caminho de sempre, sem
 * custo extra.
 */
async function ancorarNaVersaoPublicada(
  resolvido: { workflow: DefWorkflow; steps: DefStep[] },
  db: Prisma.TransactionClient | typeof prisma,
): Promise<{ workflow: DefWorkflow; steps: DefStep[] }> {
  const { workflow, steps } = resolvido

  const ultimaPublicada = await db.phaseInternalWorkflowVersao.findFirst({
    where: { workflowId: workflow.id },
    orderBy: { versao: "desc" },
    select: { versao: true },
  })
  // Workflow nunca publicado (raríssimo em produção: `active:true` sem NUNCA ter
  // passado por "Publicar") — não há para onde ancorar; segue o comportamento
  // anterior (a única opção honesta é usar o que existe).
  if (!ultimaPublicada) return resolvido

  const publicada = await lerVersaoPublicada(workflow.id, ultimaPublicada.versao, db)
  if (!publicada) return resolvido

  const idPorKey = new Map(steps.map((s) => [s.key, s.id]))
  const stepsAncorados: DefStep[] = publicada.passos
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => ({
      id: idPorKey.get(p.key) ?? 0,
      key: p.key, label: p.label, description: p.description, ordem: p.ordem,
      createsTask: p.createsTask, required: p.required, owner: p.owner, priority: p.priority,
      slaDays: p.slaDays, completionRule: p.completionRule, checklist: p.checklist, versao: p.versao,
      cardinalidade: normalizarCardinalidade(p.cardinalidade),
      tipo: null,
      dependeDe: Array.isArray(p.dependeDe) ? p.dependeDe : null,
      executorKey: p.executorKey,
      dependeDeStepKeys: null,
    }))

  return {
    // ETAPA 2b-EDITOR (fechamento, 26/09/2026): a ancoragem cobre também os
    // campos ESCALARES do workflow que a versão publicada congela
    // (`execucao`/`escopoExecucao`/`name`/`phaseKey`/`tipoProcessoId`/
    // `exigeDocumento`/`exigePessoa`) — antes só `versao` era substituída, e
    // um rascunho que mudasse "execução sequencial → paralela" (por
    // exemplo) sem publicar vazava pro runtime do mesmo jeito que os
    // Steps vazavam antes desta função existir. `wfUid`/`active`/
    // `arquivado` continuam vindo da tabela viva DE PROPÓSITO: não são
    // conteúdo de rascunho, são toggles administrativos que sempre valem
    // no instante em que são ligados, nunca versionados.
    workflow: {
      ...workflow,
      versao: ultimaPublicada.versao,
      name: publicada.name,
      phaseKey: publicada.phaseKey,
      tipoProcessoId: publicada.tipoProcessoId,
      execucao: normalizarModoExecucao(publicada.execucao),
      escopoExecucao: publicada.escopoExecucao,
      exigeDocumento: publicada.exigeDocumento,
      exigePessoa: publicada.exigePessoa,
    },
    steps: stepsAncorados,
  }
}

/**
 * Entidades do processo que servem de alvo aos passos escopados. Lida SEMPRE pelo
 * mesmo cliente da transação (ver nota de pool acima).
 *
 * Só é consultado o que algum passo publicado realmente pede: um workflow com todos
 * os passos GLOBAL não faz nenhuma query extra.
 */
async function carregarContextoEscopo(
  processoId: number,
  steps: DefStep[],
  escopoDaFase: Cardinalidade,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<{ ctx: ContextoEscopo; diagnosticos: WorkflowValidationIssue[] }> {
  const cards = new Set(steps.map((st) => cardinalidadeEfetiva(st.cardinalidade, escopoDaFase)))
  const ctx: ContextoEscopo = { pessoaIds: [], necessidadeIds: [], documentoIds: [], retificacaoPacoteIds: [], documentoIdPorNecessidade: new Map() }
  // DIAGNÓSTICO, não log: quando a fase não materializa nada, o motivo tem de chegar
  // até quem pediu a materialização — e daí até a tela. Um console.error aqui foi o
  // que deixou "0 documentos" sem explicação em produção.
  const diagnosticos: WorkflowValidationIssue[] = []
  if (cards.size === 1 && cards.has("PROCESSO")) return { ctx, diagnosticos }

  const proc = await db.processo.findUnique({ where: { id: processoId }, select: { arvoreId: true } })

  if (!proc?.arvoreId && (cards.has("PESSOA") || cards.has("NECESSIDADE") || cards.has("DOCUMENTO"))) {
    diagnosticos.push({
      code: "PROCESSO_SEM_ARVORE",
      message: "O processo ainda não tem árvore genealógica vinculada, e os passos publicados desta fase operam por entidade da árvore. Crie a árvore e cadastre as pessoas: a fase converge sozinha quando elas existirem.",
      entityType: "processo", entityId: processoId,
    })
  }

  if (cards.has("PESSOA") && proc?.arvoreId) {
    const pessoas = await db.pessoa.findMany({ where: { arvoreId: proc.arvoreId }, select: { id: true }, orderBy: { id: "asc" } })
    ctx.pessoaIds = pessoas.map((p) => p.id)
  }

  if (cards.has("NECESSIDADE")) {
    // ESTE BLOCO SÓ LÊ. Ele não cria obrigação documental.
    //
    // Antes, criava: chamava `garantirNecessidadesArvoreDoProcesso`
    // (analyzePessoa/DOCUMENT_RULES, regras hardcoded) e o comentário original
    // assumia que "as duas origens convivem na mesma NecessidadeDocumental".
    // Não conviviam. Cada motor gravava um `varianteKey` diferente para a mesma
    // exigência — "padrao" aqui, `rd:<regra>:v<versao>` no motor de Regras
    // Documentais — e a chave de idempotência, que inclui a variante, tratava as
    // duas como obrigações distintas. A mesma pessoa recebia a certidão duas
    // vezes, uma por motor.
    //
    // Quem cria é `materializarExecucaoDaFase` → `materializarGenealogia`, a
    // partir das Regras Documentais PUBLICADAS, ANTES da instanciação chegar
    // aqui. Fase sem alvo agora significa uma coisa só, e verdadeira: não há
    // regra publicada que se aplique.
    const certItens = await itemCatalogosDeCertidao(db)
    const necs = await db.necessidadeDocumental.findMany({
      where: { processoId, supersedePorId: null, status: { not: "DISPENSADA" } },
      select: { id: true, itemCatalogoId: true, documentos: { select: { id: true }, take: 1, orderBy: { id: "asc" } } },
      orderBy: { id: "asc" },
    })
    // Só CERTIDÕES entram como alvo de localização registral (natureza estruturada).
    const certidoes = necs.filter((n) => certItens.has(n.itemCatalogoId))
    ctx.necessidadeIds = certidoes.map((n) => n.id)
    for (const n of certidoes) if (n.documentos[0]) ctx.documentoIdPorNecessidade.set(n.id, n.documentos[0].id)

    if (certidoes.length === 0 && necs.length > 0) {
      diagnosticos.push({
        code: "NENHUMA_NECESSIDADE_DE_CERTIDAO",
        message: `O processo tem ${necs.length} exigência(s) documental(is), mas nenhuma delas é de natureza CERTIDÃO — e esta fase opera sobre registros/certidões. Confira a natureza dos tipos documentais.`,
        entityType: "processo", entityId: processoId,
      })
    }
  }

  if (cards.has("RETIFICACAO")) {
    // OS PEDIDOS ABERTOS. Um pacote validado ou bloqueado não é trabalho a fazer —
    // materializar passos para ele encheria a fila de etapas que já terminaram.
    const pacotes = await db.retificacaoPacote.findMany({
      where: { processoId, status: { notIn: ["validado", "cancelado"] } },
      select: { id: true }, orderBy: { id: "asc" },
    })
    ctx.retificacaoPacoteIds = pacotes.map((p) => p.id)
    if (pacotes.length === 0) {
      diagnosticos.push({
        code: "NENHUM_PEDIDO_DE_RETIFICACAO",
        message: "Esta fase opera por pedido de retificação e o processo não tem nenhum aberto. Abra o pedido com as divergências que entram nele: a fase converge sozinha quando ele existir.",
        entityType: "processo", entityId: processoId,
      })
    }
  }

  if (cards.has("DOCUMENTO") && proc?.arvoreId) {
    const docs = await db.documento.findMany({
      where: { pessoa: { arvoreId: proc.arvoreId }, status: { not: "CANCELADO" } },
      select: { id: true }, orderBy: { id: "asc" },
    })
    ctx.documentoIds = docs.map((d) => d.id)
  }
  return { ctx, diagnosticos }
}

/**
 * Cria as instâncias que faltam para os alvos planejados. CONVERGENTE: o que já
 * existe (mesma chave lógica) é recuperado, nunca duplicado — abrir/recarregar a
 * Central ou reexecutar a materialização não multiplica passo nem tarefa.
 */
async function materializarAlvos(
  tx: Prisma.TransactionClient,
  ctx: {
    instanciaId: number
    processoId: number
    faseMacroKey: string
    ciclo: number
    correlationId: string
    causationId: string
    instantiatedAt: string
    /** CONTRATO (Fatia 1): o workflow declarou que executa sobre documento? */
    exigeDocumento?: boolean
    /** Reabertura: não herda o estado da visita anterior (ver InstanciarWorkflowDaFaseInput). */
    reexecutarDoZero?: boolean
  },
  alvos: AlvoDePasso[],
): Promise<{ criados: PhaseWorkflowStepInstance[]; existentes: PhaseWorkflowStepInstance[] }> {
  const chaves = alvos.map((a) =>
    montarChavePasso({
      workflowInstanceId: ctx.instanciaId, stepDefinitionId: a.def.id, stepKey: a.def.key,
      stepDefinitionVersion: a.def.versao, ciclo: ctx.ciclo,
      documentoId: a.documentoId, pessoaId: a.pessoaId, necessidadeId: a.necessidadeId,
      retificacaoPacoteId: a.retificacaoPacoteId,
    }),
  )
  // CONVERGÊNCIA POR IDENTIDADE LÓGICA, não só pela string da chave. O passo de uma
  // necessidade pode ter sido criado por outro caminho oficial (a materialização
  // documental usa a chave `matdoc|...`). Reconhecer o que já existe pelo par
  // (stepKey, entidade, ciclo) é o que impede DUAS tarefas para o mesmo alvo.
  const jaExistem = alvos.length
    ? await tx.phaseWorkflowStepInstance.findMany({
        where: {
          workflowInstanceId: ctx.instanciaId,
          ciclo: ctx.ciclo,
          stepKey: { in: [...new Set(alvos.map((a) => a.def.key))] },
          status: { notIn: ["SUPERSEDIDO", "CANCELADO"] },
        },
      })
    : []
  const idLogica = (x: { stepKey: string; pessoaId: number | null; necessidadeId: number | null; documentoId: number | null; retificacaoPacoteId?: number | null }) =>
    `${x.stepKey}|p${x.pessoaId ?? "-"}|n${x.necessidadeId ?? "-"}|d${x.documentoId ?? "-"}|r${x.retificacaoPacoteId ?? "-"}`
  const porChave = new Map<string, (typeof jaExistem)[number]>()
  for (const e of jaExistem) {
    porChave.set(e.chaveIdempotencia, e)
    porChave.set(idLogica(e), e)
    // Passo criado por outro caminho ANTES de o Documento existir fica com
    // documentoId=null; o alvo atual já traz o Documento. É o mesmo trabalho.
    if (e.necessidadeId != null) porChave.set(`${e.stepKey}|p-|n${e.necessidadeId}|d-|r-`, e)
  }

  // ── REENTRADA NA FASE: o trabalho já feito da MESMA obrigação não recomeça ──
  //
  // Voltar a uma fase abre um CICLO novo — é assim que o sistema distingue "a fase"
  // de "esta passagem pela fase", e é o que permite ler cada visita separadamente.
  // Mas o ciclo é da VISITA; a unidade de trabalho é da OBRIGAÇÃO. Materializar o
  // ciclo novo do zero fazia a mesma certidão, com "solicitar" e "aguardar" já
  // concluídos, voltar a 0 de 5 — o operador perdia de vista trabalho que existiu, e
  // o gate passava a exigir de novo o que já tinha sido feito.
  //
  // Aqui o passo novo NASCE no estado terminal que o passo equivalente da visita
  // anterior alcançou. Equivalente = mesma fase, mesma stepKey, MESMA unidade
  // (necessidade/documento/pessoa). Só herda estado TERMINAL POSITIVO: concluído e
  // dispensado são trabalho feito; cancelado e supersedido não são, e obrigação nova
  // não tem de quem herdar — continua pendente, e a fase continua barrada por ela.
  const HERDAVEIS: StepInstanceStatus[] = ["CONCLUIDO", "DISPENSADO"]
  type Ancestral = { id: number; status: StepInstanceStatus; ciclo: number; startedAt: Date | null; completedAt: Date | null }
  const ancestrais = new Map<string, Ancestral>()
  if (ctx.ciclo > 1 && alvos.length > 0 && ctx.reexecutarDoZero !== true) {
    const anteriores = await tx.phaseWorkflowStepInstance.findMany({
      where: {
        processoId: ctx.processoId,
        faseMacroKey: ctx.faseMacroKey,
        ciclo: { lt: ctx.ciclo },
        stepKey: { in: [...new Set(alvos.map((a) => a.def.key))] },
        status: { in: HERDAVEIS },
      },
      select: {
        id: true, stepKey: true, ciclo: true, status: true, startedAt: true, completedAt: true,
        pessoaId: true, necessidadeId: true, documentoId: true, retificacaoPacoteId: true,
      },
      orderBy: { ciclo: "desc" },
    })
    // O ciclo MAIS RECENTE vence: se a mesma unidade passou por aqui três vezes, o que
    // vale é o último estado alcançado, não o primeiro.
    const guardar = (k: string, p: Ancestral) => { if (!ancestrais.has(k)) ancestrais.set(k, p) }
    for (const p of anteriores) {
      guardar(idLogica(p), p)
      // As duas tolerâncias do reconhecimento acima, na mesma direção: o passo de uma
      // visita pode ter nascido antes do Documento existir (ou depois), e continua
      // sendo a mesma obrigação.
      if (p.necessidadeId != null) guardar(`${p.stepKey}|n${p.necessidadeId}`, p)
      if (p.documentoId != null) guardar(`${p.stepKey}|d${p.documentoId}`, p)
    }
  }
  const acharAncestral = (a: AlvoDePasso): Ancestral | undefined =>
    ancestrais.get(idLogica({ stepKey: a.def.key, pessoaId: a.pessoaId, necessidadeId: a.necessidadeId, documentoId: a.documentoId, retificacaoPacoteId: a.retificacaoPacoteId })) ??
    (a.necessidadeId != null ? ancestrais.get(`${a.def.key}|n${a.necessidadeId}`) : undefined) ??
    (a.documentoId != null ? ancestrais.get(`${a.def.key}|d${a.documentoId}`) : undefined)

  // ── ONDE A FILA COMEÇA, QUANDO A FASE NÃO COMEÇA DO ZERO ──────────────────
  // O plano de materialização descreve uma fase que começa do zero: no SEQUENCIAL só
  // o primeiro passo nasce DISPONÍVEL e os demais dependem do anterior. Há dois casos
  // legítimos em que ela não começa do zero — a REENTRADA, onde os primeiros passos
  // nascem herdados como concluídos, e a OBRIGAÇÃO NOVA, publicada depois numa fase
  // cujos passos anteriores já estão feitos. Nos dois, o plano cru abriria a fase sem
  // nada executável: trabalho parado que ninguém pode pegar.
  //
  // A correção é do STATUS INICIAL, decidida aqui, antes de criar — e não uma
  // transição depois. Passo criado não é passo movido: quem move passo é a máquina de
  // passos, e ela continua sendo a única.
  const chaveDaUnidade = (x: { pessoaId: number | null; necessidadeId: number | null; documentoId: number | null }) =>
    `p${x.pessoaId ?? "-"}|n${x.necessidadeId ?? "-"}|d${x.documentoId ?? "-"}`
  const statusInicial = new Map<AlvoDePasso, string>()
  {
    const porUnidade = new Map<string, AlvoDePasso[]>()
    for (const a of alvos) {
      const k = chaveDaUnidade(a)
      porUnidade.set(k, [...(porUnidade.get(k) ?? []), a])
    }
    for (const [unidade, daUnidade] of porUnidade) {
      // O que JÁ está feito nesta unidade: o herdado da visita anterior mais o que
      // já existe neste ciclo (caso da obrigação publicada depois).
      const feito = new Set<string>()
      for (const a of daUnidade) {
        const h = acharAncestral(a)
        if (h) feito.add(a.def.key)
      }
      for (const e of jaExistem) {
        if (chaveDaUnidade(e) === unidade && HERDAVEIS.includes(e.status)) feito.add(e.stepKey)
      }
      if (feito.size === 0) continue // fase que começa do zero: o plano já está certo
      const ordenados = [...daUnidade].sort((x, y) => x.def.ordem - y.def.ordem)
      const proximo = ordenados.find(
        (a) => !feito.has(a.def.key) && a.status === "PENDENTE" && a.dependeDeStepKeys.every((k) => feito.has(k)),
      )
      if (proximo) statusInicial.set(proximo, "DISPONIVEL")
    }
  }

  const criados: PhaseWorkflowStepInstance[] = []
  const existentes: PhaseWorkflowStepInstance[] = []
  /** Unidades que herdaram algo — usado no diagnóstico da materialização. */
  const unidadesHerdadas = new Set<string>()

  for (let i = 0; i < alvos.length; i++) {
    const a = alvos[i]
    const chavePasso = chaves[i]
    const existente =
      porChave.get(chavePasso) ??
      porChave.get(idLogica({ stepKey: a.def.key, pessoaId: a.pessoaId, necessidadeId: a.necessidadeId, documentoId: a.documentoId, retificacaoPacoteId: a.retificacaoPacoteId })) ??
      (a.necessidadeId != null ? porChave.get(`${a.def.key}|p-|n${a.necessidadeId}|d-`) : undefined)
    if (existente) { existentes.push(existente); continue }

    // INVARIANTE DOCUMENTAL — workflow que declarou exigir documento não
    // materializa passo sem documento. Aborta a transação inteira: passo órfão
    // não é meio-certo, é um passo que a Central não agrupa e o operador não
    // executa. Workflow que não assinou o contrato segue como antes.
    exigirDocumentoNoPasso({
      workflowExigeDocumento: ctx.exigeDocumento === true,
      stepKey: a.def.key,
      documentoId: a.documentoId,
      processoId: ctx.processoId,
    })

    const tipoRes = mapearTipoPasso(a.def)
    // O estado herdado da visita anterior, quando existe (ver bloco REENTRADA acima).
    const herdado = acharAncestral(a)
    if (herdado) unidadesHerdadas.add(`p${a.pessoaId ?? "-"}|n${a.necessidadeId ?? "-"}|d${a.documentoId ?? "-"}`)
    const si = await tx.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: ctx.instanciaId,
        stepDefinitionId: a.def.id,
        stepDefinitionVersion: a.def.versao,
        stepKey: a.def.key,
        snapshot: construirSnapshotPasso(a.def, {
          tipo: tipoRes.tipo, dependeDeStepKeys: a.dependeDeStepKeys, instantiatedAt: ctx.instantiatedAt,
        }) as Prisma.InputJsonValue,
        snapshotSchemaVersion: 1,
        processoId: ctx.processoId,
        faseMacroKey: ctx.faseMacroKey,
        ordem: a.def.ordem,
        tipo: tipoRes.tipo,
        obrigatorio: a.def.required,
        geraTarefa: a.def.createsTask,
        ciclo: ctx.ciclo,
        // HERANÇA DE REENTRADA: nasce onde a visita anterior parou, ou no estado
        // planejado quando não há de quem herdar.
        status: (herdado ? herdado.status : statusInicial.get(a) ?? a.status) as StepInstanceStatus,
        startedAt: herdado?.startedAt ?? null,
        completedAt: herdado?.completedAt ?? null,
        metadata: herdado
          ? ({ reentrada: { herdadoDoPassoId: herdado.id, cicloAnterior: herdado.ciclo, status: herdado.status } } as Prisma.InputJsonValue)
          : undefined,
        prioridade: a.def.priority,
        papel: a.def.owner ?? null,
        slaDays: a.def.slaDays,
        // ENTIDADE DO ESCOPO — persistida na instância, não deduzida depois.
        pessoaId: a.pessoaId,
        necessidadeId: a.necessidadeId,
        documentoId: a.documentoId,
        retificacaoPacoteId: a.retificacaoPacoteId,
        dependeDeStepKeys: a.dependeDeStepKeys,
        chaveIdempotencia: chavePasso,
        correlationId: ctx.correlationId,
        causationId: ctx.causationId,
      },
    })
    criados.push(si)

    // A OBRIGAÇÃO NASCE COM A PRIMEIRA TENTATIVA. Um passo sem tentativa seria uma
    // obrigação sobre a qual não se pode dizer nada — nem que ninguém a tentou.
    // Passo herdado nasce com a tentativa já concluída: o trabalho é da visita
    // anterior, e a linhagem fica em `motivo`.
    await garantirTentativa(si.id, {
      motivo: herdado ? MOTIVOS_DE_TENTATIVA.BACKFILL : MOTIVOS_DE_TENTATIVA.ABERTURA,
      status: si.status,
      startedAt: si.startedAt,
      completedAt: si.completedAt,
    }, tx)

    await tx.workflowEvento.createMany({
      skipDuplicates: true,
      data: {
        tipo: "PASSO_INSTANCIADO", entityType: "step_instance", entityId: si.id,
        processoId: ctx.processoId, workflowInstanceId: ctx.instanciaId, stepInstanceId: si.id,
        correlationId: ctx.correlationId, causationId: ctx.causationId,
        chaveIdempotencia: montarChaveEvento({
          correlationId: ctx.correlationId, tipo: "PASSO_INSTANCIADO",
          entityType: "step_instance", entityId: si.id, operationKey: chavePasso,
        }),
        dados: {
          stepKey: a.def.key, ordem: a.def.ordem, tipo: tipoRes.tipo, ciclo: ctx.ciclo,
          cardinalidade: a.cardinalidade, pessoaId: a.pessoaId, necessidadeId: a.necessidadeId, documentoId: a.documentoId,
          retificacaoPacoteId: a.retificacaoPacoteId,
          // CAUSALIDADE DA HERANÇA — o histórico precisa dizer que este passo nasceu
          // concluído porque a visita anterior o concluiu, e de qual passo veio.
          ...(herdado ? { herdadoDoPassoId: herdado.id, herdadoDoCiclo: herdado.ciclo, herdadoStatus: herdado.status } : {}),
        },
      },
    })
  }

  return { criados, existentes }
}

export async function instanciarWorkflowDaFase(
  input: InstanciarWorkflowDaFaseInput,
  txExterno?: Prisma.TransactionClient
): Promise<InstanciarResultado> {
  const correlationId = input.correlationId ?? randomUUID()
  const ciclo = input.ciclo && input.ciclo > 0 ? input.ciclo : 1
  const origem: OrigemInstanciaStr = input.origem ?? "MOTOR"

  const fail = (code: FailureCode, errors: WorkflowValidationIssue[] = []): InstanciarResultado => ({
    success: false, code, errors, correlationId,
  })

  // Leituras via txExterno quando fornecido: permite compor DENTRO de uma transação
  // já aberta e enxergar o Processo recém-criado (criação V2-nativa) ou recém-mudado.
  const db = txExterno ?? prisma

  // 1) runtime + feature flag (só escreve com v2 permitido)
  const processo = await db.processo.findUnique({
    where: { id: input.processoId },
    select: { id: true, workflowRuntime: true, tipoProcessoMotorId: true },
  })
  if (!processo) return fail("CONFIGURACAO_INVALIDA", [{ code: "PROCESSO_NAO_ENCONTRADO", message: "Processo inexistente" }])

  const cfg = await db.motorConfig.findUnique({ where: { id: 1 }, select: { runtimeV2Habilitado: true } })
  const runtime = resolveWorkflowRuntime(processo.workflowRuntime, cfg?.runtimeV2Habilitado ?? false)
  if (!(cfg?.runtimeV2Habilitado ?? false)) return fail("RUNTIME_V2_DESABILITADO")
  if (runtime !== "v2") return fail("PROCESSO_LEGACY")

  // 2) fase macro (identidade estável + versão)
  const fase = await db.faseMacro.findFirst({
    where: { phaseKey: input.faseMacroKey, macroWorkflow: { tipoProcessoId: processo.tipoProcessoMotorId ?? -1 } },
    select: { id: true, versao: true, macroWorkflow: { select: { id: true, versao: true } } },
  })
  if (!fase) return fail("CONFIGURACAO_INVALIDA", [{ code: "FASE_MACRO_INVALIDA", message: `Fase ${input.faseMacroKey} inexistente no macro do processo` }])

  // 3) workflow aplicável — pelo MESMO cliente das leituras acima (`db`). Sob txExterno
  //    isso é o que impede a segunda conexão (e o deadlock com connection_limit=1).
  const resolvido = await resolverWorkflowAplicavel(processo.tipoProcessoMotorId, input.faseMacroKey, db)
  if ("erro" in resolvido) {
    return fail(resolvido.erro, resolvido.detalhe
      ? [{ code: resolvido.erro, message: resolvido.detalhe, entityType: "fase", entityId: input.faseMacroKey }]
      : [])
  }
  // `resolverWorkflowAplicavel` já ancora na versão publicada por dentro —
  // nenhum segundo passo aqui (achado 25/09/2026, ver comentário na função).
  const { workflow, steps } = resolvido

  // 4) validação completa da definição ANTES de escrever
  const val = validarDefinicao(workflow, steps)
  if (!val.valid) {
    const primeiro = val.errors[0]?.code as FailureCode | undefined
    const code: FailureCode = primeiro && CODES.has(primeiro) ? primeiro : "CONFIGURACAO_INVALIDA"
    return fail(code, val.errors)
  }

  // 5) chave de idempotência do workflow
  const chaveWorkflow = montarChaveWorkflow({
    processoId: processo.id, faseMacroId: fase.id, faseMacroKey: input.faseMacroKey,
    faseMacroVersion: fase.versao, workflowDefinitionId: workflow.id, workflowVersion: workflow.versao, ciclo,
  })
  const instantiatedAt = new Date().toISOString()

  // 6) transação única (rollback integral em falha).
  // txExterno: compõe DENTRO de uma transação já aberta (ex.: PhaseAdvanceService).
  // PLANO DE MATERIALIZAÇÃO — o que a CONFIGURAÇÃO publicada manda existir.
  // Calculado antes da transação de escrita e reusado pelos dois caminhos (instância
  // nova e instância já existente), para que os dois convirjam para o mesmo estado.
  // ESCOPO OPERACIONAL da fase: a declaração oficial de por qual entidade ela opera.
  // Vem do catálogo em código quando a fase é uma das canônicas e do CADASTRO quando
  // ela foi criada por lá — é o que permite uma fase nascer sem alteração de código e
  // ainda assim materializar certo. O passo pode sobrepor no cadastro dele; sem
  // sobreposição, herda daqui. Fase que não declarou escopo em lugar nenhum cai em
  // PROCESSO (1 instância por fase/ciclo), que é o mínimo que não inventa entidade.
  const escopoDaFase: Cardinalidade =
    ((await resolverEscopoDaFase(input.faseMacroKey, db)) as Cardinalidade | null) ?? "PROCESSO"
  const { ctx: ctxEscopo, diagnosticos: diagEscopo } = await carregarContextoEscopo(processo.id, steps, escopoDaFase, db)
  const plano = planejarMaterializacao(steps, workflow.execucao, escopoDaFase, ctxEscopo)
  const avisos = [...val.warnings, ...diagEscopo, ...plano.avisos]

  const corpo = async (tx: Prisma.TransactionClient): Promise<InstanciarResultado> => {
      const existente = await tx.phaseWorkflowInstance.findUnique({ where: { chaveIdempotencia: chaveWorkflow } })
      if (existente) {
        // CONVERGÊNCIA: a instância da fase já existe, mas pode ter nascido sob uma
        // regra que descartava os passos publicados (ver `resolverWorkflowAplicavel`
        // e o histórico desta função). Reexecutar completa o que falta — sem duplicar
        // o que existe, sem tocar em passo já em andamento ou concluído.
        const r = await materializarAlvos(
          tx,
          {
            instanciaId: existente.id, processoId: processo.id, faseMacroKey: input.faseMacroKey,
            ciclo: existente.ciclo, correlationId, causationId: chaveWorkflow, instantiatedAt,
            exigeDocumento: workflow.exigeDocumento === true,
            reexecutarDoZero: input.reexecutarDoZero === true,
          },
          plano.alvos,
        )
        const stepInstances = await tx.phaseWorkflowStepInstance.findMany({
          where: { workflowInstanceId: existente.id }, orderBy: { ordem: "asc" },
        })
        return {
          success: true, created: r.criados.length > 0, workflowInstance: existente,
          stepInstances, warnings: avisos, correlationId,
        }
      }

      const instancia = await tx.phaseWorkflowInstance.create({
        data: {
          processoId: processo.id,
          faseMacroKey: input.faseMacroKey,
          faseMacroId: fase.id,
          faseMacroVersion: fase.versao,
          macroWorkflowId: fase.macroWorkflow.id,
          macroVersion: fase.macroWorkflow.versao,
          workflowDefinitionId: workflow.id,
          workflowVersion: workflow.versao,
          snapshot: construirSnapshotWorkflow({
            workflowDefinitionId: workflow.id, workflowVersion: workflow.versao, name: workflow.name,
            faseMacroId: fase.id, faseMacroKey: input.faseMacroKey, faseMacroVersion: fase.versao,
            modoKey: input.modoKey ?? null, tipoProcessoId: workflow.tipoProcessoId, instantiatedAt,
          }) as Prisma.InputJsonValue,
          snapshotSchemaVersion: 1,
          ciclo,
          status: "ATIVO", // nasce ATIVO (decisão 8) — tudo numa transação
          origem,
          instanciadoPor: input.solicitadoPorId != null ? String(input.solicitadoPorId) : "MOTOR",
          correlationId,
          causationId: input.causationId ?? null,
          chaveIdempotencia: chaveWorkflow,
        },
      })

      // MATERIALIZAÇÃO PELA CONFIGURAÇÃO PUBLICADA.
      //
      // Antes, fases operadas por entidade (kind="documento") NÃO instanciavam os
      // passos do template — a aposta era que eles nasceriam por-entidade na
      // materialização documental. Quando nenhuma Regra Documental está publicada,
      // essa materialização não roda e a fase fica ATIVA com ZERO passos: o passo
      // configurado ("gera tarefa", obrigatório, com SLA) simplesmente não existia.
      //
      // Agora quem decide é o cadastro: cada passo publicado vira instância conforme
      // o ESCOPO persistido nele, e a ordem/liberação segue o MODO DE EXECUÇÃO
      // persistido no workflow. Passo GLOBAL existe mesmo sem pessoa, sem necessidade
      // documental e sem documento. Passos genéricos que não pertencem ao gate da
      // fase seguem filtrados na leitura por `resolvePassosBloqueantesDaFase` — a
      // proteção contra a "esteira paralela" continua valendo, e no lugar certo.
      const r = await materializarAlvos(
        tx,
        {
          instanciaId: instancia.id, processoId: processo.id, faseMacroKey: input.faseMacroKey,
          ciclo, correlationId, causationId: chaveWorkflow, instantiatedAt,
          exigeDocumento: workflow.exigeDocumento === true,
          reexecutarDoZero: input.reexecutarDoZero === true,
        },
        plano.alvos,
      )
      const stepInstances: PhaseWorkflowStepInstance[] = [...r.criados, ...r.existentes]

      // Evento e outbox do workflow (mesma transação)
      await tx.workflowEvento.create({
        data: {
          tipo: "WORKFLOW_INSTANCIADO", entityType: "workflow_instance", entityId: instancia.id,
          processoId: processo.id, workflowInstanceId: instancia.id,
          correlationId, causationId: input.causationId ?? null,
          chaveIdempotencia: montarChaveEvento({ correlationId, tipo: "WORKFLOW_INSTANCIADO", entityType: "workflow_instance", entityId: instancia.id, operationKey: chaveWorkflow }),
          dados: { faseMacroKey: input.faseMacroKey, ciclo, steps: stepInstances.map((s) => ({ id: s.id, stepKey: s.stepKey })) },
        },
      })
      await tx.domainOutbox.create({
        data: {
          tipo: "phase-workflow.instanced", aggregateType: "PhaseWorkflowInstance", aggregateId: instancia.id,
          correlationId, causationId: input.causationId ?? null,
          chaveIdempotencia: `outbox|${chaveWorkflow}`,
          payload: {
            processoId: processo.id, faseMacroKey: input.faseMacroKey, ciclo,
            workflowInstanceId: instancia.id, stepInstanceIds: stepInstances.map((s) => s.id),
            stepKeys: stepInstances.map((s) => s.stepKey), workflowVersion: workflow.versao,
          },
        },
      })

      // `avisos`, não `val.warnings`: o ramo que CRIA a instância é justamente onde os
      // motivos de "nenhum alvo" nascem. Devolver só os avisos de validação da
      // definição fazia a informação decisiva morrer aqui dentro.
      return { success: true, created: true, workflowInstance: instancia, stepInstances, warnings: avisos, correlationId }
  }
  try {
    // timeout maior que o padrão (5s) — a distância real até o banco pooled já
    // fez esta transação estourar por RTT puro, sem nada de errado no trabalho
    // em si (achado real, recorrente nesta sessão: P2028 "Transaction already
    // closed" contra o banco remoto).
    return txExterno ? await corpo(txExterno) : await prisma.$transaction(corpo, { timeout: 15_000 })
  } catch (e) {
    // Concorrência: unique da chave do workflow → converge (só no modo standalone;
    // sob txExterno, propaga para o chamador tratar como conflito e dar rollback).
    if (!txExterno && (e as { code?: string })?.code === "P2002") {
      const existente = await prisma.phaseWorkflowInstance.findUnique({ where: { chaveIdempotencia: chaveWorkflow } })
      if (existente) {
        const stepInstances = await prisma.phaseWorkflowStepInstance.findMany({
          where: { workflowInstanceId: existente.id }, orderBy: { ordem: "asc" },
        })
        return { success: true, created: false, workflowInstance: existente, stepInstances, warnings: avisos, correlationId }
      }
    }
    throw e
  }
}

export interface ReconciliarInstanciaAtualInput {
  processoId: number
  faseMacroKey: string
  correlationId?: string
  causationId?: string
}

export type ReconciliarInstanciaAtualMotivo =
  | "SEM_INSTANCIA_ABERTA"
  | "SEM_VERSAO_REGISTRADA"
  | "WORKFLOW_MUDOU_DE_IDENTIDADE"
  | "VERSAO_ANTIGA_NAO_CONGELADA"
  | "SEM_TRABALHO_NOVO"
  | "CONFLITO_DADOS_EXISTENTES"

/** UM conflito nomeado — o quê, em qual passo/subtarefa, e por quê não é seguro aplicar. */
export interface ConflitoDeReconciliacao {
  stepKey: string
  subtaskKey?: string
  campo: string
  detalhe: string
}

export type ReconciliarInstanciaAtualResultado =
  | {
      success: true; aplicado: true; workflowInstanceId: number
      versaoAnterior: number; versaoNova: number; passosCriados: number
      passosAtualizados: number; subtarefasRetiradas: number; prazosRecalculados: number
      stepInstances: PhaseWorkflowStepInstance[]; correlationId: string
    }
  | { success: true; aplicado: false; motivo: "CONFLITO_DADOS_EXISTENTES"; conflitos: ConflitoDeReconciliacao[]; detalhe: string; correlationId: string }
  | { success: true; aplicado: false; motivo: Exclude<ReconciliarInstanciaAtualMotivo, "CONFLITO_DADOS_EXISTENTES">; detalhe?: string; correlationId: string }
  | { success: false; code: FailureCode; errors: WorkflowValidationIssue[]; correlationId: string }

/** Campos do passo congelado fora de `subtarefas`/`slaDays` — os dois têm regra própria (ver função principal). */
function semSubtarefasNemSla(p: PassoCongelado): Omit<PassoCongelado, "subtarefas" | "slaDays"> {
  const { subtarefas: _subtarefas, slaDays: _slaDays, ...resto } = p
  return resto
}

/**
 * `executorKey` só escolhe QUAL EDITOR renderiza a subtarefa — nunca grava,
 * apaga nem reinterpreta um dado já registrado (ver `subtarefasDaEtapa`: a
 * definição é lida ao vivo pela versão do passo a cada render; trocar o
 * executor não reescreve `SubtaskExecution` nenhuma). Por isso é tratado
 * como campo SEGURO (mesmo grupo do `slaDays` acima) — mudar só ele nunca
 * é "conflito com trabalho já executado" (regra 23/09/2026: fase atual
 * recebe mudança segura automaticamente; só conflito real de dado bloqueia).
 * Achado real 23/09/2026: comparar a subtarefa inteira travava o cadastro
 * dos 4 editores especializados de "Solicitar certidão" no único processo
 * real em andamento, mesmo sem overwrite nenhum de dado.
 */
function semExecutorKey(s: SubtarefaCongelada): Omit<SubtarefaCongelada, "executorKey"> {
  const { executorKey: _executorKey, ...resto } = s
  return resto
}

interface MudancaDeSla {
  stepInstanceId: number
  stepKey: string
  slaAntigo: number | null
  slaNovo: number | null
}

interface PassoAlterado {
  stepInstanceId: number
  stepKey: string
  depois: PassoCongelado
}

interface SubtarefaRetirada {
  stepInstanceId: number
  stepKey: string
  subtaskKey: string
}

/**
 * APLICA UMA VERSÃO NOVA de Workflow Interno à instância JÁ ABERTA da fase ATUAL
 * de um processo em andamento — mandato "regra única de prazo" (23/09/2026),
 * item "mudança precisa valer para processos em andamento", ampliado em
 * 23/09/2026 (item "complete a atualização automática") para tratar EDIÇÃO e
 * REMOÇÃO, não só ADIÇÃO.
 *
 * NÃO usa o caminho de `instanciarWorkflowDaFase` para isso: a chave de
 * idempotência dele (`montarChaveWorkflow`) inclui `workflowVersion`, então
 * publicar uma versão nova por cima de uma fase já materializada nunca bate
 * com a instância existente e cria uma SEGUNDA `PhaseWorkflowInstance`/Tarefa
 * em paralelo — bug real, reproduzido e corrigido em produção nos processos
 * 632/633/635/637 (ver `src/lib/motor/reconciliar-fase-macro.ts`, linhas
 * 368-384). Esta função resolve a instância pela POSIÇÃO (processo × fase,
 * status aberto), não pela chave versionada.
 *
 * ─── A TRAVA (por que existia) ───────────────────────────────────────────
 * `definicaoHistoricaDoPasso` resolve TODOS os passos de uma instância pelo
 * MESMO `workflowVersion` dela (par instância→versão, não passo→versão) —
 * bumpar essa coluna muda, de uma vez, o que TODOS os passos daquela
 * instância leem (ações, campos, canais, checklist, subtarefas). A versão
 * anterior desta função por isso recusava a publicação inteira sempre que
 * qualquer passo já materializado tinha mudado — mesmo quando a mudança era
 * inofensiva (ninguém tinha tocado o que mudou).
 *
 * ─── A ATUALIZAÇÃO SEGURA (o que esta versão faz) ────────────────────────
 * Em vez de recusar por inteiro, classifica CADA passo materializado (não
 * SUPERSEDIDO/CANCELADO) e cada subtarefa dele, campo a campo:
 *
 *   • SLA (`slaDays`) muda → SEMPRE seguro. A Tarefa viva ancorada naquele
 *     passo tem `dataPrazo` recalculado com o SLA novo a partir da MESMA
 *     origem que gerou o prazo atual (`Tarefa.createdAt` — "a origem
 *     original da contagem", nunca "agora"). Só recalcula se o valor atual
 *     bater exatamente com o que o SLA antigo produziria a partir dessa
 *     origem — divergindo (um ajuste manual, hoje sem UI própria, mas a
 *     trava já existe para quando existir), vira conflito em vez de
 *     sobrescrever silenciosamente.
 *   • Outro conteúdo do passo (rótulo, descrição, prioridade, ações, campos,
 *     canais, checklist, requisitos, regra de conclusão) muda → seguro
 *     SOMENTE se o passo nunca teve execução real iniciada (`startedAt ==
 *     null` E nenhuma Tarefa viva ancorada nele) — inofensivo, porque nada
 *     foi preenchido sob a definição antiga ainda.
 *   • Subtarefa NOVA (chave só existe na versão nova) → sempre segura,
 *     aditiva.
 *   • Subtarefa ALTERADA ou REMOVIDA → segura SOMENTE se não existe nenhuma
 *     `SubtaskExecution` para aquela chave (nunca foi tocada). Removida e
 *     segura: bumpar a versão já a tira da lista — o registro histórico
 *     (se existisse) nunca é apagado, só a versão congelada nova deixa de
 *     oferecê-la como pendência.
 *   • Passo REMOVIDO por inteiro → seguro SOMENTE se nunca teve execução
 *     real E nenhuma Tarefa viva está ancorada nele (não reflui trabalho
 *     nem fecha Tarefa sozinho) — vira SUPERSEDIDO, preservando a linha.
 *
 * Qualquer mudança fora dessas regras — a definição mudou sob dado já
 * preenchido, ação já executada, ou subtarefa já tocada — é um CONFLITO
 * nomeado (passo/subtarefa + motivo). Existindo QUALQUER conflito, a
 * reconciliação inteira deste PROCESSO se recusa — nunca aplica pela
 * metade (a fase futura e outros processos não são afetados por isso: cada
 * processo é avaliado e aplicado independentemente).
 *
 * Concluído/Dispensado nunca é tocado (não está em `chavesMaterializadas`,
 * que já exclui esses via `materializarAlvos`/reancoragem — CLAUDE.md §10).
 */
export async function reconciliarNovaVersaoNaInstanciaAtual(
  input: ReconciliarInstanciaAtualInput,
): Promise<ReconciliarInstanciaAtualResultado> {
  const correlationId = input.correlationId ?? randomUUID()
  const fail = (code: FailureCode, errors: WorkflowValidationIssue[] = []): ReconciliarInstanciaAtualResultado => ({
    success: false, code, errors, correlationId,
  })
  const semTrabalho = (
    motivo: Exclude<ReconciliarInstanciaAtualMotivo, "CONFLITO_DADOS_EXISTENTES">,
    detalhe?: string,
  ): ReconciliarInstanciaAtualResultado => ({ success: true, aplicado: false, motivo, detalhe, correlationId })

  const instancia = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: input.processoId, faseMacroKey: input.faseMacroKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
  })
  if (!instancia) return semTrabalho("SEM_INSTANCIA_ABERTA")
  if (instancia.workflowDefinitionId == null || instancia.workflowVersion == null) {
    return semTrabalho("SEM_VERSAO_REGISTRADA", "Instância não registra workflowDefinitionId/workflowVersion (dado anterior ao versionamento).")
  }

  const processo = await prisma.processo.findUnique({
    where: { id: input.processoId }, select: { tipoProcessoMotorId: true },
  })
  const resolvido = await resolverWorkflowAplicavel(processo?.tipoProcessoMotorId ?? null, input.faseMacroKey, prisma)
  if ("erro" in resolvido) {
    return resolvido.detalhe
      ? fail(resolvido.erro, [{ code: resolvido.erro, message: resolvido.detalhe, entityType: "fase", entityId: input.faseMacroKey }])
      : fail(resolvido.erro)
  }
  // `resolverWorkflowAplicavel` já ancora na versão publicada por dentro —
  // nenhum segundo passo aqui (achado 25/09/2026, ver comentário na função).
  const { workflow, steps } = resolvido

  if (workflow.id !== instancia.workflowDefinitionId) {
    // O workflow aplicável mudou de IDENTIDADE (ex.: passou a existir um
    // específico do tipo onde antes só havia o 'all') — não é versão nova do
    // MESMO workflow; fora do escopo desta reconciliação. Quem nunca
    // materializou esta fase já é alcançado pelo caminho de "fase futura"
    // (enqueueReconciliacaoCatalogoFase, origem WORKFLOW_INTERNO).
    return semTrabalho("WORKFLOW_MUDOU_DE_IDENTIDADE")
  }
  if (workflow.versao === instancia.workflowVersion) {
    return semTrabalho("SEM_TRABALHO_NOVO")
  }

  const versaoAntiga = await lerVersaoPublicada(instancia.workflowDefinitionId, instancia.workflowVersion, prisma)
  const versaoNova = await lerVersaoPublicada(workflow.id, workflow.versao, prisma)
  if (!versaoAntiga || !versaoNova) return semTrabalho("VERSAO_ANTIGA_NAO_CONGELADA")

  // CONCLUIDO/DISPENSADO ficam de fora — "mantenha concluídas concluídas"
  // (CLAUDE.md §10) não é só "não sobrescrever": é nem AVALIAR essas linhas
  // para conflito. Um passo terminal nunca vai ler a definição nova de novo
  // sob este ciclo — reentrar na fase (novo ciclo) já herda o certo por
  // conta própria (ver `materializarAlvos`, bloco REENTRADA).
  const materializados = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: instancia.id, ciclo: instancia.ciclo, status: { notIn: ["SUPERSEDIDO", "CANCELADO", "CONCLUIDO", "DISPENSADO"] } },
    select: { id: true, stepKey: true, startedAt: true },
  })
  const materializadoPorChave = new Map(materializados.map((m) => [m.stepKey, m]))

  // TOCADAS — uma Tarefa viva (não concluída) ancorada no passo é sinal de
  // trabalho em curso, mesmo quando `startedAt` ainda é nulo (a pessoa não
  // clicou "iniciar", mas o passo já é o trabalho corrente da unidade).
  const tarefasVivasPorPasso = await prisma.tarefa.findMany({
    where: { workflowStepInstanceId: { in: materializados.map((m) => m.id) }, concluida: false },
    select: { id: true, workflowStepInstanceId: true, createdAt: true, dataPrazo: true },
  })
  const tarefaViva = new Map(tarefasVivasPorPasso.map((t) => [t.workflowStepInstanceId as number, t]))

  const subtarefasTocadas = await prisma.subtaskExecution.findMany({
    where: { stepInstanceId: { in: materializados.map((m) => m.id) } },
    select: { stepInstanceId: true, subtaskKey: true },
    distinct: ["stepInstanceId", "subtaskKey"],
  })
  const subtarefaFoiTocada = new Set(subtarefasTocadas.map((s) => `${s.stepInstanceId}|${s.subtaskKey}`))

  const conflitos: ConflitoDeReconciliacao[] = []
  const slaMudancas: MudancaDeSla[] = []
  const passosAlterados: PassoAlterado[] = []
  const passosRemovidos: { stepInstanceId: number; stepKey: string }[] = []
  const subtarefasRetiradas: SubtarefaRetirada[] = []
  // Só o ponteiro `PhaseWorkflowInstance.workflowVersion` precisa avançar —
  // a definição em si é lida ao vivo pela versão a cada render
  // (`definicaoHistoricaDoPasso`), nunca duplicada por subtarefa.
  let algumExecutorKeyMudou = false

  for (const [key, mat] of materializadoPorChave) {
    const antes = versaoAntiga.passos.find((p) => p.key === key)
    const depois = versaoNova.passos.find((p) => p.key === key)
    if (!antes) continue // nunca esteve na versão anterior — nada a comparar (defensivo)
    // EXECUÇÃO REAL, não "tem Tarefa": todo passo DISPONÍVEL já nasce com
    // Tarefa (é o desenho do motor — ver garantirTarefaDePasso), então "tem
    // Tarefa viva" seria verdadeiro sempre e a distinção não protegeria
    // nada. `startedAt` é o campo que o próprio schema reserva para "alguém
    // de fato começou a executar" (task-step-sync, clique em "iniciar").
    const execucaoRealIniciada = mat.startedAt != null
    // Para REMOÇÃO do passo inteiro o risco é outro: mesmo sem "iniciar"
    // formalmente, uma Tarefa viva ancorada nele é trabalho que a fila já
    // aponta para alguém — removê-lo por baixo deixaria essa Tarefa órfã.
    const temTarefaViva = tarefaViva.has(mat.id)

    if (!depois) {
      // PASSO REMOVIDO por inteiro.
      if (execucaoRealIniciada || temTarefaViva) {
        conflitos.push({ stepKey: key, campo: "passo", detalhe: `O passo "${key}" foi removido na versão ${workflow.versao}, mas já tem execução real (ou Tarefa viva ancorada) — a reconciliação automática não remove trabalho em curso.` })
      } else {
        passosRemovidos.push({ stepInstanceId: mat.id, stepKey: key })
      }
      continue
    }

    // SLA — sempre tratado à parte (nunca bloqueia por si só).
    if (antes.slaDays !== depois.slaDays) {
      slaMudancas.push({ stepInstanceId: mat.id, stepKey: key, slaAntigo: antes.slaDays, slaNovo: depois.slaDays })
    }

    // SUBTAREFAS — cada chave é avaliada por si.
    const subAntes = new Map(antes.subtarefas.map((s) => [s.key, s]))
    const subDepois = new Map(depois.subtarefas.map((s) => [s.key, s]))
    for (const [sk, sAntes] of subAntes) {
      const sDepois = subDepois.get(sk)
      const tocadaAqui = subtarefaFoiTocada.has(`${mat.id}|${sk}`)
      if (!sDepois) {
        if (tocadaAqui) {
          conflitos.push({ stepKey: key, subtaskKey: sk, campo: "subtarefa", detalhe: `A subtarefa "${sk}" do passo "${key}" foi removida na versão ${workflow.versao}, mas já tem execução registrada — não é retirada automaticamente.` })
        } else {
          subtarefasRetiradas.push({ stepInstanceId: mat.id, stepKey: key, subtaskKey: sk })
        }
      } else if (JSON.stringify(semExecutorKey(sAntes)) !== JSON.stringify(semExecutorKey(sDepois)) && tocadaAqui) {
        conflitos.push({ stepKey: key, subtaskKey: sk, campo: "subtarefa", detalhe: `A subtarefa "${sk}" do passo "${key}" mudou de definição na versão ${workflow.versao}, mas já tem execução registrada — a reconciliação automática não altera subtarefa em andamento.` })
      } else if (sAntes.executorKey !== sDepois.executorKey) {
        algumExecutorKeyMudou = true
      }
    }

    // RESTO DO PASSO (fora subtarefas/slaDays) — seguro só se ainda intocado.
    if (JSON.stringify(semSubtarefasNemSla(antes)) !== JSON.stringify(semSubtarefasNemSla(depois))) {
      if (execucaoRealIniciada) {
        conflitos.push({ stepKey: key, campo: "definicao-do-passo", detalhe: `O passo "${key}" já está em execução e sua definição (fora o prazo) mudou na versão ${workflow.versao} — a reconciliação automática não altera passo em andamento.` })
      } else {
        passosAlterados.push({ stepInstanceId: mat.id, stepKey: key, depois })
      }
    }
  }

  // PRAZO — divergência da Tarefa viva contra o que o SLA ANTIGO devia
  // produzir a partir da MESMA origem é tratada como ajuste que não se sabe
  // explicar (hoje não há UI de edição manual de `Tarefa.dataPrazo`; esta
  // trava existe para quando existir) — vira conflito, nunca sobrescreve.
  for (const m of slaMudancas) {
    const t = tarefaViva.get(m.stepInstanceId)
    if (!t) continue // SLA mudou mas nenhuma Tarefa viva está ancorada neste passo agora — nada a recalcular
    const prazoEsperadoComSlaAntigo = m.slaAntigo != null ? prazoOperacional(m.slaAntigo, t.createdAt) : null
    const bate =
      (t.dataPrazo == null && prazoEsperadoComSlaAntigo == null) ||
      (t.dataPrazo != null && prazoEsperadoComSlaAntigo != null && Math.abs(t.dataPrazo.getTime() - prazoEsperadoComSlaAntigo.getTime()) < 1000)
    if (!bate) {
      conflitos.push({
        stepKey: m.stepKey, campo: "prazo",
        detalhe: `O SLA do passo "${m.stepKey}" mudou na versão ${workflow.versao}, mas o prazo atual da Tarefa (${t.dataPrazo?.toISOString() ?? "sem prazo"}) não bate com o que o SLA anterior calcularia — pode ser um ajuste que a reconciliação automática não reconhece, e por isso não sobrescreve.`,
      })
    }
  }

  if (conflitos.length > 0) {
    return {
      success: true, aplicado: false, motivo: "CONFLITO_DADOS_EXISTENTES", conflitos, correlationId,
      detalhe: `A publicação da versão ${workflow.versao} não foi aplicada a este processo: ${conflitos.length} conflito(s) com dado já existente. ${conflitos.map((c) => c.detalhe).join(" ")}`,
    }
  }

  const escopoDaFase: Cardinalidade = ((await resolverEscopoDaFase(input.faseMacroKey, prisma)) as Cardinalidade | null) ?? "PROCESSO"
  const { ctx: ctxEscopo } = await carregarContextoEscopo(input.processoId, steps, escopoDaFase, prisma)
  const plano = planejarMaterializacao(steps, workflow.execucao, escopoDaFase, ctxEscopo)
  const instantiatedAt = new Date().toISOString()

  const houveAlgumaMudanca =
    passosAlterados.length > 0 || passosRemovidos.length > 0 || subtarefasRetiradas.length > 0 ||
    slaMudancas.length > 0 || algumExecutorKeyMudou

  const resultado = await prisma.$transaction(async (tx) => {
    const r = await materializarAlvos(
      tx,
      {
        instanciaId: instancia.id, processoId: input.processoId, faseMacroKey: input.faseMacroKey,
        ciclo: instancia.ciclo, correlationId,
        causationId: input.causationId ?? `reconciliacao-fase-atual|${instancia.id}|v${workflow.versao}`,
        instantiatedAt, exigeDocumento: workflow.exigeDocumento === true,
      },
      plano.alvos,
    )

    if (r.criados.length === 0 && !houveAlgumaMudanca) return null

    await tx.phaseWorkflowInstance.update({
      where: { id: instancia.id },
      data: {
        workflowVersion: workflow.versao,
        snapshot: construirSnapshotWorkflow({
          workflowDefinitionId: workflow.id, workflowVersion: workflow.versao, name: workflow.name,
          faseMacroId: instancia.faseMacroId, faseMacroKey: input.faseMacroKey, faseMacroVersion: instancia.faseMacroVersion,
          tipoProcessoId: workflow.tipoProcessoId, instantiatedAt,
        }) as Prisma.InputJsonValue,
      },
    })

    // PASSO ALTERADO — aplica config nova nas colunas operacionais + no
    // snapshot (o que `garantirTarefaDePasso` lê para Tarefa nova nesse
    // passo). IDs, responsável, dados preenchidos e histórico: intocados —
    // só os campos de CONFIGURAÇÃO mudam.
    for (const alt of passosAlterados) {
      const atual = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: alt.stepInstanceId }, select: { snapshot: true } })
      const snapshotAtual = (atual?.snapshot as Record<string, unknown> | null) ?? {}
      await tx.phaseWorkflowStepInstance.update({
        where: { id: alt.stepInstanceId },
        data: {
          obrigatorio: alt.depois.required,
          geraTarefa: alt.depois.createsTask,
          prioridade: alt.depois.priority,
          papel: alt.depois.owner,
          snapshot: {
            ...snapshotAtual,
            titulo: alt.depois.label,
            descricao: alt.depois.description,
            prioridade: alt.depois.priority,
            obrigatorio: alt.depois.required,
            geraTarefa: alt.depois.createsTask,
          } as Prisma.InputJsonValue,
        },
      })
    }

    // PASSO REMOVIDO (nunca tocado) — a transição em si NÃO é feita aqui: a
    // máquina de passo único (`task-step-sync.ts`) é a dona exclusiva de
    // `PhaseWorkflowStepInstance.status` (guard-maquina-passo-unica.test.ts).
    // `supersederPasso` é chamado logo abaixo, DEPOIS desta transação —
    // preserva a linha (nunca apaga) e não toca Tarefa (confirmado acima:
    // nenhuma viva estava ancorada nele).

    // PRAZO — recalcula a partir da MESMA origem (Tarefa.createdAt), nunca
    // "agora". Já confirmado acima que o valor atual bate com o cálculo
    // original, então isto nunca reinicia nem inventa um prazo diferente do
    // que a régua já produziria.
    let prazosRecalculados = 0
    for (const m of slaMudancas) {
      const t = tarefaViva.get(m.stepInstanceId)
      if (!t) continue
      const novoPrazo = m.slaNovo != null ? prazoOperacional(m.slaNovo, t.createdAt) : null
      await tx.tarefa.update({ where: { id: t.id }, data: { dataPrazo: novoPrazo } })
      await tx.phaseWorkflowStepInstance.update({ where: { id: m.stepInstanceId }, data: { slaDays: m.slaNovo } })
      prazosRecalculados++
    }

    return { criados: r.criados, prazosRecalculados }
  }, { maxWait: 20_000, timeout: 30_000 })

  if (!resultado) return semTrabalho("SEM_TRABALHO_NOVO")

  // AGORA, fora da transação: a única porta que move status de passo. Cada
  // chamada é sua própria transação pequena (mesmo padrão de
  // `garantirTarefaDePasso` logo depois desta função, em
  // reconciliar-fase-macro.ts) — idempotente (superseder o que já está
  // SUPERSEDIDO não muda nada) e sem Tarefa para sincronizar (confirmado
  // antes: nenhuma estava ancorada nesses passos).
  for (const rem of passosRemovidos) {
    await supersederPasso(rem.stepInstanceId, {
      origem: "MOTOR", correlationId,
      causationId: input.causationId ?? `reconciliacao-fase-atual|${instancia.id}|v${workflow.versao}`,
    })
  }

  const stepInstances = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: instancia.id }, orderBy: { ordem: "asc" },
  })
  return {
    success: true, aplicado: true, workflowInstanceId: instancia.id,
    versaoAnterior: instancia.workflowVersion, versaoNova: workflow.versao,
    passosCriados: resultado.criados.length, passosAtualizados: passosAlterados.length + passosRemovidos.length,
    subtarefasRetiradas: subtarefasRetiradas.length, prazosRecalculados: resultado.prazosRecalculados,
    stepInstances, correlationId,
  }
}

/** Leitura: instância ativa (mais recente) da fase. */
export async function getInstanciaAtiva(processoId: number, faseMacroKey: string) {
  return prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    include: { steps: { orderBy: { ordem: "asc" } } },
  })
}
