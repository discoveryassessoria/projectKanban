// src/app/api/processos/[processoId]/impacto-exclusao/route.ts
//
// PREVIEW server-side do DELETE de Processo (só leitura). A interface chama
// esta rota ANTES de confirmar a exclusão — nunca confia em contagem
// calculada no cliente. O DELETE efetivo (route.ts irmã) revalida o mesmo
// plano dentro da transação; este endpoint nunca decide nada por si.
import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { analisarExclusaoProcesso } from "@/src/services/processo-ciclo-vida"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ processoId: string }> },
) {
  try {
    // Mesma permissão exigida pelo DELETE efetivo — o preview não pode
    // vazar o impacto (contagens, fatos financeiros) para quem não teria
    // autorização de executar a ação que ele descreve.
    const erro = await verificarPermissao(request, "processos.excluirDefinitivo")
    if (erro) return erro

    const { processoId } = await params
    const id = parseInt(processoId)
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 })
    }

    const plano = await analisarExclusaoProcesso(id)
    if (!plano) {
      return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
    }

    return NextResponse.json(plano)
  } catch (error) {
    console.error("Erro ao calcular impacto de exclusão do processo:", error)
    return NextResponse.json({ error: "Erro ao calcular impacto de exclusão" }, { status: 500 })
  }
}
