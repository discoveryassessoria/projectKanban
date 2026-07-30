// src/lib/genealogia/registral/tipos.ts
//
// MRG — contratos do Motor Registral Genealógico.
//
// REGRA DE ESCOPO (permanente, coberta por scripts/mrg-arquitetura-guard.test.ts):
// este módulo é PURO. Não importa Prisma, não importa React, não faz rede. Toda
// decisão registral (classificar, extrair, comparar, identificar, validar,
// propor, medir impacto) é uma função determinística de dados de entrada — é a
// única forma de conseguir cobertura de teste real num sistema cujo banco é
// produção.
//
// O motor NÃO possui documento. Ele recebe uma LEITURA do documento (texto e/ou
// campos já revisados pelo Sistema Documental) e devolve afirmações rastreáveis.

import type { GrauConfianca, OrigemAfirmacao } from "@/src/lib/cadastro-mestre/afirmacao"

// ---------------------------------------------------------------- enums espelhados
// Espelham 1:1 os enums do schema. Ficam aqui para o motor não importar
// @prisma/client (que arrasta o runtime do banco para dentro da lógica pura).

export type EtapaRegistral =
  | "RECEBIDO"
  | "CLASSIFICANDO"
  | "EXTRAINDO"
  | "REEXTRAINDO"
  | "NORMALIZANDO"
  | "RESOLVENDO_IDENTIDADES"
  | "CRUZANDO_EVIDENCIAS"
  | "VALIDANDO"
  | "REVALIDANDO"
  | "ANALISANDO_IMPACTO"
  | "AGUARDANDO_REVISAO"
  | "APLICADO"
  | "AUDITADO"
  | "FALHA_LEITURA"
  | "DOCUMENTO_INSUFICIENTE"
  | "DOCUMENTO_CONFLITANTE"
  | "REPROCESSAMENTO"
  | "REJEITADO"
  | "CANCELADO"

export type EstadoFatoRegistral =
  | "NAO_INFORMADO"
  | "INFORMADO_PELO_CLIENTE"
  | "EXTRAIDO"
  | "NAO_COMPROVADO"
  | "INCOMPLETO"
  | "PROVAVEL"
  | "CONFIRMADO"
  | "CONFIRMADO_MULTIPLAS_EVIDENCIAS"
  | "DIVERGENTE"
  | "CONFLITANTE"
  | "EM_REVISAO"
  | "REJEITADO"
  | "SUBSTITUIDO_COM_HISTORICO"

export type CampoRegistral =
  | "NOME_REGISTRAL"
  | "NOME_CASADO"
  | "SEXO"
  | "DATA_NASCIMENTO"
  | "LOCAL_NASCIMENTO"
  | "PAIS_NASCIMENTO"
  | "FILIACAO_PAI"
  | "FILIACAO_MAE"
  | "DATA_CASAMENTO"
  | "LOCAL_CASAMENTO"
  | "CONJUGE"
  | "DATA_OBITO"
  | "LOCAL_OBITO"
  | "DATA_BATISMO"
  | "LOCAL_BATISMO"
  | "PROFISSAO"
  | "NACIONALIDADE"
  | "NATURALIZACAO"
  | "IDADE_DECLARADA"
  | "RESIDENCIA_HISTORICA"
  | "REFERENCIA_REGISTRAL"
  | "DATA_EMIGRACAO"
  | "IDENTIDADE_PESSOA"
  | "IDENTIDADE_PAI"
  | "IDENTIDADE_MAE"
  | "VINCULO_ASCENDENTE_TRANSMISSOR"

export type PapelOcorrencia =
  | "REGISTRADO"
  | "PAI"
  | "MAE"
  | "CONJUGE"
  | "FILHO"
  | "AVO_PATERNO"
  | "AVOA_PATERNA"
  | "AVO_MATERNO"
  | "AVOA_MATERNA"
  | "DECLARANTE"
  | "TESTEMUNHA"
  | "OFICIANTE"
  | "PADRINHO"
  | "MADRINHA"
  | "OUTRO"

export type ClasseCorrespondencia =
  | "CORRESPONDENCIA_CONFIRMADA"
  | "ALTAMENTE_PROVAVEL"
  | "POSSIVEL"
  | "REGISTROS_CONFLITANTES"
  | "PESSOAS_DISTINTAS"

export type TipoPropostaRegistral =
  | "CONFIRMAR_DADO"
  | "COMPLETAR_DADO"
  | "CORRIGIR_DADO"
  | "ADICIONAR_NOME_ALTERNATIVO"
  | "CRIAR_PESSOA"
  | "VINCULAR_PESSOA_EXISTENTE"
  | "CRIAR_RELACIONAMENTO"
  | "CORRIGIR_RELACIONAMENTO"
  | "REMOVER_RELACIONAMENTO"
  | "MESCLAR_PESSOAS"
  | "SEPARAR_PESSOAS"
  | "SATISFAZER_NECESSIDADE"
  | "REABRIR_NECESSIDADE"
  | "CRIAR_NECESSIDADE"
  | "MARCAR_DOCUMENTO_DIVERGENTE"
  | "SOLICITAR_RETIFICACAO"

export type CriticidadeRegistral = "AUTOMATICA" | "APROVACAO_HUMANA" | "BLOQUEIO"

export type SeveridadeRegistral = "CRITICO" | "ALTO" | "MEDIO" | "BAIXO" | "INFO"

export type ResultadoLinhagemRegistral =
  | "LINHA_COMPLETA_COMPROVADA"
  | "LINHA_COMPLETA_COM_PENDENCIAS"
  | "LINHA_ESTRUTURAL_INCOMPLETA"
  | "LINHA_CONFLITANTE"
  | "ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO"
  | "REVISAO_OBRIGATORIA"

/** Natureza registral do documento — o que o classificador devolve. */
export type NaturezaRegistral =
  | "NASCIMENTO"
  | "CASAMENTO"
  | "OBITO"
  | "BATISMO"
  | "NATURALIZACAO"
  | "IMIGRACAO"
  | "IDENTIFICACAO"
  | "DESCONHECIDO"

// ---------------------------------------------------------------- leitura do documento

/** Uma página de texto do documento (dono: Sistema Documental). */
export interface PaginaTexto {
  pagina: number
  texto: string
}

/**
 * Tudo que o motor vê de um documento. Nenhum campo aqui é criado pelo motor:
 * é a projeção do Documento do Processo + sua transcrição.
 */
export interface LeituraDocumento {
  documentoId: number
  /** Sujeito cadastrado a que o documento está anexado (Documento.pessoaId). */
  pessoaId: number | null
  necessidadeId: number | null
  itemCatalogoId: number | null
  /** Enum/código do tipo declarado no Sistema Documental (quando houver). */
  tipoDeclarado: string | null
  paginas: PaginaTexto[]
  /** Campos literais já transcritos no cadastro do documento. */
  literais: LiteraisDocumento
  /** `Documento.registral` — dado registral já revisado (verdade canônica AD2). */
  registral: Record<string, unknown> | null
  /** `Documento.structuredData` — extração AD2 por tipo. */
  estruturado: Record<string, unknown> | null
  /** Fonte predominante do texto (para auditoria da evidência). */
  fonte: string
}

export interface LiteraisDocumento {
  nomeRegistrado?: string | null
  paiRegistrado?: string | null
  maeRegistrada?: string | null
  conjugeRegistrado?: string | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  numeroRegistro?: string | null
  matricula?: string | null
  dataEvento?: string | null
  dataRegistro?: string | null
  cidadeRegistro?: string | null
  estadoRegistro?: string | null
  paisRegistro?: string | null
  comune?: string | null
  observacoes?: string | null
}

// ---------------------------------------------------------------- extração

/** Uma leitura de um campo, com tudo que a torna verificável (requisito 6). */
export interface CampoExtraido {
  campo: CampoRegistral
  /** A quem o campo se refere dentro do documento. */
  papel: PapelOcorrencia
  valorBruto: string
  valorNormalizado: string
  /** Data resolvida quando o campo é temporal (ISO yyyy-mm-dd). */
  valorData?: string | null
  pagina: number | null
  /** Localização citável: "offset 120-168" ou "literal:pai_registrado". */
  regiao: string | null
  trecho: string | null
  metodo: string
  confianca: number
  regra: string
}

export interface ResultadoExtracao {
  /** Identificador do extrator (para auditoria e para provar independência). */
  extrator: string
  versao: string
  natureza: NaturezaRegistral
  campos: CampoExtraido[]
  /** Motivos pelos quais a leitura ficou incompleta. */
  lacunas: string[]
}

// ---------------------------------------------------------------- conferência

export type VeredictoConferencia =
  | "CONCORDANTE"
  | "CONCORDANTE_APOS_NORMALIZACAO"
  | "COMPLEMENTAR"
  | "DIVERGENTE"
  | "AUSENTE"

export interface CampoConferido {
  campo: CampoRegistral
  papel: PapelOcorrencia
  veredicto: VeredictoConferencia
  /** Leitura A (âncora de rótulo). */
  a: CampoExtraido | null
  /** Leitura B (estrutural/gramatical, independente). */
  b: CampoExtraido | null
  /** Valor consolidado — só existe quando não há divergência. */
  valorNormalizado: string | null
  valorData: string | null
  /** Confiança combinada 0..1. */
  confianca: number
  /** Campo crítico com divergência NUNCA é consolidado; vira conflito. */
  bloqueadoParaRevisao: boolean
  explicacao: string
}

// ---------------------------------------------------------------- ocorrências e identidade

export interface OcorrenciaExtraida {
  papel: PapelOcorrencia
  nomeBruto: string
  nomeNormalizado: string
  chaveFonetica: string
  sexoInferido: string | null
  atributos: AtributosOcorrencia
  /** Campos conferidos que descrevem esta ocorrência. */
  camposIds: number[]
}

export interface AtributosOcorrencia {
  dataNascimento?: string | null
  localNascimento?: string | null
  paisNascimento?: string | null
  dataObito?: string | null
  dataCasamento?: string | null
  localCasamento?: string | null
  idadeDeclarada?: number | null
  profissao?: string | null
  residencia?: string | null
  nomePai?: string | null
  nomeMae?: string | null
  nomeConjuge?: string | null
  nacionalidade?: string | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
}

/** Pessoa do Cadastro Mestre, como o motor a enxerga para comparar. */
export interface PessoaConhecida {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  cpf?: string | null
  data_nasc?: Date | string | null
  data_obito?: Date | string | null
  local_nasc?: string | null
  pais_nasc?: string | null
  profissao?: string | null
  paiId?: number | null
  maeId?: number | null
  /** Nome dos genitores cadastrados — evidência de filiação por nome. */
  nomePai?: string | null
  nomeMae?: string | null
  arvoreId?: number | null
  /** Aliases oficiais (NomePessoa) — é o que faz "nome de casada" bater. */
  aliases?: Array<{ nome: string; sobrenome?: string | null; tipo: string }>
  /** Ids de cônjuges e filhos conhecidos (evidência relacional). */
  conjugesIds?: number[]
  filhosIds?: number[]
}

export interface EvidenciaIdentidade {
  campo: string
  descricao: string
  favoravel: boolean
  peso: number
}

export interface Correspondencia {
  pessoaId: number
  classe: ClasseCorrespondencia
  score: number
  evidencias: EvidenciaIdentidade[]
  /** Por que o motor não pode decidir sozinho (quando aplicável). */
  motivoBloqueio: string | null
}

export interface ResultadoIdentidade {
  correspondencias: Correspondencia[]
  /** Só preenchido quando existe UMA correspondência inequívoca e sem risco. */
  pessoaAutomatica: number | null
  classeFinal: ClasseCorrespondencia
  explicacao: string
}

// ---------------------------------------------------------------- integridade

export interface Inconsistencia {
  codigo: string
  severidade: SeveridadeRegistral
  pessoaIds: number[]
  uniaoIds?: number[]
  campo?: CampoRegistral | null
  descricao: string
  explicacao: string
  acaoSugerida: string
  evidencias: string[]
}

// ---------------------------------------------------------------- linhagem

export interface CaminhoLinhagem {
  ids: number[]
  /** Gerações sem comprovação documental ao longo do caminho. */
  geracoesSemComprovacao: number[]
  /** Ponto exato em que a linha para (id da pessoa) ou null. */
  quebraEm: number | null
  comprovado: boolean
}

export interface ResultadoElegibilidade {
  requerenteId: number | null
  ascendenteTransmissorId: number | null
  caminhoPrincipal: CaminhoLinhagem | null
  caminhosAlternativos: CaminhoLinhagem[]
  resultado: ResultadoLinhagemRegistral
  /** Por que este resultado — em linguagem de operador. */
  explicacao: string
  pendencias: string[]
  conflitos: string[]
  /** false sempre que faltar evidência: o motor não declara direito. */
  comprovadoDocumentalmente: boolean
}

// ---------------------------------------------------------------- propostas

export interface OperacaoProposta {
  tipo: TipoPropostaRegistral
  /** PESSOA | UNIAO | FATO | NECESSIDADE | DOCUMENTO */
  entidadeAlvo: string
  alvoId: number | null
  campo: CampoRegistral | null
  valorAtual: string | null
  valorProposto: string | null
  /** Payload aplicável pelo aplicador (nunca interpretado por tela). */
  dados: Record<string, unknown>
}

export interface PropostaMontada {
  operacao: OperacaoProposta
  criticidade: CriticidadeRegistral
  aplicavelAutomaticamente: boolean
  confianca: number
  justificativa: string
  regraAplicada: string
  recomendacao: string
  risco: SeveridadeRegistral
  evidenciasFavoraveis: EvidenciaIdentidade[]
  evidenciasContrarias: EvidenciaIdentidade[]
  origemValorAtual: string | null
  origemValorProposto: string | null
  pessoasAfetadas: number[]
  chaveIdempotencia: string
}

// ---------------------------------------------------------------- afirmação

export interface AfirmacaoRegistral {
  origem: OrigemAfirmacao
  confianca: GrauConfianca
  responsavelId: number | null
  afirmadoEm: Date
  justificativa: string | null
}

export const ORDEM_SEVERIDADE_REGISTRAL: Record<SeveridadeRegistral, number> = {
  CRITICO: 5,
  ALTO: 4,
  MEDIO: 3,
  BAIXO: 2,
  INFO: 1,
}

export function piorSeveridadeRegistral(
  a: SeveridadeRegistral,
  b: SeveridadeRegistral,
): SeveridadeRegistral {
  return ORDEM_SEVERIDADE_REGISTRAL[a] >= ORDEM_SEVERIDADE_REGISTRAL[b] ? a : b
}
