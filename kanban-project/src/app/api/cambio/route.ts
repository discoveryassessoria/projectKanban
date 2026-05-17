import { NextResponse } from 'next/server'

const FALLBACK = {
  eur: 5.5, usd: 5.4,
  eurVar: 0, usdVar: 0,
  eurPct: 0, usdPct: 0,
  eurHist: [] as number[],
  usdHist: [] as number[],
}

interface AwesomeLast {
  bid: string
  varBid: string
  pctChange: string
  create_date: string
}
interface AwesomeDaily {
  bid: string
  timestamp: string
}

export async function GET() {
  try {
    const [resLast, resEurHist, resUsdHist] = await Promise.all([
      fetch('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL', {
        next: { revalidate: 900 }, // 15 min
      }),
      fetch('https://economia.awesomeapi.com.br/json/daily/EUR-BRL/30', {
        next: { revalidate: 3600 }, // 1 hora (histórico muda menos)
      }),
      fetch('https://economia.awesomeapi.com.br/json/daily/USD-BRL/30', {
        next: { revalidate: 3600 },
      }),
    ])

    if (!resLast.ok) throw new Error(`HTTP ${resLast.status}`)
    const last: { USDBRL: AwesomeLast; EURBRL: AwesomeLast } = await resLast.json()

    // Histórico: AwesomeAPI retorna do mais recente pro mais antigo, invertemos
    let eurHist: number[] = []
    let usdHist: number[] = []
    if (resEurHist.ok) {
      const data: AwesomeDaily[] = await resEurHist.json()
      eurHist = data.map((d) => parseFloat(d.bid)).reverse()
    }
    if (resUsdHist.ok) {
      const data: AwesomeDaily[] = await resUsdHist.json()
      usdHist = data.map((d) => parseFloat(d.bid)).reverse()
    }

    return NextResponse.json({
      eur: parseFloat(last.EURBRL.bid),
      usd: parseFloat(last.USDBRL.bid),
      eurVar: parseFloat(last.EURBRL.varBid),
      usdVar: parseFloat(last.USDBRL.varBid),
      eurPct: parseFloat(last.EURBRL.pctChange),
      usdPct: parseFloat(last.USDBRL.pctChange),
      eurHist,
      usdHist,
      atualizadoEm: last.USDBRL.create_date,
      fonte: 'AwesomeAPI',
    })
  } catch (err) {
    console.error('[cambio] erro, usando fallback:', err)
    return NextResponse.json({
      ...FALLBACK,
      atualizadoEm: null,
      fonte: 'fallback',
    })
  }
}