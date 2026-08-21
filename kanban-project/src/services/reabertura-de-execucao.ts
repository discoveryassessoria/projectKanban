// src/services/reabertura-de-execucao.ts
// ============================================================================
// REABRIR UMA EXECUÇÃO — desta pessoa, deste documento, desta etapa.
//
// ─── POR QUE ISTO É UM COMANDO SEPARADO ─────────────────────────────────────
// Reabrir e mover a fase pareciam a mesma decisão porque costumam acontecer perto uma
// da outra. Não são. Mover a fase é um fato sobre a posição do PROCESSO; reabrir é um
// fato sobre UMA unidade de trabalho.
//
// A diferença fica evidente na escala real: uma Emissão com cinquenta certidões tem
// cinquenta unidades, e a decisão de refazer é de cada uma. Perguntar isso num modal
// de movimentação é pedir uma resposta que não existe — e responder por omissão
// ("voltei de fase, então refaço tudo") é decidir pelo administrador algo que ele não
// pediu, sobre quarenta e nove certidões que estavam certas.
//
// ─── A UNIDADE É A IDENTIDADE ───────────────────────────────────────────────
// O que se reabre não é "Solicitar certidão": é "Solicitar certidão DA certidão de
// nascimento inteiro teor DO Ademir". Essa identidade é a que o motor já usa
// (`escopoDaUnidade`: instância da fase + necessidade + documento), e é ela que
// garante que as outras quarenta e nove não sejam tocadas.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não move fase. Não cancela. Não invalida. Não materializa obrigação nova — isso é
// outra coisa, e o motor a faz pelas regras dele. Não apaga a execução anterior: ela
// é arquivada com fim, autor, resultado e o que foi preenchido.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { reabrirPassoTx } from "@/src/services/task-step-sync"
import { tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "@/src/services/execucao-do-passo"
import { historicoDaOperacaoDaUnidade } from "@/src/services/operacao-da-etapa"
import { descendentes, ESTADOS_CUMPRIDOS, type PassoComDependencia } from "@/src/services/dependencias-do-passo"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"
import { escopoDaUnidade } from "@/lib/operacional/tarefa-canonica"

/** Quem é a unidade — em nomes, para a tela poder dizer de quem é o trabalho. */
export interface IdentidadeDaUnidade {
  processoId: number
  faseMacroKey: string
  faseLabel: string
  ciclo: number
  pessoaId: number | null
  pessoaNome: string | null
  documentoId: number | null
  documentoTitulo: string | null
  necessidadeId: number | null
  stepInstanceId: number
  stepKey: string
  stepTitulo: string
  stepDefinitionId: number | null
}

export interface ExecucaoAnterior {
  sequencia: number
  status: string
  motivo: string
  iniciadaEm: Date | null
  concluidaEm: Date | null
  executadoPorId: number | null
  executadoPorNome: string | null
  resultado: string | null
}

export interface PlanoDeReabertura {
  identidade: IdentidadeDaUnidade
  podeReabrir: boolean
  motivoNaoPode: string | null
  estrategiaPadrao: string
  exigeJustificativa: boolean
  permissaoExigida: string | null
  execucoes: ExecucaoAnterior[]
  /** O que a reabertura alcança SE o administrador escolher a cadeia. Da MESMA unidade. */
  dependentesDaMesmaUnidade: Array<{ stepInstanceId: number; stepKey: string; titulo: string; status: string }>
  /** Quantas outras unidades existem na fase — as que NÃO serão tocadas. */
  outrasUnidadesNaFase: number
  /**
   * O QUE FOI PREENCHIDO, através das visitas — para a nova execução CONSULTAR.
   *
   * Marcado com a visita de origem: o que veio de uma passagem anterior é herdado, e
   * não é registrado como produzido agora. Ver `historicoDaOperacaoDaUnidade`.
   */
  operacaoHistorica: Array<{ ciclo: number; visitaAtual: boolean; sequencia: number; concluidaEm: Date | null; campos: string[] }>
  aviso: string
}

function rotulo(k: string): string {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * O PLANO DE UMA REABERTURA — quem é a unidade, o que já houve nela, e o que a
 * reabertura alcança.
 *
 * Somente leitura. Nada aqui escreve, e é isso que permite mostrá-lo antes de
 * confirmar.
 */
export async function planejarReabertura(stepInstanceId: number): Promise<PlanoDeReabertura | null> {
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: {
      id: true, stepKey: true, status: true, ordem: true, ciclo: true, processoId: true,
      faseMacroKey: true, workflowInstanceId: true, documentoId: true, necessidadeId: true,
      pessoaId: true, stepDefinitionId: true, snapshot: true,
    },
  })
  if (!passo) return null

  const hist = await definicaoHistoricaDoPasso(stepInstanceId)
  const def = hist?.passo
  const titulo = def?.label ?? (passo.snapshot as { titulo?: string } | null)?.titulo ?? rotulo(passo.stepKey)

  // OS IRMÃOS DA MESMA UNIDADE — e só eles. É `escopoDaUnidade` que garante que a
  // certidão do Ademir não enxergue a da Tereza.
  const daUnidade = passo.workflowInstanceId
    ? await prisma.phaseWorkflowStepInstance.findMany({
        where: escopoDaUnidade({
          workflowInstanceId: passo.workflowInstanceId,
          necessidadeId: passo.necessidadeId,
          documentoId: passo.documentoId,
          workflowStepInstanceId: passo.id,
        }),
        select: { id: true, stepKey: true, ordem: true, status: true, dependeDeStepKeys: true, snapshot: true },
        orderBy: { ordem: "asc" },
      })
    : []

  const grafo: PassoComDependencia[] = daUnidade.map((x) => ({
    id: x.id, stepKey: x.stepKey, ordem: x.ordem, status: x.status,
    dependeDeStepKeys: Array.isArray(x.dependeDeStepKeys)
      ? (x.dependeDeStepKeys as unknown[]).filter((y): y is string => typeof y === "string")
      : null,
  }))

  const [pessoa, documento, fase] = await Promise.all([
    passo.pessoaId
      ? prisma.pessoa.findUnique({ where: { id: passo.pessoaId }, select: { nome: true, sobrenome: true } })
      : null,
    passo.documentoId
      ? prisma.documento.findUnique({
          where: { id: passo.documentoId },
          select: { tipo: true, descricao: true, publicCode: true, pessoa: { select: { nome: true, sobrenome: true } } },
        })
      : null,
    prisma.catalogoFase.findUnique({ where: { phaseKey: passo.faseMacroKey }, select: { label: true } }),
  ])

  const tentativas = await tentativasDoPasso(stepInstanceId)
  const autores = await prisma.usuario.findMany({
    where: { id: { in: [...new Set(tentativas.map((t) => t.executadoPorId).filter((x): x is number => x != null))] } },
    select: { id: true, nome: true },
  })
  const nomeDoAutor = new Map(autores.map((a) => [a.id, a.nome]))

  const jaCumprida = ESTADOS_CUMPRIDOS.has(passo.status)
  const permitido = def ? def.reaberturaPermitida : true

  // QUANTAS OUTRAS UNIDADES EXISTEM na mesma visita — o número que diz ao
  // administrador, antes de confirmar, o tamanho do que NÃO será tocado.
  const todasDaFase = passo.workflowInstanceId
    ? await prisma.phaseWorkflowStepInstance.findMany({
        where: { workflowInstanceId: passo.workflowInstanceId },
        select: { documentoId: true, necessidadeId: true, pessoaId: true },
      })
    : []
  const chave = (p: { documentoId: number | null; necessidadeId: number | null; pessoaId: number | null }) =>
    `${p.documentoId ?? "-"}|${p.necessidadeId ?? "-"}|${p.pessoaId ?? "-"}`
  const minha = chave(passo)
  const outras = new Set(todasDaFase.map(chave))
  outras.delete(minha)

  const nomePessoa =
    pessoa ? [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ")
    : documento?.pessoa ? [documento.pessoa.nome, documento.pessoa.sobrenome].filter(Boolean).join(" ")
    : null

  return {
    identidade: {
      processoId: passo.processoId,
      faseMacroKey: passo.faseMacroKey,
      faseLabel: fase?.label ?? rotulo(passo.faseMacroKey),
      ciclo: passo.ciclo,
      pessoaId: passo.pessoaId,
      pessoaNome: nomePessoa,
      documentoId: passo.documentoId,
      documentoTitulo: documento
        ? documento.descricao ?? (documento.tipo ? rotulo(String(documento.tipo)) : null) ?? documento.publicCode
        : null,
      necessidadeId: passo.necessidadeId,
      stepInstanceId: passo.id,
      stepKey: passo.stepKey,
      stepTitulo: titulo,
      stepDefinitionId: passo.stepDefinitionId,
    },
    podeReabrir: permitido && jaCumprida,
    motivoNaoPode: !permitido
      ? "O cadastro desta etapa não permite reexecução."
      : !jaCumprida
        ? "Esta etapa não está concluída — não há execução a refazer."
        : null,
    estrategiaPadrao: def?.reaberturaEstrategia ?? "ESCOLHA_MANUAL",
    exigeJustificativa: def ? def.reaberturaExigeJustificativa : true,
    permissaoExigida: def?.reaberturaPermissao ?? null,
    execucoes: tentativas.map((t) => ({
      sequencia: t.sequencia,
      status: t.status,
      motivo: t.motivo,
      iniciadaEm: t.startedAt,
      concluidaEm: t.completedAt,
      executadoPorId: t.executadoPorId,
      executadoPorNome: t.executadoPorId ? nomeDoAutor.get(t.executadoPorId) ?? null : null,
      resultado: t.resultado,
    })),
    dependentesDaMesmaUnidade: descendentes(grafo, passo.stepKey).map((d) => {
      const o = daUnidade.find((x) => x.id === d.id)!
      return {
        stepInstanceId: o.id,
        stepKey: o.stepKey,
        titulo: (o.snapshot as { titulo?: string } | null)?.titulo ?? rotulo(o.stepKey),
        status: o.status,
      }
    }),
    outrasUnidadesNaFase: outras.size,
    operacaoHistorica: (await historicoDaOperacaoDaUnidade(stepInstanceId)).map((h) => ({
      ciclo: h.ciclo, visitaAtual: h.visitaAtual, sequencia: h.sequencia,
      concluidaEm: h.concluidaEm, campos: Object.keys(h.payload),
    })),
    aviso:
      "A execução atual será arquivada com o que foi registrado nela — data, autor, resultado e campos preenchidos — " +
      "e uma execução nova começa. Nenhuma outra unidade de trabalho desta fase é alterada.",
  }
}

export interface PedidoDeReabertura {
  stepInstanceId: number
  motivoCodigo: string
  justificativa: string
  /** `false` = somente esta tarefa. `true` = esta e as que dependem dela NA MESMA unidade. */
  comDependentes: boolean
  actorId: number | null
  /** Amarra o comando: duplo clique, segunda aba e retry trazem a mesma. */
  correlationId?: string
}

export interface ResultadoReabertura {
  ok: boolean
  code?: string
  mensagem?: string
  stepInstanceId?: number
  execucaoAnterior?: number
  execucaoNova?: number
  dependentesAfetados?: Array<{ stepInstanceId: number; stepKey: string; status: string }>
  /** Prova de isolamento: unidades da fase que NÃO foram tocadas. */
  unidadesIntactas?: number
}

/**
 * REABRE UMA EXECUÇÃO. Uma unidade, um passo.
 *
 * A cadeia dependente, quando pedida, é a da MESMA unidade — `reabrirPassoTx` propaga
 * pelo grafo escopado, e é o mesmo escopo que a Central usa para desenhar a unidade.
 * Não existe caminho aqui que alcance outra certidão.
 */
export async function executarReabertura(p: PedidoDeReabertura): Promise<ResultadoReabertura> {
  const plano = await planejarReabertura(p.stepInstanceId)
  if (!plano) return { ok: false, code: "ETAPA_NAO_ENCONTRADA" }
  if (!plano.podeReabrir) {
    return { ok: false, code: "REABERTURA_NAO_PERMITIDA", mensagem: plano.motivoNaoPode ?? undefined }
  }
  if (plano.exigeJustificativa && p.justificativa.trim().length < 5) {
    return { ok: false, code: "JUSTIFICATIVA_OBRIGATORIA", mensagem: "Explique por que esta tarefa está sendo reaberta." }
  }

  const correlationId = p.correlationId ?? `reabrir|si${p.stepInstanceId}|${plano.execucoes.length}|${p.actorId ?? 0}`
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: p.stepInstanceId },
    select: { ciclo: true, processoId: true, workflowInstanceId: true },
  })

  const r = await prisma.$transaction((tx) =>
    reabrirPassoTx(tx, p.stepInstanceId, "EM_ANDAMENTO", {
      correlationId,
      operacao: "reabertura",
      ciclo: passo!.ciclo,
      processoId: passo!.processoId,
      workflowInstanceId: passo!.workflowInstanceId,
      usuarioId: p.actorId,
      motivoTentativa: MOTIVOS_DE_TENTATIVA.REABERTURA_MANUAL,
      // A ESCOLHA DO ADMINISTRADOR MANDA. "Somente esta tarefa" não refaz o que veio
      // depois: os dependentes EM VOO voltam a esperar — não têm como prosseguir com a
      // dependência aberta —, mas os já concluídos permanecem concluídos. Ele sabe se
      // aquele trabalho continua valendo; o motor não tem como saber por ele.
      alcancarConcluidos: p.comDependentes,
      extra: { motivo: p.justificativa.slice(0, 200) },
    }),
  )
  if (!r.changed) {
    return { ok: false, code: r.code ?? "SEM_MUDANCA", mensagem: "A etapa não pôde ser reaberta." }
  }

  const depois = await tentativasDoPasso(p.stepInstanceId)
  const dependentes = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: plano.dependentesDaMesmaUnidade.map((d) => d.stepInstanceId) } },
    select: { id: true, stepKey: true, status: true },
  })

  await prisma.logAuditoria.create({
    data: {
      acao: "STEP_EXECUTION_REOPENED",
      entidade: "PhaseWorkflowStepInstance", entidadeId: p.stepInstanceId,
      descricao:
        `"${plano.identidade.stepTitulo}" reaberta` +
        (plano.identidade.pessoaNome ? ` — ${plano.identidade.pessoaNome}` : "") +
        (plano.identidade.documentoTitulo ? ` / ${plano.identidade.documentoTitulo}` : "") +
        `. Execução ${depois.length} iniciada; a ${depois.length - 1} continua no histórico.`,
      detalhes: {
        identidade: plano.identidade,
        execucaoAnterior: depois.length - 1,
        execucaoNova: depois.length,
        comDependentes: p.comDependentes,
        dependentesAfetados: dependentes,
        unidadesIntactas: plano.outrasUnidadesNaFase,
        motivoCodigo: p.motivoCodigo,
        justificativa: p.justificativa,
        correlationId,
      } as never,
      usuarioId: p.actorId,
    },
  }).catch(() => null)

  return {
    ok: true,
    stepInstanceId: p.stepInstanceId,
    execucaoAnterior: depois.length - 1,
    execucaoNova: depois.length,
    dependentesAfetados: dependentes.map((d) => ({ stepInstanceId: d.id, stepKey: d.stepKey, status: d.status })),
    unidadesIntactas: plano.outrasUnidadesNaFase,
  }
}
