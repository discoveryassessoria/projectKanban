// src/services/retrocesso-de-fase.ts
// ============================================================================
// RETROCEDER FASE É UM COMANDO PRÓPRIO — não é cancelar, não é resetar.
//
// ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
// `movePhaseManual` sempre esteve certo: ele reposiciona a fase e não toca em
// obrigação nenhuma. O erro estava no que vinha DEPOIS. O administrador retrocedia
// para refazer trabalho, chegava na Central e encontrava, para uma operação
// concluída, exatamente três botões: Pausar, Cancelar, Invalidar. O único que muda
// alguma coisa é Cancelar — e era para lá que o fluxo empurrava.
//
// Cancelar não é refazer. Cancelar diz "isto não vai acontecer"; refazer diz "isto
// vai acontecer de novo". Trocar um pelo outro apaga a intenção de quem operou e
// tira o documento da fila em vez de devolvê-lo a ela.
//
// ─── O QUE ESTE MÓDULO ESTABELECE ──────────────────────────────────────────
// Retroceder passa a ter as duas metades que sempre faltaram:
//
//   PLANEJAR  — antes de escrever, mostrar o que existe na fase de destino: cada
//               obrigação, o estado dela, de que ela depende, se pode ser reaberta
//               (pelo cadastro), e o que a reabertura de cada uma alcançaria.
//   EXECUTAR  — mover a fase pela porta canônica e reabrir SOMENTE o que foi
//               escolhido, cada reabertura criando execução nova.
//
// ─── O QUE ELE NÃO FAZ ─────────────────────────────────────────────────────
// Não cancela. Não invalida. Não reabre por conta própria — retroceder sem
// selecionar nada reposiciona a fase e mais nada, que é o caso mais comum. Não
// inventa dependência: quem responde "o que mais é afetado" é o grafo cadastrado.
// Não apaga execução anterior: reabrir cria uma nova e arquiva a que houve.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { movePhaseManual } from "@/src/lib/motor/phase-advance"
import { reabrirPassoTx } from "@/src/services/task-step-sync"
import { tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "@/src/services/execucao-do-passo"
import { descendentes, ESTADOS_CUMPRIDOS, type PassoComDependencia } from "@/src/services/dependencias-do-passo"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"
import { resolverInstanciaVigente } from "@/src/lib/process-stage/instancia-vigente-da-fase"

type TX = Prisma.TransactionClient

/** Uma obrigação da fase de destino, como o administrador precisa vê-la para decidir. */
export interface ObrigacaoDoDestino {
  stepInstanceId: number
  stepKey: string
  titulo: string
  ordem: number
  status: string
  obrigatorio: boolean
  concluidaEm: Date | null
  responsavelId: number | null
  /** A quem ela pertence — a certidão, a pessoa, o registro. */
  documentoId: number | null
  necessidadeId: number | null
  /** Chaves de que esta obrigação depende, pelo cadastro. */
  dependeDe: string[]
  /** Execuções que já houve. 0 quando a obrigação nunca foi tentada. */
  execucoes: number
  /** O cadastro permite reexecutar esta obrigação? */
  podeReabrir: boolean
  /** Por que não pode, quando não pode — para a tela dizer, em vez de só desabilitar. */
  motivoNaoPode: string | null
  estrategiaPadrao: string
  exigeJustificativa: boolean
  /** Se esta for reaberta, quem mais é alcançado — pelo GRAFO, nunca pela ordem. */
  alcancaSeReaberta: Array<{ stepInstanceId: number; stepKey: string; titulo: string; status: string }>
}

export interface PlanoDeRetrocesso {
  processoId: number
  faseAtual: string | null
  faseAtualLabel: string | null
  faseDestino: string
  faseDestinoLabel: string
  /** `false` quando o destino não é uma fase anterior — aí não há o que reabrir. */
  ehRetrocesso: boolean
  obrigacoes: ObrigacaoDoDestino[]
  /** Fases posteriores ao destino que já foram visitadas — o histórico que permanece. */
  fasesPosterioresVisitadas: Array<{ faseMacroKey: string; ciclos: number; obrigacoes: number }>
  aviso: string
}

function rotulo(k: string): string {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * O QUE HÁ NA FASE DE DESTINO — lido, nunca suposto.
 *
 * Lê a instância VIGENTE da fase de destino (o ciclo em que ela está), não a soma de
 * todas as visitas: reabrir é sobre a execução corrente daquela fase, e misturar
 * ciclos ofereceria ao administrador obrigações de uma visita que já terminou.
 */
export async function planejarRetrocesso(
  processoId: number,
  faseDestino: string,
  db: typeof prisma | TX = prisma,
): Promise<PlanoDeRetrocesso | null> {
  const processo = await db.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, tipoProcessoMotorId: true },
  })
  if (!processo) return null

  const fases = await db.faseMacro.findMany({
    where: { macroWorkflow: { tipoProcessoId: processo.tipoProcessoMotorId ?? -1 } },
    select: { phaseKey: true, label: true, ordem: true },
    orderBy: { ordem: "asc" },
  })
  const ordemDe = (k: string | null) => fases.find((f) => f.phaseKey === k)?.ordem ?? -1
  const labelDe = (k: string | null) => fases.find((f) => f.phaseKey === k)?.label ?? rotulo(k ?? "—")
  const ehRetrocesso = ordemDe(faseDestino) >= 0 && ordemDe(processo.faseAtualKey) > ordemDe(faseDestino)

  const instancia = await resolverInstanciaVigente(processoId, faseDestino, db as typeof prisma)
  const passos = instancia
    ? await db.phaseWorkflowStepInstance.findMany({
        where: { workflowInstanceId: instancia.id },
        select: {
          id: true, stepKey: true, ordem: true, status: true, obrigatorio: true,
          completedAt: true, responsavelId: true, documentoId: true, necessidadeId: true,
          dependeDeStepKeys: true, snapshot: true,
        },
        orderBy: { ordem: "asc" },
      })
    : []

  const grafo: PassoComDependencia[] = passos.map((p) => ({
    id: p.id, stepKey: p.stepKey, ordem: p.ordem, status: p.status,
    dependeDeStepKeys: Array.isArray(p.dependeDeStepKeys)
      ? (p.dependeDeStepKeys as unknown[]).filter((x): x is string => typeof x === "string")
      : null,
  }))

  const obrigacoes: ObrigacaoDoDestino[] = []
  for (const p of passos) {
    const hist = await definicaoHistoricaDoPasso(p.id, db as typeof prisma)
    const def = hist?.passo
    const titulo = def?.label ?? (p.snapshot as { titulo?: string } | null)?.titulo ?? rotulo(p.stepKey)
    const tentativas = await tentativasDoPasso(p.id, db as typeof prisma)

    // PODE REABRIR? A resposta é do CADASTRO, e a ausência de configuração histórica
    // não é um "não": versão anterior à política permitia, e continuava permitindo.
    const permitido = def ? def.reaberturaPermitida : true
    const jaCumprida = ESTADOS_CUMPRIDOS.has(p.status)
    const motivo = !permitido
      ? "O cadastro desta etapa não permite reexecução."
      : !jaCumprida
        ? "A etapa ainda não foi concluída — não há o que reexecutar."
        : null

    // A UNIDADE importa: numa fase com quatro certidões, reabrir a de uma pessoa não
    // alcança as das outras. `descendentes` roda sobre o grafo inteiro da instância,
    // então o alcance é filtrado pela mesma unidade da obrigação.
    const mesmaUnidade = (outro: { id: number }) => {
      const o = passos.find((x) => x.id === outro.id)!
      return o.documentoId === p.documentoId && o.necessidadeId === p.necessidadeId
    }
    const alcancados = descendentes(grafo.filter((g) => mesmaUnidade(g)), p.stepKey)

    obrigacoes.push({
      stepInstanceId: p.id,
      stepKey: p.stepKey,
      titulo,
      ordem: p.ordem,
      status: p.status,
      obrigatorio: p.obrigatorio,
      concluidaEm: p.completedAt,
      responsavelId: p.responsavelId,
      documentoId: p.documentoId,
      necessidadeId: p.necessidadeId,
      dependeDe: Array.isArray(p.dependeDeStepKeys) ? (p.dependeDeStepKeys as string[]) : [],
      execucoes: tentativas.length,
      podeReabrir: permitido && jaCumprida,
      motivoNaoPode: motivo,
      estrategiaPadrao: def?.reaberturaEstrategia ?? "ESCOLHA_MANUAL",
      exigeJustificativa: def ? def.reaberturaExigeJustificativa : true,
      alcancaSeReaberta: alcancados.map((a) => {
        const o = passos.find((x) => x.id === a.id)!
        return { stepInstanceId: o.id, stepKey: o.stepKey, titulo: rotulo(o.stepKey), status: o.status }
      }),
    })
  }

  // AS FASES POSTERIORES NÃO SOMEM. Elas ficam no plano para que o administrador veja
  // que o trabalho delas continua registrado — e para que ninguém confunda retroceder
  // com apagar o que veio depois.
  const posteriores = await db.phaseWorkflowInstance.groupBy({
    by: ["faseMacroKey"],
    where: { processoId, faseMacroKey: { in: fases.filter((f) => f.ordem > ordemDe(faseDestino)).map((f) => f.phaseKey) } },
    _count: { _all: true },
  })
  const fasesPosterioresVisitadas: PlanoDeRetrocesso["fasesPosterioresVisitadas"] = []
  for (const p of posteriores) {
    fasesPosterioresVisitadas.push({
      faseMacroKey: p.faseMacroKey,
      ciclos: p._count._all,
      obrigacoes: await db.phaseWorkflowStepInstance.count({ where: { processoId, faseMacroKey: p.faseMacroKey } }),
    })
  }

  return {
    processoId,
    faseAtual: processo.faseAtualKey,
    faseAtualLabel: labelDe(processo.faseAtualKey),
    faseDestino,
    faseDestinoLabel: labelDe(faseDestino),
    ehRetrocesso,
    obrigacoes,
    fasesPosterioresVisitadas,
    aviso:
      "Retroceder reposiciona a fase do processo. Nada é concluído, cancelado ou apagado. " +
      "As execuções que já aconteceram continuam no histórico, e só é reexecutado o que for marcado abaixo.",
  }
}

export interface PedidoDeRetrocesso {
  processoId: number
  faseDestino: string
  motivoCodigo: string
  justificativa: string
  /** As obrigações que o administrador escolheu reexecutar. Vazio = só reposicionar. */
  reabrir: Array<{ stepInstanceId: number; comDependentes: boolean }>
  actorId: number | null
  origem?: string
  /** Amarra o comando: o mesmo clique reenviado não reabre duas vezes. */
  correlationId?: string
}

export interface ResultadoRetrocesso {
  ok: boolean
  code?: string
  mensagem?: string
  faseAnterior?: string
  faseAtual?: string
  reabertas: Array<{ stepInstanceId: number; stepKey: string; execucaoAnterior: number; execucaoNova: number }>
  alcancadasPorDependencia: Array<{ stepInstanceId: number; stepKey: string; status: string }>
}

/**
 * EXECUTA O RETROCESSO — mover a fase, e só então reabrir o que foi escolhido.
 *
 * A ORDEM É DELIBERADA. Mover primeiro porque é a mudança que o administrador pediu;
 * reabrir depois porque é consequência do que ele marcou. Se a movimentação for
 * recusada (gate, permissão, conflito), nada é reaberto — não faz sentido reexecutar
 * trabalho de uma fase para a qual o processo não voltou.
 *
 * AS REABERTURAS SÃO TRANSACIONAIS ENTRE SI: ou todas as marcadas acontecem, ou
 * nenhuma. Uma reabertura parcial deixaria o roteiro num estado que ninguém escolheu.
 */
export async function executarRetrocesso(p: PedidoDeRetrocesso): Promise<ResultadoRetrocesso> {
  const correlationId = p.correlationId ?? `retrocesso|p${p.processoId}|${p.faseDestino}|${p.actorId ?? 0}`
  const plano = await planejarRetrocesso(p.processoId, p.faseDestino)
  if (!plano) return { ok: false, code: "PROCESSO_NAO_ENCONTRADO", reabertas: [], alcancadasPorDependencia: [] }

  // A JUSTIFICATIVA É COBRADA ANTES DE QUALQUER ESCRITA, e por obrigação: se alguma
  // das marcadas exige e não veio, o retrocesso inteiro é recusado — não metade dele.
  const exigem = plano.obrigacoes.filter(
    (o) => p.reabrir.some((r) => r.stepInstanceId === o.stepInstanceId) && o.exigeJustificativa,
  )
  if (exigem.length > 0 && p.justificativa.trim().length < 5) {
    return {
      ok: false, code: "JUSTIFICATIVA_OBRIGATORIA",
      mensagem: `Reexecutar ${exigem.map((o) => `"${o.titulo}"`).join(", ")} exige justificativa.`,
      reabertas: [], alcancadasPorDependencia: [],
    }
  }
  const naoPodem = plano.obrigacoes.filter(
    (o) => p.reabrir.some((r) => r.stepInstanceId === o.stepInstanceId) && !o.podeReabrir,
  )
  if (naoPodem.length > 0) {
    return {
      ok: false, code: "REABERTURA_NAO_PERMITIDA",
      mensagem: naoPodem.map((o) => `"${o.titulo}": ${o.motivoNaoPode}`).join(" · "),
      reabertas: [], alcancadasPorDependencia: [],
    }
  }

  // 1) MOVER A FASE — só quando há para onde mover.
  //
  // REABRIR SEM RETROCEDER É CASO LEGÍTIMO, e o mais comum deles: o administrador já
  // está na fase, viu que uma etapa precisa ser refeita, e não há fase nenhuma a
  // mudar. Chamar a movimentação aqui pediria ao motor que movesse o processo para
  // onde ele já está — recusa correta dele, e que abortaria uma reabertura que não
  // tem nada de errado.
  const precisaMover = plano.faseAtual !== p.faseDestino
  let mov: { success: boolean; changed?: boolean; faseAnterior?: string; faseAtual?: string; code?: string } = {
    success: true, changed: false, faseAnterior: plano.faseAtual ?? undefined, faseAtual: p.faseDestino,
  }
  if (precisaMover) {
    mov = await movePhaseManual(p.processoId, {
      faseAlvo: p.faseDestino,
      justificativa: p.justificativa,
      motivoCodigo: p.motivoCodigo,
      solicitadoPorId: p.actorId ?? undefined,
      origem: (p.origem ?? "retrocesso").slice(0, 20),
      correlationId,
    } as never)
    if (!mov.success) {
      return { ok: false, code: mov.code, mensagem: "A fase não pôde ser movida; nada foi reexecutado.", reabertas: [], alcancadasPorDependencia: [] }
    }
  }

  if (p.reabrir.length === 0) {
    await registrarAuditoriaDoRetrocesso(p, plano, mov, [], correlationId)
    return {
      ok: true, faseAnterior: mov.faseAnterior, faseAtual: mov.faseAtual,
      reabertas: [], alcancadasPorDependencia: [],
    }
  }

  // 2) REABRIR O QUE FOI ESCOLHIDO — tudo numa transação.
  const reabertas: ResultadoRetrocesso["reabertas"] = []
  const alcancadas: ResultadoRetrocesso["alcancadasPorDependencia"] = []
  const recusas: string[] = []

  // A SELEÇÃO É POR IDENTIDADE, NÃO POR ID DE LINHA.
  //
  // Voltar para uma fase abre uma VISITA NOVA nela — ciclo 2 —, e a visita nova
  // herda o progresso da anterior em passos novos. O administrador escolheu vendo os
  // passos da visita que estava vigente ANTES do movimento; reabrir aquelas linhas
  // escreveria numa visita que acabou de virar histórico, e a Central mostraria a
  // visita nova, sem a reabertura. Ele veria o oposto do que pediu.
  //
  // O que ele escolheu não é uma linha: é "reexecutar ESTA etapa DESTA certidão". Essa
  // identidade — chave do passo + documento + necessidade — atravessa o ciclo, e é
  // por ela que a seleção é reencontrada depois do movimento.
  const vigenteDepois = await resolverInstanciaVigente(p.processoId, p.faseDestino)
  const passosVigentes = vigenteDepois
    ? await prisma.phaseWorkflowStepInstance.findMany({
        where: { workflowInstanceId: vigenteDepois.id },
        select: { id: true, stepKey: true, ordem: true, status: true, documentoId: true, necessidadeId: true },
      })
    : []
  // A ÂNCORA DA UNIDADE É A QUE EXISTE NOS DOIS LADOS.
  //
  // Um passo de cardinalidade DOCUMENTO carrega `documentoId` e não carrega
  // `necessidadeId`; um de NECESSIDADE, o contrário. Exigir que os dois batam faria a
  // reabertura não reencontrar nada — e recusar por identidade quando a identidade é
  // a mesma. Compara-se o que ambos declaram; o que só um declara não faz parte da
  // identidade daquela obrigação.
  const mesmaUnidadeQue = (
    a: { documentoId: number | null; necessidadeId: number | null },
    b: { documentoId: number | null; necessidadeId: number | null },
  ) =>
    (a.documentoId == null || b.documentoId == null || a.documentoId === b.documentoId) &&
    (a.necessidadeId == null || b.necessidadeId == null || a.necessidadeId === b.necessidadeId)

  const reencontrar = (o: ObrigacaoDoDestino): { id: number; status: string; ordem: number } | null => {
    // A PRÓPRIA LINHA, quando ela continua na visita vigente: o movimento não trocou
    // o ciclo, e não há nada a remapear.
    const mesma = passosVigentes.find((x) => x.id === o.stepInstanceId)
    if (mesma) return { id: mesma.id, status: mesma.status, ordem: mesma.ordem }

    const achado = passosVigentes.find((x) => x.stepKey === o.stepKey && mesmaUnidadeQue(x, o))
    if (achado) return { id: achado.id, status: achado.status, ordem: achado.ordem }
    // Sem visita nova materializada, a própria linha continua valendo.
    return passosVigentes.length === 0 ? { id: o.stepInstanceId, status: o.status, ordem: o.ordem } : null
  }

  await prisma.$transaction(async (tx) => {
    // ORDEM DE REABERTURA: da menor para a maior ordem. Reabrir o predecessor primeiro
    // faz a propagação alcançar os dependentes uma vez; ao contrário, reabrir o
    // dependente antes o deixaria em voo para o predecessor derrubar em seguida.
    const escolhidas = p.reabrir
      .map((r) => ({ r, o: plano.obrigacoes.find((x) => x.stepInstanceId === r.stepInstanceId) }))
      .filter((x): x is { r: (typeof p.reabrir)[number]; o: ObrigacaoDoDestino } => !!x.o)
      .sort((a, b) => a.o.ordem - b.o.ordem)

    for (const { r, o } of escolhidas) {
      const alvo = reencontrar(o)
      if (!alvo) {
        // A visita nova não tem essa obrigação — o roteiro publicado mudou, ou a
        // entidade dela não existe mais. Recusar é mais honesto do que reabrir a linha
        // velha e deixar a Central mostrando outra coisa.
        recusas.push(`"${o.titulo}": não existe na visita atual da fase`)
        continue
      }
      const antes = await tentativasDoPasso(alvo.id, tx)
      // JÁ REABERTA POR CASCATA, ou herdada em aberto pela visita nova: reabrir de novo
      // criaria uma execução a mais para o mesmo comando. O que falta é ela sair de
      // BLOQUEADO quando a dependência fechar.
      const atual = await tx.phaseWorkflowStepInstance.findUnique({
        where: { id: alvo.id }, select: { status: true },
      })
      if (!ESTADOS_CUMPRIDOS.has(atual?.status ?? "")) {
        alcancadas.push({ stepInstanceId: alvo.id, stepKey: o.stepKey, status: atual?.status ?? "" })
        continue
      }

      const rr = await reabrirPassoTx(tx, alvo.id, "EM_ANDAMENTO", {
        // A CHAVE AMARRA AO COMANDO, não à tentativa: duplo clique, duas abas e retry
        // de rede trazem a mesma correlação e não criam duas execuções.
        correlationId: `${correlationId}|si${alvo.id}`,
        operacao: "retrocesso",
        ciclo: 1,
        processoId: p.processoId,
        usuarioId: p.actorId,
        motivoTentativa: MOTIVOS_DE_TENTATIVA.REABERTURA_MANUAL,
        extra: { motivo: p.justificativa.slice(0, 200) },
      })
      if (!rr.changed) {
        recusas.push(`"${o.titulo}": ${rr.code ?? "sem mudança"}`)
        continue
      }
      const depois = await tentativasDoPasso(alvo.id, tx)
      reabertas.push({
        stepInstanceId: alvo.id, stepKey: o.stepKey,
        execucaoAnterior: antes.find((t) => t.supersededAt != null)?.sequencia ?? antes.length,
        execucaoNova: depois.find((t) => t.supersededAt == null)?.sequencia ?? depois.length,
      })

      // A CADEIA DEPENDENTE já foi alcançada pela própria reabertura — `reabrirPassoTx`
      // propaga pelo grafo. O que a opção do administrador muda é a INTENÇÃO
      // registrada, e o que a tela mostra; não existe um segundo mecanismo aqui.
      if (r.comDependentes) {
        for (const d of o.alcancaSeReaberta) {
          const st = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: d.stepInstanceId }, select: { status: true } })
          alcancadas.push({ stepInstanceId: d.stepInstanceId, stepKey: d.stepKey, status: st?.status ?? "" })
        }
      }
    }

    if (recusas.length > 0) {
      // NENHUMA REABERTURA PARCIAL. Uma delas recusada e a transação inteira volta:
      // metade do que o administrador marcou é um estado que ele não escolheu.
      throw Object.assign(new Error("REABERTURA_RECUSADA"), { recusas })
    }
  }, { timeout: 60_000 }).catch((e) => {
    const recusasErro = (e as { recusas?: string[] }).recusas
    if (recusasErro) {
      reabertas.length = 0
      alcancadas.length = 0
      throw Object.assign(new Error("REABERTURA_RECUSADA"), { recusas: recusasErro })
    }
    throw e
  })

  await registrarAuditoriaDoRetrocesso(p, plano, mov, reabertas, correlationId)
  return {
    ok: true, faseAnterior: mov.faseAnterior, faseAtual: mov.faseAtual,
    reabertas, alcancadasPorDependencia: alcancadas,
  }
}

/**
 * A AUDITORIA DO ATO — um evento do retrocesso e um por reabertura.
 *
 * Fora da transação de estado, de propósito: uma falha ao gravar auditoria não pode
 * desfazer um retrocesso que já aconteceu. O rastro do que mudou de fato está no
 * `PhaseAdvanceLog` e nas tentativas, que são transacionais.
 */
async function registrarAuditoriaDoRetrocesso(
  p: PedidoDeRetrocesso,
  plano: PlanoDeRetrocesso,
  mov: { faseAnterior?: string; faseAtual?: string },
  reabertas: ResultadoRetrocesso["reabertas"],
  correlationId: string,
): Promise<void> {
  await prisma.logAuditoria.create({
    data: {
      acao: "PROCESS_PHASE_ROLLED_BACK",
      entidade: "Processo", entidadeId: p.processoId,
      descricao:
        `Processo retrocedido de "${plano.faseAtualLabel}" para "${plano.faseDestinoLabel}". ` +
        (reabertas.length
          ? `${reabertas.length} obrigação(ões) reaberta(s) para nova execução.`
          : "Nenhuma obrigação foi reaberta — apenas o reposicionamento da fase."),
      detalhes: {
        processoId: p.processoId,
        deFase: mov.faseAnterior ?? plano.faseAtual,
        paraFase: mov.faseAtual ?? p.faseDestino,
        motivoCodigo: p.motivoCodigo,
        justificativa: p.justificativa,
        reaberturasSelecionadas: p.reabrir,
        reabertas,
        correlationId,
      } as never,
      usuarioId: p.actorId,
    },
  }).catch(() => null)

  for (const r of reabertas) {
    await prisma.logAuditoria.create({
      data: {
        acao: "OPERATION_REOPENED",
        entidade: "PhaseWorkflowStepInstance", entidadeId: r.stepInstanceId,
        descricao:
          `"${r.stepKey}" reaberta para nova execução (execução ${r.execucaoNova}). ` +
          `A execução ${r.execucaoAnterior} continua no histórico, com o que foi registrado nela.`,
        detalhes: {
          stepInstanceId: r.stepInstanceId,
          execucaoAnterior: r.execucaoAnterior,
          execucaoNova: r.execucaoNova,
          motivo: p.motivoCodigo,
          justificativa: p.justificativa,
          origem: "retrocesso-de-fase",
          correlationId,
        } as never,
        usuarioId: p.actorId,
      },
    }).catch(() => null)
  }
}
