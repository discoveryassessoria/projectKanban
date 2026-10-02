// src/lib/genealogia/gentilico.ts
//
// GENTÍLICO (nacionalidade) A PARTIR DO PAÍS — tabela estática, pura, sem React.
//
// Ao escolher o país de nascimento o formulário da pessoa sugere a nacionalidade
// ("Brasil" → "Brasileira"). Convenção do sistema: forma FEMININA com inicial
// maiúscula — a mesma de `AMBIENTE_PAISES[*].nacionalidade` ("Italiana") e do
// formulário de onboarding da árvore ("Brasileira", "Espanhola").
//
// FONTE ÚNICA, SEM DUPLICAR: os sete países que o Ambiente por Nacionalidade já
// cadastra (Itália, Espanha, Portugal, França, Alemanha, Polônia, Áustria) vêm de
// `src/lib/ambiente/paises.ts`; esta tabela cobre só o RESTO da base mundial
// (`Pais`, ISO 3166-1) e é conferida contra ela por teste. Território sem
// população própria (Antártida, Ilha Bouvet…) fica sem gentílico: o campo segue livre.
//
// O gentílico é SUGESTÃO: o formulário nunca trava o campo e nunca sobrescreve o
// que o usuário digitou (`proximaNacionalidade`).

import { AMBIENTE_PAISES, normalizarPais } from "@/src/lib/ambiente/paises"

/** [ISO alpha-2, nome como a base `Pais` o grava, gentílico, ...nomes alternativos (pt-BR, siglas)] */
type Linha = readonly [string, string, string, ...string[]]

const TABELA: readonly Linha[] = [
  ["AF", "Afeganistão", "Afegã"], ["ZA", "África do Sul", "Sul-africana"], ["AL", "Albânia", "Albanesa"],
  ["AD", "Andorra", "Andorrana"], ["AO", "Angola", "Angolana"], ["AI", "Anguila", "Anguilana"],
  ["AG", "Antígua e Barbuda", "Antiguana"], ["SA", "Arábia Saudita", "Saudita"], ["DZ", "Argélia", "Argelina"],
  ["AR", "Argentina", "Argentina"], ["AM", "Arménia", "Armênia", "Armênia"], ["AW", "Aruba", "Arubana"],
  ["AU", "Austrália", "Australiana"], ["AZ", "Azerbaijão", "Azerbaijana"], ["BS", "Bahamas", "Bahamense"],
  ["BH", "Bahrein", "Bareinita", "Barein"], ["BD", "Bangladesh", "Bangladeshiana"], ["BB", "Barbados", "Barbadiana"],
  ["BE", "Bélgica", "Belga"], ["BZ", "Belize", "Belizenha"], ["BJ", "Benim", "Beninense", "Benin"],
  ["BM", "Bermudas", "Bermudense"], ["BY", "Bielorrússia", "Bielorrussa", "Belarus"], ["BO", "Bolívia", "Boliviana"],
  ["BA", "Bósnia-Herzegovina", "Bósnia", "Bósnia e Herzegovina"], ["BW", "Botsuana", "Botsuanesa"],
  ["BR", "Brasil", "Brasileira"], ["BN", "Brunei", "Bruneana"], ["BG", "Bulgária", "Búlgara"],
  ["BF", "Burkina Faso", "Burquinense"], ["BI", "Burundi", "Burundiana"], ["BT", "Butão", "Butanesa"],
  ["CV", "Cabo Verde", "Cabo-verdiana"], ["KH", "Camboja", "Cambojana"], ["CA", "Canadá", "Canadense"],
  ["QA", "Qatar", "Catariana", "Catar"], ["KZ", "Cazaquistão", "Cazaque"], ["TD", "Chade", "Chadiana"],
  ["CL", "Chile", "Chilena"], ["CN", "China", "Chinesa"], ["CY", "Chipre", "Cipriota"],
  ["VA", "Santa Sé", "Vaticana", "Vaticano", "Cidade do Vaticano"], ["SG", "Singapura", "Singapurense"],
  ["CO", "Colômbia", "Colombiana"], ["KM", "Comores", "Comoriana"],
  ["CG", "República Democrática do Congo", "Congolesa", "Congo"], ["CD", "República Popular do Congo", "Congolesa", "República do Congo"],
  ["KP", "Coreia do Norte", "Norte-coreana"], ["KR", "Coreia do Sul", "Sul-coreana", "Coreia"],
  ["CI", "Costa do Marfim", "Marfinense"], ["CR", "Costa Rica", "Costa-riquenha"], ["HR", "Croácia", "Croata"],
  ["CU", "Cuba", "Cubana"], ["CW", "Curaçao", "Curaçauense"], ["DK", "Dinamarca", "Dinamarquesa"],
  ["DJ", "Djibouti", "Djibutiana", "Djibuti"], ["DM", "Dominica", "Dominiquense"], ["EG", "Egito", "Egípcia"],
  ["SV", "El Salvador", "Salvadorenha"], ["AE", "Emirados Árabes Unidos", "Emiradense", "Emirados"],
  ["EC", "Equador", "Equatoriana"], ["ER", "Eritreia", "Eritreia"], ["SK", "Eslováquia", "Eslovaca"],
  ["SI", "Eslovénia", "Eslovena", "Eslovênia"], ["US", "Estados Unidos", "Estadunidense", "EUA", "Estados Unidos da América", "USA"],
  ["EE", "Estónia", "Estoniana", "Estônia"], ["ET", "Etiópia", "Etíope"], ["FJ", "Fiji", "Fijiana", "Fiji"],
  ["PH", "Filipinas", "Filipina"], ["FI", "Finlândia", "Finlandesa"], ["GA", "Gabão", "Gabonesa"],
  ["GM", "Gâmbia", "Gambiana"], ["GH", "Gana", "Ganense"], ["GE", "Geórgia", "Georgiana"],
  ["GI", "Gibraltar", "Gibraltarina"], ["GD", "Granada", "Granadina"], ["GR", "Grécia", "Grega"],
  ["GL", "Gronelândia", "Groenlandesa"], ["GP", "Guadalupe", "Guadalupense"], ["GU", "Guam", "Guamense"],
  ["GT", "Guatemala", "Guatemalteca"], ["GG", "Guernsey", "Guernesiana"], ["GY", "Guiana", "Guianense"],
  ["GF", "Guiana Francesa", "Guianense"], ["GN", "Guiné", "Guineana"], ["GW", "Guiné-Bissau", "Bissau-guineense"],
  ["GQ", "Guiné Equatorial", "Equatoguineana"], ["HT", "Haiti", "Haitiana"],
  ["NL", "Países Baixos", "Holandesa", "Holanda"], ["HN", "Honduras", "Hondurenha"],
  ["HK", "Hong Kong", "Hong-konguesa"], ["HU", "Hungria", "Húngara"], ["YE", "Iémen", "Iemenita", "Iêmen"],
  ["IM", "Ilha de Man", "Manesa"], ["AX", "Ilhas Åland", "Alandesa"], ["KY", "Ilhas Caimão", "Caimanesa"],
  ["FO", "Ilhas Faroé", "Feroesa"], ["FK", "Ilhas Malvinas", "Malvinense", "Falkland"],
  ["MH", "Ilhas Marshall", "Marshallina"], ["SB", "Ilhas Salomão", "Salomonense"],
  ["IN", "Índia", "Indiana"], ["ID", "Indonésia", "Indonésia"], ["IR", "Irão", "Iraniana", "Irã"],
  ["IQ", "Iraque", "Iraquiana"], ["IE", "Irlanda", "Irlandesa"], ["IS", "Islândia", "Islandesa"],
  ["IL", "Israel", "Israelense"], ["JM", "Jamaica", "Jamaicana"], ["JP", "Japão", "Japonesa"],
  ["JE", "Jersey", "Jerseyana"], ["JO", "Jordânia", "Jordaniana"], ["KW", "Koweit", "Kuwaitiana", "Kuwait"],
  ["LA", "Laos", "Laosiana"], ["LS", "Lesoto", "Lesotiana"], ["LV", "Letónia", "Letã", "Letônia"],
  ["LB", "Líbano", "Libanesa"], ["LR", "Libéria", "Liberiana"], ["LY", "Líbia", "Líbia"],
  ["LI", "Liechtenstein", "Liechtensteinense"], ["LT", "Lituânia", "Lituana"], ["LU", "Luxemburgo", "Luxemburguesa"],
  ["MO", "Macau", "Macaense"], ["MK", "Macedónia do Norte", "Macedônia", "Macedônia do Norte", "Macedônia"],
  ["MG", "Madagáscar", "Malgaxe"], ["MY", "Malásia", "Malaia"], ["MW", "Maláui", "Malauiana", "Malawi"],
  ["MV", "Maldivas", "Maldiva"], ["ML", "Mali", "Maliana"], ["MT", "Malta", "Maltesa"], ["MA", "Marrocos", "Marroquina"],
  ["MQ", "Martinica", "Martinicana"], ["MU", "Maurícia", "Mauriciana", "Maurício"], ["MR", "Mauritânia", "Mauritana"],
  ["YT", "Mayotte", "Maiotense"], ["MX", "México", "Mexicana"], ["MM", "Mianmar (Birmânia)", "Mianmarense", "Mianmar", "Birmânia"],
  ["FM", "Micronésia", "Micronésia"], ["MZ", "Moçambique", "Moçambicana"], ["MD", "Moldávia", "Moldávia", "Moldova"],
  ["MC", "Mónaco", "Monegasca", "Mônaco"], ["MN", "Mongólia", "Mongol"], ["ME", "Montenegro", "Montenegrina"],
  ["MS", "Monserrate", "Monserratense"], ["NA", "Namíbia", "Namibiana"], ["NR", "Nauru", "Nauruana"],
  ["NP", "Nepal", "Nepalesa"], ["NI", "Nicarágua", "Nicaraguense"], ["NE", "Níger", "Nigerina"],
  ["NG", "Nigéria", "Nigeriana"], ["NU", "Niue", "Niueana"], ["NO", "Noruega", "Norueguesa"],
  ["NC", "Nova Caledónia", "Neocaledônia", "Nova Caledônia"], ["NZ", "Nova Zelândia", "Neozelandesa"],
  ["OM", "Omã", "Omanense"], ["PW", "Palau", "Palauana"], ["PA", "Panamá", "Panamenha"],
  ["PG", "Papua-Nova Guiné", "Papuásia", "Papua Nova Guiné"], ["PK", "Paquistão", "Paquistanesa"],
  ["PY", "Paraguai", "Paraguaia"], ["PE", "Peru", "Peruana"], ["PF", "Polinésia Francesa", "Polinésia"],
  ["PR", "Porto Rico", "Porto-riquenha"], ["KE", "Quénia", "Queniana", "Quênia"], ["KG", "Quirguistão", "Quirguiz"],
  ["KI", "Quiribati", "Quiribatiana"],
  ["GB", "Reino Unido", "Britânica", "Grã-Bretanha"],
  ["CF", "República Centro-Africana", "Centro-africana"], ["DO", "República Dominicana", "Dominicana"],
  ["CM", "Camarões", "Camaronesa"], ["CZ", "Chéquia", "Tcheca", "República Tcheca", "Tchéquia"],
  ["RE", "Reunião", "Reunionense"], ["RO", "Roménia", "Romena", "Romênia"], ["RW", "Ruanda", "Ruandesa"],
  ["RU", "Rússia", "Russa"], ["EH", "Saara Ocidental", "Saariana"], ["WS", "Samoa", "Samoana"],
  ["SM", "San Marino", "Sanmarinense"], ["LC", "Santa Lúcia", "Santa-lucense"],
  ["KN", "São Cristóvão e Neves", "São-cristovense"], ["ST", "São Tomé e Príncipe", "São-tomense"],
  ["VC", "São Vicente e Granadinas", "São-vicentina"], ["SN", "Senegal", "Senegalesa"],
  ["SL", "Serra Leoa", "Serra-leonesa"], ["RS", "Sérvia", "Sérvia"], ["SC", "Seychelles", "Seichelense"],
  ["SY", "Síria", "Síria"], ["SO", "Somália", "Somali"], ["LK", "Sri Lanka", "Sri-lanquesa"],
  ["SZ", "Essuatíni", "Suazi", "Suazilândia", "Eswatini"], ["SD", "Sudão", "Sudanesa"],
  ["SS", "Sudão do Sul", "Sul-sudanesa"], ["SE", "Suécia", "Sueca"], ["CH", "Suíça", "Suíça"],
  ["SR", "Suriname", "Surinamesa"], ["TH", "Tailândia", "Tailandesa"], ["TW", "Taiwan", "Taiwanesa"],
  ["TJ", "Tajiquistão", "Tadjique"], ["TZ", "Tanzânia", "Tanzaniana"],
  ["PS", "Territórios palestinos", "Palestina", "Palestina"], ["TL", "Timor-Leste", "Timorense", "Timor Leste"],
  ["TG", "Togo", "Togolesa"], ["TK", "Tokelau", "Tokelauana"], ["TO", "Tonga", "Tonganesa"],
  ["TT", "Trindade e Tobago", "Trinitária"], ["TN", "Tunísia", "Tunisiana"], ["TM", "Turquemenistão", "Turcomena"],
  ["TR", "Turquia", "Turca"], ["TV", "Tuvalu", "Tuvaluana"], ["UA", "Ucrânia", "Ucraniana"],
  ["UG", "Uganda", "Ugandense"], ["UY", "Uruguai", "Uruguaia"], ["UZ", "Uzbequistão", "Uzbeque"],
  ["VU", "Vanuatu", "Vanuatuense"], ["VE", "Venezuela", "Venezuelana"], ["VN", "Vietname", "Vietnamita", "Vietnã"],
  ["WF", "Wallis e Futuna", "Wallisiana"], ["ZM", "Zâmbia", "Zambiana"], ["ZW", "Zimbábue", "Zimbabuana"],
  ["XK", "Kosovo", "Kosovar"],
]

/** Países/territórios SEM população própria na base `Pais`: ficam sem gentílico de propósito. */
export const ISO_SEM_GENTILICO: readonly string[] = [
  "AQ", "BV", "HM", "GS", "TF", "IO", "UM", "CX", "CC", "NF", "MP", "PN", "TC", "VG", "VI",
  "BQ", "PM", "AS", "SH", "BL", "MF", "SX", "SJ", "CK",
]

/** Minúsculo, sem acento, sem pontuação de ligação: chave de comparação de nome de país. */
export function normalizarNomePais(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[-_.]/g, " ").replace(/\s+/g, " ").trim()
}

let porNome: Map<string, string> | null = null // nome normalizado → gentílico
let porIso: Map<string, string> | null = null  // ISO → gentílico

function indices() {
  if (porNome && porIso) return { porNome, porIso }
  const n = new Map<string, string>()
  const i = new Map<string, string>()
  for (const [iso, nome, gentilico, ...alternativos] of TABELA) {
    i.set(iso, gentilico)
    for (const chave of [nome, ...alternativos]) n.set(normalizarNomePais(chave), gentilico)
  }
  porNome = n
  porIso = i
  return { porNome: n, porIso: i }
}

/** Códigos ISO que esta tabela cobre (para o teste de completude contra a base mundial). */
export function codigosComGentilicoProprio(): string[] {
  return TABELA.map((l) => l[0])
}

export function gentilicoPorCodigo(iso: string | null | undefined): string | null {
  const codigo = String(iso ?? "").trim().toUpperCase()
  if (!codigo) return null
  for (const p of Object.values(AMBIENTE_PAISES)) if (p.iso === codigo) return p.nacionalidade
  return indices().porIso.get(codigo) ?? null
}

/** Gentílico do país pelo NOME digitado/escolhido (aceita acento, caixa e variantes pt-BR/pt-PT). Null se desconhecido. */
export function gentilicoDoPais(pais: string | null | undefined): string | null {
  const chave = normalizarNomePais(pais)
  if (!chave) return null
  const doAmbiente = normalizarPais(pais) // os sete cadastrados no Ambiente
  if (doAmbiente) return AMBIENTE_PAISES[doAmbiente].nacionalidade
  return indices().porNome.get(chave) ?? null
}

const mesmaNacionalidade = (a: string, b: string) => normalizarNomePais(a) === normalizarNomePais(b)

/**
 * Nacionalidade que o formulário deve mostrar depois de o país mudar.
 *  - o usuário já mexeu no campo (`tocado`) → mantém o que está lá, sempre;
 *  - país com gentílico conhecido → sugere o gentílico;
 *  - país desconhecido/vazio → mantém o que está lá (nunca apaga).
 */
export function proximaNacionalidade(args: { atual: string; tocado: boolean; pais: string | null | undefined }): string {
  if (args.tocado) return args.atual
  return gentilicoDoPais(args.pais) ?? args.atual
}

/**
 * Estado inicial de "tocado" ao abrir a EDIÇÃO de uma pessoa já gravada: se a
 * nacionalidade gravada é diferente da que o país sugeriria, alguém a escolheu à
 * mão e ela é preservada; se coincide com a sugestão (ou está vazia), o campo
 * ainda acompanha o país.
 */
export function nacionalidadeJaTocada(nacionalidade: string | null | undefined, pais: string | null | undefined): boolean {
  const atual = String(nacionalidade ?? "").trim()
  if (!atual) return false
  const sugerida = gentilicoDoPais(pais)
  return !sugerida || !mesmaNacionalidade(atual, sugerida)
}

/** O que o usuário digitou na nacionalidade passa a valer como "tocado" (vazio devolve o controle ao país). */
export const nacionalidadeDigitadaToca = (valor: string): boolean => valor.trim() !== ""
