// src/app/api/tipos-documento/route.ts
// Cadastro MESTRE oficial de tipos de documento (ativos). Consumido pelo seletor "Documento a
// emitir" da Operação Antecipada — dinâmico (novo tipo cadastrado aparece automaticamente).
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, "processos.ver")
  if (erro) return erro
  try {
    const tipos = await prisma.tipoDocumentoCadastro.findMany({
      where: { ativo: true },
      select: { id: true, publicCode: true, name: true, code: true, category: true, countryCode: true, itemCatalogoId: true },
      orderBy: { name: "asc" },
    })
    return NextResponse.json({ tipos })
  } catch (e) {
    console.error("[GET tipos-documento]", e)
    return NextResponse.json({ error: "Erro ao listar tipos de documento" }, { status: 500 })
  }
}
