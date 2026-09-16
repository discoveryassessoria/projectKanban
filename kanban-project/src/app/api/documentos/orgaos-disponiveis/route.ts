// src/app/api/documentos/orgaos-disponiveis/route.ts
//
// LISTAGEM LEVE do cadastro de Órgãos e Organizações, pra vincular um documento
// ao seu órgão/cartório emissor (`Documento.orgaoId`) — não confundir com
// GET /api/gerenciamento/orgaos-protocolo, que é a tela de administração do
// cadastro inteiro (ficha completa, permissão de admin). Aqui é só "qual
// órgão", pela mesma permissão operacional que já edita o documento
// (`arvore.editar_documento`) — quem pode preencher "Dados Registrais" pode
// escolher o órgão emissor.
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "arvore.editar_documento")
  if (erro) return erro
  const paisId = request.nextUrl.searchParams.get("paisId")
  try {
    const orgaos = await prisma.orgaoProtocolo.findMany({
      where: paisId ? { paisId: Number(paisId) } : undefined,
      orderBy: [{ pais: { countryLabel: "asc" } }, { name: "asc" }],
      select: {
        id: true, name: true, nomeFantasia: true, type: true, city: true, state: true,
        pais: { select: { id: true, countryLabel: true } },
      },
    })
    return NextResponse.json({ orgaos })
  } catch (e) {
    console.error("GET orgaos-disponiveis", e)
    return NextResponse.json({ error: "Erro ao carregar órgãos." }, { status: 500 })
  }
}
