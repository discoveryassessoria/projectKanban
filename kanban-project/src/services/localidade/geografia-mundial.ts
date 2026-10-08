// src/services/localidade/geografia-mundial.ts
// ============================================================================
// PROVÍNCIAS E CIDADES DO MUNDO (fora do Brasil) — UMA base, no servidor. Fonte: pacote `country-state-city` (dados do GeoNames/dr5hn, ~250 países, ~150 mil cidades),
// dentro do próprio deploy: SEM chave, SEM limite de uso, SEM custo e SEM chamada externa — se a internet cair, o formulário continua funcionando. O pacote só é lido
// aqui (rota de servidor); nunca vai no navegador. Cidade que a base não conhece NÃO é erro: a tela aceita texto livre.
// ============================================================================
import { provinciaItEmPortugues, provinciaEsEmPortugues, provinciaItOficial, provinciaEsOficial } from '@/lib/localidade/provincias-oficiais'

export interface Divisao { codigo: string; nome: string }
export interface CidadeDaBase { nome: string; provincia: string | null }

type Csc = typeof import('country-state-city')
let carregado: Csc | null = null
async function base(): Promise<Csc> { return (carregado ??= await import('country-state-city')) }

const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-’']/g, ' ').replace(/\s+/g, ' ').trim()

// ── ITÁLIA e ESPANHA: PROVÍNCIA DE VERDADE (fontes oficiais ISTAT/INE, dentro do deploy) ──────────────────────────────────────────────────────────
type CidadeIt = { name: string; province: string; region: string }
let italia: { provincias: string[]; comuni: CidadeIt[]; nomeProvincia: (codigo: string) => string } | null = null
async function baseItalia() {
  if (italia) return italia
  const cidade = await import('comuni-province-regioni/lib/city')
  const prov = await import('comuni-province-regioni/lib/province')
  const attrs = (cidade as unknown as { CITIES_ATTRIBUTES: Record<string, { name: string; province: string; region: string }> }).CITIES_ATTRIBUTES
  const toStr = (prov as unknown as { provinceToString: (p: string) => string }).provinceToString
  const comuni = Object.values(attrs).map((c) => ({ name: c.name, province: toStr(c.province), region: c.region }))
  italia = { provincias: [...new Set(comuni.map((c) => c.province))].sort((a, b) => a.localeCompare(b, 'it')), comuni, nomeProvincia: toStr }
  return italia
}
type CidadeEs = { name: string; province: string }
let espanha: { provincias: string[]; municipios: CidadeEs[] } | null = null
async function baseEspanha() {
  if (espanha) return espanha
  const m = await import('spanish-cities-info')
  const municipios = m.getAllCities().map((c: { name: string; province: string }) => ({ name: c.name, province: c.province }))
  espanha = { provincias: [...m.getProvinces()].sort((a, b) => a.localeCompare(b, 'es')), municipios }
  return espanha
}

function filtrar<T extends { name: string; province: string }>(lista: T[], q: string | null | undefined, limite: number): T[] {
  const t = q ? norm(q) : ''
  const achadas = lista.filter((c) => !t || norm(c.name).includes(t))
  const vistos = new Set<string>()
  return achadas.filter((c) => { const k = `${norm(c.name)}|${c.province}`; if (vistos.has(k)) return false; vistos.add(k); return true }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).slice(0, limite)
}

export async function provinciasDoPais(codigoPais: string): Promise<Divisao[]> {
  const pais = codigoPais.toUpperCase()
  try {
    if (pais === 'IT') return (await baseItalia()).provincias.map((p) => ({ codigo: p, nome: provinciaItEmPortugues(p) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    if (pais === 'ES') return (await baseEspanha()).provincias.map((p) => ({ codigo: p, nome: provinciaEsEmPortugues(p) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    const { State } = await base()
    return State.getStatesOfCountry(pais).map((s) => ({ codigo: s.isoCode, nome: s.name })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  } catch { return [] }
}

/** Cidades da província (ou do país inteiro, se a província não for dada). `q` filtra por texto (sem acento). Base fora do ar ou cidade ausente = lista vazia, nunca erro. */
export async function cidadesDaProvincia(codigoPais: string, provinciaNome?: string | null, q?: string | null, limite = 300): Promise<CidadeDaBase[]> {
  const pais = codigoPais.toUpperCase()
  try {
    if (pais === 'IT') {
      const b = await baseItalia()
      let lista = b.comuni
      if (provinciaNome?.trim()) { const oficial = provinciaItOficial(provinciaNome, b.provincias); if (!oficial) return []; lista = lista.filter((c) => c.province === oficial) }
      return filtrar(lista, q, limite).map((c) => ({ nome: c.name, provincia: provinciaItEmPortugues(c.province) }))
    }
    if (pais === 'ES') {
      const b = await baseEspanha()
      let lista = b.municipios
      if (provinciaNome?.trim()) { const oficial = provinciaEsOficial(provinciaNome, b.provincias); if (!oficial) return []; lista = lista.filter((c) => c.province === oficial) }
      return filtrar(lista, q, limite).map((c) => ({ nome: c.name, provincia: provinciaEsEmPortugues(c.province) }))
    }
    const { City, State } = await base()
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

/** A província (em português) a que a CIDADE pertence num país com fonte oficial; `null` se a cidade não existir ou for ambígua (nome em mais de uma província). */
export async function provinciaDaCidade(codigoPais: string, cidade: string): Promise<string | null> {
  const todas = await cidadesDaProvincia(codigoPais, null, cidade, 5000)
  const exatas = todas.filter((c) => norm(c.nome) === norm(cidade))
  const provs = [...new Set(exatas.map((c) => c.provincia))]
  return provs.length === 1 ? provs[0] : null
}
