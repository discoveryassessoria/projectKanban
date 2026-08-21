// src/app/api/workflow-step-instances/[id]/reabrir/route.ts
//
// REABRIR UMA EXECUÇÃO — desta pessoa, deste documento, desta etapa.
//
//   GET   o plano: quem é a unidade, as execuções que já houve, o que a cadeia
//         alcançaria NA MESMA unidade, e quantas outras unidades ficam intactas.
//   POST  reabre: uma execução nova, arquivando a atual.
//
// A rota é POR INSTÂNCIA e não por fase, nem por chave de passo. "Reabrir Solicitar
// certidão" não é um comando: é ambíguo entre cinquenta certidões. O comando é
// "reabrir ESTA instância", e o id na URL é a identidade.
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { planejarReabertura, executarReabertura } from "@/src/services/reabertura-de-execucao"
import { MOTIVOS_MOVIMENTACAO } from "@/src/lib/motor/motivos-movimentacao"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "workflow.iniciarPasso")
  if (erro) return erro
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 })
  const plano = await planejarReabertura(id)
  if (!plano) return NextResponse.json({ error: "Etapa não encontrada." }, { status: 404 })
  return NextResponse.json({ ok: true, plano, motivos: MOTIVOS_MOVIMENTACAO })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "workflow.iniciarPasso")
  if (erro) return erro
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const usuario = await extrairUsuarioComPermissoes(request)

  // PERMISSÃO POR ETAPA, quando o cadastro a declara. A permissão geral abre a porta;
  // a do cadastro é a tranca que o administrador escolheu pôr nesta etapa específica.
  const plano = await planejarReabertura(id)
  if (plano?.permissaoExigida) {
    const concedidas = Object.entries(usuario?.permissoes ?? {}).filter(([, v]) => v === true).map(([k]) => k)
    if (!concedidas.includes(plano.permissaoExigida)) {
      return NextResponse.json(
        { ok: false, code: "SEM_PERMISSAO", mensagem: `Reabrir esta etapa exige a permissão "${plano.permissaoExigida}".` },
        { status: 403 },
      )
    }
  }

  const r = await executarReabertura({
    stepInstanceId: id,
    motivoCodigo: String(body?.motivoCodigo ?? "ERRO_OPERACIONAL"),
    justificativa: String(body?.justificativa ?? ""),
    comDependentes: body?.comDependentes === true,
    actorId: usuario?.userId ?? null,
    correlationId: body?.correlationId ? String(body.correlationId).slice(0, 120) : undefined,
  })
  return NextResponse.json(r, { status: r.ok ? 200 : 422 })
}
