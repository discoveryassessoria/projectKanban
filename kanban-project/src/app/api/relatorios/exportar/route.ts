// POST /api/relatorios/exportar
//
// O MESMO resultado da tela, em CSV, Excel ou PDF. Os três saem da MESMA coleta,
// que reusa `executar`: export com consulta própria acaba trazendo linha que a
// tela não mostrou — e ninguém descobre até alguém conferir à mão.
//
// SOMENTE LEITURA.

import { NextResponse } from "next/server"
import { verificarPermissao, extrairUsuarioComPermissoes } from "@/src/lib/verificar-permissao"
import { dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import { exportar, TIPO_MIME, type FormatoExportacao } from "@/src/lib/relatorios/motor/exportar"
import type { QuerySpec } from "@/src/lib/relatorios/motor/tipos"

const FORMATOS: FormatoExportacao[] = ["csv", "xlsx", "pdf"]

export async function POST(request: Request) {
  try {
    const corpo = (await request.json()) as QuerySpec & { formato?: string }
    const d = dominioPorChave(corpo?.dominio)
    if (!d) return NextResponse.json({ error: "Domínio não encontrado." }, { status: 404 })

    // PORTÃO DO MÓDULO. Esconder o item do menu não autoriza nada: sem

    // `relatorios.ver` a rota recusa, venha o pedido de onde vier.

    const semModulo = await verificarPermissao(request, "relatorios.ver")

    if (semModulo) return semModulo


    const erro = await verificarPermissao(request, d.permissao)
    if (erro) return erro

    // Formato fora da lista é RECUSADO, não normalizado para CSV em silêncio:
    // quem pediu PDF e recebeu CSV sem aviso descobre tarde, e desconfia do dado.
    const pedido = corpo.formato ?? "csv"
    if (!FORMATOS.includes(pedido as FormatoExportacao)) {
      return NextResponse.json(
        { error: `Formato "${pedido}" não existe. Use: ${FORMATOS.join(", ")}.` },
        { status: 400 },
      )
    }
    const formato = pedido as FormatoExportacao

    // Mesmo recorte de coluna da tela. Exportar não pode ser a porta larga.
    const usuario = await extrairUsuarioComPermissoes(request)
    const pode = (chave: Parameters<typeof verificarPermissao>[1]) =>
      usuario?.tipo === "admin" || usuario?.permissoes?.[chave] === true

    const { corpo: arquivo, nome, dados } = await exportar(d, corpo, formato, undefined, pode)

    return new NextResponse(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": TIPO_MIME[formato],
        "Content-Disposition": `attachment; filename="${nome}"`,
        // O truncamento não pode ficar só dentro do arquivo: a tela precisa
        // dizer, na hora, que a extração parou antes do fim.
        "X-Relatorio-Total": String(dados.total),
        "X-Relatorio-Extraidas": String(dados.extraidas),
        "X-Relatorio-Truncado": dados.truncado ? "1" : "0",
      },
    })
  } catch (e) {
    console.error("POST relatorios/exportar", e)
    return NextResponse.json({ error: "Erro ao exportar." }, { status: 500 })
  }
}
