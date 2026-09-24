// GET /api/geografia/paises — base mundial (~250 países), seleção travada para
// "país de registro"/"país de nascimento". Nunca `CatalogoPais` (esse é o
// cadastro travado da hierarquia País×Tipo×Modalidade, servido em
// `/api/paises` — ver comentário do model `Pais` em schema.prisma). Sempre a
// base local — nunca uma chamada externa por tecla.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, "arvore.editar_documento")
  if (erro) return erro

  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? ""

  const paises = await prisma.pais.findMany({
    where: { ativo: true, ...(q ? { nomeNormalizado: { contains: q } } : {}) },
    orderBy: { nome: "asc" },
    select: { id: true, codigo: true, nome: true },
  })

  return NextResponse.json({ paises })
}
