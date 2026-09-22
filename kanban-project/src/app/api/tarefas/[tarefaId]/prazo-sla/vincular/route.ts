// ESTE ARQUIVO VAI EM: src/app/api/tarefas/[tarefaId]/prazo-sla/vincular/route.ts
//
// POST - vincula a Tarefa a uma Política de Prazo/SLA PUBLICADA e calcula o
//        prazoDaTarefa (Tarefa.dataPrazo) + o primeiro acompanhamento a
//        partir do evento inicial informado. Ato administrativo/estrutural.

import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { vincularPoliticaATarefa } from "@/src/services/prazo-sla/tarefa-prazo-sla"

export async function POST(request: NextRequest, { params }: { params: Promise<{ tarefaId: string }> }) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { tarefaId } = await params
    const b = await request.json().catch(() => ({}))
    if (!b?.politicaChave) return NextResponse.json({ error: "Informe a política.", code: "POLITICA_OBRIGATORIA" }, { status: 400 })
    const baseCalculoEm = b.baseCalculoEm ? new Date(b.baseCalculoEm) : new Date()

    const resultado = await vincularPoliticaATarefa({ tarefaId: Number(tarefaId), politicaChave: String(b.politicaChave), baseCalculoEm })
    if (!resultado.success) return NextResponse.json({ error: resultado.message, code: resultado.code }, { status: 400 })
    return NextResponse.json(resultado)
  } catch (error) {
    console.error("Erro ao vincular política de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }
}
