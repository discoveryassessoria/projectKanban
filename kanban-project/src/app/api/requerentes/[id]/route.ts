// src/app/api/requerentes/[id]/route.ts
//
// 🛡️ Versão blindada — retorna JSON válido em QUALQUER cenário, loga o
// payload recebido e o tempo de query pra facilitar debug, e traduz
// erros do Prisma em mensagens compreensíveis.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from '@/src/lib/verificar-permissao'

// ============================================================================
// Helper: resposta de erro padronizada (SEMPRE JSON válido)
// ============================================================================
function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: message, ...(extra ?? {}) },
    { status }
  )
}

// ============================================================================
// Helper: traduz erro do Prisma em mensagem humana
// Usa duck-typing em vez de `instanceof Prisma.PrismaClientKnownRequestError`
// porque esse namespace pode não estar exposto em certas versões do client.
// ============================================================================
function tratarErroPrisma(error: unknown): { message: string; status: number } {
  if (error instanceof Error) {
    const err = error as Error & { code?: string; meta?: { target?: string[] } }

    // P2002 = violação de unique constraint (Prisma)
    if (err.code === 'P2002') {
      const campo = err.meta?.target?.[0] ?? 'campo'
      return {
        message: `Já existe um requerente com esse ${campo}`,
        status: 409,
      }
    }

    // P2025 = registro não encontrado (Prisma)
    if (err.code === 'P2025') {
      return { message: 'Requerente não encontrado no banco', status: 404 }
    }

    // P2003 = foreign key quebrada (Prisma)
    if (err.code === 'P2003') {
      return { message: 'Referência inválida no banco de dados', status: 400 }
    }

    // PrismaClientValidationError costuma ter name específico
    if (err.name === 'PrismaClientValidationError' ||
        err.message.includes('PrismaClientValidationError')) {
      return {
        message: 'Um dos campos tem valor inválido. Verifique o formato.',
        status: 400,
      }
    }

    // Erro de JSON.parse no body (body vazio ou truncado)
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      return {
        message: 'Dados enviados estão incompletos ou corrompidos. Tente novamente.',
        status: 400,
      }
    }

    // Timeout (Prisma Accelerate tem limite de 10s no Starter)
    if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      return {
        message: 'O banco demorou demais para responder. Tente novamente em alguns segundos.',
        status: 504,
      }
    }
  }

  return { message: 'Erro interno ao processar requerente', status: 500 }
}

// ============================================================================
// GET - Buscar requerente por ID
// ============================================================================
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const parsedId = parseInt(id)

    if (isNaN(parsedId)) {
      return jsonError("ID inválido", 400)
    }

    const requerente = await prisma.requerente.findUnique({
      where: { id: parsedId },
      include: {
        processos: {
          include: {
            processo: {
              include: {
                status: true,
              }
            }
          }
        },
      },
    })

    if (!requerente) {
      return jsonError("Requerente não encontrado", 404)
    }

    return NextResponse.json({ requerente })
  } catch (error) {
    console.error("[GET /api/requerentes/:id] erro:", error)
    const { message, status } = tratarErroPrisma(error)
    return jsonError(message, status)
  }
}

// ============================================================================
// PUT - Atualizar requerente
// ============================================================================
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const t0 = Date.now()
  let parsedId: number | null = null

  try {
    const erro = await verificarPermissao(request, 'clientes.editar')
    if (erro) return erro

    const { id } = await params
    parsedId = parseInt(id)

    if (isNaN(parsedId)) {
      return jsonError("ID inválido", 400)
    }

    // 🛡️ Parse do body com proteção contra body vazio/truncado
    let body: Record<string, unknown>
    try {
      const raw = await request.text()
      if (!raw || raw.trim() === '') {
        console.warn(`[PUT /api/requerentes/${parsedId}] body vazio recebido`)
        return jsonError(
          'Nenhum dado foi enviado. Recarregue a página e tente novamente.',
          400
        )
      }
      body = JSON.parse(raw)
    } catch (parseError) {
      console.error(`[PUT /api/requerentes/${parsedId}] erro ao parsear body:`, parseError)
      return jsonError(
        'Os dados enviados estão corrompidos. Recarregue a página e tente novamente.',
        400
      )
    }

    // 🔍 Log do que chegou (pra ajudar a diferenciar req do Marco vs req do Gabriel)
    console.log(`[PUT /api/requerentes/${parsedId}] recebido:`, {
      campos: Object.keys(body),
      nome: body.nome,
      estadoCivil: body.estadoCivil,
      dataNascimento: body.dataNascimento,
      sexo: body.sexo,
      nacionalidade: body.nacionalidade,
    })

    // Verificar se existe
    const existente = await prisma.requerente.findUnique({
      where: { id: parsedId },
    })

    if (!existente) {
      return jsonError("Requerente não encontrado", 404)
    }

    // Montar objeto de dados para update
    const updateData: Record<string, unknown> = {}

    if (body.nome !== undefined) {
      const nome = typeof body.nome === 'string' ? body.nome.trim() : null
      updateData.nome = nome || null
    }
    if (body.cpf !== undefined) updateData.cpf = body.cpf || null
    if (body.rg !== undefined) updateData.rg = body.rg || null
    if (body.dataNascimento !== undefined) {
      // 🛡️ Proteção contra data inválida
      if (body.dataNascimento) {
        const d = new Date(body.dataNascimento as string)
        if (isNaN(d.getTime())) {
          return jsonError(
            `Data de nascimento inválida: "${body.dataNascimento}"`,
            400
          )
        }
        updateData.dataNascimento = d
      } else {
        updateData.dataNascimento = null
      }
    }
    if (body.sexo !== undefined) updateData.sexo = body.sexo || null
    if (body.estadoCivil !== undefined) updateData.estadoCivil = body.estadoCivil || null
    if (body.nacionalidade !== undefined) updateData.nacionalidade = body.nacionalidade || null
    if (body.telefone !== undefined) updateData.telefone = body.telefone || null
    if (body.email !== undefined) updateData.email = body.email || null
    if (body.endereco !== undefined) updateData.endereco = body.endereco || null
    if (body.numero !== undefined) updateData.numero = body.numero || null
    if (body.complemento !== undefined) updateData.complemento = body.complemento || null
    if (body.bairro !== undefined) updateData.bairro = body.bairro || null
    if (body.cidade !== undefined) updateData.cidade = body.cidade || null
    if (body.estado !== undefined) updateData.estado = body.estado || null
    if (body.cep !== undefined) updateData.cep = body.cep || null
    if (body.observacoes !== undefined) updateData.observacoes = body.observacoes || null

    const requerente = await prisma.requerente.update({
      where: { id: parsedId },
      data: updateData,
    })

    const elapsed = Date.now() - t0
    if (elapsed > 3000) {
      console.warn(`[PUT /api/requerentes/${parsedId}] query lenta: ${elapsed}ms`)
    }

    return NextResponse.json({ requerente })
  } catch (error) {
    const elapsed = Date.now() - t0
    console.error(
      `[PUT /api/requerentes/${parsedId}] erro após ${elapsed}ms:`,
      error
    )
    const { message, status } = tratarErroPrisma(error)
    return jsonError(message, status, { elapsed })
  }
}

// ============================================================================
// DELETE - Excluir requerente
// ============================================================================
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const erro = await verificarPermissao(request, 'clientes.excluir')
    if (erro) return erro

    const { id } = await params
    const parsedId = parseInt(id)

    if (isNaN(parsedId)) {
      return jsonError("ID inválido", 400)
    }

    const requerente = await prisma.requerente.findUnique({
      where: { id: parsedId },
      include: {
        _count: { select: { processos: true } }
      },
    })

    if (!requerente) {
      return jsonError("Requerente não encontrado", 404)
    }

    if (requerente._count.processos > 0) {
      return jsonError(
        `Este requerente está vinculado a ${requerente._count.processos} processo(s). Desvincule primeiro.`,
        400
      )
    }

    await prisma.requerente.delete({
      where: { id: parsedId },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[DELETE /api/requerentes/:id] erro:", error)
    const { message, status } = tratarErroPrisma(error)
    return jsonError(message, status)
  }
}