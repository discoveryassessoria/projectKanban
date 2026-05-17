import { NextResponse } from "next/server"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; DiscoveryAssessoria/1.0)",
  "Accept": "application/json",
}

async function safeFetch<T>(url: string, revalidate: number, label: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, next: { revalidate } })
    if (!res.ok) {
      console.error(`[api/cambio] ${label} retornou ${res.status} ${res.statusText}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error(`[api/cambio] ${label} falhou:`, err)
    return null
  }
}

export async function GET() {
  const [last, usdData, eurData] = await Promise.all([
    safeFetch<any>("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL", 900, "last"),
    safeFetch<any[]>("https://economia.awesomeapi.com.br/json/daily/USD-BRL/30", 3600, "usdHist"),
    safeFetch<any[]>("https://economia.awesomeapi.com.br/json/daily/EUR-BRL/30", 3600, "eurHist"),
  ])

  // Se nenhum dos três funcionou, devolve fallback
  if (!last && !usdData && !eurData) {
    console.error("[api/cambio] Todos os fetches falharam, devolvendo fallback")
    return NextResponse.json({
      eur: 5.5, usd: 5.4,
      eurVar: 0, usdVar: 0, eurPct: 0, usdPct: 0,
      eurHist: [], usdHist: [],
      atualizadoEm: null,
      fonte: "fallback",
    })
  }

  const usd = last?.USDBRL ? parseFloat(last.USDBRL.bid) : 5.4
  const eur = last?.EURBRL ? parseFloat(last.EURBRL.bid) : 5.5
  const usdVar = last?.USDBRL ? parseFloat(last.USDBRL.varBid) : 0
  const eurVar = last?.EURBRL ? parseFloat(last.EURBRL.varBid) : 0
  const usdPct = last?.USDBRL ? parseFloat(last.USDBRL.pctChange) : 0
  const eurPct = last?.EURBRL ? parseFloat(last.EURBRL.pctChange) : 0

  const usdHist = Array.isArray(usdData) ? usdData.map((d) => parseFloat(d.bid)).reverse() : []
  const eurHist = Array.isArray(eurData) ? eurData.map((d) => parseFloat(d.bid)).reverse() : []

  const atualizadoEm = last?.USDBRL?.create_date || new Date().toISOString()

  return NextResponse.json({
    eur, usd,
    eurVar, usdVar,
    eurPct, usdPct,
    eurHist, usdHist,
    atualizadoEm,
    fonte: "AwesomeAPI",
  })
}