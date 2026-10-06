// GET /api/documentos/:id/arvore-valores — o que a ÁRVORE tem hoje para os campos que esta certidão vai sincronizar (data/cidade/estado/país do evento).
// A tela dos Dados Registrais compara com o que o usuário digita e AVISA antes de gravar um valor diferente.
import { type NextRequest, NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { valoresDaArvoreParaDocumento } from "@/src/services/genealogia/sincronizar-com-registro"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao
  const id = Number.parseInt((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido" }, { status: 400 })
  return NextResponse.json(await valoresDaArvoreParaDocumento(id))
}
