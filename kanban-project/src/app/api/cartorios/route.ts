// GET /api/cartorios — busca na BASE LOCAL do Discovery (nunca consulta o portal
// a cada tecla digitada — ver seção 15/28 do comando). Server-side, paginada.
// Filtros: q (nome, normalizado), uf, municipio, ativo (default: só ativos),
// page, limit.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { normalizarNome } from "@/src/services/cartorios/cartorio-sync-service"
import type { Prisma } from "@prisma/client"

const LIMITE_PADRAO = 30
const LIMITE_MAXIMO = 100

export async function GET(req: NextRequest) {
  // Mesma permissão de quem já escolhe órgão/cartório em Dados Registrais.
  const erro = await verificarPermissao(req, "arvore.editar_documento")
  if (erro) return erro

  const sp = req.nextUrl.searchParams
  const q = sp.get("q")?.trim() ?? ""
  const uf = sp.get("uf")?.trim().toUpperCase() ?? ""
  const municipio = sp.get("municipio")?.trim() ?? ""
  const ativoParam = sp.get("ativo")
  const page = Math.max(1, parseInt(sp.get("page") ?? "1") || 1)
  const limit = Math.min(LIMITE_MAXIMO, Math.max(1, parseInt(sp.get("limit") ?? String(LIMITE_PADRAO)) || LIMITE_PADRAO))

  const where: Prisma.CartorioWhereInput = {}
  if (ativoParam == null || ativoParam === "true") where.ativo = true
  else if (ativoParam === "false") where.ativo = false
  if (uf) where.uf = uf
  if (municipio) where.municipio = { equals: municipio, mode: "insensitive" }
  if (q) {
    // busca livre: "2 registro campinas" — cada termo precisa aparecer (em
    // qualquer ordem) no nome normalizado OU no município.
    const termos = normalizarNome(q).split(" ").filter(Boolean)
    where.AND = termos.map((t) => ({
      OR: [
        { nomeNormalizado: { contains: t } },
        { municipio: { contains: t, mode: "insensitive" as const } },
      ],
    }))
  }

  const [total, cartorios] = await Promise.all([
    prisma.cartorio.count({ where }),
    prisma.cartorio.findMany({
      where,
      orderBy: [{ uf: "asc" }, { municipio: "asc" }, { nome: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, nome: true, uf: true, municipio: true, endereco: true,
        telefone: true, email: true, cns: true, ativo: true,
      },
    }),
  ])

  return NextResponse.json({
    cartorios,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}
