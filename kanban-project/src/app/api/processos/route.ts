// src/app/api/processos/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Pais } from "@prisma/client"
import { logProcesso } from "@/lib/auditoria"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// GET - Buscar processos (filtrado por país, requerente ou contratante)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const pais = searchParams.get("pais") as Pais | null
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
        status: true,
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
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

    // Formatar para incluir contratantes e requerentes como arrays simples
    const processosFormatados = processos.map(p => ({
      ...p,
      contratantes: p.contratantes.map(c => c.contratante),
      requerentes: p.requerentes.map(r => r.requerente)
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

    const body = await request.json()
    const { 
      nome, 
      descricao, 
      observacoes,
      statusId, 
      pais, 
      contratanteIds,
      arvoreId,
      previsaoTermino,
      requerenteIds,
      tipoProcessoMotorId,
    } = body

    if (!nome) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 }
      )
    }

    if (!statusId) {
      return NextResponse.json(
        { error: "Status é obrigatório" },
        { status: 400 }
      )
    }

    if (!pais) {
      return NextResponse.json(
        { error: "País é obrigatório" },
        { status: 400 }
      )
    }

    // Validar se o país é válido
    if (!Object.values(Pais).includes(pais)) {
      return NextResponse.json(
        { error: "País inválido" },
        { status: 400 }
      )
    }

    // Verificar se o status existe e pertence ao país correto
    const status = await prisma.status.findUnique({
      where: { id: statusId }
    })

    if (!status) {
      return NextResponse.json(
        { error: "Status não encontrado" },
        { status: 404 }
      )
    }

    if (status.pais !== pais) {
      return NextResponse.json(
        { error: "Status não pertence a este país" },
        { status: 400 }
      )
    }

    // ✅ Se veio tipo do motor, confere se existe
    if (tipoProcessoMotorId != null) {
      const tipoMotor = await prisma.tipoProcessoNacionalidade.findUnique({
        where: { id: tipoProcessoMotorId },
      })
      if (!tipoMotor) {
        return NextResponse.json({ error: "Tipo de processo (motor) não encontrado" }, { status: 400 })
      }
    }

    // Criar o processo
    const processo = await prisma.processo.create({
      data: {
        nome,
        descricao: descricao || null,
        observacoes: observacoes || null,
        pais,
        statusId,
        arvoreId: arvoreId || null,
        previsaoTermino: previsaoTermino ? new Date(previsaoTermino) : null,
        tipoProcessoMotorId: tipoProcessoMotorId ?? null,   // ✅ nasce ligado ao motor
      }
    })

    // Criar relacionamentos com contratantes se fornecidos
    if (contratanteIds?.length > 0) {
      await prisma.processoContratante.createMany({
        data: contratanteIds.map((contratanteId: number) => ({
          processoId: processo.id,
          contratanteId
        }))
      })
    }

    // Criar relacionamentos com requerentes se fornecidos
    if (requerenteIds?.length > 0) {
      await prisma.processoRequerente.createMany({
        data: requerenteIds.map((requerenteId: number) => ({
          processoId: processo.id,
          requerenteId
        }))
      })
    }

    // ✅ REGISTRAR LOG
    await logProcesso.criar(processo.nome, processo.id)

    // Buscar processo completo com relacionamentos
    const processoCompleto = await prisma.processo.findUnique({
      where: { id: processo.id },
      include: {
        status: true,
        contratantes: {
          include: {
            contratante: true
          }
        },
        arvore: true,
        requerentes: {
          include: {
            requerente: true
          }
        }
      }
    })

    // Formatar resposta
    const processoFormatado = {
      ...processoCompleto,
      contratantes: processoCompleto?.contratantes.map(c => c.contratante) || [],
      requerentes: processoCompleto?.requerentes.map(r => r.requerente) || []
    }

    return NextResponse.json({ processo: processoFormatado }, { status: 201 })
  } catch (error) {
    console.error("Erro ao criar processo:", error)
    return NextResponse.json(
      { error: "Erro ao criar processo" },
      { status: 500 }
    )
  }
}