// src/app/api/tarefas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {PrioridadeTarefa} from '@prisma/client'
import { logTarefa } from "@/lib/auditoria"
import { toUTCNoon } from "@/src/lib/date-utils"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar tarefas (com filtros opcionais)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const processoId = searchParams.get("processoId")
    const responsavelId = searchParams.get("responsavelId")
    const concluida = searchParams.get("concluida")
    const prioridade = searchParams.get("prioridade") as PrioridadeTarefa | null
    const pais = searchParams.get("pais") as string | null
    const statusId = searchParams.get("statusId")
    const responsavelEmail = searchParams.get("responsavel")
    const dataInicio = searchParams.get("dataInicio")
    const dataFim = searchParams.get("dataFim")
    const status = searchParams.get("status")
    // Tarefa Transversal: filtros por tipo (NORMAL|TRANSVERSAL) e fases de origem/referência.
    const tipo = searchParams.get("tipo")
    const faseOrigemCode = searchParams.get("faseOrigemCode")
    const faseReferenciaCode = searchParams.get("faseReferenciaCode")

    const where: any = {}
    if (tipo === "NORMAL" || tipo === "TRANSVERSAL") where.tipo = tipo
    if (faseOrigemCode) where.faseOrigemCode = faseOrigemCode
    if (faseReferenciaCode) where.faseReferenciaCode = faseReferenciaCode

    // =====================================================
    // 🔒 FILTRO OBRIGATÓRIO POR USUÁRIO
    // Se o usuário NÃO for admin, só vê as próprias tarefas
    // =====================================================
    const usuario = await extrairUsuarioKanban(request)
    
    if (usuario && usuario.tipo !== 'admin') {
        // Usuário comum: só as próprias tarefas + as sem responsável
        where.AND = [
          ...(where.AND || []),
          { OR: [{ responsavelId: usuario.userId }, { responsavelId: null }] }
        ]
    }
    // =====================================================

    if (processoId) {
      where.processoId = parseInt(processoId)
    }

    // Filtro por responsavelId manual - SÓ aplica se for admin
    // (para usuário comum, já está fixo acima e não pode mudar)
    if (responsavelId && (!usuario || usuario.tipo === 'admin')) {
      where.responsavelId = parseInt(responsavelId)
    }

    // Filtro por email do responsável (vem do FilterModal) - SÓ para admin
    if (responsavelEmail && (!usuario || usuario.tipo === 'admin')) {
      const usuarioBusca = await prisma.usuario.findFirst({
        where: { email: responsavelEmail },
        select: { id: true }
      })
      if (usuarioBusca) {
        where.responsavelId = usuarioBusca.id
      }
    }

    // Filtro por status (Pendente/Concluída)
    if (status === 'concluida') {
      where.concluida = true
    } else if (status === 'pendente') {
      where.concluida = false
    }

    if (dataInicio || dataFim) {
      where.dataInicio = {}
      if (dataInicio && dataFim) {
        where.dataInicio.gte = new Date(dataInicio + 'T00:00:00.000Z')
        where.dataInicio.lte = new Date(dataFim + 'T23:59:59.999Z')
      } else if (dataInicio) {
        where.dataInicio.gte = new Date(dataInicio + 'T00:00:00.000Z')
        where.dataInicio.lte = new Date(dataInicio + 'T23:59:59.999Z')
      } else if (dataFim) {
        where.dataInicio.lte = new Date(dataFim + 'T23:59:59.999Z')
      }
    }

    if (concluida !== null && concluida !== undefined && concluida !== "") {
      where.concluida = concluida === "true"
    }

    if (prioridade && Object.values(PrioridadeTarefa).includes(prioridade)) {
      where.prioridade = prioridade
    }

    // País válido é o CADASTRADO — a lista deixou de ser constante do schema.
    const paisCadastrado = pais
      ? await prisma.catalogoPais.findFirst({ where: { countryKey: String(pais).toLowerCase() }, select: { id: true } })
      : null
    if (pais && paisCadastrado) {
      const paisCondition = {
        OR: [
          { pais: pais },
          { processo: { pais: pais } }
        ]
      }
      if (where.OR) {
        const existingOR = where.OR
        delete where.OR
        where.AND = [...(where.AND || []), { OR: existingOR }, paisCondition]
      } else {
        where.AND = [...(where.AND || []), paisCondition]
      }
    }

    if (statusId) {
      where.statusId = parseInt(statusId)
    }

    const tarefas = await prisma.tarefa.findMany({
      where,
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true
          }
        },
        responsavel: {
          select: {
            id: true,
            nome: true,
            email: true
          }
        },
        status: {
          select: {
            id: true,
            nome: true
          }
        }
      },
      orderBy: [
        { concluida: "asc" },
        { prioridade: "desc" },
        { dataPrazo: "asc" },
        { ordem: "asc" },
        { createdAt: "desc" }
      ]
    })

    // Usuário não-admin só vê o que pode agir AGORA. A ordem de execução é
    // do workflow do processo, não de uma árvore de tarefas: aqui resta
    // esconder o que já foi concluído.
    if (usuario && usuario.tipo !== 'admin' && !processoId) {
      return NextResponse.json({ tarefas: tarefas.filter((t) => !t.concluida) })
    }

    return NextResponse.json({ tarefas })
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error)
    return NextResponse.json(
      { error: "Erro ao buscar tarefas" },
      { status: 500 }
    )
  }
}

// POST - Criar nova tarefa
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.criar')
    if (erro) return erro

    const body = await request.json()
    const { 
      titulo, 
      descricao, 
      processoId, 
      responsavelId,
      prioridade,
      dataPrazo,
      statusId,
      pais,
      ordem
    } = body

    if (!titulo) {
      return NextResponse.json(
        { error: "Título é obrigatório" },
        { status: 400 }
      )
    }

    let processoNome: string | undefined
    if (processoId) {
      const processo = await prisma.processo.findUnique({
        where: { id: processoId },
        select: { nome: true }
      })

      if (!processo) {
        return NextResponse.json(
          { error: "Processo não encontrado" },
          { status: 404 }
        )
      }
      processoNome = processo.nome
    }

    if (responsavelId) {
      const responsavel = await prisma.usuario.findUnique({
        where: { id: responsavelId }
      })

      if (!responsavel) {
        return NextResponse.json(
          { error: "Responsável não encontrado" },
          { status: 404 }
        )
      }
    }

    if (statusId) {
      const status = await prisma.status.findUnique({
        where: { id: statusId }
      })

      if (!status) {
        return NextResponse.json(
          { error: "Status não encontrado" },
          { status: 404 }
        )
      }
    }

    const prioridadeValida = prioridade && Object.values(PrioridadeTarefa).includes(prioridade)
      ? prioridade
      : PrioridadeTarefa.MEDIA

    // Validado contra o CADASTRO, não contra uma lista do schema.
    const paisValido = pais
      ? (await prisma.catalogoPais.findFirst({
          where: { countryKey: String(pais).toLowerCase() }, select: { countryKey: true },
        }))?.countryKey ?? null
      : null

    let ordemFinal = ordem
    if (ordemFinal === undefined || ordemFinal === null) {
      const ultimaTarefa = await prisma.tarefa.findFirst({
        where: { processoId: processoId || undefined },
        orderBy: { ordem: "desc" }
      })
      ordemFinal = (ultimaTarefa?.ordem ?? -1) + 1
    }

    const tarefa = await prisma.tarefa.create({
      data: {
        titulo,
        descricao: descricao || null,
        processoId: processoId || null,
        responsavelId: responsavelId || null,
        prioridade: prioridadeValida,
        dataPrazo: toUTCNoon(dataPrazo),
        statusId: statusId || null,
        pais: paisValido,
        ordem: ordemFinal
      },
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            pais: true
          }
        },
        responsavel: {
          select: {
            id: true,
            nome: true,
            email: true
          }
        },
        status: {
          select: {
            id: true,
            nome: true
          }
        }
      }
    })

    await logTarefa.criar(tarefa.titulo, tarefa.id, processoNome)

    // A ÁRVORE PAI/FILHO FOI REMOVIDA DAQUI.
    //
    // Criar a tarefa da procuração criava três filhas — "Preparar", "Conferir",
    // "Enviar ao cliente" —, que são ETAPAS do mesmo trabalho. Etapa vive no
    // workflow interno da tarefa, não como tarefa filha.

    return NextResponse.json({ tarefa }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao criar tarefa" },
      { status: 500 }
    )
  }
}