// lib/operacional/tarefa-etapa.ts
// ============================================================================
// CONCLUIR UMA ETAPA INTERNA — a última porta do motor.
//
// É a operação mais delicada do conjunto, porque é a única que toca no
// WORKFLOW e não só na tarefa. Concluir "enviar ao cartório" avança o roteiro;
// concluir "validar" encerra o trabalho. A diferença entre as duas está no
// workflow, nunca em quem chamou.
//
// ─── O QUE ESTA PORTA IMPEDE ────────────────────────────────────────────────
// Sem ela, a tela concluiria etapa com `phaseWorkflowStepInstance.update` —
// e aí o passo mudaria sozinho, sem ativar o próximo, sem recalcular a tarefa,
// sem auditoria e, no caso do último passo, sem concluir o trabalho. A tarefa
// ficaria eternamente aberta com todas as etapas prontas.
//
// ─── CONCLUIR ETAPA NÃO É CONCLUIR TAREFA ───────────────────────────────────
// Cinco das seis conclusões de um pedido de certidão NÃO encerram nada: elas
// movem o trabalho adiante. Só a última encerra, e quem decide qual é a última
// é o próprio workflow — o motor não tem lista de "etapas finais".
// ============================================================================
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { STATUS_TERMINAIS, escopoDaUnidade, estadoDerivado, etapaCorrente } from './tarefa-canonica'
import { transicionarPassoTx, ativarProximoPassoTx, aplicarTarefaTx } from '@/src/services/task-step-sync'
import { assegurarCoerenciaPassoTarefa } from '@/src/services/passo-tarefa-projecao'
import { processarOutbox } from '@/src/services/outbox-dispatcher'
import { tentarAvancoAutomatico } from '@/src/lib/motor/auto-avanco'

export type FalhaEtapa =
  | 'TAREFA_NAO_ENCONTRADA' | 'ETAPA_NAO_ENCONTRADA' | 'ETAPA_DE_OUTRA_TAREFA'
  | 'TAREFA_TERMINAL' | 'TAREFA_BLOQUEADA' | 'TAREFA_AGUARDANDO'
  | 'ETAPA_NAO_EXECUTAVEL' | 'DEPENDENCIA_PENDENTE' | 'EVIDENCIA_FALTANDO'
  | 'CONFLITO'

export type ResultadoEtapa =
  | {
      ok: true
      tarefaId: number
      etapaConcluidaId: number
      /** Já estava concluída — o retry não repetiu o efeito. */
      jaEstavaConcluida: boolean
      proximaEtapaId: number | null
      tarefaConcluida: boolean
      statusTarefa: string
    }
  | { ok: false; codigo: FalhaEtapa; mensagem: string }

/** Estados em que a etapa ainda pode ser trabalhada. */
const EXECUTAVEIS = ['DISPONIVEL', 'EM_ANDAMENTO', 'EXECUTADO', 'AGUARDANDO_APROVACAO']

/**
 * AS EVIDÊNCIAS QUE A ETAPA EXIGE.
 *
 * O cadastro declara, por `stepKey`, quais documentos precisam existir antes de
 * a etapa poder ser dada como feita. Validar isto no backend é o que impede
 * "concluído" de significar "cliquei no botão": sem o requerimento anexado, o
 * pedido não foi ao cartório, por mais que a tela diga que sim.
 */
async function evidenciasFaltando(
  tx: Prisma.TransactionClient,
  step: { stepKey: string; documentoId: number | null; processoId: number },
): Promise<string[]> {
  const exigencias = await tx.exigenciaEvidenciaEtapa.findMany({
    where: {
      stepKey: step.stepKey,
      ...(step.documentoId != null ? {} : { documentoTipoId: null }),
    },
    select: { evidenciaTipoId: true, evidenciaTipo: { select: { name: true } }, documentoTipoId: true },
  })
  if (exigencias.length === 0) return []

  // A exigência é sobre o DOCUMENTO desta etapa. Sem documento operacional
  // ligado, exigência com tipo específico não se aplica.
  const doc = step.documentoId != null
    ? await tx.documento.findUnique({ where: { id: step.documentoId }, select: { id: true, documentTypeId: true } })
    : null

  const faltando: string[] = []
  for (const e of exigencias) {
    if (e.documentoTipoId != null && e.documentoTipoId !== doc?.documentTypeId) continue
    const tem = await tx.documentoArquivo.count({
      where: {
        documentTypeId: e.evidenciaTipoId,
        ...(doc ? { documentoId: doc.id } : { documento: { pessoa: { arvore: { processos: { some: { id: step.processoId } } } } } }),
      },
    })
    if (tem === 0) faltando.push(e.evidenciaTipo?.name ?? `tipo ${e.evidenciaTipoId}`)
  }
  return faltando
}

/**
 * CONCLUI A ETAPA E MOVE O TRABALHO — transacional do começo ao fim.
 *
 * `etapaId` ausente conclui a ETAPA CORRENTE da tarefa. É o caso normal da
 * tela: quem trabalha conclui "a etapa em que estou", não um id que ele não
 * conhece.
 */
export async function concluirEtapa(args: {
  tarefaId: number
  etapaId?: number | null
  autorId: number
  observacao?: string | null
  /** ADMIN pode concluir etapa de tarefa bloqueada; o executor, não. */
  permiteForcar?: boolean
}): Promise<ResultadoEtapa> {
  const agora = new Date()
  // Correlaciona, num id só, tudo o que este clique produziu: a conclusão do
  // passo, a ativação do seguinte, o evento de workflow e o avanço de fase.
  const correlationId = randomUUID()
  /** Preenchido dentro da transação; os efeitos pós-commit precisam dele. */
  let processoAfetado: number | null = null

  const resultado = await prisma.$transaction(async (tx) => {
    const tarefa = await tx.tarefa.findUnique({
      where: { id: args.tarefaId },
      select: {
        id: true, titulo: true, statusTarefa: true, workflowInstanceId: true,
        workflowStepInstanceId: true, dataInicio: true, dataConclusao: true, lockVersion: true,
        // A UNIDADE DE TRABALHO. Sem ela esta porta lia os passos da FASE
        // inteira — ver o comentário da consulta abaixo.
        necessidadeId: true, documentoId: true,
      },
    })
    if (!tarefa) return { ok: false as const, codigo: 'TAREFA_NAO_ENCONTRADA' as const, mensagem: 'Tarefa não existe.' }

    // §14 — encerrada não se trabalha. Para retomar existe reabertura.
    if (STATUS_TERMINAIS.includes(tarefa.statusTarefa)) {
      return {
        ok: false as const, codigo: 'TAREFA_TERMINAL' as const,
        mensagem: `Tarefa já encerrada (${tarefa.statusTarefa}). Reabra antes de concluir etapas.`,
      }
    }
    // §15 — bloqueio é impedimento real: concluir por cima esconderia o motivo
    // pelo qual o trabalho parou. Só o administrador força, e fica auditado.
    if (tarefa.statusTarefa === 'BLOQUEADA' && !args.permiteForcar) {
      return {
        ok: false as const, codigo: 'TAREFA_BLOQUEADA' as const,
        mensagem: 'A tarefa está bloqueada — desbloqueie antes de concluir a etapa.',
      }
    }
    // §16 — a volta do terceiro tem porta própria. Concluir direto da espera
    // pularia o cálculo da pausa de SLA e o registro de que a resposta chegou.
    if (tarefa.statusTarefa === 'AGUARDANDO_TERCEIRO' && !args.permiteForcar) {
      return {
        ok: false as const, codigo: 'TAREFA_AGUARDANDO' as const,
        mensagem: 'A tarefa aguarda terceiro — registre a retomada antes de concluir a etapa.',
      }
    }
    if (!tarefa.workflowInstanceId) {
      return {
        ok: false as const, codigo: 'ETAPA_NAO_ENCONTRADA' as const,
        mensagem: 'Esta tarefa não tem workflow — não há etapa a concluir.',
      }
    }

    // OS PASSOS DESTA UNIDADE — não os da instância inteira.
    //
    // A instância é da FASE e abriga uma tarefa por certidão. Lendo todos os
    // passos dela, esta porta misturava o trabalho de pessoas diferentes em
    // QUATRO lugares de uma vez: a etapa corrente era a de outro documento, a
    // dependência casava `solicitar_certidao` alheio, o estado derivado da
    // tarefa dependia do que faltava nas outras certidões, e o ponteiro da
    // etapa acabava apontando para o documento de outra pessoa — que é
    // exatamente o que o "Continuar" da fila abriria.
    //
    // O escopo é o mesmo que a sincronização canônica usa; ele mora num lugar só.
    const steps = await tx.phaseWorkflowStepInstance.findMany({
      where: escopoDaUnidade({
        workflowInstanceId: tarefa.workflowInstanceId,
        necessidadeId: tarefa.necessidadeId,
        documentoId: tarefa.documentoId,
        workflowStepInstanceId: tarefa.workflowStepInstanceId,
      }),
      select: {
        id: true, status: true, obrigatorio: true, ordem: true, stepKey: true,
        documentoId: true, necessidadeId: true, processoId: true, dependeDeStepKeys: true, ciclo: true,
      },
      orderBy: { ordem: 'asc' },
    })

    const alvo = args.etapaId != null
      ? steps.find((s) => s.id === args.etapaId)
      : etapaCorrente(steps)
    if (!alvo) {
      return args.etapaId != null
        ? { ok: false as const, codigo: 'ETAPA_DE_OUTRA_TAREFA' as const, mensagem: 'Esta etapa não pertence ao workflow desta tarefa.' }
        : { ok: false as const, codigo: 'ETAPA_NAO_ENCONTRADA' as const, mensagem: 'Não há etapa executável nesta tarefa.' }
    }

    // §8 — RETRY IDEMPOTENTE. Concluir de novo a mesma etapa devolve o estado
    // atual sem repetir efeito nem gravar um segundo evento de auditoria.
    if (alvo.status === 'CONCLUIDO') {
      const proxima = etapaCorrente(steps)
      return {
        ok: true as const,
        tarefaId: tarefa.id,
        etapaConcluidaId: alvo.id,
        jaEstavaConcluida: true,
        proximaEtapaId: proxima?.id ?? null,
        tarefaConcluida: STATUS_TERMINAIS.includes(tarefa.statusTarefa),
        statusTarefa: tarefa.statusTarefa,
      }
    }
    // Etapas anteriores obrigatórias precisam estar prontas: concluir a 5 antes
    // da 3 faria o roteiro contar uma história que não aconteceu.
    const dependeDe = Array.isArray(alvo.dependeDeStepKeys) ? (alvo.dependeDeStepKeys as string[]) : []
    const pendentes = dependeDe.length > 0
      ? steps.filter((s) => dependeDe.includes(s.stepKey) && s.status !== 'CONCLUIDO' && s.status !== 'DISPENSADO')
      : steps.filter((s) => s.obrigatorio && s.ordem < alvo.ordem && !['CONCLUIDO', 'DISPENSADO', 'CANCELADO', 'SUPERSEDIDO'].includes(s.status))
    if (pendentes.length > 0) {
      return {
        ok: false as const, codigo: 'DEPENDENCIA_PENDENTE' as const,
        mensagem: `Etapas anteriores ainda abertas: ${pendentes.map((s) => s.stepKey).join(', ')}.`,
      }
    }

    // A DEPENDÊNCIA É VERIFICADA ANTES DO ESTADO, e a ordem importa para quem
    // lê o erro: uma etapa fora de ordem está PENDENTE *porque* as anteriores
    // não terminaram. Responder "a etapa está PENDENTE" seria descrever o
    // sintoma; o operador precisa saber o que falta fazer.
    if (!EXECUTAVEIS.includes(alvo.status)) {
      return {
        ok: false as const, codigo: 'ETAPA_NAO_EXECUTAVEL' as const,
        mensagem: `A etapa está ${alvo.status} — não pode ser concluída neste estado.`,
      }
    }

    // §13 — o que o cadastro exige antes de a etapa poder ser dada como feita.
    const faltando = await evidenciasFaltando(tx, alvo)
    if (faltando.length > 0 && !args.permiteForcar) {
      return {
        ok: false as const, codigo: 'EVIDENCIA_FALTANDO' as const,
        mensagem: `Faltam evidências exigidas para esta etapa: ${faltando.join(', ')}.`,
      }
    }

    // §9 — A TRANSIÇÃO DO PASSO É DELEGADA AO DONO DELA.
    //
    // `transicionarPassoTx` é a mesma função que as portas de `task-step-sync`
    // usam: valida pela precedência, grava com CAS por (status + lockVersion),
    // emite `WorkflowEvento` e publica no outbox. Escrever
    // `phaseWorkflowStepInstance.updateMany` aqui — como esta porta fazia —
    // criava uma segunda máquina de estados: concluir pela tela emitia evento,
    // concluir por aqui não, e o histórico dependia do botão usado.
    const transicao = await transicionarPassoTx(tx, alvo.id, 'CONCLUIDO', {
      correlationId,
      operacao: 'tarefa-concluir-etapa',
      ciclo: alvo.ciclo,
      processoId: alvo.processoId,
      workflowInstanceId: tarefa.workflowInstanceId,
      ...(args.observacao ? { extra: { motivo: args.observacao.slice(0, 300) } } : {}),
    })
    if (!transicao.changed) {
      return transicao.code === 'TRANSICAO_INVALIDA'
        ? {
            ok: false as const, codigo: 'ETAPA_NAO_EXECUTAVEL' as const,
            mensagem: `A etapa está ${transicao.anterior} — não pode ser concluída neste estado.`,
          }
        : {
            ok: false as const, codigo: 'CONFLITO' as const,
            mensagem: 'A etapa mudou de estado enquanto você a concluía — recarregue e tente de novo.',
          }
    }

    // A PRÓXIMA ETAPA EXECUTÁVEL é ativada aqui, e só aqui — pela mesma porta.
    // Se a tela fizesse isso, uma conclusão sem ativação deixaria o trabalho
    // parado com todas as etapas pendentes e ninguém sabendo o que fazer em
    // seguida.
    const depois = steps.map((s) => (s.id === alvo.id ? { ...s, status: 'CONCLUIDO' } : s))
    const ativadaId = await ativarProximoPassoTx(
      tx,
      {
        workflowInstanceId: tarefa.workflowInstanceId,
        ordemConcluida: alvo.ordem,
        // A próxima etapa é a DESTE documento. A unidade vem do passo que
        // acabou de fechar — ele sabe de qual obrigação é.
        necessidadeId: alvo.necessidadeId,
        documentoId: alvo.documentoId,
      },
      { correlationId, operacao: 'tarefa-ativar-proxima-etapa' },
    )
    const proxima = ativadaId != null ? depois.find((s) => s.id === ativadaId) : undefined
    if (proxima) proxima.status = 'DISPONIVEL'

    // O ESTADO DA TAREFA é RECALCULADO, nunca decidido aqui. Quem sabe se o
    // trabalho acabou é o conjunto das etapas obrigatórias.
    const { status } = estadoDerivado(depois, { iniciada: tarefa.dataInicio != null })
    const corrente = etapaCorrente(depois)
    const concluiuAgora = STATUS_TERMINAIS.includes(status) && !STATUS_TERMINAIS.includes(tarefa.statusTarefa)

    // A MUDANÇA DE ESTADO DA TAREFA PASSA PELO MESMO APLICADOR DA CENTRAL.
    //
    // É o que garante que a conclusão apareça no histórico do workflow venha de
    // onde vier: antes, concluir pela Central emitia TAREFA_CONCLUIDA e concluir
    // por aqui não emitia nada — a mesma tarefa, o mesmo fim, e o evento existia
    // ou não conforme o botão.
    if (status !== tarefa.statusTarefa) {
      await aplicarTarefaTx(tx, tarefa.id, status, concluiuAgora ? 'TAREFA_CONCLUIDA' : 'TAREFA_SINCRONIZADA', {
        correlationId,
        operacao: 'tarefa-concluir-etapa',
        ciclo: alvo.ciclo,
        processoId: alvo.processoId,
        workflowInstanceId: tarefa.workflowInstanceId,
      })
    }

    // O que é SÓ da camada de tarefa — o ponteiro da etapa corrente e as datas
    // do trabalho — continua sendo escrito aqui.
    await tx.tarefa.update({
      where: { id: tarefa.id },
      data: {
        workflowStepInstanceId: corrente?.id ?? null,
        ...(concluiuAgora && tarefa.dataConclusao == null ? { dataConclusao: agora } : {}),
        ...(tarefa.dataInicio == null ? { dataInicio: agora } : {}),
        lockVersion: { increment: 1 },
      },
    })

    // §10 — UM registro por conclusão, com tudo o que a auditoria precisa.
    await tx.logAuditoria.create({
      data: {
        acao: concluiuAgora ? 'TAREFA_ETAPA_CONCLUIDA_E_TAREFA_CONCLUIDA' : 'TAREFA_ETAPA_CONCLUIDA',
        entidade: 'Tarefa',
        entidadeId: tarefa.id,
        usuarioId: args.autorId,
        descricao:
          `Etapa "${alvo.stepKey}" concluída na tarefa "${tarefa.titulo}".` +
          (proxima ? ` Próxima etapa: "${proxima.stepKey}".` : ' Não há próxima etapa.') +
          (concluiuAgora ? ' O workflow chegou ao fim e a tarefa foi concluída.' : ` A tarefa segue ${status}.`) +
          (faltando.length > 0 ? ` FORÇADA — evidências faltando: ${faltando.join(', ')}.` : ''),
        detalhes: {
          tarefaId: tarefa.id,
          workflowInstanceId: tarefa.workflowInstanceId,
          etapaId: alvo.id,
          stepKey: alvo.stepKey,
          etapaDe: alvo.status,
          etapaPara: 'CONCLUIDO',
          tarefaDe: tarefa.statusTarefa,
          tarefaPara: status,
          proximaEtapaId: proxima?.id ?? null,
          forcada: !!args.permiteForcar && faltando.length > 0,
          evidenciasFaltando: faltando,
          observacao: args.observacao ?? null,
          em: agora.toISOString(),
        },
      },
    })

    // TRAVA ANTES DO COMMIT — a mesma que `task-step-sync` usa. Se o par
    // (passo, tarefa) ficar contraditório, a transação inteira volta atrás. Um
    // estado meio-atualizado é pior do que a operação recusada: ele fica no
    // banco parecendo verdade.
    await assegurarCoerenciaPassoTarefa(tx, [alvo.id, ...(proxima ? [proxima.id] : [])])

    processoAfetado = alvo.processoId

    return {
      ok: true as const,
      tarefaId: tarefa.id,
      etapaConcluidaId: alvo.id,
      jaEstavaConcluida: false,
      proximaEtapaId: proxima?.id ?? null,
      tarefaConcluida: concluiuAgora,
      statusTarefa: status,
    }
  })

  // ─── EFEITOS PÓS-COMMIT ────────────────────────────────────────────────────
  // Só depois do commit, e só quando a etapa realmente mudou agora. Os dois são
  // best-effort de propósito: o evento já está gravado, então uma falha aqui
  // atrasa o efeito, não o perde — o outbox reprocessa e o avanço é reavaliado
  // na próxima conclusão.
  if (resultado.ok && !resultado.jaEstavaConcluida) {
    // Antecipa a projeção financeira documental para o mesmo clique, em vez de
    // esperar o próximo ciclo da fila.
    await processarOutbox({ tipos: ['step.concluido'], limite: 20 }).catch(() => {})
    // AVANÇO AUTOMÁTICO DE FASE. Concluir a última etapa da última tarefa de
    // uma fase é o que fecha a fase — e isso não pode depender de qual porta o
    // operador usou. Antes desta consolidação, concluir pela rota antiga
    // avançava a fase e concluir por esta porta não.
    await tentarAvancoAutomatico(processoAfetado)
  }

  return resultado
}
