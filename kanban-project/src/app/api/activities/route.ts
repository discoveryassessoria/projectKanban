import { NextRequest, NextResponse } from "next/server"

// GET - Listar atividades (deprecated - usar /api/processos)
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    atividades: [],
    message: "API deprecated - use /api/processos" 
  })
}

// POST - Criar atividade (deprecated)
export async function POST(request: NextRequest) {
  return NextResponse.json({ 
    atividade: null,
    message: "API deprecated - use /api/processos" 
  }, { status: 410 })
}