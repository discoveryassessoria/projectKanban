// src/app/api/financeiro/cambio/route.ts

import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const moeda = request.nextUrl.searchParams.get("moeda")
    if (!moeda || !["EUR", "USD"].includes(moeda)) {
      return NextResponse.json({ error: "Moeda inválida" }, { status: 400 })
    }

    try {
      const res = await fetch(`https://economia.awesomeapi.com.br/last/${moeda}-BRL`, {
        next: { revalidate: 300 }
      })
      const data = await res.json()
      const valor = Number(data[`${moeda}BRL`]?.bid || 0)
      if (valor > 0) {
        return NextResponse.json({
          cambio: valor, fonte: "AwesomeAPI",
          atualizadoEm: new Date().toISOString()
        })
      }
    } catch (e) {
      console.warn("AwesomeAPI falhou:", e)
    }

    const fallback = moeda === "EUR" ? 5.8 : 5.4
    return NextResponse.json({
      cambio: fallback, fonte: "Fallback",
      atualizadoEm: new Date().toISOString()
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}