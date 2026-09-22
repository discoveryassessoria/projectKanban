// ESTE ARQUIVO VAI EM: src/app/api/gerenciamento/politicas-prazo-sla/route.ts
//
// GET  - lista as políticas (busca + filtro por status)
// POST - cria política nova (nasce RASCUNHO — publicar é uma ação à parte)

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"

function slug(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const { searchParams } = new URL(request.url)
    const busca = searchParams.get("busca")?.trim()
    const status = searchParams.get("status")
    const politicas = await prisma.politicaPrazoSla.findMany({
      where: {
        ...(status ? { status: status as "RASCUNHO" | "PUBLICADA" | "INATIVA" } : {}),
        ...(busca ? { OR: [{ nome: { contains: busca, mode: "insensitive" } }, { chave: { contains: busca, mode: "insensitive" } }] } : {}),
      },
      orderBy: { atualizadoEm: "desc" },
      include: {
        versoes: { orderBy: { versao: "desc" }, take: 1 },
        _count: { select: { tarefas: true } },
      },
    })
    return NextResponse.json({ politicas })
  } catch (error) {
    console.error("Erro ao listar políticas de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro ao listar políticas" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const erro = await verificarPermissao(request, "usuarios.gerenciar")
  if (erro) return erro
  try {
    const b = await request.json().catch(() => ({}))
    const nome = String(b?.nome || "").trim()
    if (!nome) return NextResponse.json({ error: "Informe o nome da política.", code: "NOME_OBRIGATORIO" }, { status: 400 })
    const chave = String(b?.chave || "").trim() || slug(nome)
    if (!chave) return NextResponse.json({ error: "Não foi possível gerar a chave da política.", code: "CHAVE_INVALIDA" }, { status: 400 })

    const existe = await prisma.politicaPrazoSla.findUnique({ where: { chave } })
    if (existe) return NextResponse.json({ error: `Já existe uma política com a chave "${chave}".`, code: "CHAVE_DUPLICADA" }, { status: 409 })

    const usuario = await extrairUsuarioComPermissoes(request)
    const politica = await prisma.politicaPrazoSla.create({
      data: { chave, nome, descricao: b?.descricao ? String(b.descricao) : null, criadoPorId: usuario?.userId ?? null },
    })
    await prisma.eventoPrazoSla.create({
      data: { tipo: "POLITICA_CRIADA", politicaId: politica.id, usuarioId: usuario?.userId ?? null, valorNovo: { nome, chave }, chaveIdempotencia: `POLITICA_CRIADA::${politica.id}` },
    }).catch(() => null)
    return NextResponse.json({ politica }, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Já existe uma política com essa chave.", code: "CHAVE_DUPLICADA" }, { status: 409 })
    console.error("Erro ao criar política de prazo/SLA:", error)
    return NextResponse.json({ error: "Erro ao criar política" }, { status: 500 })
  }
}
