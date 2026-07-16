// src/lib/documentos/regras-documentais/tipos.ts
//
// Tipos canônicos das REGRAS DOCUMENTAIS (base persistente = MatrizDocumental
// ampliada). Puro — sem Prisma, sem I/O. Compartilhado por avaliador, detector de
// conflitos, validador de condições, API e testes.
//
// NADA aqui cria Documento/Necessidade/Tarefa nem toca runtime. É só o modelo de
// dados + o vocabulário fechado de público-alvo, operadores e campos de condição.

// ---- vocabulário FECHADO (nada de SQL / nomes livres de tabela) ----

export const PUBLICOS_ALVO = [
  "REQUERENTE",
  "CONTRATANTE",
  "PESSOA_DA_ARVORE_COM_DOCUMENTACAO",
  "PESSOA_DA_LINHA_RETA",
  "PESSOA_FORA_DA_LINHA_RETA",
  "TODAS_AS_PESSOAS_DA_ARVORE",
] as const
export type PublicoAlvo = (typeof PUBLICOS_ALVO)[number]

export const PUBLICO_ALVO_LABEL: Record<PublicoAlvo, string> = {
  REQUERENTE: "Requerente",
  CONTRATANTE: "Contratante",
  PESSOA_DA_ARVORE_COM_DOCUMENTACAO: "Pessoa da árvore com documentação",
  PESSOA_DA_LINHA_RETA: "Pessoa da linha reta",
  PESSOA_FORA_DA_LINHA_RETA: "Pessoa fora da linha reta",
  TODAS_AS_PESSOAS_DA_ARVORE: "Todas as pessoas da árvore",
}

export const OPERADORES = [
  "igual",
  "diferente",
  "contem",
  "nao_contem",
  "maior",
  "menor",
  "existe",
  "nao_existe",
] as const
export type Operador = (typeof OPERADORES)[number]

export const OPERADOR_LABEL: Record<Operador, string> = {
  igual: "é igual a",
  diferente: "é diferente de",
  contem: "contém",
  nao_contem: "não contém",
  maior: "é maior que",
  menor: "é menor que",
  existe: "existe",
  nao_existe: "não existe",
}

export type Combinador = "TODAS" | "QUALQUER"

export type Obrigatoriedade = "OBRIGATORIA" | "OPCIONAL"

export const STATUS_REGRA = ["RASCUNHO", "PUBLICADA", "INATIVA", "ARQUIVADA"] as const
export type StatusRegra = (typeof STATUS_REGRA)[number]

// Campos de condição LEGÍTIMOS (fechado). Cada um resolve contra um atributo do
// sujeito (pessoa/requerente). Não inferir nada pelo nome do documento.
export const CAMPOS_CONDICAO = [
  "precisaDeDocumentacao",
  "requerente",
  "contratante",
  "linhaReta",
  "casado",
  "falecido",
  "vivo",
  "possuiConjuge",
  "geracao",
  "nacionalidade",
  "paisRegistro",
] as const
export type CampoCondicao = (typeof CAMPOS_CONDICAO)[number]

export const CAMPO_CONDICAO_LABEL: Record<CampoCondicao, string> = {
  precisaDeDocumentacao: "Precisa de documentação",
  requerente: "É requerente",
  contratante: "É contratante",
  linhaReta: "É da linha reta",
  casado: "É casado",
  falecido: "É falecido",
  vivo: "Está vivo",
  possuiConjuge: "Possui cônjuge",
  geracao: "Geração",
  nacionalidade: "Nacionalidade",
  paisRegistro: "País do registro",
}

export type ValorCondicao = string | number | boolean | null

export interface Condicao {
  campo: CampoCondicao
  operador: Operador
  valor: ValorCondicao
}

export interface ConjuntoCondicoes {
  combinador: Combinador
  regras: Condicao[]
}

// ---- a REGRA DOCUMENTAL canônica (espelho dos campos novos da MatrizDocumental) ----

export interface RegraDocumental {
  id: number
  // IDENTIFICAÇÃO
  codigo: string | null // código estável (compartilhado entre versões)
  nome: string | null
  descricao: string | null
  status: StatusRegra
  versao: number
  prioridade: number
  vigenciaInicio: string | null // ISO
  vigenciaFim: string | null // ISO
  // APLICABILIDADE
  tipoProcessoId: number
  modalidadeId: number | null
  paisCode: string | null
  regiaoCode: string | null
  tipoProcessoVersao: number | null
  // DOCUMENTO
  documentTypeCode: string
  categoriaCode: string | null
  obrigatoriedade: Obrigatoriedade
  // PÚBLICO-ALVO
  publicoAlvo: PublicoAlvo
  // CONDIÇÕES
  condicoes: ConjuntoCondicoes | null
  // FASE E BLOQUEIO
  faseExigencia: string | null // fase em que passa a ser exigido (phaseKey)
  faseBloqueio: string | null // fase que bloqueia (phaseKey)
  bloqueiaConclusaoFase: boolean
  continuaObrigatorioNasFasesSeguintes: boolean
  faseFinalExigencia: string | null
  obrigatorioAteFinalProcesso: boolean
  // VALIDADE
  possuiValidade: boolean
  validadeDias: number | null
  exigeDataEmissao: boolean
  renovarQuandoExpirado: boolean
  antecedenciaRenovacaoDias: number | null
}

// ---- contexto de avaliação (entrada do avaliador) ----

export interface SujeitoContexto {
  id?: number | string
  nome?: string
  ehPessoaArvore?: boolean
  requerente?: boolean
  contratante?: boolean
  linhaReta?: boolean
  precisaDeDocumentacao?: boolean
  casado?: boolean
  vivo?: boolean
  falecido?: boolean
  possuiConjuge?: boolean
  geracao?: number | null
  nacionalidade?: string | null
  paisRegistro?: string | null
  // opcional: data de emissão de um documento já existente, para checar validade
  dataEmissaoDocumento?: string | null // ISO
}

export interface ContextoAvaliacao {
  tipoProcessoId: number
  modalidadeId?: number | null
  paisCode?: string | null
  regiaoCode?: string | null
  faseKey?: string | null
  sujeito: SujeitoContexto
  dataReferencia: string // ISO — injetada por quem chama (scripts não têm Date.now)
  regras: RegraDocumental[]
}

// ---- validade calculada ----

export interface ValidadeCalculada {
  possuiValidade: boolean
  validadeDias: number | null
  dataEmissao: string | null
  vencimento: string | null // ISO
  expirado: boolean
  precisaRenovar: boolean
  diasParaVencer: number | null
}

// ---- resultado do avaliador ----

export interface ResultadoRegra {
  regraId: number
  regraNome: string | null
  documentTypeCode: string
  publicoAlvo: PublicoAlvo
  aplicavel: boolean
  obrigatoriedade: Obrigatoriedade
  faseExigencia: string | null
  faseBloqueio: string | null
  bloqueiaConclusaoFase: boolean
  obrigatorioAteFinalProcesso: boolean
  validade: ValidadeCalculada
  condicoesSatisfeitas: string[]
  condicoesNaoSatisfeitas: string[]
  justificativa: string // frase legível ("precisa de documentação e é casado")
  motivoNaoAplicavel: string | null // por que NÃO se aplica (público, condição, vigência, status…)
}

export interface ResultadoAvaliacao {
  sujeitoNome: string
  aplicaveis: ResultadoRegra[]
  naoAplicaveis: ResultadoRegra[]
}
