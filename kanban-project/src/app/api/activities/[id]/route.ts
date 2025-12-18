import { NextResponse } from "next/server"

// GET - Buscar atividade por ID (deprecated)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return NextResponse.json({ 
    atividade: null,
    message: "API deprecated - use /api/processos" 
  })
}

// PUT - Atualizar atividade (deprecated)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return NextResponse.json({ 
    atividade: null,
    message: "API deprecated - use /api/processos" 
  })
}

// DELETE - Excluir atividade (deprecated)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return NextResponse.json({ 
    message: "API deprecated - use /api/processos" 
  })
}