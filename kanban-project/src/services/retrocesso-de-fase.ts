// src/services/retrocesso-de-fase.ts
// ============================================================================
// RETROCEDER FASE — reposicionar o processo, e SOMENTE isso.
//
// ─── O ERRO QUE ESTE ARQUIVO JÁ TEVE ────────────────────────────────────────
// A primeira versão perguntava, no próprio modal de movimentação, quais obrigações
// da fase de destino deveriam ser reabertas — e reabria as marcadas na mesma
// transação. Parecia conveniente e estava conceitualmente errado.
//
// Mover a fase é um fato sobre a POSIÇÃO MACRO do processo. Reabrir é um fato sobre
// UMA unidade de trabalho: esta certidão, desta pessoa, nesta etapa. Amarrar os dois
// obriga quem só quer reposicionar a responder uma pergunta que não é dele, e — pior —
// transforma "voltei de fase" em "vou refazer o trabalho daquela fase", que é uma
// conclusão que ninguém tirou. Numa Emissão com cinquenta certidões, a pergunta é
// impossível de responder num modal: as unidades são cinquenta, e a decisão é de cada
// uma, na Central, olhando o documento.
//
// ─── O QUE ESTE MÓDULO FAZ AGORA ────────────────────────────────────────────
// Move a fase. Nenhuma execução é criada, nenhuma é alterada, nenhuma é cancelada.
// Uma etapa concluída continua concluída depois do retrocesso — e ganha, na Central,
// a ação administrativa de reabrir, que é outro comando (`reabertura-de-execucao.ts`).
//
// O preview aqui existe para o administrador SABER o que há na fase de destino antes
// de mover — e é só isso: leitura, sem seleção e sem consequência.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { movePhaseManual } from "@/src/lib/motor/phase-advance"
import { ESTADOS_CUMPRIDOS } from "@/src/services/dependencias-do-passo"
import { resolverInstanciaVigente } from "@/src/lib/process-stage/instancia-vigente-da-fase"

type TX = Prisma.TransactionClient

/**
 * O QUE EXISTE NA FASE DE DESTINO — só para o administrador ver antes de mover.
 *
 * Não há checkbox, não há seleção e não há ação: é um retrato. Se ele quiser refazer
 * alguma coisa, faz depois, na Central, escolhendo a unidade.
 */
export interface RetratoDaFaseDestino {
  unidades: number
  obrigacoes: number
  concluidas: number
  emAberto: number
}

export interface PlanoDeRetrocesso {
  processoId: number
  faseAtual: string | null
  faseAtualLabel: string | null
  faseDestino: string
  faseDestinoLabel: string
  /** `false` quando o destino não é uma fase anterior. */
  ehRetrocesso: boolean
  /** Leitura, não seleção. */
  retrato: RetratoDaFaseDestino
  /** Fases posteriores já visitadas — o histórico que permanece. */
  fasesPosterioresVisitadas: Array<{ faseMacroKey: string; ciclos: number; obrigacoes: number }>
  aviso: string
}

function rotulo(k: string): string {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

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
        select: { status: true, documentoId: true, necessidadeId: true, pessoaId: true },
      })
    : []

  const chaveDaUnidade = (p: { documentoId: number | null; necessidadeId: number | null; pessoaId: number | null }) =>
    `${p.documentoId ?? "-"}|${p.necessidadeId ?? "-"}|${p.pessoaId ?? "-"}`
  const concluidas = passos.filter((p) => ESTADOS_CUMPRIDOS.has(p.status)).length

  const posteriores = await db.phaseWorkflowInstance.groupBy({
    by: ["faseMacroKey"],
    where: {
      processoId,
      faseMacroKey: { in: fases.filter((f) => f.ordem > ordemDe(faseDestino)).map((f) => f.phaseKey) },
    },
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
    retrato: {
      unidades: new Set(passos.map(chaveDaUnidade)).size,
      obrigacoes: passos.length,
      concluidas,
      emAberto: passos.length - concluidas,
    },
    fasesPosterioresVisitadas,
    aviso:
      "Mover a fase muda apenas a posição do processo. Nenhuma tarefa é reaberta, concluída, cancelada ou apagada — " +
      "o que já foi executado continua como está. Depois de chegar na fase, cada tarefa que precisar ser refeita é " +
      "reaberta individualmente, na Central Operacional, escolhendo a pessoa e o documento.",
  }
}

export interface PedidoDeRetrocesso {
  processoId: number
  faseDestino: string
  motivoCodigo: string
  justificativa: string
  actorId: number | null
  origem?: string
  correlationId?: string
}

export interface ResultadoRetrocesso {
  ok: boolean
  code?: string
  mensagem?: string
  faseAnterior?: string
  faseAtual?: string
}

/**
 * MOVE A FASE. Nada mais.
 *
 * Não recebe seleção de tarefas — de propósito, e não por omissão: a assinatura é o
 * contrato, e um parâmetro `reabrir` aqui seria o convite para o acoplamento voltar.
 */
export async function executarRetrocesso(p: PedidoDeRetrocesso): Promise<ResultadoRetrocesso> {
  const correlationId = p.correlationId ?? `retrocesso|p${p.processoId}|${p.faseDestino}|${p.actorId ?? 0}`
  const plano = await planejarRetrocesso(p.processoId, p.faseDestino)
  if (!plano) return { ok: false, code: "PROCESSO_NAO_ENCONTRADO" }
  if (plano.faseAtual === p.faseDestino) {
    return { ok: false, code: "MESMA_FASE", mensagem: "O processo já está nesta fase." }
  }

  const mov = await movePhaseManual(p.processoId, {
    faseAlvo: p.faseDestino,
    justificativa: p.justificativa,
    motivoCodigo: p.motivoCodigo,
    solicitadoPorId: p.actorId ?? undefined,
    origem: (p.origem ?? "retrocesso").slice(0, 20),
    correlationId,
  } as never)
  if (!mov.success) {
    return { ok: false, code: mov.code, mensagem: "A fase não pôde ser movida." }
  }

  // O EVENTO DO RETROCESSO É SÓ DO RETROCESSO. Reabertura, quando houver, gera evento
  // próprio (`STEP_EXECUTION_REOPENED`) noutro momento e por outro comando — e é assim
  // que a linha do tempo consegue mostrar dois fatos distintos, às 12:00 e às 12:08.
  await prisma.logAuditoria.create({
    data: {
      acao: "PROCESS_PHASE_ROLLED_BACK",
      entidade: "Processo", entidadeId: p.processoId,
      descricao:
        `Processo retrocedido de "${plano.faseAtualLabel}" para "${plano.faseDestinoLabel}". ` +
        "Nenhuma tarefa foi reaberta: mover a fase não refaz trabalho.",
      detalhes: {
        processoId: p.processoId,
        deFase: mov.faseAnterior ?? plano.faseAtual,
        paraFase: mov.faseAtual ?? p.faseDestino,
        motivoCodigo: p.motivoCodigo,
        justificativa: p.justificativa,
        retratoDaFaseDestino: plano.retrato,
        correlationId,
      } as never,
      usuarioId: p.actorId,
    },
  }).catch(() => null)

  return { ok: true, faseAnterior: mov.faseAnterior, faseAtual: mov.faseAtual }
}
