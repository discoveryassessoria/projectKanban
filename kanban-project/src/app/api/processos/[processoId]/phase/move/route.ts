// src/app/api/processos/[processoId]/phase/move/route.ts
//
// MOVIMENTAÇÃO MANUAL DE FASE — Administrador Master.
//
// Reposiciona o processo em QUALQUER fase do workflow (anterior, posterior ou
// intermediária) SEM as validações do fluxo automático. É a válvula administrativa
// para o caso em que a realidade e o sistema divergiram — e, como toda válvula
// dessas, é registrada: origem, destino, usuário, data e motivo.
//
// AUTORIZAÇÃO: permissão EXCLUSIVA `processos.moverFaseManual`. Exclusiva significa
// que nem `tipo = 'admin'` a recebe por ser admin (ver PERMISSOES_EXCLUSIVAS): ela só
// existe por concessão NOMINAL no perfil ou nas permissões do usuário. Funcionário
// não move processo manualmente, e "ser admin" não é autorização — a concessão é.
//
// A movimentação só REPOSICIONA. Nada é apagado: as tarefas, os passos, os eventos e
// o histórico das demais fases seguem intactos, e a fase de origem é supersedida (não
// concluída) preservando o ciclo dela.

import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { movePhaseManual } from "@/src/lib/motor/phase-advance"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ processoId: string }> }
) {
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!temPermissao(usuario.permissoes, "processos.moverFaseManual")) {
    return NextResponse.json(
      {
        error: "Movimentação manual de fase é exclusiva do Administrador Master.",
        permissao: "processos.moverFaseManual",
      },
      { status: 403 },
    )
  }

  try {
    const { processoId: pid } = await params
    const processoId = parseInt(pid)
    if (isNaN(processoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    // O usuário da movimentação vem do TOKEN, nunca do corpo da requisição: quem
    // assina a decisão é quem está autenticado.
    const resultado = await movePhaseManual(processoId, {
      faseAlvo: String(body?.faseAlvo ?? ""),
      justificativa: String(body?.justificativa ?? ""),
      motivoCodigo: String(body?.motivoCodigo ?? ""),
      correlationId: body?.correlationId,
      causationId: body?.causationId,
      solicitadoPorId: usuario.userId,
      origem: "move-route",
    })

    const status = resultado.success
      ? 200
      : resultado.resultado === "CONFLITO"
        ? 409
        : resultado.code === "JUSTIFICATIVA_OBRIGATORIA" ||
          resultado.code === "MOTIVO_OBRIGATORIO" ||
          resultado.code === "FASE_ALVO_INVALIDA"
          ? 422
          : 400
    return NextResponse.json(resultado, { status })
  } catch (error) {
    console.error("[POST .../phase/move]", error)
    return NextResponse.json({ error: "Erro interno na movimentação de fase" }, { status: 500 })
  }
}
