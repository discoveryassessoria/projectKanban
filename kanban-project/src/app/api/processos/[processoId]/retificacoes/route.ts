// src/app/api/processos/[processoId]/retificacoes/route.ts
//
// ABRIR UM PEDIDO DE RETIFICAÇÃO, dizendo quais divergências entram nele.
//
// ─── POR QUE ESTA ROTA EXISTE ───────────────────────────────────────────────
// A rota legada (`.../retificacao/pacotes`) cria um pacote VAZIO: escolhe judicial ou
// administrativa e pronto — nenhuma divergência é vinculada, e o que o pedido veio
// corrigir fica sabido só por quem estava na sala. Não havia, em lugar nenhum do
// sistema, uma operação que dissesse "estas três divergências vão na mesma petição".
//
// ─── O QUE ELA NÃO FAZ ──────────────────────────────────────────────────────
// Não agrupa sozinha. Não junta por processo, nem por pessoa, nem por documento, nem
// por tipo de erro — cada um desses critérios acerta num caso e erra no seguinte, e
// escolher um seria decidir, no código, uma questão que é de quem analisa.
//
// Quem decide manda a lista. A regra é a de quem conhece o caso; o sistema garante o
// resto: que a divergência não esteja em dois pedidos abertos, que o número seja único
// no processo, e que cada pedido tenha a própria cadeia de passos.

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  abrirPacoteDeRetificacao, divergenciasDoPacote, pacotesAbertos,
  MODOS_DE_RETIFICACAO, type ModoDeRetificacao,
} from "@/src/services/retificacao-canonica"

const HTTP_DO_ERRO: Record<string, number> = {
  MODO_INVALIDO: 422,
  PACOTE_SEM_DIVERGENCIA: 422,
  DIVERGENCIA_JA_EM_PEDIDO: 409,
}

export async function GET(_req: Request, { params }: { params: Promise<{ processoId: string }> }) {
  const { processoId } = await params
  const id = Number(processoId)
  if (!Number.isInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const pacotes = await pacotesAbertos(id)
  return NextResponse.json({
    pacotes: await Promise.all(pacotes.map(async (p) => ({
      ...p, divergencias: await divergenciasDoPacote(p.id),
    }))),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ processoId: string }> }) {
  try {
    const { processoId } = await params
    const id = Number(processoId)
    if (!Number.isInteger(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

    // A PORTA DE PERMISSÃO É A MESMA das outras rotas de processo — não uma checagem
    // própria, que divergiria no dia em que o mapa de permissões mudasse.
    const erro = await verificarPermissao(request, "processos.editar")
    if (erro) return erro

    const body = (await request.json().catch(() => ({}))) as {
      tipo?: string; divergenciaIds?: unknown; motivo?: string | null; orgaoId?: number | null
    }
    if (!(MODOS_DE_RETIFICACAO as readonly string[]).includes(String(body.tipo))) {
      return NextResponse.json({
        error: "MODO_INVALIDO",
        mensagem: `O modo precisa ser ${MODOS_DE_RETIFICACAO.join(" ou ")}.`,
      }, { status: 422 })
    }
    // A LISTA VEM DE QUEM DECIDE. O servidor confere que são números; quais entram
    // juntas é a pergunta que ele não tem como responder.
    const divergenciaIds = Array.isArray(body.divergenciaIds)
      ? body.divergenciaIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : []

    const r = await abrirPacoteDeRetificacao({
      processoId: id,
      tipo: body.tipo as ModoDeRetificacao,
      divergenciaIds,
      motivo: body.motivo ?? null,
      orgaoId: body.orgaoId ?? null,
    })
    return NextResponse.json({
      ok: true, pacoteId: r.pacoteId, num: r.num,
      divergencias: await divergenciasDoPacote(r.pacoteId),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERRO"
    const codigo = msg.split(":")[0]
    if (HTTP_DO_ERRO[codigo]) return NextResponse.json({ error: codigo, mensagem: msg }, { status: HTTP_DO_ERRO[codigo] })
    console.error("[POST .../retificacoes]", e)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
