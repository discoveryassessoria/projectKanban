// src/app/api/processos/[processoId]/phase/move/route.ts
//
// MOVIMENTAÇÃO MANUAL DE FASE — Administrador Master.
//
// GET  → contexto para o modal: fase atual, fases válidas do macro DESTE processo e
//        o catálogo oficial de motivos. O frontend não inventa nenhuma dessas listas.
// POST → executa a movimentação: reposiciona o processo em QUALQUER fase do workflow
//        (anterior, posterior ou intermediária) SEM as validações do fluxo automático.
//
// AUTORIZAÇÃO: permissão EXCLUSIVA `processos.moverFaseManual`. Exclusiva significa
// que nem `tipo = 'admin'` a recebe por ser admin (ver PERMISSOES_EXCLUSIVAS): ela só
// existe por concessão NOMINAL. Funcionário não move processo manualmente, e "ser
// admin" não é autorização — a concessão é.
//
// ERROS SÃO ESTRUTURADOS: sempre `{ code, message }`. A tela mostra a `message` do
// servidor; nunca um "Erro ao mover processo" que esconde o que de fato aconteceu.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { movePhaseManual } from "@/src/lib/motor/phase-advance"
import {
  MOTIVOS_MOVIMENTACAO,
  motivoValido,
  normalizarJustificativa,
  JUSTIFICATIVA_MIN,
  JUSTIFICATIVA_MAX,
} from "@/src/lib/motor/motivos-movimentacao"
import { FASES, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import type { FaseCode } from "@prisma/client"

const PERMISSAO = "processos.moverFaseManual"

/**
 * Vocabulário ESTÁVEL de erro da API. O motor tem os códigos dele (o domínio); aqui
 * eles são traduzidos para o contrato que a tela consome. Um código novo no motor não
 * vaza para o cliente sem passar por esta tradução.
 */
const CODIGO_API: Record<string, string> = {
  PROCESSO_NAO_ENCONTRADO: "PROCESS_NOT_FOUND",
  FASE_ALVO_INVALIDA: "INVALID_TARGET_PHASE",
  JUSTIFICATIVA_OBRIGATORIA: "MISSING_JUSTIFICATION",
  MOTIVO_OBRIGATORIO: "MISSING_REASON",
  CONFLITO: "CONCURRENT_MODIFICATION",
  RUNTIME_V2_DESABILITADO: "MIGRATION_NOT_READY",
  PROCESSO_LEGACY: "MIGRATION_NOT_READY",
  SEM_TIPO_MOTOR: "PHASE_NOT_IN_WORKFLOW",
  INSTANCIACAO_FALHOU: "INTERNAL_ERROR",
}

const STATUS_POR_CODIGO: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PERMISSION_REQUIRED: 403,
  PROCESS_NOT_FOUND: 404,
  INVALID_TARGET_PHASE: 422,
  SAME_PHASE: 422,
  PHASE_NOT_IN_WORKFLOW: 422,
  MISSING_REASON: 422,
  MISSING_JUSTIFICATION: 422,
  CONCURRENT_MODIFICATION: 409,
  MIGRATION_NOT_READY: 409,
  INTERNAL_ERROR: 500,
}

function erro(code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, code, message, ...extra },
    { status: STATUS_POR_CODIGO[code] ?? 400 },
  )
}

/** Rótulo humano da fase, do catálogo oficial — nunca a chave crua na tela. */
function rotuloFase(phaseKey: string): string {
  const code = phaseKeyToFaseCode(phaseKey)
  return code ? FASES[code as FaseCode].label : phaseKey
}

/**
 * TENTATIVA NÃO AUTORIZADA também é auditoria. Quem tentou mover um processo sem
 * poder é exatamente o que se quer saber depois — e é o que um `return 403` mudo
 * apaga. Grava em WorkflowEvento, na mesma trilha do resto do motor.
 */
async function auditarTentativaNegada(processoId: number, userId: number | null, motivo: string) {
  try {
    await prisma.workflowEvento.createMany({
      skipDuplicates: true,
      data: {
        tipo: "FASE_MOVIDA",
        entityType: "fase",
        entityId: processoId,
        processoId,
        chaveIdempotencia: `evt|move-negado|${processoId}|${userId ?? "anon"}|${Date.now()}`,
        dados: { negado: true, motivo, usuarioId: userId, permissao: PERMISSAO, origem: "move-route" },
      },
    })
  } catch {
    // Auditar a negativa não pode derrubar a negativa. O 403 sai de qualquer forma.
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return erro("UNAUTHORIZED", "Sessão não autenticada.")
  if (!temPermissao(usuario.permissoes, PERMISSAO)) {
    return erro("PERMISSION_REQUIRED", "Movimentação manual de fase é exclusiva do Administrador Master.", { permissao: PERMISSAO })
  }

  const { processoId: pid } = await params
  const processoId = parseInt(pid)
  if (isNaN(processoId)) return erro("PROCESS_NOT_FOUND", "Identificador de processo inválido.")

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, codigo: true, faseAtualKey: true, tipoProcessoMotorId: true },
  })
  if (!processo) return erro("PROCESS_NOT_FOUND", "Processo não encontrado.")
  if (!processo.tipoProcessoMotorId) {
    return erro("PHASE_NOT_IN_WORKFLOW", "Processo sem tipo do motor — não há workflow para posicionar.")
  }

  // As fases vêm do MACRO DESTE PROCESSO, não de uma lista fixa: o destino válido é
  // o que o workflow dele conhece.
  const macro = await prisma.macroWorkflow.findUnique({
    where: { tipoProcessoId: processo.tipoProcessoMotorId },
    include: { fases: { orderBy: { ordem: "asc" }, select: { phaseKey: true, label: true, ordem: true, conditional: true } } },
  })
  const fases = (macro?.fases ?? []).map((f) => ({
    phaseKey: f.phaseKey,
    label: rotuloFase(f.phaseKey) || f.label,
    ordem: f.ordem,
    conditional: f.conditional === true,
    atual: f.phaseKey === processo.faseAtualKey,
  }))

  return NextResponse.json({
    success: true,
    processo: { id: processo.id, nome: processo.nome, codigo: processo.codigo },
    faseAtual: processo.faseAtualKey,
    faseAtualLabel: processo.faseAtualKey ? rotuloFase(processo.faseAtualKey) : null,
    fases,
    motivos: MOTIVOS_MOVIMENTACAO,
    justificativa: { min: JUSTIFICATIVA_MIN, max: JUSTIFICATIVA_MAX },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> },
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  const { processoId: pid } = await params
  const processoId = parseInt(pid)

  if (!usuario) return erro("UNAUTHORIZED", "Sessão não autenticada.")
  if (!temPermissao(usuario.permissoes, PERMISSAO)) {
    if (!isNaN(processoId)) await auditarTentativaNegada(processoId, usuario.userId, "SEM_PERMISSAO")
    return erro("PERMISSION_REQUIRED", "Movimentação manual de fase é exclusiva do Administrador Master.", { permissao: PERMISSAO })
  }

  try {
    if (isNaN(processoId)) return erro("PROCESS_NOT_FOUND", "Identificador de processo inválido.")

    const body = await request.json().catch(() => ({}))
    const faseAlvo = String(body?.faseAlvo ?? "").trim()
    const motivoCodigo = String(body?.motivoCodigo ?? "").trim()
    const justificativa = normalizarJustificativa(String(body?.justificativa ?? ""))

    // VALIDAÇÃO DE ENTRADA no servidor — o cliente pode ter sido contornado.
    if (!motivoCodigo) return erro("MISSING_REASON", "Selecione o motivo da movimentação.")
    if (!motivoValido(motivoCodigo)) {
      return erro("MISSING_REASON", "Motivo fora do catálogo oficial de movimentação.", { motivoCodigo })
    }
    if (!justificativa) return erro("MISSING_JUSTIFICATION", "Informe uma justificativa para a movimentação manual.")
    if (justificativa.length < JUSTIFICATIVA_MIN) {
      return erro("MISSING_JUSTIFICATION", `A justificativa precisa ter ao menos ${JUSTIFICATIVA_MIN} caracteres.`)
    }
    if (justificativa.length > JUSTIFICATIVA_MAX) {
      return erro("MISSING_JUSTIFICATION", `A justificativa pode ter no máximo ${JUSTIFICATIVA_MAX} caracteres.`)
    }

    // O usuário vem do TOKEN, nunca do corpo: quem assina a decisão é quem está
    // autenticado. `body.userId`, se vier, é ignorado.
    const r = await movePhaseManual(processoId, {
      faseAlvo,
      justificativa,
      motivoCodigo,
      correlationId: typeof body?.correlationId === "string" ? body.correlationId : undefined,
      solicitadoPorId: usuario.userId,
      origem: typeof body?.origem === "string" && body.origem === "KANBAN_DRAG_DROP" ? "kanban-drag" : "move-route",
      // Esta é a porta de movimentação manual (admin) — nunca a do Retrocesso. As
      // fases anteriores devem continuar existindo, abertas e regularizáveis uma a
      // uma; nada aqui pode concluir, cancelar ou anular o que ficou pra trás.
      preservarHistorico: true,
    })

    if (r.success) {
      return NextResponse.json({
        success: true,
        code: "MOVED",
        message: `Processo movido para ${rotuloFase(r.faseAtual)}.`,
        faseAnterior: r.faseAnterior,
        faseAnteriorLabel: rotuloFase(r.faseAnterior),
        faseAtual: r.faseAtual,
        faseAtualLabel: rotuloFase(r.faseAtual),
        ciclo: r.ciclo,
        workflowInstanceId: r.workflowInstanceId,
        correlationId: r.correlationId,
      })
    }

    // Mover para a MESMA fase tem código próprio: o operador precisa saber que não é
    // um erro de cadastro, é que ele soltou o card onde já estava.
    const mesmaFase = (r.message ?? "").includes("já está nesta fase")
    const code = mesmaFase ? "SAME_PHASE" : CODIGO_API[r.code ?? ""] ?? "INTERNAL_ERROR"
    return erro(code, r.message ?? "Não foi possível mover o processo.", { motorCode: r.code, correlationId: r.correlationId })
  } catch (e) {
    console.error(
      "[POST .../phase/move] falha",
      JSON.stringify({ processoId, usuarioId: usuario.userId, erro: (e as Error)?.message ?? String(e) }),
    )
    return erro("INTERNAL_ERROR", "Erro interno ao mover o processo de fase.")
  }
}
