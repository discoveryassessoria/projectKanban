// src/app/api/processos/[processoId]/phase/rollback/route.ts
//
// RETROCEDER FASE — o comando próprio, com o impacto na frente.
//
//   GET  ?faseDestino=...   devolve o PLANO: obrigações da fase de destino, estado de
//                           cada uma, de que dependem, se podem ser reexecutadas e o
//                           que a reabertura de cada uma alcançaria.
//   POST                    executa: move a fase e reabre SOMENTE o que foi marcado.
//
// Existe separado de `phase/move` porque são comandos diferentes: mover para frente é
// avanço administrativo; mover para trás abre a pergunta "e o trabalho que já foi
// feito?". Misturar os dois foi o que deixou o administrador sem resposta para essa
// pergunta — e, na falta dela, o único botão que restava era "Cancelar operação".
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
  const reabrir = Array.isArray(body?.reabrir)
    ? (body.reabrir as unknown[])
        .filter((r): r is { stepInstanceId: number; comDependentes?: boolean } =>
          !!r && typeof r === "object" && Number.isFinite((r as { stepInstanceId?: number }).stepInstanceId))
        .map((r) => ({ stepInstanceId: Number(r.stepInstanceId), comDependentes: r.comDependentes === true }))
    : []

  try {
    const r = await executarRetrocesso({
      processoId,
      faseDestino,
      motivoCodigo: String(body?.motivoCodigo ?? "CORRECAO_CADASTRO"),
      justificativa: String(body?.justificativa ?? ""),
      reabrir,
      actorId: usuario?.userId ?? null,
      origem: String(body?.origem ?? "retrocesso"),
      // IDEMPOTÊNCIA DO COMANDO: a tela manda a mesma correlação no retry, no duplo
      // clique e na segunda aba. Sem ela, cada envio criaria uma execução nova.
      correlationId: body?.correlationId ? String(body.correlationId).slice(0, 120) : undefined,
    })
    return NextResponse.json(r, { status: r.ok ? 200 : 422 })
  } catch (e) {
    const recusas = (e as { recusas?: string[] }).recusas
    if (recusas) {
      // A transação inteira voltou: nada foi reaberto. Dizer quais recusaram é o que
      // permite ao administrador corrigir a seleção em vez de tentar de novo às cegas.
      return NextResponse.json(
        { ok: false, code: "REABERTURA_RECUSADA", mensagem: recusas.join(" · "), reabertas: [], alcancadasPorDependencia: [] },
        { status: 422 },
      )
    }
    console.error("POST phase/rollback", e)
    return NextResponse.json({ error: "Erro ao retroceder a fase." }, { status: 500 })
  }
}
