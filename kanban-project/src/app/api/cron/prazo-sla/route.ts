// src/app/api/cron/prazo-sla/route.ts
// ============================================================================
// VARREDURA do Módulo de Prazos/SLA/Acompanhamento — de hora em hora
// (`vercel.json`, mesma cadência de `/api/cron/avisos-prazo`). Só alcança
// tarefas VINCULADAS a uma Política de Prazo/SLA (`politicaPrazoSlaVersaoId`
// preenchido); não toca em nenhuma tarefa fora deste módulo. Mesma convenção
// de autorização dos crons existentes.
// ============================================================================
import { type NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { varrerPrazosEAcompanhamentosSla } from "@/src/services/prazo-sla/varredura-prazo-sla"

export const dynamic = "force-dynamic"
export const maxDuration = 60

async function autorizado(req: NextRequest): Promise<boolean> {
  if (req.headers.get("x-vercel-cron")) return true
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (segredo && auth === `Bearer ${segredo}`) return true
  const usuario = await extrairUsuarioComPermissoes(req)
  return !!usuario && (usuario.tipo === "admin" || temPermissao(usuario.permissoes, "usuarios.gerenciar"))
}

async function executar(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  try {
    const relatorio = await varrerPrazosEAcompanhamentosSla({})
    console.log(`[cron/prazo-sla] avaliadas=${relatorio.avaliadas} proximoDoVencimento=${relatorio.proximoDoVencimento} vencido=${relatorio.vencido} retornoAAtencao=${relatorio.retornoAAtencao} escalonamentos=${relatorio.escalonamentosGerados}`)
    return NextResponse.json(relatorio)
  } catch (e) {
    console.error("[cron/prazo-sla] falha na varredura:", e)
    return NextResponse.json({ error: "Varredura de prazo/SLA indisponível.", detalhe: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}

export const GET = executar
export const POST = executar
