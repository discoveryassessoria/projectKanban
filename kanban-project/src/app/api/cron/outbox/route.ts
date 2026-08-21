// src/app/api/cron/outbox/route.ts
// ============================================================================
// A FILA DRENA SOZINHA — de quinze em quinze minutos.
//
//   GET/POST /api/cron/outbox            drena
//   GET/POST /api/cron/outbox?ensaio=1   só conta o que drenaria
//
// ─── POR QUE ISTO PRECISOU EXISTIR ──────────────────────────────────────────
// O dispatcher só rodava DE CARONA: pendurado em criar processo, em avançar fase,
// em concluir passo — sempre com um filtro de tipo, sempre no caminho de alguém.
// Isso funciona enquanto houver tráfego naquele caminho específico. Não havendo,
// a fila cresce em silêncio: em produção havia eventos PENDENTES desde 3 de agosto,
// 217 no total, e o efeito deles simplesmente não acontecia. Ninguém recebeu erro —
// o silêncio de uma fila parada é idêntico ao de uma fila vazia.
//
// Um cron não reduz a chance: ele fecha a questão. Não importa por qual caminho o
// evento nasceu nem se alguém passou por lá depois; no máximo quinze minutos depois,
// ele é processado ou registra por que falhou.
//
// ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
// Não decide nada. Chama `processarOutbox`, que é o MESMO dispatcher das chamadas
// de carona, com o MESMO claim atômico e a MESMA idempotência por evento. Dois
// workers simultâneos não processam o mesmo evento: o claim resolve. E ele não
// reprocessa evento que já estourou o teto de tentativas — isso é conserto, e
// conserto é decisão de quem opera.
// ============================================================================
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { processarOutbox, TIPOS_DRENADOS } from "@/src/services/outbox-dispatcher"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** Teto por execução: drenar é manutenção, não pode virar carga. */
const LOTE = 300

async function autorizado(req: NextRequest): Promise<boolean> {
  if (req.headers.get("x-vercel-cron")) return true
  const segredo = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (segredo && auth === `Bearer ${segredo}`) return true
  const usuario = await extrairUsuarioComPermissoes(req)
  return !!usuario && (usuario.tipo === "admin" || temPermissao(usuario.permissoes, "usuarios.gerenciar"))
}

async function executar(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
  }
  const ensaio = new URL(req.url).searchParams.get("ensaio") === "1"

  const pendentesPorTipo = await prisma.domainOutbox.groupBy({
    by: ["tipo"],
    where: { status: "PENDENTE" },
    _count: { _all: true },
  })
  const fila = Object.fromEntries(pendentesPorTipo.map((p) => [p.tipo, p._count._all]))

  if (ensaio) {
    return NextResponse.json({ ok: true, ensaio: true, fila, tiposDrenados: TIPOS_DRENADOS })
  }

  const resumo = await processarOutbox({ limite: LOTE })
  const restante = await prisma.domainOutbox.count({ where: { status: "PENDENTE" } })

  console.log(
    `[cron/outbox] lidos=${resumo.lidos} processados=${resumo.processados} ` +
    `falhos=${resumo.falhos} ignorados=${resumo.ignorados} restante=${restante}`,
  )
  // Falha de evento não derruba a execução: ela fica no `erro` da linha, e o próximo
  // ciclo tenta de novo até o teto. Devolver 200 aqui é correto — o cron fez o que
  // devia; o que falhou é do evento, e está registrado nele.
  return NextResponse.json({
    ok: true, ...resumo,
    detalhes: resumo.detalhes.filter((d) => d.status === "ERRO").slice(0, 20),
    filaAntes: fila, restante,
  })
}

export async function GET(req: NextRequest) { return executar(req) }
export async function POST(req: NextRequest) { return executar(req) }
