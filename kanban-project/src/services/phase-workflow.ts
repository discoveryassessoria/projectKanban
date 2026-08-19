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
    // A sequência é derivada do MODO DE EXECUÇÃO configurado no workflow, no
    // planejamento (phase-workflow-escopo). Aqui não se decide nada.
    dependeDeStepKeys: null,
  }))
  return { workflow, steps }
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
  const ctx: ContextoEscopo = { pessoaIds: [], necessidadeIds: [], documentoIds: [], documentoIdPorNecessidade: new Map() }
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
  const idLogica = (x: { stepKey: string; pessoaId: number | null; necessidadeId: number | null; documentoId: number | null }) =>
    `${x.stepKey}|p${x.pessoaId ?? "-"}|n${x.necessidadeId ?? "-"}|d${x.documentoId ?? "-"}`
  const porChave = new Map<string, (typeof jaExistem)[number]>()
  for (const e of jaExistem) {
    porChave.set(e.chaveIdempotencia, e)
    porChave.set(idLogica(e), e)
    // Passo criado por outro caminho ANTES de o Documento existir fica com
    // documentoId=null; o alvo atual já traz o Documento. É o mesmo trabalho.
    if (e.necessidadeId != null) porChave.set(`${e.stepKey}|p-|n${e.necessidadeId}|d-`, e)
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
        pessoaId: true, necessidadeId: true, documentoId: true,
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
    ancestrais.get(idLogica({ stepKey: a.def.key, pessoaId: a.pessoaId, necessidadeId: a.necessidadeId, documentoId: a.documentoId })) ??
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
      porChave.get(idLogica({ stepKey: a.def.key, pessoaId: a.pessoaId, necessidadeId: a.necessidadeId, documentoId: a.documentoId })) ??
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
        dependeDeStepKeys: a.dependeDeStepKeys,
        chaveIdempotencia: chavePasso,
        correlationId: ctx.correlationId,
        causationId: ctx.causationId,
      },
    })
    criados.push(si)

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
    return txExterno ? await corpo(txExterno) : await prisma.$transaction(corpo)
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

/** Leitura: instância ativa (mais recente) da fase. */
export async function getInstanciaAtiva(processoId: number, faseMacroKey: string) {
  return prisma.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey, status: { in: ["ATIVO", "BLOQUEADO", "AGUARDANDO"] } },
    orderBy: { ciclo: "desc" },
    include: { steps: { orderBy: { ordem: "asc" } } },
  })
}
