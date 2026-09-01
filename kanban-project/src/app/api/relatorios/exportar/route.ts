// POST /api/relatorios/exportar
//
// O MESMO resultado da tela, em CSV. Reusa `executar` de propósito: export com
// consulta própria acaba trazendo linha que a tela não mostrou — e ninguém
// descobre até alguém conferir à mão.
//
// SOMENTE LEITURA.

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import { exportarCsv } from "@/src/lib/relatorios/motor/executar"
import type { QuerySpec } from "@/src/lib/relatorios/motor/tipos"

export async function POST(request: Request) {
  try {
    const spec = (await request.json()) as QuerySpec
    const d = dominioPorChave(spec?.dominio)
    if (!d) return NextResponse.json({ error: "Domínio não encontrado." }, { status: 404 })

    const erro = await verificarPermissao(request, d.permissao)
    if (erro) return erro

    const csv = await exportarCsv(d, spec)
    const nome = `${d.key}-${new Date().toISOString().slice(0, 10)}.csv`
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nome}"`,
      },
    })
  } catch (e) {
    console.error("POST relatorios/exportar", e)
    return NextResponse.json({ error: "Erro ao exportar." }, { status: 500 })
  }
}
