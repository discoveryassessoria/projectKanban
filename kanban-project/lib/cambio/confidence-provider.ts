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

/** Modalidade comercial oficial usada por moeda (documentada, gravada no registro). */
export const MODALIDADE_OFICIAL = 'ecommerce_especie_venda'
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

/** Config do provider a partir do ambiente (sem segredo hardcoded). */
function configConfidence(): { url: string | null; apiKey: string | null } {
  return { url: process.env.CONFIDENCE_COTACAO_URL || null, apiKey: process.env.CONFIDENCE_API_KEY || null }
}

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
    const base: CotacaoProviderResult = {
      moedaOrigem: moeda, moedaDestino: 'BRL', valor: null, modalidade: MODALIDADE_OFICIAL,
      dataReferencia: null, consultadoEm: agoraISO, origem: ORIGEM_AUTOMATICA, urlFonte: null, payloadHash: null, status: 'INDISPONIVEL',
    }
    const { url, apiKey } = configConfidence()
    // Sem endpoint/credencial oficial configurada → PENDENTE (não inventa, não usa outra fonte).
    if (!url) return { ...base, status: 'CONFIGURACAO_PENDENTE', detalhe: 'CONFIDENCE_COTACAO_URL não configurada (API Cotação de parceiro / endpoint do widget)' }
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 12000)
      const res = await fetch(url, { signal: ctrl.signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined }).finally(() => clearTimeout(t))
      if (!res.ok) return { ...base, status: 'INDISPONIVEL', detalhe: `HTTP ${res.status}`, urlFonte: url }
      const payload = await res.json().catch(() => null)
      const { valor, dataRef, detalhe } = extrairValorVenda(payload, moeda)
      const hash = hashPayload({ moeda, payload })
      if (valor == null) return { ...base, status: 'INCONSISTENTE', detalhe: detalhe ?? 'sem valor', urlFonte: url, payloadHash: hash }
      const [min, max] = FAIXA[moeda]
      if (valor < min || valor > max) return { ...base, status: 'INCONSISTENTE', detalhe: `valor ${valor} fora da faixa [${min},${max}]`, urlFonte: url, payloadHash: hash }
      return { ...base, valor, dataReferencia: dataRef, urlFonte: url, payloadHash: hash, status: 'OK' }
    } catch (e) {
      return { ...base, status: 'INDISPONIVEL', detalhe: (e instanceof Error ? e.message : String(e)).slice(0, 140), urlFonte: url }
    }
  }
}

/** Provider ativo oficial (fixo em CONFIDENCE; extensível no futuro). */
export function providerOficial(): ExchangeProvider {
  return new ConfidenceExchangeProvider()
}
