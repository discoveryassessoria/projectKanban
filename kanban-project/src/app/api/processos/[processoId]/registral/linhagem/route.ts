// GET/POST — linhagem e elegibilidade apuradas do processo.
//
// O resultado é DERIVADO do estado atual (árvore + fatos + necessidades). Não é
// persistido como conclusão: conclusão persistida vira segunda fonte de verdade e
// passa a divergir da árvore no dia seguinte.
import { type NextRequest, NextResponse } from "next/server"
import { recalcularLinhagem, registrarRecalculo } from "@/src/services/registral/consultas"
import { erro, exigir, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const auth = await exigirAlguma(request, ["arvore.ver", "registral.ver_evidencias", "registral.revisar"])
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const r = await recalcularLinhagem(processoId)
  if (!r) return erro("Processo sem árvore vinculada", 404)
  return NextResponse.json(r)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ processoId: string }> }) {
  const auth = await exigir(request, "registral.revisar")
  if (!auth.ok) return auth.resposta

  const { processoId: raw } = await params
  const processoId = idDe(raw)
  if (processoId == null) return erro("processoId inválido")

  const r = await recalcularLinhagem(processoId)
  if (!r) return erro("Processo sem árvore vinculada", 404)

  await registrarRecalculo(
    processoId,
    auth.ctx.usuarioId,
    `${r.elegibilidade.resultado}; ${r.inconsistencias.length} inconsistência(s); ${r.elegibilidade.pendencias.length} pendência(s)`,
  )
  return NextResponse.json(r)
}
