// GET — versões genealógicas da árvore (snapshots lógicos, append-only).
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { listarVersoes } from "@/src/services/registral/versionamento"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar", "arvore.ver"])
  if (!auth.ok) return auth.resposta

  const { arvoreId: raw } = await params
  const arvoreId = idDe(raw)
  if (arvoreId == null) return erro("arvoreId inválido")

  const existe = await prisma.arvore.findUnique({ where: { id: arvoreId }, select: { id: true } })
  if (!existe) return erro("Árvore não encontrada", 404)

  const versoes = await listarVersoes(prisma, arvoreId)
  return NextResponse.json({ versoes, total: versoes.length })
}
