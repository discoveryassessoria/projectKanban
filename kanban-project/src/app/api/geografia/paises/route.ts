// GET /api/geografia/paises — base mundial (~250 países), seleção travada para
// "país de registro"/"país de nascimento". Nunca `CatalogoPais` (esse é o
// cadastro travado da hierarquia País×Tipo×Modalidade, servido em
// `/api/paises` — ver comentário do model `Pais` em schema.prisma). Sempre a
// base local — nunca uma chamada externa por tecla.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { temPermissao } from "@/src/lib/permissoes"

export async function GET(req: NextRequest) {
  // Lê quem pode EDITAR dados: a Árvore (documento/país de nascimento) e o cadastro
  // de clientes (seletor de DDI do telefone). Basta uma das duas.
  const usuario = await extrairUsuarioComPermissoes(req)
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!temPermissao(usuario.permissoes, "arvore.editar_documento") && !temPermissao(usuario.permissoes, "clientes.editar")) {
    return NextResponse.json({ error: "Sem permissão para esta ação" }, { status: 403 })
  }

  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? ""

  const paises = await prisma.pais.findMany({
    where: { ativo: true, ...(q ? { nomeNormalizado: { contains: q } } : {}) },
    orderBy: { nome: "asc" },
    select: { id: true, codigo: true, nome: true },
  })

  return NextResponse.json({ paises })
}
