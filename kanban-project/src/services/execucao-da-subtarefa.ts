// src/services/execucao-da-subtarefa.ts
// ============================================================================
// AS EXECUÇÕES DE UMA SUBTAREFA — abrir, registrar, substituir, ler.
//
// ─── O QUE FALTAVA ─────────────────────────────────────────────────────────
// Dentro de "Solicitar certidão" acontecem três coisas: pedir, registrar o protocolo,
// esperar o retorno. Nenhuma delas tinha existência: eram trechos de um componente.
// "Quem registrou o protocolo?" só podia ser respondido por dedução — olhando o
// payload da tentativa do passo inteiro e torcendo para o campo estar lá.
//
// ─── O QUE ESTE MÓDULO ESTABELECE ──────────────────────────────────────────
// A subtarefa é a OBRIGAÇÃO ("registrar o protocolo desta certidão, nesta visita").
// Cada tentativa de cumpri-la é uma linha em `SubtaskExecution`, append-only.
//
// Reabrir não desconclui: a execução vigente é SUBSTITUÍDA (ganha `supersededAt`,
// mantendo `completedAt`, executor, resultado e dados) e uma nova nasce. É a mesma
// mecânica da tentativa do passo, um nível abaixo — de propósito: duas mecânicas
// diferentes para o mesmo fato dariam duas respostas para "o que aconteceu antes".
//
// ─── QUAL É A ATUAL ────────────────────────────────────────────────────────
// A vigente é a única com `supersededAt` nulo, garantido por índice parcial no banco.
// Não se descobre ordenando por data: descobre-se porque não foi substituída.
//
// ─── O QUE ELE NÃO FAZ ─────────────────────────────────────────────────────
// Não decide se a subtarefa PODE ser executada (isso é da projeção, que conhece as
// dependências e as condições), não conclui passo, não toca em tarefa nem documento.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"
import { prazoOperacional } from "@/lib/operacional/tempo-operacional"

type DB = Prisma.TransactionClient | typeof prisma

/**
 * OS ESTADOS DE UMA EXECUÇÃO DE SUBTAREFA.
 *
 * Vocabulário fechado, conferido por CHECK no banco. `PENDENTE` e `DISPONIVEL` são
 * coisas diferentes: pendente é "ainda não pode", disponível é "pode agora" — e
 * misturá-las é o que faz uma tela mostrar botão que o servidor recusa.
 */
export const ESTADOS_DA_SUBTAREFA = {
  PENDENTE: "PENDENTE",
  DISPONIVEL: "DISPONIVEL",
  EM_ANDAMENTO: "EM_ANDAMENTO",
  AGUARDANDO_EXTERNO: "AGUARDANDO_EXTERNO",
  BLOQUEADO: "BLOQUEADO",
  CONCLUIDO: "CONCLUIDO",
  CANCELADO: "CANCELADO",
  INVALIDADO: "INVALIDADO",
  FALHOU: "FALHOU",
} as const
export type EstadoDaSubtarefa = (typeof ESTADOS_DA_SUBTAREFA)[keyof typeof ESTADOS_DA_SUBTAREFA]

/** Estados em que a obrigação está cumprida — nem toda saída é conclusão. */
export const ESTADOS_CUMPRIDOS_DA_SUBTAREFA: EstadoDaSubtarefa[] = ["CONCLUIDO"]
/** Estados em que ela saiu de cena sem ter sido cumprida. */
export const ESTADOS_ENCERRADOS_SEM_CUMPRIR: EstadoDaSubtarefa[] = ["CANCELADO", "INVALIDADO"]

/** POR QUE esta execução nasceu. Mesmo vocabulário da tentativa do passo. */
export const MOTIVOS_DE_EXECUCAO = {
  ABERTURA: "ABERTURA",
  REABERTURA_MANUAL: "REABERTURA_MANUAL",
  NOVA_OCORRENCIA: "NOVA_OCORRENCIA",
  CORRECAO: "CORRECAO",
  RETRY: "RETRY",
  BACKFILL: "BACKFILL",
} as const
export type MotivoDeExecucao = (typeof MOTIVOS_DE_EXECUCAO)[keyof typeof MOTIVOS_DE_EXECUCAO]

/** CAUSAS ESTRUTURADAS de bloqueio — "bloqueada" sem dizer por quê a UI não explica. */
export const CAUSAS_DE_BLOQUEIO = {
  DEPENDENCIA_PENDENTE: "DEPENDENCIA_PENDENTE",
  CONDICAO_DE_ENTRADA: "CONDICAO_DE_ENTRADA",
  FORNECEDOR_AUSENTE: "FORNECEDOR_AUSENTE",
  CANAL_INDISPONIVEL: "CANAL_INDISPONIVEL",
  PASSO_BLOQUEADO: "PASSO_BLOQUEADO",
} as const
export type CausaDeBloqueio = (typeof CAUSAS_DE_BLOQUEIO)[keyof typeof CAUSAS_DE_BLOQUEIO]

export interface ExecucaoDeSubtarefa {
  id: number
  stepInstanceId: number
  subtaskKey: string
  subtaskDefinitionId: number | null
  workflowVersao: number | null
  sequencia: number
  status: string
  motivo: string
  bloqueioCodigo: string | null
  bloqueioAlvo: string | null
  startedAt: Date | null
  completedAt: Date | null
  executadoPorId: number | null
  responsavelId: number | null
  prazo: Date | null
  resultado: string | null
  payload: unknown
  fornecedorId: number | null
  canalKey: string | null
  protocolo: string | null
  protocoloId: number | null
  enviadoEm: Date | null
  previstoPara: Date | null
  supersededAt: Date | null
  supersededPorId: number | null
  criadoEm: Date
}

/** A execução ATUAL da subtarefa: a única não substituída. `null` se ainda não há. */
export async function execucaoVigente(
  stepInstanceId: number, subtaskKey: string, db: DB = prisma,
): Promise<ExecucaoDeSubtarefa | null> {
  return db.subtaskExecution.findFirst({
    where: { stepInstanceId, subtaskKey, supersededAt: null },
  }) as Promise<ExecucaoDeSubtarefa | null>
}

/** Todas as execuções da subtarefa, da mais antiga para a mais nova. */
export async function execucoesDaSubtarefa(
  stepInstanceId: number, subtaskKey: string, db: DB = prisma,
): Promise<ExecucaoDeSubtarefa[]> {
  return db.subtaskExecution.findMany({
    where: { stepInstanceId, subtaskKey }, orderBy: { sequencia: "asc" },
  }) as Promise<ExecucaoDeSubtarefa[]>
}

/** Todas as execuções vigentes do passo, uma por subtarefa. */
export async function vigentesDoPasso(stepInstanceId: number, db: DB = prisma): Promise<ExecucaoDeSubtarefa[]> {
  return db.subtaskExecution.findMany({
    where: { stepInstanceId, supersededAt: null }, orderBy: { id: "asc" },
  }) as Promise<ExecucaoDeSubtarefa[]>
}

/**
 * ABRE UMA EXECUÇÃO — a primeira da subtarefa, ou a que substitui a atual.
 *
 * IDEMPOTENTE por `chaveIdempotencia`: o retry de um comando não vira execução nova.
 * ATÔMICO: recebendo um `tx`, tudo acontece na transação de quem chamou.
 *
 * A SUBSTITUIÇÃO VEM DEPOIS DA CRIAÇÃO, de propósito: o índice parcial exige no
 * máximo uma não-substituída, então a antiga só sai de cena quando a nova já existe.
 */
export async function abrirExecucao(
  args: {
    stepInstanceId: number
    subtaskKey: string
    subtaskDefinitionId?: number | null
    workflowVersao?: number | null
    motivo: MotivoDeExecucao
    status: EstadoDaSubtarefa
    bloqueioCodigo?: CausaDeBloqueio | null
    bloqueioAlvo?: string | null
    responsavelId?: number | null
    prazo?: Date | null
    payload?: Prisma.InputJsonValue | null
    correlationId?: string | null
    chaveIdempotencia?: string
  },
  db: DB = prisma,
): Promise<{ execucao: ExecucaoDeSubtarefa; substituiu: number | null; criada: boolean }> {
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey, db)
  const sequencia = (vigente?.sequencia ?? 0) + 1
  const chave = args.chaveIdempotencia ??
    `subexec|si${args.stepInstanceId}|${args.subtaskKey}|seq${sequencia}|${args.motivo}`

  const jaExiste = (await db.subtaskExecution.findUnique({ where: { chaveIdempotencia: chave } })) as ExecucaoDeSubtarefa | null
  if (jaExiste) return { execucao: jaExiste, substituiu: null, criada: false }

  const agora = new Date()
  // ── A SUBSTITUIÇÃO VEM ANTES DA CRIAÇÃO ─────────────────────────────────
  //
  // O índice parcial admite UMA linha não-substituída. Inserir a nova antes de tirar a
  // antiga de cena viola o índice — e, com `ON CONFLICT DO NOTHING`, a violação é
  // SILENCIOSA: nada é inserido, a função devolve "já existia" e a reabertura
  // simplesmente não acontece, sem erro nenhum. Era assim em produção.
  //
  // O ponteiro para a sucessora fica NULO por um instante, e a trava do banco permite
  // exatamente isso: ela exige que a substituída tenha data e que o ponteiro, quando
  // existir, aponte para OUTRA linha. "Saiu de cena, e já se sabe quando" é um estado
  // legítimo; "aponta para si mesma" nunca seria.
  if (vigente) {
    await db.subtaskExecution.update({
      where: { id: vigente.id },
      data: { supersededAt: agora },
    })
  }

  // CUMPRIDA TEM MOMENTO — inclusive a que nasce assim. Nascer CONCLUIDO sem
  // `completedAt` produziria estado de conclusão sem a conclusão; o banco recusa, e
  // aqui a incoerência nem chega a ser tentada.
  const nasceCumprida = args.status === "CONCLUIDO"
  // BLOQUEADO TEM CAUSA. Sem código de bloqueio, a UI só sabe dizer "bloqueada".
  const bloqueioCodigo = args.status === "BLOQUEADO"
    ? (args.bloqueioCodigo ?? CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE)
    : (args.bloqueioCodigo ?? null)

  const criadas = await db.subtaskExecution.createMany({
    data: [{
      stepInstanceId: args.stepInstanceId,
      subtaskKey: args.subtaskKey,
      subtaskDefinitionId: args.subtaskDefinitionId ?? null,
      workflowVersao: args.workflowVersao ?? null,
      sequencia,
      status: args.status,
      motivo: args.motivo,
      bloqueioCodigo,
      bloqueioAlvo: args.bloqueioAlvo ?? null,
      completedAt: nasceCumprida ? agora : null,
      responsavelId: args.responsavelId ?? null,
      prazo: args.prazo ?? null,
      payload: args.payload ?? undefined,
      correlationId: args.correlationId ?? null,
      chaveIdempotencia: chave,
    }],
    skipDuplicates: true,
  })
  const nova = (await db.subtaskExecution.findUnique({ where: { chaveIdempotencia: chave } })) as ExecucaoDeSubtarefa
  if (criadas.count === 0) {
    // Retry do mesmo comando: a chave já existia. Desfaz a substituição — o que já
    // estava lá continua sendo o vigente.
    if (vigente) {
      await db.subtaskExecution.update({
        where: { id: vigente.id }, data: { supersededAt: null, supersededPorId: null },
      })
    }
    return { execucao: nova, substituiu: null, criada: false }
  }

  if (vigente) {
    await db.subtaskExecution.update({
      where: { id: vigente.id },
      data: { supersededAt: agora, supersededPorId: nova.id },
    })
  }
  return { execucao: nova, substituiu: vigente?.id ?? null, criada: true }
}

export interface ResultadoReaberturaSubtarefa {
  ok: boolean
  code?: "SUBTAREFA_NAO_ENCONTRADA" | "SUBTAREFA_NAO_CONCLUIDA" | "PASSO_NAO_ENCONTRADO"
  mensagem?: string
  passoReaberto?: boolean
  dependentesBloqueadas?: string[]
}

/**
 * REABRE UMA SUBTAREFA — admin, por instância, sem tocar nas outras subtarefas
 * do mesmo passo.
 *
 * Achado real (16/09/2026): o passo consolidado (1 Tarefa → 1 Passo → N
 * subtarefas) só tinha reabertura no nível do PASSO inteiro
 * (`executarReabertura`, CONGELADO — 68 invariantes). Reabrir "Solicitar
 * certidão" reabria as 4 subtarefas juntas; não havia como corrigir só
 * "Enviar requerimento" sem desfazer "Conferir e validar" também.
 *
 * NÃO modifica o mecanismo congelado: quando o passo já está CONCLUIDO, esta
 * função CHAMA `executarReabertura` (inalterada) pra trazer o passo de volta
 * — a mesma porta que qualquer reabertura de passo usa, com os mesmos 68
 * invariantes protegendo. A parte NOVA é só a granularidade abaixo dele:
 * `abrirExecucao` substitui a execução da SUBTAREFA pedida (mantendo o que
 * já aconteceu nela como fato histórico, por trás de `supersededAt`) sem
 * tocar nas execuções vigentes das demais — que continuam CONCLUIDO.
 */
export interface ExecucaoAnteriorDeSubtarefa {
  sequencia: number
  status: string
  motivo: string
  startedAt: Date | null
  completedAt: Date | null
  executadoPorId: number | null
  executadoPorNome: string | null
  resultado: string | null
}

export interface DependenteDeSubtarefa {
  key: string
  label: string
  status: string
}

export interface PlanoDeReaberturaDeSubtarefa {
  identidade: {
    faseLabel: string
    pessoaNome: string | null
    documentoTitulo: string | null
    documentoId: number | null
    stepTitulo: string
    stepKey: string
    subtaskLabel: string
    subtaskKey: string
  }
  podeReabrir: boolean
  motivoNaoPode: string | null
  /** Se o PASSO já estava concluído, reabrir a subtarefa reabre o passo junto. */
  passoSeraReaberto: boolean
  execucoes: ExecucaoAnteriorDeSubtarefa[]
  /** Quem depende, direta ou transitivamente, e hoje está CONCLUÍDO — volta a BLOQUEADO. */
  dependentes: DependenteDeSubtarefa[]
  aviso: string
}

/**
 * O PLANO DE REABERTURA DE UMA SUBTAREFA — mesma régua do `planejarReabertura`
 * (passo), um nível abaixo: mostrar ANTES de confirmar quem é a unidade, o que
 * já houve, e o que a cascata de dependência alcança. Somente leitura.
 *
 * Achado real (16/09/2026): a tela pedia justificativa num `window.prompt` nu
 * — sem mostrar a quem pertence a subtarefa, o histórico, nem (desde que a
 * reabertura passou a cascatear dependentes) o que mais seria afetado.
 */
export async function planejarReaberturaDeSubtarefa(
  stepInstanceId: number,
  subtaskKey: string,
): Promise<PlanoDeReaberturaDeSubtarefa | null> {
  const { planejarReabertura } = await import("@/src/services/reabertura-de-execucao")
  const passoPlano = await planejarReabertura(stepInstanceId)
  if (!passoPlano) return null

  const hist = await definicaoHistoricaDoPasso(stepInstanceId)
  const defs = hist?.passo.subtarefas ?? []
  const def = defs.find((d) => d.key === subtaskKey)
  if (!def) return null

  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId }, select: { status: true },
  })

  const todasExecucoes = await execucoesDaSubtarefa(stepInstanceId, subtaskKey)
  const executorIds = [...new Set(todasExecucoes.map((e) => e.executadoPorId).filter((x): x is number => x != null))]
  const executores = executorIds.length
    ? await prisma.usuario.findMany({ where: { id: { in: executorIds } }, select: { id: true, nome: true } })
    : []
  const nomePorId = new Map(executores.map((u) => [u.id, u.nome]))

  const execucoes: ExecucaoAnteriorDeSubtarefa[] = todasExecucoes.map((e) => ({
    sequencia: e.sequencia,
    status: e.status,
    motivo: e.motivo,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    executadoPorId: e.executadoPorId,
    executadoPorNome: e.executadoPorId ? (nomePorId.get(e.executadoPorId) ?? null) : null,
    resultado: e.resultado,
  }))

  const vigente = todasExecucoes.find((e) => e.supersededAt == null) ?? null
  const podeReabrir = vigente?.status === "CONCLUIDO"
  const motivoNaoPode = podeReabrir
    ? null
    : !vigente
      ? "Esta subtarefa não tem execução registrada."
      : "Só uma subtarefa concluída pode ser reaberta."

  // MESMO BFS de `reabrirSubtarefa` — o plano precisa prever exatamente o que
  // a confirmação vai fazer, não uma aproximação.
  const afetadas = new Set<string>()
  let fronteira = [subtaskKey]
  while (fronteira.length > 0) {
    const proxima: string[] = []
    for (const d of defs) {
      const deps = Array.isArray(d.dependeDe) ? d.dependeDe.map(String) : []
      if (fronteira.some((k) => deps.includes(k)) && !afetadas.has(d.key)) {
        afetadas.add(d.key)
        proxima.push(d.key)
      }
    }
    fronteira = proxima
  }
  const dependentes: DependenteDeSubtarefa[] = []
  for (const key of afetadas) {
    const exec = await execucaoVigente(stepInstanceId, key)
    if (exec && exec.status === "CONCLUIDO") {
      const d = defs.find((x) => x.key === key)
      dependentes.push({ key, label: d?.label ?? key, status: exec.status })
    }
  }

  return {
    identidade: {
      faseLabel: passoPlano.identidade.faseLabel,
      pessoaNome: passoPlano.identidade.pessoaNome,
      documentoTitulo: passoPlano.identidade.documentoTitulo,
      documentoId: passoPlano.identidade.documentoId,
      stepTitulo: passoPlano.identidade.stepTitulo,
      stepKey: passoPlano.identidade.stepKey,
      subtaskLabel: def.label,
      subtaskKey,
    },
    podeReabrir,
    motivoNaoPode,
    passoSeraReaberto: passo?.status === "CONCLUIDO",
    execucoes,
    dependentes,
    aviso: dependentes.length > 0
      ? `${dependentes.length} subtarefa(s) que dependem desta voltam para bloqueada — nada é apagado, o que já aconteceu fica no histórico.`
      : "Nada mais é afetado — nenhuma outra subtarefa depende desta.",
  }
}

export async function reabrirSubtarefa(args: {
  stepInstanceId: number
  subtaskKey: string
  actorId: number | null
  justificativa: string
  /**
   * A ESCOLHA fica com quem confirma — mesma régua do `ReabrirEtapaModal`
   * (`comDependentes` do passo). `false` reabre só esta, mesmo que existam
   * dependentes concluídas (o admin decidiu que aquilo está certo do jeito
   * que está); `true` bloqueia em cascata quem dependia dela.
   */
  comDependentes: boolean
  correlationId?: string
}): Promise<ResultadoReaberturaSubtarefa> {
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey)
  if (!vigente) return { ok: false, code: "SUBTAREFA_NAO_ENCONTRADA", mensagem: "Esta subtarefa não tem execução registrada." }
  if (vigente.status !== "CONCLUIDO") {
    return { ok: false, code: "SUBTAREFA_NAO_CONCLUIDA", mensagem: "Só uma subtarefa concluída pode ser reaberta." }
  }

  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: args.stepInstanceId }, select: { status: true },
  })
  if (!passo) return { ok: false, code: "PASSO_NAO_ENCONTRADO", mensagem: "Etapa não encontrada." }

  let passoReaberto = false
  if (passo.status === "CONCLUIDO") {
    const { executarReabertura } = await import("@/src/services/reabertura-de-execucao")
    const r = await executarReabertura({
      stepInstanceId: args.stepInstanceId,
      motivoCodigo: "ERRO_OPERACIONAL",
      justificativa: args.justificativa,
      comDependentes: false,
      actorId: args.actorId,
      correlationId: args.correlationId,
    })
    if (!r.ok) return { ok: false, mensagem: r.mensagem ?? "Não foi possível reabrir a etapa." }
    passoReaberto = true
  }

  // AS DEPENDENTES CONCLUÍDAS — quem já tinha sido dado por feito DEPOIS desta
  // subtarefa, na mesma execução que agora volta pra trás. Achado real,
  // 16/09/2026: "Enviar requerimento" reabria e "Aguardar retorno"/"Receber
  // certidão"/"Conferir e validar" continuavam CONCLUÍDO — um estado
  // impossível (a certidão "conferida" de um requerimento que nem foi
  // reenviado ainda). Reabertura não deixa órfão nem pra baixo (dependente
  // que devia acompanhar) nem pra cima (histórico, já preservado acima).
  // A definição HISTÓRICA (congelada na versão que esta instância rodou) —
  // não `StepSubtaskDefinition` pelo `subtaskDefinitionId` da execução: esse
  // campo é null em execuções legadas (achado real, 16/09/2026, processo
  // 613 stepInstance 2498 — TODAS as execuções tinham `subtaskDefinitionId:
  // null`), e é exatamente a mesma fonte que `subtarefasDaEtapa` já usa pra
  // saber "quem depende de quem" nesta instância — e, agora, o SLA efetivo
  // pra ligar o relógio de novo.
  const hist = await definicaoHistoricaDoPasso(args.stepInstanceId)

  const dependentesConcluidas = !args.comDependentes ? [] : await (async () => {
    const todas = hist?.passo.subtarefas ?? []
    if (todas.length === 0) return []
    // BFS pelo grafo de dependência (declarada, nunca por ordem) a partir da
    // chave reaberta, achando quem depende dela direta ou transitivamente.
    const afetadas = new Set<string>()
    let fronteira = [args.subtaskKey]
    while (fronteira.length > 0) {
      const proxima: string[] = []
      for (const d of todas) {
        const deps = Array.isArray(d.dependeDe) ? d.dependeDe.map(String) : []
        if (fronteira.some((k) => deps.includes(k)) && !afetadas.has(d.key)) {
          afetadas.add(d.key)
          proxima.push(d.key)
        }
      }
      fronteira = proxima
    }
    const resultado: Array<{ key: string; workflowVersao: number | null; execucaoId: number }> = []
    for (const key of afetadas) {
      const exec = await execucaoVigente(args.stepInstanceId, key)
      if (exec && exec.status === "CONCLUIDO") {
        resultado.push({ key, workflowVersao: exec.workflowVersao, execucaoId: exec.id })
      }
    }
    return resultado
  })()

  // NOVA TENTATIVA, NOVO RELÓGIO: reabrir é uma execução nova (sequência
  // seguinte, ver cabeçalho do arquivo) — o prazo antigo pertence à execução
  // substituída, que fica preservada como histórico. Mesmo SLA efetivo
  // (própria ou herdada do passo) que `materializarSubtarefas` usa.
  const defReaberta = hist?.passo.subtarefas.find((d) => d.key === args.subtaskKey)
  const prazoReaberta = prazoOperacional(defReaberta?.slaDays ?? hist?.passo.slaDays ?? 0, new Date())

  await prisma.$transaction(async (tx) => {
    await abrirExecucao({
      stepInstanceId: args.stepInstanceId,
      subtaskKey: args.subtaskKey,
      subtaskDefinitionId: vigente.subtaskDefinitionId,
      workflowVersao: vigente.workflowVersao,
      motivo: MOTIVOS_DE_EXECUCAO.REABERTURA_MANUAL,
      status: ESTADOS_DA_SUBTAREFA.DISPONIVEL,
      responsavelId: vigente.responsavelId,
      prazo: prazoReaberta,
      correlationId: args.correlationId ?? null,
    }, tx)

    for (const dep of dependentesConcluidas) {
      await abrirExecucao({
        stepInstanceId: args.stepInstanceId,
        subtaskKey: dep.key,
        subtaskDefinitionId: null,
        workflowVersao: dep.workflowVersao,
        motivo: MOTIVOS_DE_EXECUCAO.REABERTURA_MANUAL,
        status: ESTADOS_DA_SUBTAREFA.BLOQUEADO,
        bloqueioCodigo: CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE,
        bloqueioAlvo: args.subtaskKey,
        correlationId: args.correlationId ?? null,
      }, tx)
    }

    await tx.logAuditoria.create({
      data: {
        acao: "SUBTAREFA_REABERTA",
        entidade: "SubtaskExecution",
        entidadeId: vigente.id,
        usuarioId: args.actorId,
        descricao: `Subtarefa "${args.subtaskKey}" (passo ${args.stepInstanceId}) reaberta${passoReaberto ? " — passo também reaberto" : ""}${dependentesConcluidas.length > 0 ? ` — ${dependentesConcluidas.length} subtarefa(s) dependente(s) voltaram a bloqueada: ${dependentesConcluidas.map((d) => d.key).join(", ")}` : ""}: ${args.justificativa}`,
        detalhes: { stepInstanceId: args.stepInstanceId, subtaskKey: args.subtaskKey, passoReaberto, dependentesBloqueadas: dependentesConcluidas.map((d) => d.key) } as never,
      },
    }).catch(() => null)
  })

  return { ok: true, passoReaberto, dependentesBloqueadas: dependentesConcluidas.map((d) => d.key) }
}

/**
 * REGISTRA NA EXECUÇÃO VIGENTE o que acabou de acontecer.
 *
 * Só mexe na ATUAL — execução substituída é fato consumado e nada aqui a alcança.
 * `completedAt` e `startedAt` são gravados uma vez e não são reescritos.
 */
export async function registrarNaExecucao(
  stepInstanceId: number,
  subtaskKey: string,
  dados: {
    status?: EstadoDaSubtarefa
    bloqueioCodigo?: CausaDeBloqueio | null
    bloqueioAlvo?: string | null
    startedAt?: Date | null
    completedAt?: Date | null
    executadoPorId?: number | null
    responsavelId?: number | null
    prazo?: Date | null
    resultado?: string | null
    payload?: Prisma.InputJsonValue | null
    fornecedorId?: number | null
    canalKey?: string | null
    /**
     * PROJEÇÃO do número, nunca a fonte. Quem responde pelo protocolo é `Protocolo`,
     * alcançado por `protocoloId`; este texto existe para os leitores que ainda não
     * migraram e só deve receber o que o cadastro canônico confirmou.
     */
    protocolo?: string | null
    /** O protocolo canônico desta execução. É por ele que se chega ao número. */
    protocoloId?: number | null
    enviadoEm?: Date | null
    previstoPara?: Date | null
  },
  db: DB = prisma,
): Promise<ExecucaoDeSubtarefa | null> {
  const vigente = await execucaoVigente(stepInstanceId, subtaskKey, db)
  if (!vigente) return null

  const cumprindo = dados.status === "CONCLUIDO"
  const bloqueando = dados.status === "BLOQUEADO"
  const atualizada = await db.subtaskExecution.update({
    where: { id: vigente.id },
    data: {
      ...(dados.status !== undefined ? { status: dados.status } : {}),
      // Sair de BLOQUEADO limpa a causa: causa de bloqueio pendurada numa execução
      // que não está mais bloqueada é histórico falso.
      ...(dados.status !== undefined && !bloqueando ? { bloqueioCodigo: null, bloqueioAlvo: null } : {}),
      ...(bloqueando ? {
        bloqueioCodigo: dados.bloqueioCodigo ?? vigente.bloqueioCodigo ?? CAUSAS_DE_BLOQUEIO.DEPENDENCIA_PENDENTE,
        bloqueioAlvo: dados.bloqueioAlvo ?? vigente.bloqueioAlvo ?? null,
      } : {}),
      ...(cumprindo && vigente.completedAt == null ? { completedAt: dados.completedAt ?? new Date() } : {}),
      ...(dados.startedAt !== undefined && vigente.startedAt == null ? { startedAt: dados.startedAt } : {}),
      ...(dados.executadoPorId !== undefined ? { executadoPorId: dados.executadoPorId } : {}),
      ...(dados.responsavelId !== undefined ? { responsavelId: dados.responsavelId } : {}),
      ...(dados.prazo !== undefined ? { prazo: dados.prazo } : {}),
      ...(dados.resultado !== undefined ? { resultado: dados.resultado } : {}),
      ...(dados.payload !== undefined && dados.payload !== null ? { payload: dados.payload } : {}),
      ...(dados.fornecedorId !== undefined ? { fornecedorId: dados.fornecedorId } : {}),
      ...(dados.canalKey !== undefined ? { canalKey: dados.canalKey } : {}),
      ...(dados.protocolo !== undefined ? { protocolo: dados.protocolo } : {}),
      ...(dados.protocoloId !== undefined ? { protocoloId: dados.protocoloId } : {}),
      ...(dados.enviadoEm !== undefined ? { enviadoEm: dados.enviadoEm } : {}),
      ...(dados.previstoPara !== undefined ? { previstoPara: dados.previstoPara } : {}),
    },
  })
  return atualizada as ExecucaoDeSubtarefa
}

/**
 * GARANTE QUE A SUBTAREFA TEM EXECUÇÃO VIGENTE, sem criar uma segunda.
 *
 * É o que a materialização chama: um passo que ganha subtarefas passa a ter uma linha
 * por subtarefa, no estado que a projeção calculou.
 */
export async function garantirExecucao(
  args: {
    stepInstanceId: number
    subtaskKey: string
    subtaskDefinitionId?: number | null
    workflowVersao?: number | null
    status: EstadoDaSubtarefa
    bloqueioCodigo?: CausaDeBloqueio | null
    bloqueioAlvo?: string | null
    responsavelId?: number | null
    prazo?: Date | null
  },
  db: DB = prisma,
): Promise<ExecucaoDeSubtarefa> {
  const vigente = await execucaoVigente(args.stepInstanceId, args.subtaskKey, db)
  if (vigente) return vigente
  const r = await abrirExecucao({ ...args, motivo: MOTIVOS_DE_EXECUCAO.ABERTURA }, db)
  return r.execucao
}
