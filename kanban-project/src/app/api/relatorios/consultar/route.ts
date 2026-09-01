// POST /api/relatorios/consultar
//
// A CONSULTA. Recebe uma QuerySpec e devolve total, colunas e linhas.
//
// A permissão é conferida NO SERVIDOR pelo domínio pedido: esconder um item do
// menu não é autorizar coisa nenhuma. Filtro que o domínio não declarou volta em
// `ignorados` — o cliente não escolhe o que o motor executa.
//
// SOMENTE LEITURA.

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import { executar } from "@/src/lib/relatorios/motor/executar"
import type { QuerySpec } from "@/src/lib/relatorios/motor/tipos"

export async function POST(request: Request) {
  try {
    const spec = (await request.json()) as QuerySpec
    const d = dominioPorChave(spec?.dominio)
    if (!d) return NextResponse.json({ error: "Domínio não encontrado." }, { status: 404 })

    const erro = await verificarPermissao(request, d.permissao)
    if (erro) return erro

    return NextResponse.json(await executar(d, spec))
  } catch (e) {
    console.error("POST relatorios/consultar", e)
    return NextResponse.json({ error: "Erro ao executar a consulta." }, { status: 500 })
  }
}
