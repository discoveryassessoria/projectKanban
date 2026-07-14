// src/lib/process-stage/recalcular-fase.ts
//
// MOTOR DE FASE — implementa a "regra do mínimo" (analogia do carro do Marco).
//
// A fase do CARD (processo) é sempre a fase do documento da LINHA RETA mais
// ATRASADO. Quando o documento mais lento avança, o card avança junto.
//
// Esta versão cobre o AVANÇO (caso comum: todos andando pra frente).
// O RECUO (entra documento novo numa fase anterior → card volta) será
// adicionado depois, usando a mesma fórmula do mínimo.
//
// Chamado pela rota de conclusão de step quando um workflow fica concluído.

import { prisma } from "@/lib/prisma"
import { processoEmRuntimeV2 } from "@/src/lib/motor/runtime-guard" // CP-4H
import {
  getFase,
  getOrdemFase,
  getStepsForFase,
  isFaseReady,
  type FaseStep,
  phaseKeyToFaseCode,
  faseCodeToPhaseKey,
} from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"
import { politicaPadraoParaStep } from "@/src/services/processEngine/stepCompletionResolver"
import { dispararMotorNaFaseAtual } from "@/src/lib/motor/executor"

interface ResultadoRecalculo {
  mudou: boolean
  faseAnterior: FaseCode | null
  faseNova: FaseCode | null
  motivo: string
}

/**
 * Recalcula e (se necessário) avança a fase do processo de um documento.
 * Idempotente: se nada mudou, não faz nada.
 */
export async function recalcularFaseDoProcesso(
  documentoId: number
): Promise<ResultadoRecalculo> {
  // ── 1. Achar o processo deste documento ───────────────────────────────
  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: {
      pessoa: {
        select: { arvore: { select: { processos: { select: { id: true } } } } },
      },
    },
  })

  const processoId = doc?.pessoa?.arvore?.processos?.[0]?.id
  if (!processoId) {
    return { mudou: false, faseAnterior: null, faseNova: null, motivo: "Documento sem processo" }
  }

  // CP-4H — no-op para processos em runtime v2: a fase é escrita SOMENTE pelo
  // PhaseAdvanceService; o recálculo legado não pode mover faseAtualKey no v2.
  if (await processoEmRuntimeV2(processoId)) {
    return { mudou: false, faseAnterior: null, faseNova: null, motivo: "Processo em runtime v2 — recálculo de fase legado inativo" }
  }

  // ── 2. Fase atual do card (faseCode da coluna onde o processo está) ────
  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, pais: true, faseAtualKey: true, status: { select: { faseCode: true } } },
  })
const faseAtual = phaseKeyToFaseCode(processo?.faseAtualKey) ?? processo?.status?.faseCode ?? null
  if (!processo || !faseAtual) {
    return { mudou: false, faseAnterior: faseAtual, faseNova: faseAtual, motivo: "Processo sem faseCode" }
  }

  // ── 3. Documentos da LINHA RETA, ativos, deste processo ────────────────
  // Linha reta = pessoa.linhaReta = true. Ativos = não cancelado/inválido.
  // São esses que contam pra "regra do mínimo".
  const docsLinhaReta = await prisma.documento.findMany({
    where: {
      pessoa: {
        linhaReta: true,
        arvore: { processos: { some: { id: processoId } } },
      },
      status: { notIn: ["CANCELADO", "INVALIDO"] },
    },
    select: {
      id: true,
      // Agora um documento tem VÁRIOS workflows (um por fase, os antigos
      // arquivados). Pegamos todos e escolhemos o relevante no código.
      workflows: { select: { faseCode: true, status: true } },
    },
  })

  if (docsLinhaReta.length === 0) {
    return { mudou: false, faseAnterior: faseAtual, faseNova: faseAtual, motivo: "Sem documentos de linha reta" }
  }

  // ── 4. Calcular a fase de cada doc e achar o MÍNIMO (mais atrasado) ─────
  // Cada doc tem vários workflows. O que importa pro avanço: ele JÁ concluiu
  // a fase atual do card? Isso é verdade se ele tem um workflow:
  //   - de fase POSTERIOR à atual (já passou), OU
  //   - da fase atual com status "concluido"/"arquivado".
  const ordemAtual = getOrdemFase(faseAtual)
  const todosConcluiramFaseAtual = docsLinhaReta.every((d) => {
    // doc sem nenhum workflow ainda = não concluiu (segura o card)
    if (!d.workflows || d.workflows.length === 0) return false
    // Concluiu a fase atual se QUALQUER workflow dele satisfaz:
    return d.workflows.some((wf) => {
      if (!wf.faseCode) return false
      const ordemWf = getOrdemFase(wf.faseCode)
      if (ordemWf > ordemAtual) return true // tem workflow de fase posterior = já passou
      if (ordemWf < ordemAtual) return false
      // mesma fase: conta se concluído ou arquivado
      return wf.status === "concluido" || wf.status === "arquivado"
    })
  })

  if (!todosConcluiramFaseAtual) {
    return { mudou: false, faseAnterior: faseAtual, faseNova: faseAtual, motivo: "Nem todos os docs da linha reta concluíram a fase atual" }
  }

  // ── 5. Todos concluíram → calcular próxima fase ────────────────────────
  const faseDef = getFase(faseAtual)
  const proximaFase = faseDef.next
  if (!proximaFase) {
    return { mudou: false, faseAnterior: faseAtual, faseNova: faseAtual, motivo: "Fase terminal ou condicional (sem next automático)" }
  }
  // Fases "documento" precisam de etapas prontas. Fases "processo" (Análise,
  // Retificação...) não têm workflow por-doc — o card entra e é trabalhado no
  // painel próprio da fase. Por isso liberamos elas mesmo sem steps.
  if (!isFaseReady(proximaFase) && getFase(proximaFase).kind !== "processo") {
    return { mudou: false, faseAnterior: faseAtual, faseNova: faseAtual, motivo: `Próxima fase ${proximaFase} ainda não especificada (pendingSpec)` }
  }

  // ── 6. Achar a coluna de destino: mesmo país, faseCode = proximaFase ───
  const colunaDestino = await prisma.status.findFirst({
    where: { pais: processo.pais, faseCode: proximaFase },
    select: { id: true },
  })
  // colunaDestino é OPCIONAL: o kanban posiciona o card pela faseAtualKey.
  // País sem a coluna legada na tabela Status segue normal (só não atualiza a board antiga).

  // ── 7. AVANÇO em transação: arquiva + move card + cria workflows novos ─
  const now = new Date()
  const stepsProxima: FaseStep[] = getStepsForFase(proximaFase)

  await prisma.$transaction(async (tx) => {
    // 7a. Arquiva os workflows da fase atual dos docs ativos da linha reta
    await tx.workflow.updateMany({
      where: {
        documentoId: { in: docsLinhaReta.map((d) => d.id) },
        faseCode: faseAtual,
        status: { not: "arquivado" },
      },
      data: { status: "arquivado" },
    })

    // 7b. Move o card: troca o statusId do processo pra coluna de destino
    await tx.processo.update({
      where: { id: processoId },
      data: { faseAtualKey: faseCodeToPhaseKey(proximaFase) as string, ...(colunaDestino ? { statusId: colunaDestino.id } : {}) },
    })

    // 7c. Cria os workflows da próxima fase nos docs ativos da linha reta
    //     (primeira etapa já em andamento — sem pedir "iniciar")
    if (stepsProxima.length > 0) for (const d of docsLinhaReta) {
      // Idempotência: se o doc já tem um workflow ATIVO da próxima fase,
      // não cria de novo (evita duplicar se o motor rodar duas vezes).
      const jaExiste = await tx.workflow.findFirst({
        where: {
          documentoId: d.id,
          faseCode: proximaFase,
          status: { notIn: ["arquivado", "cancelado"] },
        },
        select: { id: true },
      })
      if (jaExiste) continue

      const firstStep = stepsProxima[0]
      const dueAt = new Date(now.getTime() + firstStep.slaDays * 86400000)
      await tx.workflow.create({
        data: {
          documentoId: d.id,
          faseCode: proximaFase,
          templateCode: `FASE_${proximaFase}`,
          templateName: `Workflow · ${getFase(proximaFase).label}`,
          status: "em_andamento",
          progress: 0,
          prioridade: "normal",
          startedAt: now,
          steps: {
            create: stepsProxima.map((s, i) => ({
              ordem: s.ordem,
              stepKey: s.stepKey,
              title: s.title,
              description: s.description,
              weight: s.weight,
              ownerKey: s.ownerKey,
              slaDays: s.slaDays,
              completionPolicy: politicaPadraoParaStep(s.stepKey),
              status: i === 0 ? "em_andamento" : "bloqueada",
              startedAt: i === 0 ? now : null,
              dueAt: i === 0 ? dueAt : null,
            })),
          },
        },
      })
    }
  }, {
    // O padrão do Prisma é 5s, que estoura quando o banco da nuvem está
    // lento (vários creates/updates dentro de uma transação somam o tempo).
    // Damos mais fôlego: até 30s pra transação rodar, e até 10s esperando
    // uma conexão livre antes de começar. Evita "Transaction already closed".
    timeout: 30000,
    maxWait: 10000,
  })

  // ── 8. ✅ E5 — MOTOR: dispara as automações da NOVA fase ────────────────
  // Fora da transação (a fase JÁ foi movida acima). Best-effort e só roda se
  // MotorConfig.autoExecutarAoAvancar estiver LIGADO — desligado, é no-op.
  // Antes, o avanço AUTOMÁTICO não disparava o motor (só o botão manual). Agora
  // o fluxo Genealogia→Emissão→Análise também aciona as automações da fase.
  await dispararMotorNaFaseAtual(processoId)

  return { mudou: true, faseAnterior: faseAtual, faseNova: proximaFase, motivo: "Avançou de fase" }
}