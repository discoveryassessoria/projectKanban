// src/services/genealogia/trava-emissao-por-genealogia.ts
// ============================================================================
// "LOCALIZAR REGISTRO" ABERTO TRAVA A EMISSÃO E REABRE A GENEALOGIA (06/10/2026).
//
// Regra do dono: NUNCA se solicita uma certidão cujos dados registrais ainda não foram localizados. Defeito real (processo 683, Fogli):
// o Rodolfo entrou na árvore com a Genealogia já concluída → o materializador não achou instância ativa e NÃO criou o "Localizar registro";
// a Emissão, que só olha a necessidade, abriu as 3 certidões dele. Mesma família (Carlota, processo 676): o passo "Localizar registro" foi
// reaberto DEPOIS de a Genealogia ter avançado e nada mais reagiu.
//
// Uma só regra, aplicada por um só reconciliador (`reconciliarGenealogiaEEmissaoTx`), chamado por TODA porta que muda o estado de um passo
// "Localizar registro" (task-step-sync), por TODA materialização da Genealogia, pela materialização da fase e pelo motor de fases (cron):
//   1. GENEALOGIA REABRE: passo "Localizar registro" aberto numa instância CONCLUÍDA → a instância volta a ATIVO (histórico preservado,
//      nada é apagado) e o histórico do processo registra "Genealogia reaberta: …". Aberto, o passo vira tarefa e a Genealogia deixa de dar 100%.
//   2. EMISSÃO TRAVA: o passo "Solicitar certidão" da MESMA necessidade (ainda não iniciado) vai a BLOQUEADO com o motivo
//      `MOTIVO_AGUARDANDO_GENEALOGIA`; a tarefa converge pela projeção passo→tarefa. As demais certidões não são tocadas.
//   3. LIBERA SOZINHO: concluído o "Localizar registro" (ou dispensado/cancelado), o passo da Emissão volta ao estado de antes. Só libera o
//      que ESTA regra travou (motivo exato) — bloqueio manual nunca é desfeito aqui.
//   4. GENEALOGIA FECHA DE NOVO: instância reaberta por esta regra, sem nenhum passo aberto, volta a CONCLUÍDO.
// Casamento é da UNIÃO (`NecessidadeDocumental.uniaoId`): a identidade do passo é a necessidade, então vale igual para pessoa e união.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { STEP_KEY_LOCALIZAR_REGISTRO, STEP_KEY_SOLICITAR_CERTIDAO } from "@/src/lib/process-stage/situacao-solicitacao-certidao"
import { projetarTarefaDoPasso } from "@/src/services/passo-tarefa-projecao"
import { reancorarTarefaNoPasso } from "@/lib/operacional/tarefa-canonica"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"

type TX = Prisma.TransactionClient
type DB = TX | typeof prisma

export const FASE_GENEALOGIA_KEY = "genealogia"
export const MOTIVO_AGUARDANDO_GENEALOGIA = "Aguardando Genealogia"
export const ORIGEM_REABERTURA_POR_PENDENCIA = "PENDENCIA_LOCALIZAR_REGISTRO"
const ACAO_GENEALOGIA_REABERTA = "GENEALOGIA_REABERTA"
/** Marca da Tarefa que a regra REANCOROU no "Localizar registro" (a tarefa é UMA por obrigação: o trabalho aberto agora é localizar). */
export const MOTIVO_TAREFA_REANCORADA = "REANCORADA_GENEALOGIA"

/** O passo "Localizar registro" está resolvido (localizado, dispensado, cancelado ou de ciclo antigo)? */
const LOCALIZAR_RESOLVIDO = ["CONCLUIDO", "DISPENSADO", "CANCELADO", "SUPERSEDIDO"] as const
/** Estados da Emissão que ainda NÃO começaram: só estes são travados (trabalho em curso não é interrompido). */
const EMISSAO_TRAVAVEL = ["PENDENTE", "DISPONIVEL"] as const
const INSTANCIA_VIVA = ["ATIVO", "BLOQUEADO", "AGUARDANDO"] as const

async function emTx<T>(db: DB, fn: (tx: TX) => Promise<T>): Promise<T> {
  if ("$transaction" in db) return (db as typeof prisma).$transaction((tx) => fn(tx), { maxWait: 20_000, timeout: 60_000 })
  return fn(db as TX)
}

/** Nome legível do sujeito da necessidade: a pessoa, ou "A e B" para a união (casamento). */
export async function rotuloDoSujeito(db: DB, necessidadeId: number): Promise<string> {
  const n = await db.necessidadeDocumental.findUnique({
    where: { id: necessidadeId },
    select: {
      pessoa: { select: { nome: true, sobrenome: true } },
      uniao: { select: { pessoa1: { select: { nome: true, sobrenome: true } }, pessoa2: { select: { nome: true, sobrenome: true } } } },
    },
  })
  const nome = (p: { nome: string; sobrenome: string | null } | null | undefined) => (p ? `${p.nome}${p.sobrenome ? ` ${p.sobrenome}` : ""}`.trim() : null)
  if (n?.pessoa) return nome(n.pessoa) ?? "pessoa"
  const a = nome(n?.uniao?.pessoa1), b = nome(n?.uniao?.pessoa2)
  return [a, b].filter(Boolean).join(" e ") || "pessoa"
}

/**
 * A Genealogia JÁ CONCLUÍDA volta a ATIVO porque apareceu um "Localizar registro" aberto. A instância concluída mais recente é a que reabre
 * (nunca cria ciclo novo: a identidade do trabalho é a mesma). Devolve a instância viva (a que já existia ou a reaberta) ou `null` se o
 * processo nunca teve Genealogia.
 */
export async function reabrirGenealogiaPorPendenciaTx(
  tx: TX,
  processoId: number,
  o: { descricao: string; necessidadeIds?: number[]; usuarioId?: number | null },
): Promise<{ id: number; ciclo: number; reaberta: boolean } | null> {
  const viva = await tx.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: FASE_GENEALOGIA_KEY, status: { in: [...INSTANCIA_VIVA] } },
    orderBy: { ciclo: "desc" }, select: { id: true, ciclo: true },
  })
  if (viva) return { ...viva, reaberta: false }
  const concluida = await tx.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: FASE_GENEALOGIA_KEY, status: "CONCLUIDO" },
    orderBy: { ciclo: "desc" }, select: { id: true, ciclo: true },
  })
  if (!concluida) return null
  const r = await tx.phaseWorkflowInstance.updateMany({ where: { id: concluida.id, status: "CONCLUIDO" }, data: { status: "ATIVO", completedAt: null } })
  if (r.count === 0) return { ...concluida, reaberta: false }
  const nec = (o.necessidadeIds ?? []).slice().sort((a, b) => a - b).join("-") || "x"
  const quando = Date.now()
  await tx.workflowEvento.create({
    data: {
      tipo: "WORKFLOW_REABERTO", entityType: "workflow_instance", entityId: concluida.id, processoId, workflowInstanceId: concluida.id,
      correlationId: `genealogia-reaberta|${processoId}|${quando}`, causationId: `genealogia-reaberta|wfi${concluida.id}|n${nec}`,
      chaveIdempotencia: `evt|genealogia-reaberta|wfi${concluida.id}|n${nec}|${quando}`,
      dados: { origem: ORIGEM_REABERTURA_POR_PENDENCIA, motivo: o.descricao, necessidadeIds: o.necessidadeIds ?? [] } as Prisma.InputJsonValue,
    },
  })
  await tx.logAuditoria.create({
    data: {
      acao: ACAO_GENEALOGIA_REABERTA, entidade: "Processo", entidadeId: processoId, usuarioId: o.usuarioId ?? null,
      descricao: `Genealogia reaberta: ${o.descricao}`,
      detalhes: { processoId, workflowInstanceId: concluida.id, motivo: o.descricao, necessidadeIds: o.necessidadeIds ?? [] } as Prisma.InputJsonValue,
    },
  })
  return { id: concluida.id, ciclo: concluida.ciclo, reaberta: true }
}

/** Necessidade NOVA (pessoa/união que entrou na linhagem depois da Genealogia concluir) precisa de "Localizar registro": reabre a Genealogia. */
export async function reabrirGenealogiaParaNecessidadeTardiaTx(tx: TX, processoId: number, necessidadeId: number): Promise<{ id: number; ciclo: number; reaberta: boolean } | null> {
  const n = await tx.necessidadeDocumental.findUnique({ where: { id: necessidadeId }, select: { uniaoId: true } })
  const sujeito = await rotuloDoSujeito(tx, necessidadeId)
  const descricao = n?.uniaoId != null ? `casamento de ${sujeito} adicionado à linhagem` : `pessoa ${sujeito} adicionada à linhagem`
  return reabrirGenealogiaPorPendenciaTx(tx, processoId, { descricao, necessidadeIds: [necessidadeId] })
}

export interface ResultadoTrava { bloqueados: number; liberados: number; genealogiaReaberta: number; genealogiaFechada: number; tarefasReancoradas: number }

/**
 * O RECONCILIADOR ÚNICO (idempotente). Lê o estado e converge: reabre a Genealogia onde há "Localizar registro" aberto em instância concluída,
 * trava/libera a Emissão pela necessidade e fecha a Genealogia reaberta quando nada mais está aberto.
 */
export async function reconciliarGenealogiaEEmissaoTx(tx: TX, processoId: number): Promise<ResultadoTrava> {
  const res: ResultadoTrava = { bloqueados: 0, liberados: 0, genealogiaReaberta: 0, genealogiaFechada: 0, tarefasReancoradas: 0 }

  const locAbertos = await tx.phaseWorkflowStepInstance.findMany({
    where: { processoId, stepKey: STEP_KEY_LOCALIZAR_REGISTRO, status: { notIn: [...LOCALIZAR_RESOLVIDO] }, necessidadeId: { not: null } },
    select: { id: true, necessidadeId: true, workflowInstanceId: true, workflowInstance: { select: { status: true, faseMacroKey: true } } },
  })

  // 1) Genealogia reaberta quando o passo aberto está numa instância concluída.
  const emConcluida = locAbertos.filter((s) => s.workflowInstance.faseMacroKey === FASE_GENEALOGIA_KEY && s.workflowInstance.status === "CONCLUIDO")
  if (emConcluida.length > 0) {
    const ids = [...new Set(emConcluida.map((s) => s.necessidadeId as number))]
    const nomes = [...new Set(await Promise.all(ids.map((id) => rotuloDoSujeito(tx, id))))]
    const r = await reabrirGenealogiaPorPendenciaTx(tx, processoId, {
      descricao: nomes.length === 1 ? `registro de ${nomes[0]} voltou a ser pendente (Localizar registro aberto)` : `registros de ${nomes.join(", ")} voltaram a ser pendentes (Localizar registro aberto)`,
      necessidadeIds: ids,
    })
    if (r?.reaberta) res.genealogiaReaberta++
  }

  // 2) e 3) Emissão: trava/libera por necessidade.
  const abertas = new Set(locAbertos.map((s) => s.necessidadeId as number))
  const emissao = await tx.phaseWorkflowStepInstance.findMany({
    where: { processoId, stepKey: STEP_KEY_SOLICITAR_CERTIDAO, status: { in: [...EMISSAO_TRAVAVEL, "BLOQUEADO"] } },
    select: { id: true, status: true, motivo: true, statusAnteriorBloqueio: true, necessidadeId: true, documentoId: true, ciclo: true, workflowInstanceId: true },
  })
  if (emissao.length > 0) {
    const docIds = emissao.map((e) => e.documentoId).filter((x): x is number => x != null)
    const docs = docIds.length ? await tx.documento.findMany({ where: { id: { in: docIds } }, select: { id: true, necessidadeId: true } }) : []
    const necDoDoc = new Map(docs.map((d) => [d.id, d.necessidadeId]))
    const { transicionarPassoTx } = await import("@/src/services/task-step-sync")
    const { restaurarStatusPasso } = await import("@/src/services/task-step-sync-helpers")
    for (const e of emissao) {
      const nec = e.necessidadeId ?? (e.documentoId != null ? necDoDoc.get(e.documentoId) ?? null : null)
      if (nec == null) continue
      const correlationId = `trava-genealogia|${processoId}|s${e.id}|${Date.now()}`
      const base = { correlationId, operacao: "genealogia-trava", ciclo: e.ciclo ?? 1, processoId, workflowInstanceId: e.workflowInstanceId, ignorarDependencias: true } as const
      if (abertas.has(nec) && (EMISSAO_TRAVAVEL as readonly string[]).includes(e.status)) {
        const r = await transicionarPassoTx(tx, e.id, "BLOQUEADO", { ...base, extra: { motivo: MOTIVO_AGUARDANDO_GENEALOGIA, statusAnteriorBloqueio: e.status } })
        if (r.changed) {
          res.bloqueados++
          // A TAREFA É UMA POR OBRIGAÇÃO (taskId preservado): a que já estava na Emissão passa a mostrar o trabalho que está aberto AGORA —
          // localizar o registro. Sem isto a tarefa ficava bloqueada na Emissão e o "Localizar registro" não aparecia para ninguém.
          const loc = locAbertos.find((l) => l.necessidadeId === nec && l.workflowInstance.faseMacroKey === FASE_GENEALOGIA_KEY)
          const tarefa = await tx.tarefa.findFirst({
            where: { workflowStepInstanceId: e.id, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } },
            select: { id: true },
          })
          if (tarefa && loc) {
            await reancorarTarefaNoPasso(tx, tarefa.id, { workflowInstanceId: loc.workflowInstanceId, workflowStepInstanceId: loc.id, faseMacroKey: FASE_GENEALOGIA_KEY, motivoCodigo: MOTIVO_TAREFA_REANCORADA }, new Date())
            res.tarefasReancoradas++
          }
        }
      } else if (!abertas.has(nec) && e.status === "BLOQUEADO" && e.motivo === MOTIVO_AGUARDANDO_GENEALOGIA) {
        const alvo = restaurarStatusPasso(e.statusAnteriorBloqueio)
        const r = await transicionarPassoTx(tx, e.id, alvo, {
          ...base, tipoEvento: "PASSO_DESBLOQUEADO", extra: { motivo: null, statusAnteriorBloqueio: null, blockedAt: null },
        })
        if (r.changed) {
          res.liberados++
          // A tarefa da obrigação que estava no "Localizar registro" (levada pela regra ou nascida lá) segue para a certidão (mesmo taskId).
          const volta = await tx.tarefa.findFirst({
            where: { processoId, OR: [{ necessidadeId: nec }, ...(e.documentoId != null ? [{ documentoId: e.documentoId }] : [])], workflowInstance: { faseMacroKey: FASE_GENEALOGIA_KEY }, statusTarefa: { notIn: ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"] } },
            select: { id: true },
          })
          if (volta) {
            const inst = await tx.phaseWorkflowInstance.findUnique({ where: { id: e.workflowInstanceId }, select: { faseMacroKey: true } })
            await reancorarTarefaNoPasso(tx, volta.id, { workflowInstanceId: e.workflowInstanceId, workflowStepInstanceId: e.id, faseMacroKey: inst?.faseMacroKey ?? null, motivoCodigo: null }, new Date())
          } else {
            await projetarTarefaDoPasso(tx, { stepInstanceId: e.id, statusPasso: alvo as never })
          }
        }
      }
    }
  }

  // As tarefas que faltam (a certidão liberada, o "Localizar registro" novo) nascem agora, pelo reconciliador canônico.
  if (res.bloqueados > 0 || res.liberados > 0 || res.genealogiaReaberta > 0) await reconciliarTarefas({ processoId, db: tx })

  // 4) Genealogia reaberta por esta regra e sem nada aberto: volta a CONCLUÍDO.
  const reaberta = await tx.phaseWorkflowInstance.findFirst({
    where: { processoId, faseMacroKey: FASE_GENEALOGIA_KEY, status: "ATIVO" },
    orderBy: { ciclo: "desc" }, select: { id: true, processo: { select: { faseAtualKey: true } } },
  })
  if (reaberta && reaberta.processo?.faseAtualKey !== FASE_GENEALOGIA_KEY) {
    const foiReabertaPorNos = await tx.workflowEvento.findFirst({
      where: { workflowInstanceId: reaberta.id, tipo: "WORKFLOW_REABERTO" }, orderBy: { id: "desc" }, select: { dados: true },
    })
    const origem = (foiReabertaPorNos?.dados as { origem?: string } | null)?.origem
    if (origem === ORIGEM_REABERTURA_POR_PENDENCIA) {
      const ainda = await tx.phaseWorkflowStepInstance.count({
        where: { workflowInstanceId: reaberta.id, status: { notIn: ["CONCLUIDO", "DISPENSADO", "CANCELADO", "SUPERSEDIDO"] } },
      })
      if (ainda === 0) {
        const r = await tx.phaseWorkflowInstance.updateMany({ where: { id: reaberta.id, status: "ATIVO" }, data: { status: "CONCLUIDO", completedAt: new Date() } })
        if (r.count > 0) res.genealogiaFechada++
      }
    }
  }
  return res
}

/** Mesma conciliação para quem NÃO está dentro de uma transação (efeitos pós-commit, cron). */
export async function reconciliarGenealogiaEEmissao(processoId: number, db: DB = prisma): Promise<ResultadoTrava> {
  return emTx(db, (tx) => reconciliarGenealogiaEEmissaoTx(tx, processoId))
}
