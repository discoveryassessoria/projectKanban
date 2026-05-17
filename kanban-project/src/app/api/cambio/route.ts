import { NextResponse } from "next/server"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; DiscoveryAssessoria/1.0)",
  "Accept": "application/json",
}

// BCB exige formato MM-DD-YYYY entre aspas simples na URL
function bcbDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${mm}-${dd}-${d.getFullYear()}`
}

async function safeFetch<T>(url: string, revalidate: number, label: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, next: { revalidate } })
    if (!res.ok) {
      console.error(`[api/cambio] ${label} retornou ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error(`[api/cambio] ${label} falhou:`, err)
    return null
  }
}

// Busca os últimos PTAX (precisa olhar até 7 dias pra trás por causa de finais de semana)
async function fetchUltimasCotacoes(moeda: "USD" | "EUR") {
  const hoje = new Date()
  const seteDiasAtras = new Date(hoje)
  seteDiasAtras.setDate(hoje.getDate() - 7)

  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='${moeda}'&@dataInicial='${bcbDate(seteDiasAtras)}'&@dataFinalCotacao='${bcbDate(hoje)}'&$orderby=dataHoraCotacao desc&$top=10&$format=json`

  const data = await safeFetch<{ value: any[] }>(url, 1800, `BCB ${moeda} atual`)
  if (!data?.value?.length) return null

  const atual = data.value[0]
  const anterior = data.value[1]
  return {
    valor: parseFloat(atual.cotacaoVenda),
    anterior: anterior ? parseFloat(anterior.cotacaoVenda) : null,
    dataHora: atual.dataHoraCotacao as string,
  }
}

// Busca 30 dias de histórico pro sparkline (pega 45 corridos pra garantir ~30 úteis)
async function fetchHistorico(moeda: "USD" | "EUR"): Promise<number[]> {
  const hoje = new Date()
  const inicio = new Date(hoje)
  inicio.setDate(hoje.getDate() - 45)

  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='${moeda}'&@dataInicial='${bcbDate(inicio)}'&@dataFinalCotacao='${bcbDate(hoje)}'&$orderby=dataHoraCotacao asc&$format=json`

  const data = await safeFetch<{ value: any[] }>(url, 21600, `BCB ${moeda} hist`)
  if (!data?.value?.length) return []
  return data.value.map((d) => parseFloat(d.cotacaoVenda)).slice(-30)
}

export async function GET() {
  const [usdAtual, eurAtual, usdHist, eurHist] = await Promise.all([
    fetchUltimasCotacoes("USD"),
    fetchUltimasCotacoes("EUR"),
    fetchHistorico("USD"),
    fetchHistorico("EUR"),
  ])

  if (!usdAtual && !eurAtual) {
    console.error("[api/cambio] BCB indisponível, devolvendo fallback")
    return NextResponse.json({
      eur: 5.5, usd: 5.4,
      eurVar: 0, usdVar: 0, eurPct: 0, usdPct: 0,
      eurHist: [], usdHist: [],
      atualizadoEm: null,
      fonte: "fallback",
    })
  }

  const usd = usdAtual?.valor ?? 5.4
  const eur = eurAtual?.valor ?? 5.5
  const usdVar = usdAtual?.anterior ? usdAtual.valor - usdAtual.anterior : 0
  const eurVar = eurAtual?.anterior ? eurAtual.valor - eurAtual.anterior : 0
  const usdPct = usdAtual?.anterior ? (usdVar / usdAtual.anterior) * 100 : 0
  const eurPct = eurAtual?.anterior ? (eurVar / eurAtual.anterior) * 100 : 0

  return NextResponse.json({
    eur, usd,
    eurVar, usdVar,
    eurPct, usdPct,
    eurHist, usdHist,
    atualizadoEm: usdAtual?.dataHora || eurAtual?.dataHora || null,
    fonte: "BCB",
  })
}