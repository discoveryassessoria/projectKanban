// src/app/api/operacao/tarefas/cobrar-todos-vencidos/route.ts
// ============================================================================
// COBRAR TODOS OS VENCIDOS — Etapa 3 (tela Operação v3, 26/09/2026), aba
// Acompanhamento. Registra uma cobrança por tarefa entre as selecionadas
// (o cliente já filtrou por `acompanhamentoVencido && terceiro` — mesmo
// comportamento do protótipo, que aplica a cobrança individualmente a cada
// tarefa vencida, não uma só por órgão apesar do rótulo do botão).
//
//   POST /api/operacao/tarefas/cobrar-todos-vencidos
//   body: { tarefaIds: number[], canal?: string, resultado?: string, observacao?: string, dataContato?: string }
// ============================================================================
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { cobrarTarefas, CANAIS_VALIDOS, RESULTADOS_VALIDOS } from "@/src/services/cobranca-terceiros"

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "tarefas.ver")
  if (erro) return erro
  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: "não autenticado" }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const tarefaIds = Array.isArray(body.tarefaIds) ? body.tarefaIds.map(Number).filter(Number.isInteger) : []
  if (tarefaIds.length === 0) return NextResponse.json({ ok: false, code: "SEM_TAREFAS", mensagem: "Nenhuma tarefa vencida para cobrar." }, { status: 400 })
  // Canal ausente/inválido = o CANAL CADASTRADO de cada tarefa (Bloco G) — antes
  // era EMAIL fixo. A tela sempre manda o canal escolhido no formulário.
  const canalRaw = typeof body.canal === "string" ? body.canal.toUpperCase() : ""
  const canal = CANAIS_VALIDOS.has(canalRaw) ? canalRaw : null
  // Default SEM_RESPOSTA — mesmo raciocínio de /cobrar (Bloco B, 29/09/2026).
  const resultadoRaw = String(body.resultado ?? "SEM_RESPOSTA").toUpperCase()
  const resultado = RESULTADOS_VALIDOS.has(resultadoRaw) ? resultadoRaw : "SEM_RESPOSTA"
  const observacao = typeof body.observacao === "string" ? body.observacao.trim() || null : null
  const dataContatoRaw = typeof body.dataContato === "string" && body.dataContato.trim() ? new Date(body.dataContato) : null
  const dataContato = dataContatoRaw && !Number.isNaN(dataContatoRaw.getTime()) ? dataContatoRaw : null

  const { cobradas, ignoradas } = await cobrarTarefas({
    tarefaIds, autor: { userId: usuario.userId, tipo: usuario.tipo }, canal, resultado, observacao, dataContato,
  })
  return NextResponse.json({ ok: true, cobradas: cobradas.length, ignoradas })
}
