// GET /api/operacao/orgaos/busca?q=&uf= — autocomplete do cadastro OrgaoProtocolo
// (nome, cidade, UF, tipo), ordenado por proximidade do texto.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { buscarOrgaos } from "@/src/services/orgao-vinculo-documento"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro
  const sp = request.nextUrl.searchParams
  const orgaos = await buscarOrgaos(prisma, sp.get("q") ?? "", { uf: sp.get("uf") ?? undefined, limit: Number(sp.get("limit")) || undefined })
  return NextResponse.json({ orgaos })
}
