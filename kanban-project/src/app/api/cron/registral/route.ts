// GET/POST — WORKER do motor registral.
//
// Drena os lotes que ainda têm documento pendente e as execuções que voltaram
// para reprocessamento (com backoff). Idempotente e reentrante: o claim atômico
// por execução garante que duas invocações concorrentes não processem o mesmo
// documento.
//
// Autorização: mesmo padrão do cron de câmbio já existente — segredo do Vercel
// Cron (`CRON_SECRET`) OU permissão explícita quando chamado por um operador.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { processarLote } from "@/src/services/registral/lote"
import { logRegistral } from "@/src/services/registral/auditoria"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"
import { LOTE_PADRAO_POR_CICLO } from "@/src/services/registral/constantes"

/** Máximo de lotes tocados por invocação (mantém a função dentro do tempo). */
const MAX_LOTES = 5

// O worker pode percorrer vários lotes: mesma janela do cron de câmbio.
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Autorização, na MESMA convenção do cron que já existe no projeto:
 *   · `x-vercel-cron` — header que a Vercel injeta na execução agendada. Sem
 *     aceitar isto o worker simplesmente nunca roda em produção;
 *   · `Authorization: Bearer <CRON_SECRET>` — para acionamento externo;
 *   · usuário autenticado com `registral.reprocessar` — para o operador disparar
 *     o worker manualmente.
 */
async function autorizado(request: NextRequest): Promise<boolean> {
  if (request.headers.get("x-vercel-cron")) return true

  const segredo = process.env.CRON_SECRET
  if (segredo) {
    const header = request.headers.get("authorization") ?? ""
    if (header === `Bearer ${segredo}`) return true
  }
  const usuario = await extrairUsuarioComPermissoes(request)
  return !!usuario && temPermissao(usuario.permissoes, "registral.reprocessar")
}

async function executar(request: NextRequest) {
  if (!(await autorizado(request))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const q = new URL(request.url).searchParams
  const limiteRaw = Number.parseInt(q.get("limite") ?? "", 10)
  const limite = Number.isFinite(limiteRaw) && limiteRaw > 0 ? limiteRaw : LOTE_PADRAO_POR_CICLO

  const pendentes = await prisma.loteRegistral.findMany({
    where: {
      status: { in: ["RECEBIDO", "EM_PROCESSAMENTO"] },
      execucoes: { some: { etapa: { in: ["RECEBIDO", "REPROCESSAMENTO"] } } },
    },
    orderBy: { criadoEm: "asc" },
    take: MAX_LOTES,
    select: { id: true },
  })

  const resultados: Array<Record<string, unknown>> = []
  for (const lote of pendentes) {
    try {
      const r = await processarLote({ loteId: lote.id, limite })
      resultados.push({ ...r })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logRegistral("error", "worker_lote_falhou", { loteId: lote.id, erro: msg })
      resultados.push({ loteId: lote.id, erro: msg })
    }
  }

  logRegistral("info", "worker_ciclo", { lotes: pendentes.length })
  return NextResponse.json({ lotesTocados: pendentes.length, resultados })
}

export async function GET(request: NextRequest) {
  return executar(request)
}

export async function POST(request: NextRequest) {
  return executar(request)
}
