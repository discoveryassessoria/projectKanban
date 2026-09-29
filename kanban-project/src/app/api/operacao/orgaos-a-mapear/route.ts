// GET /api/operacao/orgaos-a-mapear — pendência "órgão a mapear": textos livres
// (Documento.cartorio) sem orgaoId, agrupados por texto, com contagem de
// documentos/tarefas. Alimenta a Torre / aba Terceiros.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { orgaosAMapear } from "@/src/services/orgao-vinculo-documento"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "tarefas.ver")
  if (erro) return erro
  const grupos = await orgaosAMapear(prisma)
  return NextResponse.json({
    total: grupos.length,
    documentos: grupos.reduce((s, g) => s + g.documentos, 0),
    tarefas: grupos.reduce((s, g) => s + g.tarefas, 0),
    grupos,
  })
}
