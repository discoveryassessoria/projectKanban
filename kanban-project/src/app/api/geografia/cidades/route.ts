// GET /api/cidades?paisCodigo=ES&q=... — base mundial de cidades (GeoNames,
// população ≥ 5000), seleção travada. Sempre a base local — nunca uma chamada
// externa por tecla digitada (mesma régua de /api/cartorios).
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

const LIMITE = 50

export async function GET(req: NextRequest) {
  const erro = await verificarPermissao(req, "arvore.editar_documento")
  if (erro) return erro

  const sp = req.nextUrl.searchParams
  const paisCodigo = sp.get("paisCodigo")?.trim().toUpperCase() ?? ""
  const q = sp.get("q")?.trim().toLowerCase() ?? ""
  if (!paisCodigo) return NextResponse.json({ cidades: [] })

  const cidades = await prisma.cidade.findMany({
    where: {
      ativo: true,
      pais: { codigo: paisCodigo },
      ...(q ? { nomeNormalizado: { contains: q } } : {}),
    },
    orderBy: { nome: "asc" },
    take: LIMITE,
    select: { id: true, nome: true, regiao: true },
  })

  return NextResponse.json({ cidades })
}
