// GET/PUT — TRANSCRIÇÃO do documento.
//
// A transcrição pertence ao SISTEMA DOCUMENTAL (é atributo do Documento, ao lado
// do arquivo), não à árvore. Esta rota é o ponto de entrada do texto lido do
// documento — venha de OCR, de digitalização com camada de texto ou de digitação
// do operador. O motor registral apenas LÊ o que está aqui.
//
// DEPENDÊNCIA EXTERNA DECLARADA: o serviço de OCR é externo ao Discovery. Ele
// entrega o texto por esta rota. Sem transcrição o pipeline continua funcionando
// com os campos literais e o dado estruturado da Análise Documental — com menos
// cobertura, e registrando a lacuna.
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { auditar } from "@/src/services/registral/auditoria"
import { notificarDocumentoAlterado } from "@/src/services/registral/gancho-documental"

const MAX_TEXTO = 500_000
const MAX_PAGINAS = 400

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const semPermissao = await verificarPermissao(request, "arvore.ver")
  if (semPermissao) return semPermissao

  const { id } = await params
  const documentoId = Number.parseInt(id, 10)
  if (!Number.isFinite(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const doc = await prisma.documento.findUnique({
    where: { id: documentoId },
    select: {
      id: true,
      transcricaoTexto: true,
      transcricaoPaginas: true,
      transcricaoFonte: true,
      transcricaoEm: true,
    },
  })
  if (!doc) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
  return NextResponse.json({ transcricao: doc })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Escrever transcrição é editar o DOCUMENTO — permissão do domínio documental.
  const semPermissao = await verificarPermissao(request, "arvore.editar_documento")
  if (semPermissao) return semPermissao

  const { id } = await params
  const documentoId = Number.parseInt(id, 10)
  if (!Number.isFinite(documentoId)) return NextResponse.json({ error: "ID inválido" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const fonte = typeof body?.fonte === "string" && body.fonte.trim() ? body.fonte.trim().slice(0, 40) : "manual"

  let paginas: Array<{ pagina: number; texto: string }> | null = null
  if (Array.isArray(body?.paginas)) {
    paginas = []
    for (const item of body.paginas.slice(0, MAX_PAGINAS)) {
      if (!item || typeof item !== "object") continue
      const numero = Number((item as Record<string, unknown>).pagina)
      const texto = String((item as Record<string, unknown>).texto ?? "")
      if (!texto.trim()) continue
      paginas.push({
        pagina: Number.isFinite(numero) && numero > 0 ? numero : paginas.length + 1,
        texto: texto.slice(0, MAX_TEXTO),
      })
    }
    if (!paginas.length) paginas = null
  }

  const textoDireto = typeof body?.texto === "string" ? body.texto.slice(0, MAX_TEXTO) : null
  const texto = textoDireto ?? (paginas ? paginas.map((p) => p.texto).join("\n\n") : null)

  if (!texto && !paginas) {
    return NextResponse.json(
      { error: "Envie `texto` (string) ou `paginas` ([{ pagina, texto }])." },
      { status: 400 },
    )
  }

  const existe = await prisma.documento.findUnique({ where: { id: documentoId }, select: { id: true } })
  if (!existe) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })

  const atualizado = await prisma.documento.update({
    where: { id: documentoId },
    data: {
      transcricaoTexto: texto,
      transcricaoPaginas: paginas ?? undefined,
      transcricaoFonte: fonte,
      transcricaoEm: new Date(),
    },
    select: { id: true, transcricaoFonte: true, transcricaoEm: true },
  })

  // Auditoria REDIGIDA: o conteúdo transcrito não vai para o log, só o tamanho.
  await auditar(prisma, {
    acao: "registral_transcricao_gravada",
    entidade: "Documento",
    entidadeId: documentoId,
    descricao: `Transcrição gravada (fonte: ${fonte}).`,
    detalhes: { fonte, caracteres: texto?.length ?? 0, paginas: paginas?.length ?? 0 },
  })

  // MRG — a transcrição é o insumo do pipeline: gravá-la dispara a revalidação.
  notificarDocumentoAlterado({ documentoId, motivo: "documento_transcrito" }).catch((e) =>
    console.error("[transcricao → gancho registral]", e),
  )

  return NextResponse.json({ transcricao: atualizado })
}
