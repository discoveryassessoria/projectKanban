// src/components/registral/tipos-ui.ts
//
// Formas que a INTERFACE consome das rotas do motor registral.
//
// Deliberadamente separadas dos tipos do motor: a tela lê JSON de API, não o
// modelo do Prisma nem os tipos puros. Amarrar a tela ao tipo interno faz uma
// mudança de campo do domínio quebrar o build da interface — e o contrário do
// que se quer aqui é acoplar revisão a implementação.

export type Criticidade = "AUTOMATICA" | "APROVACAO_HUMANA" | "BLOQUEIO"
export type StatusProposta =
  | "PENDENTE"
  | "APROVADA"
  | "REJEITADA"
  | "ADIADA"
  | "APLICADA"
  | "REVERTIDA"
  | "ABORTADA"
export type Severidade = "CRITICO" | "ALTO" | "MEDIO" | "BAIXO" | "INFO"
export type StatusConflito = "ABERTO" | "EM_REVISAO" | "RESOLVIDO" | "DESCARTADO"

export interface EvidenciaResumo {
  campo: string
  descricao: string
  favoravel: boolean
  peso: number
}

export interface PropostaLista {
  id: number
  processoId: number
  arvoreId: number | null
  loteId: number | null
  tipo: string
  criticidade: Criticidade
  status: StatusProposta
  entidadeAlvo: string
  alvoId: number | null
  campo: string | null
  valorAtual: string | null
  valorProposto: string | null
  origemValorAtual: string | null
  origemValorProposto: string | null
  confianca: number
  justificativa: string
  regraAplicada: string
  recomendacao: string | null
  risco: Severidade
  aplicavelAutomaticamente: boolean
  pessoasAfetadas: unknown
  decididoEm: string | null
  decisaoNota: string | null
  aplicadoEm: string | null
  revertidoEm: string | null
  motivoAbortoRevalidacao: string | null
  versaoArvoreAntes: number | null
  versaoArvoreDepois: number | null
  criadoEm: string
  decididoPor: { id: number; nome: string } | null
}

export interface ImpactoResumo {
  id: number
  momento: string
  pessoasAfetadas: number
  arvoresAfetadas: number
  requerentesAfetados: number
  processosAfetados: number
  vinculosAlterados: number
  documentosRelacionados: number
  necessidadesRecalculadas: number
  inconsistenciasCriadas: number
  inconsistenciasResolvidas: number
  elegibilidadeAntes: string | null
  elegibilidadeDepois: string | null
  riscoDuplicidade: Severidade
  riscoDocumental: Severidade
  riscoOperacional: Severidade
  bloqueado: boolean
  motivoBloqueio: string | null
  detalhes: unknown
}

export interface DecisaoResumo {
  id: number
  decisao: string
  motivo: string
  permissao: string
  criadoEm: string
  responsavel?: { id: number; nome: string } | null
}

export interface PropostaDetalhe extends PropostaLista {
  operacao: unknown
  evidenciasFavoraveis: unknown
  evidenciasContrarias: unknown
  impactos: ImpactoResumo[]
  decisoes: DecisaoResumo[]
  conflitos: Array<{ id: number; codigo: string; severidade: Severidade; status: StatusConflito; descricao: string }>
  fato: {
    id: number
    campo: string
    estado: string
    confianca: string
    valorNormalizado: string | null
    evidencias: Array<{
      id: number
      documentoId: number
      metodoExtracao: string
      favoravel: boolean
      trechoTexto: string | null
      pagina: number | null
    }>
  } | null
  revertidaPor: { id: number; nome: string } | null
}

export interface ConflitoLista {
  id: number
  processoId: number
  codigo: string
  severidade: Severidade
  status: StatusConflito
  campo: string | null
  pessoaId: number | null
  uniaoId: number | null
  descricao: string
  explicacao: string
  acaoSugerida: string | null
  evidencias: unknown
  documentoIds: unknown
  criadoEm: string
  resolvidoEm: string | null
  resolucaoNota: string | null
  resolvidoPor: { id: number; nome: string } | null
  decisoes: DecisaoResumo[]
}

export interface LoteResumo {
  id: number
  status: string
  versaoMotor: string
  totalDocumentos: number
  processados: number
  falhos: number
  aguardando: number
  propostasCriadas: number
  conflitosAbertos: number
  evidenciasCriadas: number
  resumo: string | null
  criadoEm: string
  finalizadoEm: string | null
  criadoPor: { id: number; nome: string } | null
}

export interface LoteDetalhe extends LoteResumo {
  processoId: number
  arvoreId: number | null
  percentual: number
  distribuicaoEtapas: Array<{ etapa: string; quantidade: number }>
  execucoes: Array<{
    id: number
    documentoId: number
    etapa: string
    tipoDetectado: string | null
    confiancaTipo: number | null
    tentativas: number
    erro: string | null
    ocorrenciasDetectadas: number
    camposExtraidos: number
    camposDivergentes: number
    evidenciasCriadas: number
    finalizadoEm: string | null
  }>
}

export interface CaminhoLinhagemUI {
  ids: number[]
  geracoesSemComprovacao: number[]
  quebraEm: number | null
  comprovado: boolean
}

export interface LinhagemResposta {
  processoId: number
  arvoreId: number | null
  elegibilidade: {
    requerenteId: number | null
    ascendenteTransmissorId: number | null
    caminhoPrincipal: CaminhoLinhagemUI | null
    caminhosAlternativos: CaminhoLinhagemUI[]
    resultado: string
    explicacao: string
    pendencias: string[]
    conflitos: string[]
    comprovadoDocumentalmente: boolean
  }
  inconsistencias: Array<{
    codigo: string
    severidade: Severidade
    pessoaIds: number[]
    campo: string | null
    descricao: string
    explicacao: string
    acaoSugerida: string
    evidencias: string[]
  }>
  nomes: Array<{ id: number; nome: string }>
}

export interface RespostaCopilotoUI {
  intencao: string
  conclusao: string
  evidencias: string[]
  confianca: number
  pendencias: string[]
  origemDosDados: string[]
  semDados: boolean
}

// ---------------------------------------------------------------- rótulos

export const ROTULO_TIPO_PROPOSTA: Record<string, string> = {
  CONFIRMAR_DADO: "Confirmar dado",
  COMPLETAR_DADO: "Completar dado",
  CORRIGIR_DADO: "Corrigir dado",
  ADICIONAR_NOME_ALTERNATIVO: "Adicionar forma de nome",
  CRIAR_PESSOA: "Criar pessoa",
  VINCULAR_PESSOA_EXISTENTE: "Vincular a pessoa existente",
  CRIAR_RELACIONAMENTO: "Criar filiação",
  CORRIGIR_RELACIONAMENTO: "Corrigir filiação",
  REMOVER_RELACIONAMENTO: "Remover filiação",
  MESCLAR_PESSOAS: "Mesclar pessoas",
  SEPARAR_PESSOAS: "Separar pessoas",
  SATISFAZER_NECESSIDADE: "Satisfazer necessidade",
  REABRIR_NECESSIDADE: "Reabrir necessidade",
  CRIAR_NECESSIDADE: "Criar necessidade",
  MARCAR_DOCUMENTO_DIVERGENTE: "Marcar divergência",
  SOLICITAR_RETIFICACAO: "Solicitar retificação",
}

export const ROTULO_CRITICIDADE: Record<Criticidade, string> = {
  AUTOMATICA: "Automática",
  APROVACAO_HUMANA: "Aprovação humana",
  BLOQUEIO: "Bloqueio",
}

export const ROTULO_CAMPO_UI: Record<string, string> = {
  NOME_REGISTRAL: "Nome de registro",
  NOME_CASADO: "Nome de casado(a)",
  SEXO: "Sexo",
  DATA_NASCIMENTO: "Data de nascimento",
  LOCAL_NASCIMENTO: "Local de nascimento",
  PAIS_NASCIMENTO: "País de nascimento",
  FILIACAO_PAI: "Filiação — pai",
  FILIACAO_MAE: "Filiação — mãe",
  DATA_CASAMENTO: "Data do casamento",
  LOCAL_CASAMENTO: "Local do casamento",
  CONJUGE: "Cônjuge",
  DATA_OBITO: "Data do óbito",
  LOCAL_OBITO: "Local do óbito",
  DATA_BATISMO: "Data do batismo",
  LOCAL_BATISMO: "Local do batismo",
  PROFISSAO: "Profissão",
  NACIONALIDADE: "Nacionalidade",
  NATURALIZACAO: "Naturalização",
  IDADE_DECLARADA: "Idade declarada",
  RESIDENCIA_HISTORICA: "Residência histórica",
  REFERENCIA_REGISTRAL: "Referência registral",
  DATA_EMIGRACAO: "Data de emigração",
  IDENTIDADE_PESSOA: "Identidade da pessoa",
  IDENTIDADE_PAI: "Identidade do pai",
  IDENTIDADE_MAE: "Identidade da mãe",
  VINCULO_ASCENDENTE_TRANSMISSOR: "Vínculo com o ascendente transmissor",
}

export const ROTULO_RESULTADO_LINHA: Record<string, string> = {
  LINHA_COMPLETA_COMPROVADA: "Linha completa e comprovada",
  LINHA_COMPLETA_COM_PENDENCIAS: "Linha completa com pendências",
  LINHA_ESTRUTURAL_INCOMPLETA: "Linha estrutural incompleta",
  LINHA_CONFLITANTE: "Linha conflitante",
  ASCENDENTE_ELEGIVEL_NAO_IDENTIFICADO: "Ascendente elegível não identificado",
  REVISAO_OBRIGATORIA: "Revisão obrigatória",
}

export const ROTULO_ETAPA: Record<string, string> = {
  RECEBIDO: "Recebido",
  CLASSIFICANDO: "Classificando",
  EXTRAINDO: "Extraindo",
  REEXTRAINDO: "Reextraindo",
  NORMALIZANDO: "Normalizando",
  RESOLVENDO_IDENTIDADES: "Resolvendo identidades",
  CRUZANDO_EVIDENCIAS: "Cruzando evidências",
  VALIDANDO: "Validando",
  REVALIDANDO: "Revalidando",
  ANALISANDO_IMPACTO: "Analisando impacto",
  AGUARDANDO_REVISAO: "Aguardando revisão",
  APLICADO: "Aplicado",
  AUDITADO: "Auditado",
  FALHA_LEITURA: "Falha de leitura",
  DOCUMENTO_INSUFICIENTE: "Documento insuficiente",
  DOCUMENTO_CONFLITANTE: "Documento conflitante",
  REPROCESSAMENTO: "Reprocessamento",
  REJEITADO: "Rejeitado",
  CANCELADO: "Cancelado",
}

/** Tom do DS para cada severidade — cor só em ícone/badge, nunca em barra. */
export function tomDaSeveridade(s: Severidade): "danger" | "warning" | "neutral" {
  if (s === "CRITICO" || s === "ALTO") return "danger"
  if (s === "MEDIO") return "warning"
  return "neutral"
}

export function tomDaCriticidade(c: Criticidade): "danger" | "warning" | "success" {
  if (c === "BLOQUEIO") return "danger"
  if (c === "APROVACAO_HUMANA") return "warning"
  return "success"
}

export function tomDoStatus(s: StatusProposta): "success" | "danger" | "warning" | "neutral" {
  if (s === "APLICADA") return "success"
  if (s === "REJEITADA" || s === "ABORTADA") return "danger"
  if (s === "PENDENTE" || s === "ADIADA") return "warning"
  return "neutral"
}

/** Lista de evidências vinda do JSON, tolerante a formato inesperado. */
export function evidenciasDe(v: unknown): EvidenciaResumo[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
    .map((x) => ({
      campo: String(x.campo ?? ""),
      descricao: String(x.descricao ?? ""),
      favoravel: x.favoravel !== false,
      peso: Number(x.peso ?? 1),
    }))
}

export function idsDe(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  // `Number(null)` é 0, e `Number.isFinite(0)` é true: sem descartar nulo antes,
  // um buraco na lista viraria "pessoa #0" na tela.
  return v
    .filter((x) => x != null && x !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
}
