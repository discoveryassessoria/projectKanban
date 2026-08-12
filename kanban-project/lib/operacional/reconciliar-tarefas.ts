// lib/operacional/reconciliar-tarefas.ts
// ============================================================================
// RECONCILIA O TRABALHO REAL COM AS TAREFAS — convergente e idempotente.
//
// Toda instância de workflow operacional ATIVA representa um trabalho que
// alguém precisa fazer. Este reconciliador garante que cada uma tenha
// exatamente UMA tarefa, com o estado e a etapa corrente certos.
//
// ─── POR QUE UM RECONCILIADOR, E NÃO UM GATILHO ─────────────────────────────
// Gatilho só acerta o que passa por ele. A operação do Ademir existia havia
// dias — workflow ativo, etapa disponível, responsável no documento — e nunca
// passou por um gatilho de criação de tarefa, porque o materializador da
// genealogia decidia localmente `geraTarefa: false`. Nenhum evento futuro ia
// consertar o passado.
//
// Convergência é a propriedade que falta a gatilho: rodar isto de novo depois
// de qualquer bagunça leva o sistema ao mesmo estado correto.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não cria etapa, não avança fase, não conclui passo, não altera cadastro, não
// inventa responsável nem prazo. Só materializa e sincroniza a TAREFA.
// ============================================================================
import { prisma } from '@/lib/prisma'
import {
  materializarTarefaOperacional, sincronizarTarefaComWorkflow, STATUS_TERMINAIS,
} from './tarefa-canonica'

export interface ResultadoReconciliacao {
  instanciasAvaliadas: number
  tarefasCriadas: number
  tarefasSincronizadas: number
  tarefasEncerradasSemCausa: number
  /** Perderam a causa DEPOIS de iniciadas — ninguém cancela sozinho. */
  tarefasAguardandoDecisao: number
  semTitulo: number
  detalhes: Array<{ instanciaId: number; tarefaId: number; acao: string }>
}

/**
 * O TÍTULO DO TRABALHO — o que a pessoa lê na fila.
 *
 * "Solicitar Certidão de Nascimento - Inteiro Teor · Ademir Matheus", não
 * "localizar_registro". O nome vem do item do catálogo e da pessoa, ambos do
 * cadastro; sem eles a tarefa não nasce, porque uma linha de fila que não diz
 * o que fazer não serve para ninguém.
 */
function titulo(item: string | null, pessoa: string | null): string | null {
  if (!item) return null
  return pessoa ? `${item} · ${pessoa}` : item
}

/**
 * A EQUIPE do trabalho. Vem do `papel` declarado nas etapas — é lá que o
 * workflow publicado diz quem responde pela fila. Etapas divergentes não são
 * resolvidas por maioria: sem consenso, a tarefa nasce sem equipe e aparece
 * como não distribuída, que é a verdade.
 */
function equipeDoTrabalho(papeis: Array<string | null>): string | null {
  const distintos = [...new Set(papeis.filter((p): p is string => !!p))]
  return distintos.length === 1 ? distintos[0] : null
}

/**
 * O SLA do trabalho: o maior entre os das etapas obrigatórias.
 *
 * O prazo é do TRABALHO inteiro — obter a certidão —, e quem o determina é a
 * etapa mais demorada da cadeia. Somar os SLAs suporia execução estritamente
 * serial; pegar o menor prometeria o que a cadeia não entrega.
 */
function slaDoTrabalho(steps: Array<{ slaDays: number | null; obrigatorio: boolean }>): number | null {
  const dias = steps.filter((s) => s.obrigatorio && s.slaDays != null).map((s) => s.slaDays as number)
  return dias.length ? Math.max(...dias) : null
}

export async function reconciliarTarefas(
  opts: { processoId?: number; dryRun?: boolean } = {},
): Promise<ResultadoReconciliacao> {
  const dryRun = opts.dryRun ?? false
  const agora = new Date()
  const res: ResultadoReconciliacao = {
    instanciasAvaliadas: 0, tarefasCriadas: 0, tarefasSincronizadas: 0,
    tarefasEncerradasSemCausa: 0, tarefasAguardandoDecisao: 0, semTitulo: 0, detalhes: [],
  }

  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { status: 'ATIVO', ...(opts.processoId ? { processoId: opts.processoId } : {}) },
    select: {
      id: true, processoId: true, faseMacroKey: true, ciclo: true,
      tarefas: { select: { id: true, necessidadeId: true, documentoId: true } },
      steps: {
        select: {
          id: true, status: true, obrigatorio: true, ordem: true, stepKey: true, papel: true,
          slaDays: true, pessoaId: true, necessidadeId: true, documentoId: true, responsavelId: true,
        },
        orderBy: { ordem: 'asc' },
      },
    },
  })

  for (const inst of instancias) {
    res.instanciasAvaliadas++

    // Sem etapas vivas não há trabalho a fazer: instância exaurida não ganha
    // tarefa nova só porque continua marcada como ativa.
    const vivosDaInstancia = inst.steps.filter((s) => !STATUS_TERMINAIS_STEP.includes(s.status))

    // ── AS UNIDADES DE TRABALHO DENTRO DA INSTÂNCIA ────────────────────────
    //
    // A instância é da FASE. Numa Emissão Documental com quatro certidões, ela
    // guarda os passos das quatro — e cada certidão é um trabalho distinto,
    // com o seu prazo e o seu responsável.
    //
    // Este laço já tratou a instância inteira como uma unidade só, porque na
    // Genealogia havia mesmo um trabalho por instância. Ao chegar uma fase com
    // dois documentos, o segundo simplesmente não ganhava tarefa: a primeira já
    // existia e o `continue` encerrava a instância.
    //
    // O agrupamento é pela OBRIGAÇÃO — a mesma identidade que a chave da tarefa
    // usa —, então reconciliar e materializar concordam por construção.
    const grupos = new Map<string, typeof vivosDaInstancia>()
    for (const st of vivosDaInstancia) {
      const chave = st.necessidadeId != null ? `nec${st.necessidadeId}`
        : st.documentoId != null ? `doc${st.documentoId}`
        : `step${st.id}`
      const atual = grupos.get(chave)
      if (atual) atual.push(st)
      else grupos.set(chave, [st])
    }

    // Tarefas que JÁ existem nesta instância sincronizam; o resto vira unidade
    // nova. A comparação é por obrigação, não por instância.
    const jaTem = new Set(
      inst.tarefas.map((t) => (t.necessidadeId != null ? `nec${t.necessidadeId}` : t.documentoId != null ? `doc${t.documentoId}` : '')),
    )
    for (const t of inst.tarefas) {
      if (!dryRun) {
        const r = await prisma.$transaction((tx) => sincronizarTarefaComWorkflow(tx, t.id, agora))
        if (r.mudou) res.tarefasSincronizadas++
      }
      res.detalhes.push({ instanciaId: inst.id, tarefaId: t.id, acao: 'já tinha tarefa · sincronizada' })
    }

    if (grupos.size === 0) {
      res.detalhes.push({ instanciaId: inst.id, tarefaId: 0, acao: 'sem etapa viva · nada a fazer' })
      continue
    }

    for (const [chaveGrupo, vivos] of grupos) {
    if (jaTem.has(chaveGrupo)) continue

    // A CAUSA do trabalho — sem ela a tarefa seria órfã e ninguém saberia
    // responder "por que eu existo?".
    const comNec = vivos.find((s) => s.necessidadeId != null) ?? vivos[0]
    const necessidadeId = comNec.necessidadeId ?? null
    const documentoId = vivos.find((s) => s.documentoId != null)?.documentoId ?? null

    const nec = necessidadeId
      ? await prisma.necessidadeDocumental.findUnique({
          where: { id: necessidadeId },
          select: { pessoaId: true, itemCatalogo: { select: { name: true } } },
        })
      : null
    const pessoaId = nec?.pessoaId ?? vivos.find((s) => s.pessoaId != null)?.pessoaId ?? null
    const pessoa = pessoaId
      ? await prisma.pessoa.findUnique({ where: { id: pessoaId }, select: { nome: true, sobrenome: true } })
      : null

    const nome = titulo(
      nec?.itemCatalogo?.name ?? null,
      pessoa ? [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(' ') : null,
    )
    if (!nome) {
      res.semTitulo++
      res.detalhes.push({ instanciaId: inst.id, tarefaId: 0, acao: 'sem item de catálogo · título indefinido' })
      continue
    }

    // O RESPONSÁVEL vem da etapa quando ela declara um; senão a tarefa nasce na
    // fila da equipe. `Documento.responsavelId` NÃO é consultado aqui: fonte
    // concorrente de responsabilidade é o que produziu "Daniela numa tela e
    // Equipe Documental na outra".
    const responsavelId = vivos.find((s) => s.responsavelId != null)?.responsavelId ?? null

    if (dryRun) {
      res.tarefasCriadas++
      res.detalhes.push({ instanciaId: inst.id, tarefaId: 0, acao: `criaria: ${nome}` })
      continue
    }

    const criada = await prisma.$transaction(async (tx) => {
      const r = await materializarTarefaOperacional(tx, {
        titulo: nome,
        processoId: inst.processoId,
        pessoaId,
        necessidadeId,
        documentoId,
        ciclo: inst.ciclo,
        workflowInstanceId: inst.id,
        faseMacroKey: inst.faseMacroKey,
        equipeKey: equipeDoTrabalho(vivos.map((s) => s.papel)),
        responsavelId,
        slaDays: slaDoTrabalho(vivos),
        origem: 'RECONCILIADOR',
      }, agora)
      await sincronizarTarefaComWorkflow(tx, r.tarefaId, agora)
      return r
    })

    if (criada.criada) res.tarefasCriadas++
    res.detalhes.push({ instanciaId: inst.id, tarefaId: criada.tarefaId, acao: criada.criada ? `criada: ${nome}` : `reaproveitada (${criada.motivo})` })
    }
  }

  // ── TAREFA QUE PERDEU A CAUSA ────────────────────────────────────────────
  // O QUE FAZER DEPENDE DE QUANTO TRABALHO JÁ FOI FEITO. Tratar os três casos
  // igual seria destruir esforço real ou deixar a fila mentindo:
  //
  //   nunca iniciada  → cancela. Ninguém perdeu nada.
  //   já iniciada     → NÃO cancela sozinho. Alguém trabalhou nisso; jogar fora
  //                     sem análise é decisão que o motor não pode tomar.
  //                     Fica marcada e espera decisão de quem pode tomá-la.
  //   já concluída    → não se toca. O trabalho ACONTECEU. Regra que muda
  //                     depois não desfaz o passado.
  //
  // Tarefa MANUAL nunca entra aqui: ela não nasceu de obrigação automática, e
  // foi uma pessoa que decidiu que o trabalho existe.
  const semCausa = await prisma.tarefa.findMany({
    where: {
      workflowInstanceId: { not: null },
      statusTarefa: { notIn: STATUS_TERMINAIS },
      origem: { not: 'MANUAL' },
      workflowInstance: { status: { in: ['CANCELADO', 'SUPERSEDIDO'] } },
      ...(opts.processoId ? { processoId: opts.processoId } : {}),
    },
    select: { id: true, workflowInstanceId: true, titulo: true, dataInicio: true, statusTarefa: true, causaRemovidaEm: true },
  })

  for (const t of semCausa) {
    // "Iniciada" é sobre trabalho FEITO, não sobre estado nominal: quem começou
    // tem `dataInicio`, e quem saiu de NAO_INICIADA andou de alguma forma.
    const jaTrabalhou = t.dataInicio != null || t.statusTarefa !== 'NAO_INICIADA'

    if (jaTrabalhou) {
      if (t.causaRemovidaEm != null) continue // já marcada, aguardando decisão
      res.tarefasAguardandoDecisao++
      res.detalhes.push({ instanciaId: t.workflowInstanceId ?? 0, tarefaId: t.id, acao: 'causa removida · trabalho já iniciado · aguarda decisão' })
      if (dryRun) continue
      await prisma.$transaction(async (tx) => {
        await tx.tarefa.update({
          where: { id: t.id },
          data: { causaRemovidaEm: agora, causaRemovidaMotivo: 'O workflow que originou este trabalho foi encerrado.' },
        })
        await tx.logAuditoria.create({
          data: {
            acao: 'TAREFA_CAUSA_REMOVIDA',
            entidade: 'Tarefa',
            entidadeId: t.id,
            descricao:
              `Tarefa "${t.titulo}" perdeu a causa DEPOIS de iniciada. Não foi cancelada: ` +
              `o trabalho já realizado é preservado e a decisão cabe a quem tem autorização.`,
            detalhes: { workflowInstanceId: t.workflowInstanceId, statusTarefa: t.statusTarefa, dataInicio: t.dataInicio?.toISOString() ?? null },
          },
        })
      })
      continue
    }

    res.tarefasEncerradasSemCausa++
    res.detalhes.push({ instanciaId: t.workflowInstanceId ?? 0, tarefaId: t.id, acao: 'causa removida · nunca iniciada · cancelada' })
    if (dryRun) continue
    await prisma.$transaction(async (tx) => {
      await tx.tarefa.update({
        where: { id: t.id },
        data: { statusTarefa: 'CANCELADA', motivoCodigo: 'CAUSA_REMOVIDA', dataConclusao: agora, causaRemovidaEm: agora },
      })
      await tx.logAuditoria.create({
        data: {
          acao: 'TAREFA_CANCELADA',
          entidade: 'Tarefa',
          entidadeId: t.id,
          descricao: `Tarefa "${t.titulo}" retirada da fila: o workflow que a originou foi encerrado e o trabalho nunca começou. Histórico preservado.`,
          detalhes: { workflowInstanceId: t.workflowInstanceId, origem: 'RECONCILIADOR', motivo: 'CAUSA_REMOVIDA' },
        },
      })
    })
  }

  return res
}

/** Estados de ETAPA que não representam mais trabalho a fazer. */
const STATUS_TERMINAIS_STEP = ['CONCLUIDO', 'CANCELADO', 'DISPENSADO', 'SUPERSEDIDO', 'FALHOU']
