// ESTE ARQUIVO VAI EM: src/app/api/clientes/aniversariantes/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const mes = searchParams.get("mes") // 1-12
    const proximosDias = searchParams.get("proximosDias") // ex: 30
    const semAniversario = searchParams.get("semAniversario") // "true"

    // ========== CLIENTES SEM DATA DE NASCIMENTO ==========
    if (semAniversario === "true") {
      const [contratantes, requerentes] = await Promise.all([
        prisma.contratante.findMany({
          where: { dataNascimento: null },
          select: {
            id: true,
            nome: true,
            dataNascimento: true,
            telefone: true,
            email: true,
            cidade: true,
            estado: true,
            processos: {
              select: {
                processo: {
                  select: { id: true, nome: true, pais: true },
                },
              },
            },
          },
          orderBy: { nome: "asc" },
        }),
        prisma.requerente.findMany({
          where: { dataNascimento: null },
          select: {
            id: true,
            nome: true,
            dataNascimento: true,
            telefone: true,
            email: true,
            cidade: true,
            estado: true,
            processos: {
              select: {
                processo: {
                  select: { id: true, nome: true, pais: true },
                },
              },
            },
          },
          orderBy: { nome: "asc" },
        }),
      ])

      const clientesSem = [
        ...contratantes.map((c) => ({
          ...c,
          tipo: "Contratante" as const,
          processos: c.processos.map((p) => p.processo),
        })),
        ...requerentes.map((r) => ({
          ...r,
          tipo: "Requerente" as const,
          processos: r.processos.map((p) => p.processo),
        })),
      ]

      clientesSem.sort((a, b) => a.nome.localeCompare(b.nome))

      return NextResponse.json({
        clientes: clientesSem,
        total: clientesSem.length,
        semAniversario: true,
      })
    }

    // ========== CLIENTES COM DATA DE NASCIMENTO ==========
    const [contratantes, requerentes] = await Promise.all([
      prisma.contratante.findMany({
        where: { dataNascimento: { not: null } },
        select: {
          id: true,
          nome: true,
          dataNascimento: true,
          telefone: true,
          email: true,
          cidade: true,
          estado: true,
          processos: {
            select: {
              processo: {
                select: { id: true, nome: true, pais: true },
              },
            },
          },
        },
        orderBy: { nome: "asc" },
      }),
      prisma.requerente.findMany({
        where: { dataNascimento: { not: null } },
        select: {
          id: true,
          nome: true,
          dataNascimento: true,
          telefone: true,
          email: true,
          cidade: true,
          estado: true,
          processos: {
            select: {
              processo: {
                select: { id: true, nome: true, pais: true },
              },
            },
          },
        },
        orderBy: { nome: "asc" },
      }),
    ])

    const todosClientes = [
      ...contratantes.map((c) => ({
        ...c,
        tipo: "Contratante" as const,
        processos: c.processos.map((p) => p.processo),
      })),
      ...requerentes.map((r) => ({
        ...r,
        tipo: "Requerente" as const,
        processos: r.processos.map((p) => p.processo),
      })),
    ]

    let clientesFiltrados = todosClientes

    // Filtrar por mês (UTC)
    if (mes) {
      const mesNum = parseInt(mes)
      clientesFiltrados = todosClientes.filter((c) => {
        if (!c.dataNascimento) return false
        return new Date(c.dataNascimento).getUTCMonth() + 1 === mesNum
      })
    }

    // Filtrar por próximos dias (UTC)
    if (proximosDias) {
      const dias = parseInt(proximosDias)
      const hoje = new Date()
      hoje.setHours(0, 0, 0, 0)

      clientesFiltrados = todosClientes.filter((c) => {
        if (!c.dataNascimento) return false
        const dataNasc = new Date(c.dataNascimento)
        const proximoAniversario = new Date(
          hoje.getFullYear(),
          dataNasc.getUTCMonth(),
          dataNasc.getUTCDate()
        )
        if (proximoAniversario < hoje) {
          proximoAniversario.setFullYear(hoje.getFullYear() + 1)
        }
        const diffTime = proximoAniversario.getTime() - hoje.getTime()
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        return diffDays >= 0 && diffDays <= dias
      })
    }

    // Ordenar por mês/dia (UTC)
    clientesFiltrados.sort((a, b) => {
      const dateA = new Date(a.dataNascimento!)
      const dateB = new Date(b.dataNascimento!)
      const monthDiff = dateA.getUTCMonth() - dateB.getUTCMonth()
      if (monthDiff !== 0) return monthDiff
      return dateA.getUTCDate() - dateB.getUTCDate()
    })

    // Resumo por mês (UTC)
    const resumoPorMes: Record<number, number> = {}
    todosClientes.forEach((c) => {
      if (c.dataNascimento) {
        const m = new Date(c.dataNascimento).getUTCMonth() + 1
        resumoPorMes[m] = (resumoPorMes[m] || 0) + 1
      }
    })

    return NextResponse.json({
      clientes: clientesFiltrados,
      total: clientesFiltrados.length,
      totalComAniversario: todosClientes.length,
      resumoPorMes,
    })
  } catch (error) {
    console.error("Erro ao buscar aniversariantes:", error)
    return NextResponse.json(
      { error: "Erro ao buscar aniversariantes" },
      { status: 500 }
    )
  }
}