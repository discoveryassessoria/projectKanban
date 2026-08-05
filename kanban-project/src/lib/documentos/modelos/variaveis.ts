// src/lib/documentos/modelos/variaveis.ts
//
// REGISTRY ÚNICO DE VARIÁVEIS DOS MODELOS DOCUMENTAIS.
//
// É a única lista de placeholders que o sistema reconhece. Um template só é
// publicável se TODA variável que ele usa estiver aqui; um dado só entra no
// documento se vier de um campo declarado aqui. Não existe segunda lista, nem no
// frontend, nem em cada modelo, nem dentro do DOCX.
//
// POR QUE REGISTRY E NÃO SUBSTITUIÇÃO POR TEXTO: o caminho antigo de "gerar
// documento" seria procurar o nome do cliente de exemplo dentro do DOCX e trocar
// pelo nome do cliente atual. Isso amarra o template ao dado de uma pessoa real,
// quebra em qualquer redação nova e falha silenciosamente. Aqui o template
// declara o que quer por CHAVE; o motor resolve a chave a partir do cadastro.
//
// FLEXÃO: gênero gramatical vem do CADASTRO (sexo), nunca do nome. Sem o dado, a
// geração é BLOQUEADA — nenhum documento sai com "brasileiro" para uma mulher.

/** Origem do valor — de onde o motor lê. Nunca de observação, metadata ou texto livre. */
export type OrigemVariavel =
  | "cadastro_outorgante"
  | "cadastro_outorgante_derivado"
  | "ato_de_emissao"

export interface DefinicaoVariavel {
  /** Chave canônica, como aparece no DOCX entre chaves duplas. */
  chave: string
  /** Rótulo do campo no checklist da tela. */
  rotulo: string
  origem: OrigemVariavel
  /**
   * Campo do cadastro que alimenta a variável. Documentação executável: é o que
   * o checklist mostra quando o dado falta ("preencha RG no cadastro").
   */
  campo: string
  /**
   * true = quando o template usa esta variável, o dado é EXIGIDO. false = o
   * template tolera ausência (segmento opcional do endereço, por exemplo).
   */
  exigidaQuandoUsada: boolean
  /** Explicação curta para a tela de administração de modelos. */
  descricao: string
  /**
   * Como o valor é DESENHADO no documento.
   *
   * É regra de RENDERIZAÇÃO, não de dado: o cadastro continua guardando "João da
   * Silva", o checklist continua mostrando "João da Silva" e o snapshot da versão
   * gerada continua registrando "João da Silva". Só o texto que entra no DOCX
   * recebe o tratamento — e ele é declarado aqui, no registry, para que um modelo
   * futuro que use a mesma variável herde a regra sem tocar no motor.
   */
  renderizacao?: RegraDeRenderizacao
}

export interface RegraDeRenderizacao {
  /** Escreve o valor em caixa alta. */
  caixaAlta?: boolean
  /**
   * Aplica negrito APENAS ao texto inserido — o run é dividido, e o restante do
   * parágrafo conserva a formatação original.
   */
  negrito?: boolean
}

export const VARIAVEIS_MODELO: readonly DefinicaoVariavel[] = [
  {
    chave: "OUTORGANTE_NOME_COMPLETO",
    rotulo: "Nome completo",
    origem: "cadastro_outorgante",
    campo: "nome",
    exigidaQuandoUsada: true,
    descricao:
      "Nome civil completo do outorgante, como consta no cadastro. No instrumento é sempre desenhado em CAIXA ALTA e negrito.",
    renderizacao: { caixaAlta: true, negrito: true },
  },
  {
    chave: "OUTORGANTE_NACIONALIDADE",
    rotulo: "Nacionalidade",
    origem: "cadastro_outorgante",
    campo: "nacionalidade",
    exigidaQuandoUsada: true,
    descricao: "Nacionalidade flexionada pelo gênero gramatical (brasileiro / brasileira).",
  },
  {
    chave: "OUTORGANTE_ESTADO_CIVIL",
    rotulo: "Estado civil",
    origem: "cadastro_outorgante",
    campo: "estadoCivil",
    exigidaQuandoUsada: true,
    descricao: "Estado civil flexionado pelo gênero gramatical (casado / casada).",
  },
  {
    chave: "OUTORGANTE_PROFISSAO",
    rotulo: "Profissão",
    origem: "cadastro_outorgante",
    campo: "profissao",
    exigidaQuandoUsada: true,
    descricao: "Profissão do outorgante — usada apenas pelos modelos que a exigem.",
  },
  {
    chave: "OUTORGANTE_PORTADOR",
    rotulo: "Concordância de gênero (portador / portadora)",
    origem: "cadastro_outorgante_derivado",
    campo: "sexo",
    exigidaQuandoUsada: true,
    descricao:
      "Concordância gramatical da expressão 'portador da cédula de identidade'. Derivada do gênero, nunca do nome.",
  },
  {
    chave: "OUTORGANTE_RG",
    rotulo: "RG",
    origem: "cadastro_outorgante",
    campo: "rg",
    exigidaQuandoUsada: true,
    descricao: "Número da cédula de identidade.",
  },
  {
    chave: "OUTORGANTE_RG_ORGAO",
    rotulo: "Órgão expedidor do RG",
    origem: "cadastro_outorgante",
    campo: "rgOrgaoExpedidor",
    exigidaQuandoUsada: true,
    descricao: "Órgão expedidor da cédula de identidade — exigido só pelos modelos que o citam.",
  },
  {
    chave: "OUTORGANTE_CPF",
    rotulo: "CPF",
    origem: "cadastro_outorgante",
    campo: "cpf",
    exigidaQuandoUsada: true,
    descricao: "CPF do outorgante, formatado no padrão oficial.",
  },
  {
    chave: "OUTORGANTE_LOGRADOURO",
    rotulo: "Logradouro",
    origem: "cadastro_outorgante",
    campo: "endereco",
    exigidaQuandoUsada: true,
    descricao: "Logradouro do endereço residencial.",
  },
  {
    chave: "OUTORGANTE_NUMERO",
    rotulo: "Número",
    origem: "cadastro_outorgante",
    campo: "numero",
    exigidaQuandoUsada: true,
    descricao: "Número do endereço residencial.",
  },
  {
    chave: "OUTORGANTE_COMPLEMENTO",
    rotulo: "Complemento",
    origem: "cadastro_outorgante",
    campo: "complemento",
    exigidaQuandoUsada: false,
    descricao: "Complemento do endereço. Ausente é ausência real, não pendência.",
  },
  {
    chave: "OUTORGANTE_BAIRRO",
    rotulo: "Bairro",
    origem: "cadastro_outorgante",
    campo: "bairro",
    exigidaQuandoUsada: false,
    descricao: "Bairro do endereço. Ausente é ausência real, não pendência.",
  },
  {
    chave: "OUTORGANTE_CIDADE",
    rotulo: "Cidade",
    origem: "cadastro_outorgante",
    campo: "cidade",
    exigidaQuandoUsada: true,
    descricao: "Cidade do endereço residencial.",
  },
  {
    chave: "OUTORGANTE_UF",
    rotulo: "UF",
    origem: "cadastro_outorgante",
    campo: "estado",
    exigidaQuandoUsada: true,
    descricao: "Unidade federativa do endereço residencial.",
  },
  {
    chave: "OUTORGANTE_CEP",
    rotulo: "CEP",
    origem: "cadastro_outorgante",
    campo: "cep",
    exigidaQuandoUsada: true,
    descricao: "Código postal do endereço residencial.",
  },
  {
    chave: "OUTORGANTE_PAIS",
    rotulo: "País",
    origem: "cadastro_outorgante",
    campo: "pais",
    exigidaQuandoUsada: true,
    descricao: "País do endereço residencial.",
  },
  {
    chave: "OUTORGANTE_ENDERECO_LINHA",
    rotulo: "Endereço (linha completa)",
    origem: "cadastro_outorgante_derivado",
    campo: "endereco, numero, complemento, bairro, cidade, estado, cep",
    exigidaQuandoUsada: true,
    descricao:
      "Endereço em uma linha, montado a partir dos campos atômicos do cadastro. Segmentos opcionais ausentes são omitidos sem deixar vírgula solta — é o que evita placeholder vazio no meio da frase.",
  },
  {
    chave: "LOCAL_EMISSAO",
    rotulo: "Cidade da emissão",
    origem: "ato_de_emissao",
    campo: "localEmissao",
    exigidaQuandoUsada: true,
    descricao: "Cidade onde o instrumento é assinado. Informada no ato da geração.",
  },
  {
    chave: "DATA_EMISSAO_EXTENSO",
    rotulo: "Data da emissão",
    origem: "ato_de_emissao",
    campo: "dataEmissao",
    exigidaQuandoUsada: true,
    descricao: "Data da emissão por extenso, em português. Informada no ato da geração.",
  },
  {
    chave: "ASSINATURA_NOME",
    rotulo: "Nome para assinatura",
    origem: "cadastro_outorgante_derivado",
    campo: "nome",
    exigidaQuandoUsada: true,
    descricao:
      "Nome que aparece sob a linha de assinatura — o mesmo nome civil do cadastro, também em CAIXA ALTA e negrito.",
    // É o nome do OUTORGANTE outra vez, no pé do instrumento. Tratá-lo diferente
    // faria o mesmo nome aparecer de duas formas no mesmo documento.
    renderizacao: { caixaAlta: true, negrito: true },
  },
] as const

export type ChaveVariavel = (typeof VARIAVEIS_MODELO)[number]["chave"]

const PORDEFINICAO = new Map(VARIAVEIS_MODELO.map((v) => [v.chave, v]))

export function definicaoDaVariavel(chave: string): DefinicaoVariavel | null {
  return PORDEFINICAO.get(chave) ?? null
}

export function variavelConhecida(chave: string): boolean {
  return PORDEFINICAO.has(chave)
}

/** Regra de desenho da variável no DOCX. Vazio = escreve como veio. */
export function regraDeRenderizacao(chave: string): RegraDeRenderizacao {
  return PORDEFINICAO.get(chave)?.renderizacao ?? {}
}

/**
 * Aplica a regra de renderização ao VALOR, sem tocar na origem.
 *
 * Só o que é textual mora aqui (caixa alta). O negrito é atributo do run e é
 * resolvido no motor OOXML, na hora de escrever.
 */
export function valorRenderizado(chave: string, valor: string): string {
  return regraDeRenderizacao(chave).caixaAlta ? valor.toLocaleUpperCase("pt-BR") : valor
}

/** Sintaxe oficial: {{CHAVE}}. Uma só, em todo o sistema. */
export const PADRAO_PLACEHOLDER = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

/** Chaves citadas por um texto, na ordem em que aparecem, sem repetição. */
export function extrairPlaceholders(texto: string): string[] {
  const vistas = new Set<string>()
  for (const m of texto.matchAll(PADRAO_PLACEHOLDER)) vistas.add(m[1])
  return [...vistas]
}

// ════════════════════════════════════════════════════════════════════════════
// FLEXÃO GRAMATICAL
// ════════════════════════════════════════════════════════════════════════════

export type GeneroGramatical = "masculino" | "feminino"

/**
 * Gênero gramatical a partir do CADASTRO. Retorna null quando o cadastro não
 * afirma — e null bloqueia a geração. Nunca se infere gênero pelo nome.
 */
export function generoGramatical(sexo: string | null | undefined): GeneroGramatical | null {
  const s = (sexo ?? "").trim().toLowerCase()
  if (!s) return null
  if (["m", "masculino", "masculina", "male", "homem"].includes(s)) return "masculino"
  if (["f", "feminino", "feminina", "female", "mulher"].includes(s)) return "feminino"
  return null
}

/**
 * Flexiona um termo do cadastro pelo gênero.
 *
 * O cadastro guarda formas neutras de formulário — "Brasileiro(a)", "Casado(a)",
 * "Viúvo(a)". O documento jurídico não admite isso: escreve-se "brasileira" ou
 * "brasileiro". A função resolve o marcador "(a)"/"(o)" e a desinência final.
 * Termo sem marcador e sem desinência flexionável (ex.: "União estável") volta
 * como está — o correto é não mexer, não adivinhar.
 */
export function flexionar(termo: string | null | undefined, genero: GeneroGramatical): string {
  const bruto = (termo ?? "").trim()
  if (!bruto) return ""

  // "Brasileiro(a)" → base "Brasileiro" + alternativa "a" na última letra.
  const comMarcador = bruto.match(/^(.*?)\(([ao])\)\s*$/i)
  if (comMarcador) {
    const base = comMarcador[1].trim()
    const alt = comMarcador[2].toLowerCase()
    const desinencia = genero === "feminino" ? "a" : "o"
    if (alt === desinencia) return trocarDesinencia(base, desinencia)
    return trocarDesinencia(base, desinencia)
  }

  return trocarDesinencia(bruto, genero === "feminino" ? "a" : "o")
}

function trocarDesinencia(base: string, desinencia: "a" | "o"): string {
  if (!/[ao]$/i.test(base)) return base
  const ultima = base.slice(-1)
  const trocada = ultima === ultima.toUpperCase() ? desinencia.toUpperCase() : desinencia
  return base.slice(0, -1) + trocada
}

/** "portador" / "portadora" — concordância da expressão fixa do instrumento. */
export function concordarPortador(genero: GeneroGramatical): string {
  return genero === "feminino" ? "portadora" : "portador"
}

// ════════════════════════════════════════════════════════════════════════════
// FORMATAÇÃO CANÔNICA
// ════════════════════════════════════════════════════════════════════════════

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

/** Data por extenso em português, a partir dos componentes locais da data. */
export function dataPorExtenso(data: Date): string {
  return `${data.getDate()} de ${MESES[data.getMonth()]} de ${data.getFullYear()}`
}

/** CPF no padrão oficial. Valor que não tem 11 dígitos volta como veio — não se inventa. */
export function formatarCpf(cpf: string | null | undefined): string {
  const d = (cpf ?? "").replace(/\D/g, "")
  if (d.length !== 11) return (cpf ?? "").trim()
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** CEP no padrão oficial. Mesma regra: sem 8 dígitos, devolve o que existe. */
export function formatarCep(cep: string | null | undefined): string {
  const d = (cep ?? "").replace(/\D/g, "")
  if (d.length !== 8) return (cep ?? "").trim()
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

/**
 * Linha de endereço do instrumento. Segmentos opcionais ausentes desaparecem
 * junto com sua vírgula — é isto que garante que nenhuma frase saia com buraco.
 */
export function montarLinhaEndereco(dados: {
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
}): string {
  const partes = [dados.logradouro, dados.numero, dados.complemento, dados.bairro]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)

  const cidadeUf = [(dados.cidade ?? "").trim(), (dados.uf ?? "").trim()].filter(Boolean).join(" – ")
  if (cidadeUf) partes.push(cidadeUf)

  const cep = formatarCep(dados.cep)
  const linha = partes.join(", ")
  return cep ? `${linha}, CEP ${cep}` : linha
}
