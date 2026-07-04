// src/app/api/tipos-processo/route.ts
//
// Lista os TIPOS de processo do motor (TipoProcessoNacionalidade) só pra
// alimentar o seletor na hora de criar um processo no kanban.
//
// ⚠ Diferente de /api/gerenciamento/tipos-processo (que é SÓ admin):
//   este é liberado pra quem tem permissão de CRIAR processo (processos.criar),
//   senão um assistente não conseguiria criar processo.
// Só GET, só leitura, retorna o mínimo que o seletor precisa.

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "processos.criar")
  if (erro) return erro

  try {
    const tipos = await prisma.tipoProcessoNacionalidade.findMany({
      where: { ativo: true, arquivado: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        countryKey: true,
        countryLabel: true,
        modalityKey: true,
        modalityLabel: true,
      },
    })
    return NextResponse.json({ tipos })
  } catch (error) {
    console.error("Erro ao listar tipos de processo:", error)
    return NextResponse.json({ error: "Erro ao listar tipos de processo" }, { status: 500 })
  }
}