// GET — dossiê registral de uma pessoa: fatos por campo (com estado próprio),
// formas de nome e menções documentais.
import { type NextRequest, NextResponse } from "next/server"
import { dossieDaPessoa } from "@/src/services/registral/consultas"
import { erro, exigirAlguma, idDe } from "@/src/services/registral/autorizacao"

export async function GET(request: NextRequest, { params }: { params: Promise<{ pessoaId: string }> }) {
  const auth = await exigirAlguma(request, ["registral.ver_evidencias", "registral.revisar"])
  if (!auth.ok) return auth.resposta

  const { pessoaId: raw } = await params
  const pessoaId = idDe(raw)
  if (pessoaId == null) return erro("pessoaId inválido")

  const dossie = await dossieDaPessoa(pessoaId)
  return NextResponse.json({ dossie })
}
