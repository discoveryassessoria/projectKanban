// Versões de um modelo — envio de novo DOCX (nasce em RASCUNHO).
//
// O DOCX chega por multipart: o binário do template é DADO OFICIAL e nunca passa
// por presign de navegador com URL pública. Ele sobe pelo servidor e vai direto
// para o storage privado.
import { NextResponse } from "next/server"
import { exigirPermissao } from "@/src/lib/verificar-permissao"
import { criarVersao, ErroRepositorioModelos } from "@/src/services/modelos/repositorio-modelos"
import { MIME_DOCX } from "@/src/lib/documentos/modelos/storage-privado"

const TAMANHO_MAXIMO = 20 * 1024 * 1024

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { usuario, erro } = await exigirPermissao(request, "modelos.gerenciar")
  if (erro) return erro

  const { id } = await params
  const modeloId = Number(id)
  if (!Number.isInteger(modeloId)) {
    return NextResponse.json({ error: "Modelo inválido" }, { status: 400 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Envie o DOCX como multipart/form-data." }, { status: 400 })
  }

  const arquivo = form.get("arquivo")
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: "Campo 'arquivo' é obrigatório." }, { status: 400 })
  }
  if (arquivo.size <= 0 || arquivo.size > TAMANHO_MAXIMO) {
    return NextResponse.json(
      { error: `Tamanho inválido. Limite: ${TAMANHO_MAXIMO / 1024 / 1024}MB.` },
      { status: 400 },
    )
  }
  if (arquivo.type && arquivo.type !== MIME_DOCX) {
    return NextResponse.json({ error: "O modelo oficial é um arquivo .docx." }, { status: 400 })
  }

  const buffer = Buffer.from(await arquivo.arrayBuffer())
  const observacao = form.get("observacao")

  try {
    const versao = await criarVersao({
      modeloId,
      docx: buffer,
      nomeArquivo: arquivo.name || "modelo.docx",
      observacao: typeof observacao === "string" ? observacao : null,
      usuarioId: usuario.userId,
    })
    return NextResponse.json({ versao }, { status: 201 })
  } catch (e) {
    if (e instanceof ErroRepositorioModelos) {
      return NextResponse.json(
        { error: e.message, codigo: e.codigo, detalhe: e.detalhe },
        { status: 400 },
      )
    }
    throw e
  }
}
