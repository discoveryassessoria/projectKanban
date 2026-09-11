// src/app/api/tarefas/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {PrioridadeTarefa} from '@prisma/client'
import { toUTCNoon } from "@/src/lib/date-utils"
import { extrairUsuarioKanban } from "@/lib/kanban-auth"
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { STATUS_TERMINAIS } from '@/lib/operacional/tarefa-canonica'
import { criarTarefaManual } from '@/lib/operacional/tarefa-ciclo'

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

    // `concluida` (booleano) só vira `true` para CONCLUIDO_RECEBIDO — CANCELADA e
    // SUPERSEDIDA continuam com `concluida: false` para sempre (achado real: a
    // tarefa "Preparar pacote" do processo Abellan, já SUPERSEDIDA, continuava
    // aparecendo como pendente aqui e nas Notificações). "Pendente" tem que
    // excluir todo estado terminal, não só o de conclusão.
    if (where.concluida === false) {
      where.statusTarefa = { notIn: STATUS_TERMINAIS }
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
            paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }
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
//
// UNIDADE 6 (10/09/2026): esta rota tinha `prisma.tarefa.create` PRÓPRIO — um
// segundo owner de criação, sem o motivo obrigatório, a checagem de
// duplicidade nem a auditoria canônica de `criarTarefaManual`
// (lib/operacional/tarefa-ciclo.ts). Nenhum chamador real foi encontrado no
// frontend deste repositório (grep exaustivo em src/), mas a rota permanece
// por compatibilidade externa — agora DELEGANDO para o owner único.
//
// INCOMPATIBILIDADE REAL (decisão do usuário, 10/09/2026): `criarTarefaManual`
// exige `motivo` (SEM_MOTIVO se ausente) — o contrato antigo desta rota nunca
// teve esse campo. Em vez de inventar um texto, o campo passou a ser aceito
// no body como opcional; sua ausência agora resulta em 400 explícito, não em
// um motivo forjado.
export async function POST(request: Request) {
  try {
    const erro = await verificarPermissao(request, 'tarefas.criar')
    if (erro) return erro
    const usuario = await extrairUsuarioKanban(request)
    if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = await request.json()
    const {
      titulo,
      descricao,
      processoId,
      responsavelId,
      prioridade,
      dataPrazo,
      statusId,
      motivo,
    } = body

    if (!titulo) {
      return NextResponse.json(
        { error: "Título é obrigatório" },
        { status: 400 }
      )
    }

    if (processoId) {
      const processo = await prisma.processo.findUnique({
        where: { id: processoId },
        select: { id: true },
      })
      if (!processo) {
        return NextResponse.json(
          { error: "Processo não encontrado" },
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

    const resultado = await criarTarefaManual({
      processoId,
      titulo,
      autorId: usuario.userId,
      responsavelId: responsavelId || null,
      prioridade: prioridadeValida,
      dataPrazo: toUTCNoon(dataPrazo),
      motivo: motivo ?? '',
      // `criarTarefaManual` sempre checa duplicidade; o contrato antigo desta
      // rota nunca checou — confirmar de propósito preserva "sempre cria",
      // sem inventar comportamento novo.
      confirmarDuplicidade: true,
      // Campos que `criarTarefaManual` não modela como parâmetro próprio, mas
      // que a Tarefa aceita — a mesma porta grava o que quem chamou pediu.
      camposDeDominio: {
        ...(descricao ? { descricao } : {}),
        ...(statusId ? { statusId } : {}),
      },
    })

    if (!resultado.ok) {
      const status = resultado.codigo === 'SEM_MOTIVO' || resultado.codigo === 'INVALIDO' ? 400
        : resultado.codigo === 'CONFLITO' ? 409
        : 500
      return NextResponse.json({ error: resultado.mensagem }, { status })
    }

    const tarefa = await prisma.tarefa.findUnique({
      where: { id: resultado.tarefaId },
      include: {
        processo: {
          select: {
            id: true,
            nome: true,
            paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }
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