// GET /api/operacao/orgaos/busca?q=&uf=&cidade= — autocomplete do cadastro
// OrgaoProtocolo (nome, cidade, UF, tipo), ordenado por proximidade do texto.
// `pais` decide o modo (lib/localidade/regra-localidade.ts): só o Brasil tem lista de cartórios, e só do tipo «cartorio»; outro país devolve vazio.
// `cidade` (quando enviada) é filtro DURO — a LOCALIDADE já escolhida no
// documento, não mais um termo de texto opcional.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { buscarOrgaos } from "@/src/services/orgao-vinculo-documento"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro
  const sp = request.nextUrl.searchParams
  const orgaos = await buscarOrgaos(prisma, sp.get("q") ?? "", {
    uf: sp.get("uf") ?? undefined,
    pais: sp.get("pais") ?? undefined,
    cidade: sp.get("cidade") ?? undefined,
    limit: Number(sp.get("limit")) || undefined,
  })
  return NextResponse.json({ orgaos })
}
