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
    tarefasEncerradasSemCausa: 0, semTitulo: 0, detalhes: [],
  }

  const instancias = await prisma.phaseWorkflowInstance.findMany({
    where: { status: 'ATIVO', ...(opts.processoId ? { processoId: opts.processoId } : {}) },
    select: {
      id: true, processoId: true, faseMacroKey: true, ciclo: true,
      tarefa: { select: { id: true } },
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

    if (inst.tarefa) {
      if (!dryRun) {
        const r = await prisma.$transaction((tx) => sincronizarTarefaComWorkflow(tx, inst.tarefa!.id, agora))
        if (r.mudou) res.tarefasSincronizadas++
      }
      res.detalhes.push({ instanciaId: inst.id, tarefaId: inst.tarefa.id, acao: 'já tinha tarefa · sincronizada' })
      continue
    }

    // Sem etapas vivas não há trabalho a fazer: instância exaurida não ganha
    // tarefa nova só porque continua marcada como ativa.
    const vivos = inst.steps.filter((s) => !STATUS_TERMINAIS_STEP.includes(s.status))
    if (vivos.length === 0) {
      res.detalhes.push({ instanciaId: inst.id, tarefaId: 0, acao: 'sem etapa viva · nada a fazer' })
      continue
    }

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

  // ── TAREFA QUE PERDEU A CAUSA ────────────────────────────────────────────
  // A instância foi cancelada ou superseditada e a tarefa ficou. Ela não é
  // apagada: o histórico é fato. Sai da fila ativa como CANCELADA, e quem
  // olhar depois consegue ver que existiu e por que saiu.
  const orfas = await prisma.tarefa.findMany({
    where: {
      workflowInstanceId: { not: null },
      statusTarefa: { notIn: STATUS_TERMINAIS },
      workflowInstance: { status: { in: ['CANCELADO', 'SUPERSEDIDO'] } },
      ...(opts.processoId ? { processoId: opts.processoId } : {}),
    },
    select: { id: true, workflowInstanceId: true, titulo: true },
  })
  for (const t of orfas) {
    res.tarefasEncerradasSemCausa++
    res.detalhes.push({ instanciaId: t.workflowInstanceId ?? 0, tarefaId: t.id, acao: 'causa encerrada · sairia da fila' })
    if (dryRun) continue
    await prisma.$transaction(async (tx) => {
      await tx.tarefa.update({
        where: { id: t.id },
        data: { statusTarefa: 'CANCELADA', motivoCodigo: 'CAUSA_ENCERRADA', dataConclusao: agora },
      })
      await tx.logAuditoria.create({
        data: {
          acao: 'TAREFA_CANCELADA',
          entidade: 'Tarefa',
          entidadeId: t.id,
          descricao: `Tarefa "${t.titulo}" retirada da fila ativa: o workflow que a originou foi encerrado. Histórico preservado.`,
          detalhes: { workflowInstanceId: t.workflowInstanceId },
        },
      })
    })
  }

  return res
}

/** Estados de ETAPA que não representam mais trabalho a fazer. */
const STATUS_TERMINAIS_STEP = ['CONCLUIDO', 'CANCELADO', 'DISPENSADO', 'SUPERSEDIDO', 'FALHOU']
