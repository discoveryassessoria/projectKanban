// src/lib/integrations/registro-civil-cartorios-provider.ts
//
// PROVIDER ISOLADO da fonte externa — Portal da Transparência do Registro Civil
// (transparencia.registrocivil.org.br). Único arquivo que conhece a URL/formato
// real da fonte; se ela mudar endpoint ou estrutura, só este arquivo muda.
//
// INVESTIGAÇÃO REAL (16/09/2026): a própria página pública /cartorios é uma SPA
// que chama, sem autenticação nenhuma, `GET /api/notary` (base
// `https://transparencia.registrocivil.org.br/api/`) — devolve os 7000+
// cartórios de uma vez só, sem paginação (`notaries.length === total`).
// Endpoint descoberto lendo o bundle JS público da própria página (module que
// define `axios.create({baseURL: ".../api/"})` e `n.a.get("/notary", {params})`).
// Nenhuma autenticação, cookie, CSRF ou CAPTCHA envolvidos — é a MESMA chamada
// que o navegador de qualquer visitante faz.
//
// Campos reais confirmados na resposta (nenhum inventado):
//   ag_cartorio_id, cartorio, uf, cidade, endereco, telefone, num_cnj,
//   cartorio_sk, version, date_from, date_to, cartorio_id, flag_ativo,
//   flag_monitorado, oficial, regiao, entidade, email
//
// `cartorio_id` é o identificador estável (sem duplicata nas 7120 linhas
// verificadas) — é ele que vira `Cartorio.sourceId`, nunca o nome.

const BASE_URL = "https://transparencia.registrocivil.org.br/api"
const TIMEOUT_MS = 30_000

export interface CartorioBruto {
  ag_cartorio_id: number
  cartorio: string
  uf: string
  cidade: string
  endereco: string | null
  telefone: string | null
  num_cnj: string | null
  cartorio_id: number
  flag_ativo: "S" | "N" | string
  oficial: string | null
  regiao: string | null
  entidade: string | null
  email: string | null
}

export interface ResultadoBuscaFonte {
  ok: boolean
  total: number | null
  notaries: CartorioBruto[]
  /** Presente só quando `ok: false` — o chamador decide o que fazer, nunca aborta sozinho aqui. */
  erro?: string
}

/**
 * Busca TODOS os cartórios da fonte numa chamada só (a fonte não pagina este
 * endpoint — confirmado: `notaries.length === total` em teste real).
 * Nunca lança: falha de rede/timeout/formato inesperado vira `{ok: false}`,
 * porque quem decide "abortar reconciliação" é o CartorioSyncService, não aqui.
 */
export async function buscarTodosOsCartoriosDaFonte(): Promise<ResultadoBuscaFonte> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(`${BASE_URL}/notary`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      return { ok: false, total: null, notaries: [], erro: `HTTP ${resp.status}` }
    }
    const json = (await resp.json()) as { status?: number; notaries?: unknown; total?: number }
    if (!Array.isArray(json.notaries)) {
      return { ok: false, total: null, notaries: [], erro: "resposta sem array `notaries`" }
    }
    const notaries = json.notaries as CartorioBruto[]
    return { ok: true, total: typeof json.total === "number" ? json.total : notaries.length, notaries }
  } catch (e) {
    const erro = e instanceof Error ? (e.name === "AbortError" ? `timeout após ${TIMEOUT_MS}ms` : e.message) : String(e)
    return { ok: false, total: null, notaries: [], erro }
  } finally {
    clearTimeout(timer)
  }
}
