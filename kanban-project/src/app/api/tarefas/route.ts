// src/app/api/tarefas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PrioridadeTarefa, Pais } from "@prisma/client"
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
    const pais = searchParams.get("pais") as Pais | null
    const statusId = searchParams.get("statusId")
    const apenasRaiz = searchParams.get("apenasRaiz")
    const excluirEstruturais = searchParams.get("excluirEstruturais")
    const responsavelEmail = searchParams.get("responsavel")
    const dataInicio = searchParams.get("dataInicio")
    const dataFim = searchParams.get("dataFim")
    const status = searchParams.get("status")

    const where: any = {}

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

    if (pais && Object.values(Pais).includes(pais)) {
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

    if (apenasRaiz === "true") {
      where.tarefaPaiId = null
    }

    if (excluirEstruturais === "true") {
      where.OR = [
        { tarefaPaiId: { not: null } },
        { processoId: null },
        { subtarefas: { none: {} } }
      ]
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
        },
        subtarefas: {
          include: {
            responsavel: {
              select: {
                id: true,
                nome: true,
                email: true
              }
            },
            subtarefas: {
              include: {
                responsavel: {
                  select: {
                    id: true,
                    nome: true,
                    email: true
                  }
                },
                subtarefas: {
                  include: {
                    responsavel: {
                      select: {
                        id: true,
                        nome: true,
                        email: true
                      }
                    }
                  },
                  orderBy: [
                    { ordem: "asc" },
                    { createdAt: "asc" }
                  ]
                }
              },
              orderBy: [
                { ordem: "asc" },
                { createdAt: "asc" }
              ]
            }
          },
          orderBy: [
            { ordem: "asc" },
            { createdAt: "asc" }
          ]
        },
        tarefaPai: {
          select: {
            id: true,
            titulo: true
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

    // =====================================================
    // 🔒 FILTRO DE TAREFAS ACIONÁVEIS (só para usuários)
    // Usuário só vê tarefas que pode agir AGORA:
    //   - Em andamento (iniciada e não concluída)
    //   - Próxima a iniciar (botão "Iniciar" visível)
    // Esconde containers, atividades pai e subtarefas bloqueadas
    // =====================================================
    if (usuario && usuario.tipo !== 'admin' && !processoId) {
      const tarefasAcionaveis = await filtrarTarefasAcionaveis(tarefas)
      return NextResponse.json({ tarefas: tarefasAcionaveis })
    }
    // =====================================================

    return NextResponse.json({ tarefas })
  } catch (error) {
    console.error("Erro ao buscar tarefas:", error)
    return NextResponse.json(
      { error: "Erro ao buscar tarefas" },
      { status: 500 }
    )
  }
}

// =====================================================
// 🔒 HELPER: Filtrar apenas tarefas acionáveis
// Replica a lógica do frontend (TarefaDetailModal):
//   - mostrarIniciar = !algumaEmAndamento && index === primeiraNaoIniciada
// =====================================================
async function filtrarTarefasAcionaveis(tarefas: any[]) {
  // Passo 1: Separar tarefas "folha" de containers estruturais
  // Um container tem subtarefas que NÃO são cobrança/conferência
  const tarefasFolha = tarefas.filter((t: any) => {
    const subs = t.subtarefas || []
    if (subs.length === 0) return true // Sem filhos = é folha

    // Se tem filhos que NÃO são cobrança/conferência, é container
    const temFilhosEstruturais = subs.some((s: any) =>
      !s.tipoSubtarefa || (s.tipoSubtarefa !== 'COBRANCA' && s.tipoSubtarefa !== 'CONFERENCIA')
    )
    return !temFilhosEstruturais
  })

  // Passo 2: Coletar todos os parentIds para buscar irmãs completas
  // (irmãs podem ter responsáveis diferentes, então precisamos de TODAS)
  const parentIds = [...new Set(
    tarefasFolha
      .filter((t: any) => t.tarefaPaiId)
      .map((t: any) => t.tarefaPaiId as number)
  )]

  // Passo 3: Buscar todas as irmãs de cada pai (não apenas as do usuário)
  let siblingsData: any[] = []
  if (parentIds.length > 0) {
    siblingsData = await prisma.tarefa.findMany({
      where: {
        tarefaPaiId: { in: parentIds }
      },
      select: {
        id: true,
        tarefaPaiId: true,
        dataInicio: true,
        concluida: true,
        ordem: true,
        createdAt: true
      },
      orderBy: [
        { ordem: 'asc' },
        { createdAt: 'asc' }
      ]
    })
  }

  // Agrupar irmãs por pai
  const irmãsPorPai = new Map<number, typeof siblingsData>()
  for (const s of siblingsData) {
    if (s.tarefaPaiId) {
      if (!irmãsPorPai.has(s.tarefaPaiId)) {
        irmãsPorPai.set(s.tarefaPaiId, [])
      }
      irmãsPorPai.get(s.tarefaPaiId)!.push(s)
    }
  }

  // Passo 4: Filtrar apenas tarefas acionáveis
  const acionaveis = tarefasFolha.filter((t: any) => {
    // Tarefas concluídas: esconder
    if (t.concluida) return false

    // Sem pai: se chegou até aqui como folha sem pai, provavelmente
    // é uma tarefa avulsa - manter visível
    if (!t.tarefaPaiId) return true

    // ✅ Em andamento (iniciada e não concluída) → MOSTRAR
    if (t.dataInicio && !t.concluida) return true

    // Buscar todas as irmãs (mesma atividade pai)
    const irmas = irmãsPorPai.get(t.tarefaPaiId) || []

    // Se alguma irmã está em andamento, esta tarefa está bloqueada
    const algumaEmAndamento = irmas.some((s: any) => !!s.dataInicio && !s.concluida)
    if (algumaEmAndamento) return false

    // ✅ É a primeira não-iniciada na ordem → MOSTRAR (botão "Iniciar")
    const primeiraNaoIniciada = irmas.find((s: any) => !s.dataInicio && !s.concluida)
    return primeiraNaoIniciada?.id === t.id
  })

  return acionaveis
}

// POST - Criar nova tarefa ou subtarefa
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
      tarefaPaiId,
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

    if (tarefaPaiId) {
      const tarefaPai = await prisma.tarefa.findUnique({
        where: { id: tarefaPaiId }
      })

      if (!tarefaPai) {
        return NextResponse.json(
          { error: "Tarefa pai não encontrada" },
          { status: 404 }
        )
      }
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

    const paisValido = pais && Object.values(Pais).includes(pais) ? pais : null

    let ordemFinal = ordem
    if (ordemFinal === undefined || ordemFinal === null) {
      const ultimaTarefa = await prisma.tarefa.findFirst({
        where: tarefaPaiId 
          ? { tarefaPaiId } 
          : { tarefaPaiId: null, processoId: processoId || undefined },
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
        tarefaPaiId: tarefaPaiId || null,
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
        },
        subtarefas: true,
        tarefaPai: {
          select: {
            id: true,
            titulo: true
          }
        }
      }
    })

    await logTarefa.criar(tarefa.titulo, tarefa.id, processoNome)

    if (tarefaPaiId) {
      const tarefaPaiCheck = await prisma.tarefa.findUnique({
        where: { id: tarefaPaiId },
        select: { titulo: true }
      })

      if (tarefaPaiCheck?.titulo?.toLowerCase().includes("procuração administrativa")) {
        const subtarefasProcuracao = [
          { titulo: "Preparar procuração administrativa", ordem: 0 },
          { titulo: "Conferir procuração administrativa", ordem: 1 },
          { titulo: `Enviar a procuração administrativa ao cliente para assinar`, ordem: 2 },
        ]

        await prisma.tarefa.createMany({
          data: subtarefasProcuracao.map(sub => ({
            titulo: sub.titulo,
            tarefaPaiId: tarefa.id,
            processoId: tarefa.processoId,
            prioridade: tarefa.prioridade,
            ordem: sub.ordem,
          }))
        })
      }
    }

    return NextResponse.json({ tarefa }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar tarefa:", error)
    return NextResponse.json(
      { error: "Erro ao criar tarefa" },
      { status: 500 }
    )
  }
}