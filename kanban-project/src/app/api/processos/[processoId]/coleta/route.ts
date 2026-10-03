// /api/processos/[processoId]/coleta — lado do ADMINISTRADOR (JWT + `clientes.criar`).
//   GET   pré-cadastro: link ativo e envios pendentes (só consulta; nada entra no cadastro de clientes).
//   POST  gera o link de coleta (idempotente; só com o processo em "Aguardando fechamento").
import { NextRequest, NextResponse } from "next/server"
import { extrairUsuarioComPermissoes, verificarPermissao } from "@/src/lib/verificar-permissao"
import { listarPreCadastro } from "@/src/services/coleta/coleta-conferencia"
import { gerarLinkDeColeta, processoAceitaColeta } from "@/src/services/coleta/coleta-link"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

async function lerId(params: Promise<{ processoId: string }>): Promise<number | null> {
  const n = Number((await params).processoId)
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(req, "clientes.criar")
  if (erro) return erro
  const processoId = await lerId(params)
  if (!processoId) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { faseAtualKey: true } })
  if (!processo) return NextResponse.json({ error: "Processo não encontrado" }, { status: 404 })
  const pre = await listarPreCadastro(processoId)
  return NextResponse.json({ ...pre, podeGerar: processoAceitaColeta(processo.faseAtualKey) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const erro = await verificarPermissao(req, "clientes.criar")
  if (erro) return erro
  const processoId = await lerId(params)
  if (!processoId) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  const usuario = await extrairUsuarioComPermissoes(req)
  const r = await gerarLinkDeColeta(processoId, usuario?.userId ?? null)
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code }, { status: r.code === "PROCESSO_NAO_ENCONTRADO" ? 404 : 409 })
  return NextResponse.json({ link: { id: r.link.id, codigo: r.link.codigo, criadoEm: r.link.criadoEm }, jaExistia: r.jaExistia }, { status: r.jaExistia ? 200 : 201 })
}
