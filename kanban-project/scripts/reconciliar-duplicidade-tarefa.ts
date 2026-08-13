// scripts/reconciliar-duplicidade-tarefa.ts
// ============================================================================
// DUAS TAREFAS PARA A MESMA OBRIGAÇÃO — unificar sem perder nada.
//
//   npx tsx scripts/reconciliar-duplicidade-tarefa.ts            (dry-run)
//   npx tsx scripts/reconciliar-duplicidade-tarefa.ts --executar
//
// O defeito que criou essas duplas está corrigido no motor (a identidade da
// unidade de trabalho passou a ter um dono só). Este script trata o passado: as
// duplas que já existem no banco e que nenhum código novo desfaz sozinho.
//
// ─── O QUE É "A MESMA" ──────────────────────────────────────────────────────
// A mesma obrigação, no mesmo processo, no mesmo ciclo — resolvida pela mesma
// normalização que o motor usa. Não é heurística de título nem de data.
//
// ─── QUEM SOBREVIVE ─────────────────────────────────────────────────────────
// A MAIS ANTIGA. Ela é a identidade original do trabalho: é o número que
// aparece no histórico, nas notificações já enviadas e na memória das pessoas.
// Ela é REANCORADA no roteiro que está valendo, então herda os passos que a
// outra vinha executando — o trabalho feito não se perde, muda de dono formal.
//
// ─── O QUE ACONTECE COM A OUTRA ─────────────────────────────────────────────
// É ENCERRADA, nunca apagada: status CANCELADA, motivo nomeado, vínculo
// explícito com a sobrevivente (`previousTarefaId`) e auditoria dos dois lados.
// Quem for ler o histórico daqui a um ano precisa conseguir reconstruir o que
// houve.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não mexe em tarefa concluída nem cancelada, não junta obrigações diferentes,
// não inventa vínculo que o banco não tem, e não roda sozinho: é ato
// administrativo, com dry-run por padrão.
// ============================================================================
import { prisma } from '../lib/prisma'
import { normalizarUnidade, chaveDaUnidade } from '../lib/operacional/identidade-da-tarefa'

import { TERMINAIS_DA_UNIDADE } from '../lib/operacional/identidade-da-tarefa'

const TERMINAIS = [...TERMINAIS_DA_UNIDADE]
const executar = process.argv.includes('--executar')

async function main() {
  const abertas = await prisma.tarefa.findMany({
    where: { statusTarefa: { notIn: TERMINAIS }, processoId: { not: null } },
    select: {
      id: true, titulo: true, processoId: true, necessidadeId: true, documentoId: true,
      pessoaId: true, ciclo: true, statusTarefa: true, dataInicio: true, responsavelId: true,
      workflowInstanceId: true, workflowStepInstanceId: true, faseMacroKey: true,
      chaveIdempotencia: true, causaRemovidaEm: true,
    },
    orderBy: { id: 'asc' },
  })

  // Agrupa pela IDENTIDADE NORMALIZADA — a mesma pergunta que o motor faz.
  const grupos = new Map<string, typeof abertas>()
  for (const t of abertas) {
    const u = await normalizarUnidade(prisma, {
      processoId: t.processoId!, necessidadeId: t.necessidadeId,
      documentoId: t.documentoId, pessoaId: t.pessoaId, ciclo: t.ciclo ?? 1,
    })
    // Sem obrigação, a unidade é o próprio passo: não há dupla a resolver.
    if (u.necessidadeId == null && u.documentoId == null) continue
    const chave = chaveDaUnidade(u)
    const atual = grupos.get(chave)
    if (atual) atual.push(t)
    else grupos.set(chave, [t])
  }

  const duplas = [...grupos.entries()].filter(([, v]) => v.length > 1)
  console.log(`${abertas.length} tarefa(s) aberta(s) · ${grupos.size} unidade(s) · ${duplas.length} com duplicidade`)
  if (duplas.length === 0) { console.log('Nada a reconciliar.'); return }

  for (const [chave, tarefas] of duplas) {
    const [sobrevivente, ...outras] = tarefas
    console.log(`\n${chave}`)
    console.log(`  MANTÉM  #${sobrevivente.id} "${sobrevivente.titulo}" ${sobrevivente.statusTarefa} resp=${sobrevivente.responsavelId ?? '—'} wf=${sobrevivente.workflowInstanceId}`)

    // O roteiro que está VALENDO é o da tarefa mais recente que ainda anda: é
    // nele que os passos abertos vivem. A sobrevivente é reancorada ali.
    const maisRecente = tarefas[tarefas.length - 1]
    for (const o of outras) {
      console.log(`  ENCERRA #${o.id} "${o.titulo}" ${o.statusTarefa} wf=${o.workflowInstanceId} step=${o.workflowStepInstanceId}`)
    }
    if (!executar) continue

    await prisma.$transaction(async (tx) => {
      const u = await normalizarUnidade(tx, {
        processoId: sobrevivente.processoId!, necessidadeId: sobrevivente.necessidadeId,
        documentoId: sobrevivente.documentoId, pessoaId: sobrevivente.pessoaId,
        ciclo: sobrevivente.ciclo ?? 1,
      })
      // Encerra as outras ANTES de reancorar: a chave canônica é única, e as
      // duas não podem carregá-la ao mesmo tempo.
      for (const o of outras) {
        await tx.tarefa.update({
          where: { id: o.id },
          data: {
            statusTarefa: 'CANCELADA', concluida: false, dataConclusao: new Date(),
            motivoCodigo: 'DUPLICIDADE_UNIFICADA',
            justificativa: `Mesma obrigação da tarefa #${sobrevivente.id}. O trabalho continua lá.`,
            previousTarefaId: sobrevivente.id,
            chaveIdempotencia: `${o.chaveIdempotencia ?? `dup${o.id}`}|unificada-em-${sobrevivente.id}`,
            lockVersion: { increment: 1 },
          },
        })
        await tx.logAuditoria.create({
          data: {
            acao: 'TAREFA_UNIFICADA', entidade: 'Tarefa', entidadeId: o.id,
            descricao:
              `Tarefa "${o.titulo}" era a MESMA obrigação da tarefa #${sobrevivente.id} — ` +
              `duas tarefas nasceram para uma certidão só, por divergência de identidade entre ` +
              `o reconciliador e a mudança de fase. Encerrada aqui; o trabalho segue em #${sobrevivente.id}. ` +
              `Nada foi apagado: passos, anexos e histórico permanecem.`,
            detalhes: {
              tarefaId: o.id, sobreviventeId: sobrevivente.id, chaveUnidade: chave,
              statusAnterior: o.statusTarefa, workflowInstanceId: o.workflowInstanceId,
              workflowStepInstanceId: o.workflowStepInstanceId,
            },
          },
        })
      }

      // A sobrevivente assume o roteiro vivo e a identidade canônica.
      const alvoAncora = maisRecente.id === sobrevivente.id ? sobrevivente : maisRecente
      const passoAberto = await tx.phaseWorkflowStepInstance.findFirst({
        where: {
          workflowInstanceId: alvoAncora.workflowInstanceId ?? undefined,
          status: { notIn: ['CONCLUIDO', 'DISPENSADO', 'SUPERSEDIDO', 'CANCELADO'] },
          OR: [
            ...(u.necessidadeId != null ? [{ necessidadeId: u.necessidadeId }] : []),
            ...(u.documentoId != null ? [{ documentoId: u.documentoId }] : []),
          ],
        },
        orderBy: { ordem: 'asc' },
        select: { id: true },
      })
      await tx.tarefa.update({
        where: { id: sobrevivente.id },
        data: {
          workflowInstanceId: alvoAncora.workflowInstanceId,
          workflowStepInstanceId: passoAberto?.id ?? alvoAncora.workflowStepInstanceId,
          faseMacroKey: alvoAncora.faseMacroKey,
          chaveIdempotencia: chaveDaUnidade(u),
          necessidadeId: u.necessidadeId ?? undefined,
          documentoId: u.documentoId ?? undefined,
          pessoaId: u.pessoaId ?? undefined,
          // A obrigação está viva: a marca de "perdeu a causa" era sintoma da
          // duplicidade, não fato sobre a exigência.
          causaRemovidaEm: null, causaRemovidaMotivo: null,
          lockVersion: { increment: 1 },
        },
      })
      await tx.logAuditoria.create({
        data: {
          acao: 'TAREFA_UNIFICADA', entidade: 'Tarefa', entidadeId: sobrevivente.id,
          descricao:
            `Tarefa "${sobrevivente.titulo}" absorveu ${outras.length} tarefa(s) da MESMA obrigação ` +
            `(${outras.map((o) => `#${o.id}`).join(', ')}) e passou a apontar para o roteiro em curso. ` +
            `Responsável, datas e histórico preservados.`,
          detalhes: {
            tarefaId: sobrevivente.id, absorvidas: outras.map((o) => o.id), chaveUnidade: chave,
            workflowInstanceId: alvoAncora.workflowInstanceId, stepInstanceId: passoAberto?.id ?? null,
          },
        },
      })
    })
    console.log('  ✓ unificada')
  }
  console.log(executar ? '\nReconciliação aplicada.' : '\nDRY-RUN. Nada foi escrito. Use --executar.')
}

main().finally(() => prisma.$disconnect())
