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
        modalityKey: true,
        modalityLabel: true,
        // País pela relação canônica: uma junção, sem N+1.
        pais: { select: { countryKey: true, countryLabel: true } },
      },
    })
    // O seletor continua recebendo `countryKey`/`countryLabel` — só que agora
    // eles são DERIVADOS da relação, e não colunas copiadas no tipo.
    return NextResponse.json({
      tipos: tipos.map(({ pais, ...t }) => ({
        ...t,
        countryKey: pais.countryKey,
        countryLabel: pais.countryLabel,
      })),
    })
  } catch (error) {
    console.error("Erro ao listar tipos de processo:", error)
    return NextResponse.json({ error: "Erro ao listar tipos de processo" }, { status: 500 })
  }
}