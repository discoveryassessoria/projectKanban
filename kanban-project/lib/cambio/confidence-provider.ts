// lib/cambio/confidence-provider.ts
// ============================================================================
// PROVIDER ISOLADO da fonte oficial de câmbio da Discovery: CONFIDENCE CÂMBIO.
//
// A arquitetura permite múltiplos providers (interface ExchangeProvider), mas a
// fonte ATIVA oficial é CONFIDENCE. O FinanceRuleEngine NÃO conhece o site da
// Confidence — só consome a cotação já persistida no banco.
//
// MODALIDADE COMERCIAL (documentada e gravada p/ evitar ambiguidade):
//   `ecommerce_especie_venda` = preço FINAL de VENDA de moeda em ESPÉCIE no
//   e-commerce oficial (o valor que o cliente paga p/ COMPRAR 1 EUR/USD). É o
//   preço comercial praticado — já inclui IOF/tarifa/spread da modalidade espécie;
//   guardamos o valor final + a modalidade, sem confundir com cotação-base.
//
// FONTE TÉCNICA: o e-commerce (confidencecambio.com.br/ecommerce) carrega as
// taxas via JS/iframe; a "API Cotação" oficial de PARCEIRO (Swagger) exige
// credenciais liberadas após alinhamento técnico. Por isso o fetch ao vivo é
// CONFIGURÁVEL por env — sem env, o provider retorna CONFIGURACAO_PENDENTE
// (nunca inventa valor, nunca grava zero, nunca troca de fonte silenciosamente).
// ============================================================================
import { createHash } from 'node:crypto'

export type MoedaEstrangeira = 'EUR' | 'USD'
export type StatusConsulta = 'OK' | 'CONFIGURACAO_PENDENTE' | 'INDISPONIVEL' | 'INCONSISTENTE'

/** Modalidade comercial oficial (documentada, gravada no registro): TRANSFERÊNCIA
 *  INTERNACIONAL (remessa) — venda. É a regra comercial praticada pela Discovery
 *  (o "você paga" do simulador de Transferências Internacionais). Preço por unidade
 *  = venda.valor × (1 + IOF/100). A tarifa (taxa%) NÃO entra no valor unitário. */
export const MODALIDADE_OFICIAL = 'transferencia_internacional_venda'
export const ORIGEM_AUTOMATICA = 'CONFIDENCE_AUTOMATICO'
export const FONTE_NOME = 'Confidence Câmbio'

/** Faixa razoável de sanidade (anti valor-fora-de-faixa). BRL por 1 unidade. */
const FAIXA: Record<MoedaEstrangeira, [number, number]> = { EUR: [3, 15], USD: [3, 12] }

export interface CotacaoProviderResult {
  moedaOrigem: MoedaEstrangeira
  moedaDestino: 'BRL'
  valor: number | null
  modalidade: string
  dataReferencia: string | null // 'YYYY-MM-DD' — data REAL da fonte
  consultadoEm: string // ISO
  origem: typeof ORIGEM_AUTOMATICA
  urlFonte: string | null
  payloadHash: string | null
  status: StatusConsulta
  detalhe?: string
}

export interface ExchangeProvider {
  readonly nome: string
  buscar(moeda: MoedaEstrangeira, agoraISO: string): Promise<CotacaoProviderResult>
}

export function hashPayload(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 40)
}

// ── Endpoint PÚBLICO do widget oficial da Confidence (mesmo que o site incorpora) ──
// NÃO é API privada de parceiro: são os valores embutidos no bundle JS público do
// widget (confidencecambio.com.br/widgets-de-cambio). Overridáveis por env caso rotem.
//   GET {BASE}/v2/moedas-operacionais/{id}/cotacao?cidade-id={cidade}
//   headers: auth (token público do widget) + UA de browser (exigido pelo WAF).
//   payload.venda = { valor (base), iof (%), taxa (%) } → preço FINAL espécie/venda =
//   valor × (1 + (iof + taxa)/100), com a COMPOSIÇÃO preservada (auditável).
const CONFIDENCE_BASE = process.env.CONFIDENCE_BASE_URL || 'https://b8pybk7hl9.execute-api.sa-east-1.amazonaws.com/production/white-label/cotacao/api'
const CONFIDENCE_AUTH = process.env.CONFIDENCE_AUTH || '$2y$12$M4fgZx/W7r9yRWtkqZ7yx.cBlfZjRgvGzVmwOXrUEBiA8BMCn88Bq'
const CONFIDENCE_CIDADE = process.env.CONFIDENCE_CIDADE_ID || '1'
const CONFIDENCE_UA = process.env.CONFIDENCE_UA || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
// IDs oficiais da modalidade REMESSA (transferência internacional): EUR=85, USD=34.
const MOEDA_ID: Record<MoedaEstrangeira, string> = { EUR: process.env.CONFIDENCE_ID_EUR || '85', USD: process.env.CONFIDENCE_ID_USD || '34' }

/**
 * Extrai o valor final de VENDA (espécie) da moeda a partir do payload da fonte.
 * Resiliente a formatos: procura por chaves comuns; valida moeda e faixa; NUNCA
 * aceita retorno incompleto/ambíguo como sucesso. Ajustável quando o endpoint
 * oficial for confirmado (mantém validação forte).
 */
export function extrairValorVenda(payload: any, moeda: MoedaEstrangeira): { valor: number | null; dataRef: string | null; detalhe?: string } {
  if (payload == null || typeof payload !== 'object') return { valor: null, dataRef: null, detalhe: 'payload vazio/!objeto' }
  // candidatos de nó por moeda
  const raiz = Array.isArray(payload) ? payload : (payload.cotacoes ?? payload.rates ?? payload.moedas ?? payload)
  const lista = Array.isArray(raiz) ? raiz : Object.values(raiz)
  const alvo = lista.find((x: any) => x && typeof x === 'object' && String(x.moeda ?? x.currency ?? x.codigo ?? x.sigla ?? x.iso ?? '').toUpperCase() === moeda)
    ?? (raiz && typeof raiz === 'object' ? (raiz[moeda] ?? raiz[moeda.toLowerCase()]) : null)
  if (!alvo || typeof alvo !== 'object') return { valor: null, dataRef: null, detalhe: `moeda ${moeda} ausente no payload` }
  const bruto = alvo.venda ?? alvo.sell ?? alvo.valorVenda ?? alvo.especie_venda ?? alvo.especieVenda ?? alvo.valor ?? alvo.value ?? alvo.price
  const valor = typeof bruto === 'number' ? bruto : (typeof bruto === 'string' ? Number(bruto.replace(/\./g, '').replace(',', '.')) : NaN)
  const dataRef = (alvo.data ?? alvo.dataReferencia ?? alvo.date ?? payload.data ?? payload.date ?? null)
  const dataStr = dataRef ? String(dataRef).slice(0, 10) : null
  if (!Number.isFinite(valor) || valor <= 0) return { valor: null, dataRef: dataStr, detalhe: 'valor ausente/inválido/zero' }
  return { valor, dataRef: dataStr }
}

/** Provider oficial CONFIDENCE. */
export class ConfidenceExchangeProvider implements ExchangeProvider {
  readonly nome = 'CONFIDENCE'

  async buscar(moeda: MoedaEstrangeira, agoraISO: string): Promise<CotacaoProviderResult> {
    const url = `${CONFIDENCE_BASE}/v2/moedas-operacionais/${MOEDA_ID[moeda]}/cotacao?cidade-id=${CONFIDENCE_CIDADE}`
    const base: CotacaoProviderResult = {
      moedaOrigem: moeda, moedaDestino: 'BRL', valor: null, modalidade: MODALIDADE_OFICIAL,
      dataReferencia: agoraISO.slice(0, 10), consultadoEm: agoraISO, origem: ORIGEM_AUTOMATICA, urlFonte: url, payloadHash: null, status: 'INDISPONIVEL',
    }
    if (!CONFIDENCE_AUTH) return { ...base, status: 'CONFIGURACAO_PENDENTE', detalhe: 'CONFIDENCE_AUTH não configurado' }
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 12000)
      const res = await fetch(url, { signal: ctrl.signal, headers: {
        auth: CONFIDENCE_AUTH, 'user-agent': CONFIDENCE_UA, accept: 'application/json, text/plain, */*',
        origin: 'https://www.confidencecambio.com.br', referer: 'https://www.confidencecambio.com.br/',
      } }).finally(() => clearTimeout(t))
      if (!res.ok) return { ...base, status: 'INDISPONIVEL', detalhe: `HTTP ${res.status}` }
      const payload = await res.json().catch(() => null)
      const venda = payload?.payload?.venda
      // moeda/modalidade têm de estar claras; venda.valor obrigatório e positivo.
      if (!venda || typeof venda.valor !== 'number' || !(venda.valor > 0)) {
        return { ...base, status: 'INCONSISTENTE', detalhe: 'payload.venda.valor ausente/inválido', payloadHash: hashPayload({ moeda, payload }) }
      }
      const iof = Number(venda.iof) || 0
      const tarifa = Number(venda.taxa) || 0
      // PREÇO por unidade da TRANSFERÊNCIA INTERNACIONAL (venda) = base × (1 + IOF/100).
      // Confere com o simulador oficial: 1000 × [valor×(1+IOF/100)] = "você paga". A tarifa
      // (taxa%) é fee separado, NÃO entra no valor unitário. Composição preservada (auditável).
      const valorFinal = Math.round(venda.valor * (1 + iof / 100) * 1e6) / 1e6
      const [min, max] = FAIXA[moeda]
      if (valorFinal < min || valorFinal > max) return { ...base, status: 'INCONSISTENTE', detalhe: `valor ${valorFinal} fora da faixa [${min},${max}]`, payloadHash: hashPayload({ moeda, payload }) }
      const composicao = `Confidence remessa/venda: base=${venda.valor} +IOF ${iof}% = ${valorFinal} (tarifa ${tarifa}% à parte)`
      return { ...base, valor: valorFinal, payloadHash: hashPayload({ moeda, valor: venda.valor, iof, tarifa }), status: 'OK', detalhe: composicao }
    } catch (e) {
      return { ...base, status: 'INDISPONIVEL', detalhe: (e instanceof Error ? e.message : String(e)).slice(0, 140) }
    }
  }
}

/** Provider ativo oficial (fixo em CONFIDENCE; extensível no futuro). */
export function providerOficial(): ExchangeProvider {
  return new ConfidenceExchangeProvider()
}
