// /api/gerenciamento/parametrizacao
//   GET  ?tipoProcessoId=&phaseKey=   → estado das 14 etapas (derivado)
//   POST { tipoProcessoId, phaseKey?, etapaAtual, etapasConcluidas? }
//        → salva SÓ o progresso (onde parei), nunca configuração
import { NextRequest, NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { estadoParametrizacao, ETAPAS, type EtapaKey } from "@/src/services/parametrizacao/estado-parametrizacao"

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, "usuarios.gerenciar"); if (erro) return erro
  const tipoProcessoId = Number(req.nextUrl.searchParams.get("tipoProcessoId"))
  if (!tipoProcessoId) return NextResponse.json({ error: "tipoProcessoId é obrigatório." }, { status: 400 })
  const phaseKey = req.nextUrl.searchParams.get("phaseKey")
  try {
    return NextResponse.json(await estadoParametrizacao({ tipoProcessoId, phaseKey }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao apurar o estado." }, { status: 422 })
  }
}

export async function POST(req: NextRequest) {
  const erro = await verificarPermissao(req, "usuarios.gerenciar"); if (erro) return erro
  const { prisma } = await import("@/lib/prisma")
  const b = await req.json().catch(() => ({}))
  const tipoProcessoId = Number(b?.tipoProcessoId)
  const phaseKey: string | null = b?.phaseKey ?? null
  const etapaAtual = String(b?.etapaAtual ?? "")
  if (!tipoProcessoId) return NextResponse.json({ error: "tipoProcessoId é obrigatório." }, { status: 400 })
  if (!ETAPAS.includes(etapaAtual as EtapaKey)) return NextResponse.json({ error: "Etapa desconhecida." }, { status: 400 })
  // Só CHAVES de etapa são aceitas — nunca conteúdo de configuração.
  const concluidas = Array.isArray(b?.etapasConcluidas)
    ? (b.etapasConcluidas as unknown[]).map(String).filter((x) => ETAPAS.includes(x as EtapaKey))
    : []
  const actor = await extrairUsuarioComPermissoes(req)
  const existente = await prisma.assistenteParametrizacaoProgresso.findFirst({ where: { tipoProcessoId, phaseKey } })
  const row = existente
    ? await prisma.assistenteParametrizacaoProgresso.update({
        where: { id: existente.id }, data: { etapaAtual, etapasConcluidas: concluidas, usuarioId: actor?.userId ?? null },
      })
    : await prisma.assistenteParametrizacaoProgresso.create({
        data: { tipoProcessoId, phaseKey, etapaAtual, etapasConcluidas: concluidas, usuarioId: actor?.userId ?? null },
      })
  return NextResponse.json({ ok: true, progresso: { etapaAtual: row.etapaAtual, etapasConcluidas: concluidas } })
}
