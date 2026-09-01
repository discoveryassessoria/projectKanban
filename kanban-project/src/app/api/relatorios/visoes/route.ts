// /api/relatorios/visoes — as visões salvas de quem está pedindo.
//
// A visão guarda a PERGUNTA (QuerySpec), nunca o resultado. Reabrir refaz a
// consulta: é isso que a mantém verdadeira quando o dado muda.
//
// GET    lista (do dono, opcionalmente por domínio)
// POST   cria/atualiza pelo nome
// PATCH  favorita / marca uso
// DELETE remove

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import type { QuerySpec } from "@/src/lib/relatorios/motor/tipos"

async function dono(request: Request): Promise<number | null> {
  const u = await extrairUsuarioComPermissoes(request as never)
  return u?.userId ?? null
}

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    const dominio = new URL(request.url).searchParams.get("dominio")

    const visoes = await prisma.relatorioVisao.findMany({
      where: { usuarioId, ...(dominio ? { dominio } : {}) },
      orderBy: [{ favorita: "desc" }, { usadaEm: "desc" }, { nome: "asc" }],
      select: { id: true, dominio: true, nome: true, spec: true, favorita: true, usadaEm: true, criadoEm: true },
    })
    // RECENTES saem da mesma tabela: `usadaEm` já responde, sem log paralelo.
    const recentes = visoes.filter((v) => v.usadaEm).slice(0, 5)
    return NextResponse.json({ visoes, favoritas: visoes.filter((v) => v.favorita), recentes })
  } catch (e) {
    console.error("GET relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao carregar visões." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

    const b = await request.json()
    const nome = String(b?.nome ?? "").trim()
    const spec = b?.spec as QuerySpec | undefined
    if (!nome) return NextResponse.json({ error: "Dê um nome à visão." }, { status: 400 })
    if (!spec || !dominioPorChave(spec.dominio)) {
      return NextResponse.json({ error: "Domínio não encontrado." }, { status: 400 })
    }
    // O RESULTADO NÃO ENTRA. Só a configuração da pergunta é persistida.
    const limpa: QuerySpec = {
      dominio: spec.dominio,
      nacionalidade: spec.nacionalidade ?? null,
      filtros: Array.isArray(spec.filtros) ? spec.filtros : [],
      agruparPor: spec.agruparPor ?? null,
      colunas: Array.isArray(spec.colunas) ? spec.colunas : undefined,
      ordenarPor: spec.ordenarPor ?? null,
      direcao: spec.direcao ?? undefined,
    }

    const visao = await prisma.relatorioVisao.upsert({
      where: { usuarioId_dominio_nome: { usuarioId, dominio: spec.dominio, nome } },
      update: { spec: limpa as object, usadaEm: new Date() },
      create: { usuarioId, dominio: spec.dominio, nome, spec: limpa as object, usadaEm: new Date() },
      select: { id: true, dominio: true, nome: true, spec: true, favorita: true },
    })
    return NextResponse.json({ visao })
  } catch (e) {
    console.error("POST relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao salvar a visão." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    const b = await request.json()
    const id = Number(b?.id)
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Visão inválida." }, { status: 400 })

    // O `where` inclui o dono: ninguém favorita a visão de outro operador.
    const r = await prisma.relatorioVisao.updateMany({
      where: { id, usuarioId },
      data: {
        ...(b?.favorita !== undefined ? { favorita: !!b.favorita } : {}),
        ...(b?.usar ? { usadaEm: new Date() } : {}),
      },
    })
    if (r.count === 0) return NextResponse.json({ error: "Visão não encontrada." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("PATCH relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao atualizar a visão." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  try {
    const usuarioId = await dono(request)
    if (!usuarioId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    const id = Number(new URL(request.url).searchParams.get("id"))
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Visão inválida." }, { status: 400 })
    const r = await prisma.relatorioVisao.deleteMany({ where: { id, usuarioId } })
    if (r.count === 0) return NextResponse.json({ error: "Visão não encontrada." }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("DELETE relatorios/visoes", e)
    return NextResponse.json({ error: "Erro ao excluir a visão." }, { status: 500 })
  }
}
