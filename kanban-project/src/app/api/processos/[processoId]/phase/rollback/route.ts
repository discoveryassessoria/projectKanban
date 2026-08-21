// src/app/api/processos/[processoId]/phase/rollback/route.ts
//
// RETROCEDER FASE — reposicionar o processo, e só isso.
//
//   GET  ?faseDestino=...   retrato do que existe na fase de destino (leitura)
//   POST                    move a fase
//
// NÃO EXISTE PARÂMETRO DE REABERTURA AQUI, e a ausência é o contrato. Reabrir é outro
// comando, com rota própria (`/api/workflow-step-instances/[id]/reabrir`), porque é
// uma decisão sobre UMA unidade de trabalho — esta certidão, desta pessoa —, e não
// sobre a posição do processo. Numa Emissão com cinquenta certidões, a diferença é a
// distância entre reposicionar e refazer quarenta e nove trabalhos que estavam certos.
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { planejarRetrocesso, executarRetrocesso } from "@/src/services/retrocesso-de-fase"
import { MOTIVOS_MOVIMENTACAO } from "@/src/lib/motor/motivos-movimentacao"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.moverFaseManual")
  if (erro) return erro
  const processoId = Number((await params).processoId)
  const faseDestino = request.nextUrl.searchParams.get("faseDestino")
  if (!Number.isFinite(processoId) || !faseDestino) {
    return NextResponse.json({ error: "Processo e fase de destino são obrigatórios." }, { status: 400 })
  }
  const plano = await planejarRetrocesso(processoId, faseDestino)
  if (!plano) return NextResponse.json({ error: "Processo não encontrado." }, { status: 404 })
  return NextResponse.json({ success: true, plano, motivos: MOTIVOS_MOVIMENTACAO })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(request, "processos.moverFaseManual")
  if (erro) return erro
  const processoId = Number((await params).processoId)
  if (!Number.isFinite(processoId)) return NextResponse.json({ error: "Processo inválido." }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const faseDestino = String(body?.faseDestino ?? "")
  if (!faseDestino) return NextResponse.json({ error: "Fase de destino é obrigatória." }, { status: 400 })

  const usuario = await extrairUsuarioComPermissoes(request)
  const r = await executarRetrocesso({
    processoId,
    faseDestino,
    motivoCodigo: String(body?.motivoCodigo ?? "CORRECAO_CADASTRO"),
    justificativa: String(body?.justificativa ?? ""),
    actorId: usuario?.userId ?? null,
    origem: String(body?.origem ?? "retrocesso"),
    correlationId: body?.correlationId ? String(body.correlationId).slice(0, 120) : undefined,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
