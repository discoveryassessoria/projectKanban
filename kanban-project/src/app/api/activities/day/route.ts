import { NextRequest, NextResponse } from "next/server"

// GET - Atividades do dia (deprecated)
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    atividades: [],
    message: "API deprecated - use /api/processos" 
  })
}