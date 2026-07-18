// ESTE ARQUIVO SUBSTITUI: src/app/api/processos/route.ts
//
// NOVO (6/jul): GATILHO AUTOMÁTICO — se a chave MotorConfig.autoExecutarAoAvancar
// estiver LIGADA (Gerenciamento → Executor do Motor), ao CRIAR o processo o motor
// roda sozinho as automações "ao entrar na fase" da PRIMEIRA fase.
// Se o motor falhar, o processo é criado normal — só loga o erro.
// (Mantém o fix anterior: sem exigir Status legado; statusId é opcional.)

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import { garantirFamiliaParaProcesso } from '@/src/services/familia'
import { criarProcessoV2 } from '@/src/services/criar-processo'
import { processarOutbox } from '@/src/services/outbox-dispatcher'
import { resolveOperationalProjectionBatch } from '@/src/lib/process-stage/operational-projection'

// GET - Buscar processos (filtrado por país, requerente ou contratante)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais")
    const requerenteId = searchParams.get("requerenteId")
    const contratanteId = searchParams.get("contratanteId")
    const motor = searchParams.get("motor") // ✅ MOTOR

    // Construir filtro dinâmico
    const where: any = {}

    if (pais) {
      where.pais = pais
    }

    // ✅ Filtro por requerente
    if (requerenteId) {
      where.requerentes = {
        some: {
          requerenteId: parseInt(requerenteId)
        }
      }
    }

    // ✅ Filtro por contratante
    if (contratanteId) {
      where.contratantes = {
        some: {
          contratanteId: parseInt(contratanteId)
        }
      }
    }

    // ✅ MOTOR: só processos conectados ao motor (tipoProcessoMotorId preenchido)
    if (motor === "1") {
      where.tipoProcessoMotorId = { not: null }
    }

    const processos = await prisma.processo.findMany({
      where,
      include: {
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        familia: { select: { id: true, nome: true } }, // CP-1 dual-read
        requerentes: {
          include: {
            requerente: true
          }
        },
        tarefas: {
          include: {
            responsavel: true
          },
          orderBy: { createdAt: "desc" }
        },
        _count: {
          select: {
            tarefas: {
              where: { tarefaPaiId: { not: null } }
            },
            anexos: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    })

    // PROJEÇÃO OPERACIONAL OFICIAL por processo — em LOTE (poucas queries agregadas,
    // sem N+1). O Kanban Macro consome projection.progress.percentage; NÃO conta
    // tarefas/documentos/necessidades/steps.
    const ids = processos.map((p) => p.id)
    const projecoes = await resolveOperationalProjectionBatch(ids)
    const projByProc = new Map(projecoes.map((pr) => [Number(pr.processId), pr]))

    // Formatar para incluir contratantes e requerentes como arrays simples
    const processosFormatados = processos.map(p => ({
      ...p,
      contratantes: p.contratantes.map(c => c.contratante),
      requerentes: p.requerentes.map(r => r.requerente),
      projection: projByProc.get(p.id) ?? null,
    }))

    return NextResponse.json({ processos: processosFormatados })
  } catch (error) {
    console.error("Erro ao buscar processos:", error)
    return NextResponse.json(
      { error: "Erro ao buscar processos" },
      { status: 500 }
    )
  }
}

// POST - Criar novo processo
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'processos.criar')
    if (erro) return erro

    const usuario = await extrairUsuarioComPermissoes(request)
    const body = await request.json().catch(() => ({}))

    // Idempotência da criação: header (preferido) ou body. Mesma chave ⇒ mesmo processo.
    const idempotencyKey =
      request.headers.get("idempotency-key") || body.idempotencyKey || undefined

    // Toda a decisão (runtime v2, fase inicial, Workflow Interno, tarefas, evento)
    // é do serviço de domínio. A API NÃO aceita faseAtualKey/statusId/targetPhaseKey/
    // workflowRuntime/tarefas do cliente — apenas os dados de negócio.
    const resultado = await criarProcessoV2({
      nome: body.nome,
      pais: body.pais,
      tipoProcessoMotorId: body.tipoProcessoMotorId,
      descricao: body.descricao ?? null,
      observacoes: body.observacoes ?? null,
      arvoreId: body.arvoreId ?? null,
      previsaoTermino: body.previsaoTermino ?? null,
      contratanteIds: body.contratanteIds,
      requerenteIds: body.requerenteIds,
      idempotencyKey,
      solicitadoPorId: usuario?.userId,
    })

    if (!resultado.success) {
      const status =
        resultado.code === "RUNTIME_V2_DESABILITADO" ? 503 :
        resultado.code === "INSTANCIACAO_FALHOU" ? 422 :
        resultado.code === "SEM_MACRO_PUBLICADO" || resultado.code === "MACRO_SEM_FASE_INICIAL" || resultado.code === "SEM_WORKFLOW_INTERNO" ? 422 :
        400
      return NextResponse.json(
        { error: resultado.message, code: resultado.code, correlationId: resultado.correlationId },
        { status },
      )
    }

    // CP-1 — forward-fill da Família (best-effort; nunca bloqueia a criação).
    try { await garantirFamiliaParaProcesso(resultado.processId) }
    catch (e) { console.error("CP-1 forward-fill de família falhou (criar processo):", e) }

    // Drena os efeitos do phase.entered inicial (idempotente; best-effort — as
    // tarefas já nasceram na transação; aqui só marca o evento como processado).
    try { await processarOutbox({ tipos: ["phase.entered"], limite: 20 }) }
    catch (e) { console.error("Dispatcher outbox (criar processo) falhou:", e) }

    // Processo completo p/ a UI abrir direto na 1ª fase.
    const processoCompleto = await prisma.processo.findUnique({
      where: { id: resultado.processId },
      include: {
        contratantes: { include: { contratante: true } },
        arvore: true,
        familia: { select: { id: true, nome: true } }, // CP-1 dual-read
        requerentes: { include: { requerente: true } },
      },
    })

    const processoFormatado = {
      ...processoCompleto,
      contratantes: processoCompleto?.contratantes.map(c => c.contratante) || [],
      requerentes: processoCompleto?.requerentes.map(r => r.requerente) || [],
    }

    return NextResponse.json(
      {
        processo: processoFormatado,
        criacao: {
          processId: resultado.processId,
          processCode: resultado.processCode,
          workflowRuntime: resultado.workflowRuntime,
          currentPhaseKey: resultado.currentPhaseKey,
          currentPhaseInstanceId: resultado.currentPhaseInstanceId,
          workflowMacroVersionId: resultado.workflowMacroVersionId,
          phaseEnteredEventId: resultado.phaseEnteredEventId,
          tarefasIniciais: resultado.tarefasIniciais,
          initializationStatus: resultado.initializationStatus,
          idempotent: !resultado.created,
        },
      },
      { status: resultado.created ? 201 : 200 },
    )
  } catch (error) {
    console.error("Erro ao criar processo:", error)
    return NextResponse.json(
      { error: "Erro ao criar processo" },
      { status: 500 }
    )
  }
}