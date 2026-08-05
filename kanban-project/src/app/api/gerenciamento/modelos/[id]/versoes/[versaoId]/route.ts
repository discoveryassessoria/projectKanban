// Atos sobre UMA versão do modelo: validar, publicar, revogar, baixar e prévia.
//
// Publicar e revogar são atos administrativos com permissão própria. Não existe
// caminho que EDITE uma versão publicada — a única "edição" possível é enviar
// uma versão nova.
import { NextResponse } from "next/server"
import { exigirPermissao, verificarPermissao } from "@/src/lib/verificar-permissao"
import { prisma } from "@/src/lib/prisma"
import {
  publicarVersao,
  revogarVersao,
  validarVersao,
  ErroRepositorioModelos,
} from "@/src/services/modelos/repositorio-modelos"
import {
  urlAssinadaDeLeitura,
  MIME_DOCX,
} from "@/src/lib/documentos/modelos/storage-privado"

async function versaoDoModelo(modeloId: number, versaoId: number) {
  // A versão precisa pertencer ao modelo da URL — id solto não abre versão alheia.
  return prisma.modeloDocumentalVersao.findFirst({
    where: { id: versaoId, modeloId },
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versaoId: string }> },
) {
  const erro = await verificarPermissao(request, "modelos.ver")
  if (erro) return erro

  const { id, versaoId } = await params
  const versao = await versaoDoModelo(Number(id), Number(versaoId))
  if (!versao) return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 })

  const acao = new URL(request.url).searchParams.get("acao")

  if (acao === "arquivo") {
    const url = await urlAssinadaDeLeitura({
      chave: versao.arquivoChave,
      nomeParaDownload: versao.arquivoNome,
      mime: MIME_DOCX,
      download: true,
    })
    return NextResponse.json({ url, nome: versao.arquivoNome, validadeSegundos: 300 })
  }

  return NextResponse.json({ versao })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; versaoId: string }> },
) {
  const { id, versaoId } = await params
  const modeloId = Number(id)
  const vId = Number(versaoId)

  let corpo: Record<string, unknown> = {}
  try {
    corpo = await request.json()
  } catch {
    corpo = {}
  }
  const acao = String(corpo.acao ?? "")

  const permissao =
    acao === "publicar" ? "modelos.publicar" : acao === "revogar" ? "modelos.revogar" : "modelos.ver"
  const { usuario, erro } = await exigirPermissao(request, permissao as never)
  if (erro) return erro

  const versao = await versaoDoModelo(modeloId, vId)
  if (!versao) return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 })

  const declarados = Array.isArray(corpo.dadosFixosDeclarados)
    ? (corpo.dadosFixosDeclarados as unknown[]).map(String)
    : undefined

  try {
    if (acao === "validar") {
      const { validacao } = await validarVersao({ versaoId: vId, dadosFixosDeclarados: declarados })
      return NextResponse.json({ validacao })
    }
    if (acao === "publicar") {
      const publicada = await publicarVersao({
        versaoId: vId,
        dadosFixosDeclarados: declarados,
        usuarioId: usuario.userId,
      })
      return NextResponse.json({ versao: publicada })
    }
    if (acao === "revogar") {
      const revogada = await revogarVersao({
        versaoId: vId,
        motivo: corpo.motivo == null ? null : String(corpo.motivo),
        usuarioId: usuario.userId,
      })
      return NextResponse.json({ versao: revogada })
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 })
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
