import { NextRequest, NextResponse } from "next/server"

// GET - Calendário de atividades (deprecated)
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    atividades: [],
    message: "API deprecated - use /api/processos" 
  })
}