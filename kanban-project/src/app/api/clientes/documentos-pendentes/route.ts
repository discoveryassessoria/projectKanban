// ESTE ARQUIVO VAI EM: src/app/api/clientes/documentos-pendentes/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filtro = searchParams.get("filtro") // "RG", "CNH", "COMPROVANTE_ENDERECO" ou null (todos)

    // Buscar todos os contratantes com seus anexos categorizados
    const contratantes = await prisma.contratante.findMany({
      include: {
        anexos: {
          where: {
            categoria: { in: ["RG", "CNH", "COMPROVANTE_ENDERECO"] },
          },
          select: { categoria: true },
        },
        processos: {
        select: {
            processo: {
            select: {
                id: true,
                nome: true,
                pais: true,
            },
            },
        },
        },
      },
      orderBy: { nome: "asc" },
    })

    // Buscar todos os requerentes com seus anexos categorizados
    const requerentes = await prisma.requerente.findMany({
      include: {
        anexos: {
          where: {
            categoria: { in: ["RG", "CNH", "COMPROVANTE_ENDERECO"] },
          },
          select: { categoria: true },
        },
        processos: {
        select: {
            processo: {
            select: {
                id: true,
                nome: true,
                pais: true,
            },
            },
        },
        },
      },
      orderBy: { nome: "asc" },
    })

    // Montar lista com status de cada documento
    const todosClientes = [
      ...contratantes.map((c) => {
        const categorias = c.anexos.map((a: any) => a.categoria)
        const temRG = categorias.includes("RG")
        const temCNH = categorias.includes("CNH")
        const temComprovante = categorias.includes("COMPROVANTE_ENDERECO")
        const documentosFaltantes = [
          !temRG ? "RG" : null,
          !temCNH ? "CNH" : null,
          !temComprovante ? "Comprovante de Endereço" : null,
        ].filter(Boolean) as string[]

        return {
          id: c.id,
          tipo: "Contratante" as const,
          nome: c.nome || "Sem nome",
          cpf: c.cpf,
          telefone: c.telefone,
          email: c.email,
          temRG,
          temCNH,
          temComprovante,
          documentosFaltantes,
          totalFaltantes: documentosFaltantes.length,
          processos: c.processos.map((pc) => ({
          id: pc.processo.id,
          nome: pc.processo.nome,
          pais: pc.processo.pais,
          })),
        }
      }),
      ...requerentes.map((r) => {
        const categorias = r.anexos.map((a: any) => a.categoria)
        const temRG = categorias.includes("RG")
        const temCNH = categorias.includes("CNH")
        const temComprovante = categorias.includes("COMPROVANTE_ENDERECO")
        const documentosFaltantes = [
          !temRG ? "RG" : null,
          !temCNH ? "CNH" : null,
          !temComprovante ? "Comprovante de Endereço" : null,
        ].filter(Boolean) as string[]

        return {
          id: r.id,
          tipo: "Requerente" as const,
          nome: r.nome || "Sem nome",
          cpf: r.cpf,
          telefone: r.telefone,
          email: r.email,
          temRG,
          temCNH,
          temComprovante,
          documentosFaltantes,
          totalFaltantes: documentosFaltantes.length,
          processos: r.processos.map((pr) => ({
          id: pr.processo.id,
          nome: pr.processo.nome,
          pais: pr.processo.pais,
          })),
        }
      }),
    ]

    // Aplicar filtro específico se fornecido
    let clientesFiltrados
    if (filtro === "RG") {
      clientesFiltrados = todosClientes.filter((c) => !c.temRG)
    } else if (filtro === "CNH") {
      clientesFiltrados = todosClientes.filter((c) => !c.temCNH)
    } else if (filtro === "COMPROVANTE_ENDERECO") {
      clientesFiltrados = todosClientes.filter((c) => !c.temComprovante)
    } else {
      // "todos" - qualquer documento faltante
      clientesFiltrados = todosClientes.filter((c) => c.totalFaltantes > 0)
    }

    // Ordenar: mais documentos faltantes primeiro, depois por nome
    clientesFiltrados.sort((a, b) => {
      if (b.totalFaltantes !== a.totalFaltantes) return b.totalFaltantes - a.totalFaltantes
      return a.nome.localeCompare(b.nome)
    })

    // Totais gerais (sempre sobre todos os clientes)
    const totalClientes = todosClientes.length
    const totalComFalta = todosClientes.filter((c) => c.totalFaltantes > 0).length
    const totalCompletos = totalClientes - totalComFalta
    const faltaRG = todosClientes.filter((c) => !c.temRG).length
    const faltaCNH = todosClientes.filter((c) => !c.temCNH).length
    const faltaComprovante = todosClientes.filter((c) => !c.temComprovante).length

    return NextResponse.json({
      clientes: clientesFiltrados,
      totais: {
        totalClientes,
        totalComFalta,
        totalCompletos,
        faltaRG,
        faltaCNH,
        faltaComprovante,
      },
    })
  } catch (error) {
    console.error("Erro ao buscar documentos pendentes:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}