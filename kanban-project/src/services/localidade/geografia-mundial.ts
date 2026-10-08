// src/services/localidade/geografia-mundial.ts
// ============================================================================
// PROVÍNCIAS E CIDADES DO MUNDO (fora do Brasil) — UMA base, no servidor. Fonte: pacote `country-state-city` (dados do GeoNames/dr5hn, ~250 países, ~150 mil cidades),
// dentro do próprio deploy: SEM chave, SEM limite de uso, SEM custo e SEM chamada externa — se a internet cair, o formulário continua funcionando. O pacote só é lido
// aqui (rota de servidor); nunca vai no navegador. Cidade que a base não conhece NÃO é erro: a tela aceita texto livre.
// ============================================================================
export interface Divisao { codigo: string; nome: string }
export interface CidadeDaBase { nome: string; provincia: string | null }

type Csc = typeof import('country-state-city')
let carregado: Csc | null = null
async function base(): Promise<Csc> { return (carregado ??= await import('country-state-city')) }

const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-’']/g, ' ').replace(/\s+/g, ' ').trim()

export async function provinciasDoPais(codigoPais: string): Promise<Divisao[]> {
  try {
    const { State } = await base()
    return State.getStatesOfCountry(codigoPais.toUpperCase()).map((s) => ({ codigo: s.isoCode, nome: s.name })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  } catch { return [] }
}

/** Cidades da província (ou do país inteiro, se a província não for dada). `q` filtra por texto (sem acento). Base fora do ar ou cidade ausente = lista vazia, nunca erro. */
export async function cidadesDaProvincia(codigoPais: string, provinciaNome?: string | null, q?: string | null, limite = 300): Promise<CidadeDaBase[]> {
  try {
    const { City, State } = await base()
    const pais = codigoPais.toUpperCase()
    const estados = State.getStatesOfCountry(pais)
    const porCodigo = new Map(estados.map((s) => [s.isoCode, s.name]))
    let cidades = City.getCitiesOfCountry(pais) ?? []
    if (provinciaNome?.trim()) {
      const alvo = estados.find((s) => norm(s.name) === norm(provinciaNome))
      if (!alvo) return []
      cidades = cidades.filter((c) => c.stateCode === alvo.isoCode)
    }
    const t = q ? norm(q) : ''
    const lista = cidades.filter((c) => !t || norm(c.name).includes(t)).map((c) => ({ nome: c.name, provincia: porCodigo.get(c.stateCode) ?? null }))
    const vistos = new Set<string>()
    return lista.filter((c) => { const k = `${norm(c.nome)}|${c.provincia}`; if (vistos.has(k)) return false; vistos.add(k); return true }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, limite)
  } catch { return [] }
}
