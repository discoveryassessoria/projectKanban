// GET — compara duas versões da árvore, ou uma versão com o estado ATUAL.
//   ?de=3&para=5        → compara versão 3 com versão 5
//   ?de=3&processoId=12 → compara versão 3 com o estado atual
import { type NextRequest, NextResponse } from "next/server"
import { compararComAtual, compararVersoes } from "@/src/services/registral/versionamento"
import { prisma } from "@/lib/prisma"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ arvoreId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar"])
  if (!auth.ok) return auth.resposta

  const { arvoreId: raw } = await params
  const arvoreId = idDe(raw)
  if (arvoreId == null) return erro("arvoreId inválido")

  const q = new URL(request.url).searchParams
  const de = Number.parseInt(q.get("de") ?? "", 10)
  const paraRaw = q.get("para")
  const processoIdRaw = q.get("processoId")
  if (!Number.isFinite(de) || de <= 0) return erro("Informe a versão de origem em ?de=")

  if (paraRaw) {
    const para = Number.parseInt(paraRaw, 10)
    if (!Number.isFinite(para) || para <= 0) return erro("Versão de destino inválida")
    const r = await compararVersoes(prisma, arvoreId, de, para)
    if (r.erro) return erro(r.erro, 404)
    return NextResponse.json({ de, para, ...r.comparacao })
  }

  const processoId = processoIdRaw ? Number.parseInt(processoIdRaw, 10) : null
  const r = await compararComAtual(
    prisma,
    arvoreId,
    Number.isFinite(processoId) && (processoId as number) > 0 ? (processoId as number) : null,
    de,
  )
  if (r.erro) return erro(r.erro, 404)
  return NextResponse.json({ de, para: "atual", ...r.comparacao })
}
