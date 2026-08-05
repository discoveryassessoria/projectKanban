// Repositório oficial de modelos documentais — listagem e criação.
import { NextResponse } from "next/server"
import { exigirPermissao, verificarPermissao } from "@/src/lib/verificar-permissao"
import {
  criarModelo,
  listarModelos,
  ErroRepositorioModelos,
} from "@/src/services/modelos/repositorio-modelos"
import { VARIAVEIS_MODELO } from "@/src/lib/documentos/modelos/variaveis"

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "modelos.ver")
  if (erro) return erro

  const modelos = await listarModelos()
  // O registry viaja junto: a tela nunca mantém a própria lista de variáveis.
  return NextResponse.json({ modelos, variaveis: VARIAVEIS_MODELO })
}

export async function POST(request: Request) {
  const { usuario, erro } = await exigirPermissao(request, "modelos.gerenciar")
  if (erro) return erro

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const codigo = String(corpo.codigo ?? "").trim()
  const nome = String(corpo.nome ?? "").trim()
  const categoria = String(corpo.categoria ?? "").trim()
  const documentTypeId = Number(corpo.documentTypeId)

  if (!codigo || !nome || !categoria || !Number.isInteger(documentTypeId)) {
    return NextResponse.json(
      { error: "código, nome, categoria e tipo documental são obrigatórios" },
      { status: 400 },
    )
  }

  try {
    const modelo = await criarModelo({
      codigo,
      nome,
      descricao: corpo.descricao == null ? null : String(corpo.descricao),
      categoria: categoria as never,
      documentTypeId,
      ativo: corpo.ativo == null ? true : Boolean(corpo.ativo),
      usuarioId: usuario.userId,
    })
    return NextResponse.json({ modelo }, { status: 201 })
  } catch (e) {
    if (e instanceof ErroRepositorioModelos) {
      return NextResponse.json({ error: e.message, codigo: e.codigo, detalhe: e.detalhe }, { status: 400 })
    }
    if (String(e).includes("Unique constraint")) {
      return NextResponse.json({ error: "Já existe modelo com este código." }, { status: 409 })
    }
    throw e
  }
}
