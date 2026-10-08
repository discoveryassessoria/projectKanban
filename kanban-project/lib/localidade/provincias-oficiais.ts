// lib/localidade/provincias-oficiais.ts
// ============================================================================
// NOMES DAS PROVÍNCIAS DA ITÁLIA E DA ESPANHA EM PORTUGUÊS (08/10/2026). PURO. As LISTAS e a relação cidade → província vêm de fontes oficiais, dentro do deploy:
//   • Itália  — pacote `comuni-province-regioni`, gerado a partir das tabelas do ISTAT (107 províncias/cidades metropolitanas, 7.896 comuni, nomes oficiais em italiano);
//   • Espanha — pacote `spanish-cities-info`, verificado contra o INE (8.132 municípios, 50 províncias + Ceuta + Melilla, nomes oficiais).
// Aqui só mora a TRADUÇÃO: o nome em português onde há nome usual; senão, o nome oficial. A tabela é curta e explícita (nada de lista de províncias escrita de memória — as listas vêm dos pacotes).
// ============================================================================

const semAcento = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-’']/g, ' ').replace(/\s+/g, ' ').trim()
export const normalizarNomeDeLugar = semAcento

/** Itália: nome oficial (ISTAT) → nome usual em português. O que não está aqui fica com o nome oficial italiano. */
export const PROVINCIA_IT_PT: Readonly<Record<string, string>> = {
  Milano: 'Milão', Napoli: 'Nápoles', Torino: 'Turim', Firenze: 'Florença', Venezia: 'Veneza', Genova: 'Gênova', Mantova: 'Mântua', Bologna: 'Bolonha', Padova: 'Pádua',
  Bergamo: 'Bérgamo', Brescia: 'Bréscia', Ravenna: 'Ravena', Perugia: 'Perúgia', Catania: 'Catânia',
}
/** Espanha: nome oficial/cooficial (INE) → nome usual em português. O que não está aqui fica com o nome oficial espanhol. León, Lugo, Pontevedra e Barcelona ficam como são. */
export const PROVINCIA_ES_PT: Readonly<Record<string, string>> = {
  'A Coruña': 'Corunha', Zaragoza: 'Saragoça', Sevilla: 'Sevilha', Bizkaia: 'Biscaia', 'Illes Balears': 'Ilhas Baleares', Ourense: 'Orense', Lleida: 'Lérida', Gipuzkoa: 'Guipúscoa',
  Araba: 'Álava', Murcia: 'Múrcia', Alacant: 'Alicante', 'València': 'Valência', Asturias: 'Astúrias', Cantabria: 'Cantábria', 'Córdoba': 'Córdova', 'Cádiz': 'Cádis',
}

function inverso(m: Readonly<Record<string, string>>): Map<string, string> { return new Map(Object.entries(m).map(([oficial, pt]) => [semAcento(pt), oficial])) }
const IT_DE_PT = inverso(PROVINCIA_IT_PT), ES_DE_PT = inverso(PROVINCIA_ES_PT)

export const provinciaItEmPortugues = (oficial: string): string => PROVINCIA_IT_PT[oficial] ?? oficial
export const provinciaEsEmPortugues = (oficial: string): string => PROVINCIA_ES_PT[oficial] ?? oficial
/** O nome digitado/escolhido (em português ou oficial, com ou sem acento) → o nome oficial do pacote; `null` se não for conhecido. */
export function provinciaItOficial(nome: string, oficiais: readonly string[]): string | null { const n = semAcento(nome); return IT_DE_PT.get(n) ?? oficiais.find((o) => semAcento(o) === n) ?? null }
export function provinciaEsOficial(nome: string, oficiais: readonly string[]): string | null { const n = semAcento(nome); return ES_DE_PT.get(n) ?? oficiais.find((o) => semAcento(o) === n) ?? null }

/** Marcas de lista ERRADA que não podem voltar: região/comunidade, nome em inglês, «Metropolitan City of», «Province of», «Libero consorzio». */
export const MARCAS_DE_LISTA_ERRADA_IT = [/metropolitan city/i, /province of/i, /libero consorzio/i, /\blombardy\b/i, /\bpiedmont\b/i, /\bapulia\b/i, /\btuscany\b/i, /\bsicily\b/i, /\bsardinia\b/i]
export const REGIOES_DA_ITALIA = ['Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', "Valle d'Aosta", 'Veneto', 'Trentino-Alto Adige']
export const COMUNIDADES_DA_ESPANHA = ['Galicia', 'Cataluña', 'Catalunya', 'Andalucía', 'País Vasco', 'Euskadi', 'Comunidad Valenciana', 'Comunitat Valenciana', 'Castilla y León', 'Castilla-La Mancha', 'Aragón', 'Extremadura', 'Canarias', 'Islas Baleares']
