// Um modelo do repositório oficial — detalhe (com versões) e edição de metadados.
import { NextResponse } from "next/server"
import { exigirPermissao, verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  atualizarModelo,
  obterModelo,
  ErroRepositorioModelos,
} from "@/src/services/modelos/repositorio-modelos"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const erro = await verificarPermissao(request, "modelos.ver")
  if (erro) return erro

  const { id } = await params
  const modelo = await obterModelo(Number(id))
  if (!modelo) return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 })
  return NextResponse.json({ modelo })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirPermissao(request, "modelos.gerenciar")
  if (erro) return erro

  const { id } = await params
  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  try {
    const modelo = await atualizarModelo(Number(id), {
      codigo: corpo.codigo == null ? undefined : String(corpo.codigo),
      nome: corpo.nome == null ? undefined : String(corpo.nome),
      descricao: corpo.descricao === undefined ? undefined : (corpo.descricao as string | null),
      categoria: corpo.categoria == null ? undefined : (String(corpo.categoria) as never),
      documentTypeId: corpo.documentTypeId == null ? undefined : Number(corpo.documentTypeId),
      ativo: corpo.ativo == null ? undefined : Boolean(corpo.ativo),
    })
    return NextResponse.json({ modelo })
  } catch (e) {
    if (e instanceof ErroRepositorioModelos) {
      return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 400 })
    }
    if (String(e).includes("Unique constraint")) {
      return NextResponse.json({ error: "Já existe modelo com este código." }, { status: 409 })
    }
    throw e
  }
}
