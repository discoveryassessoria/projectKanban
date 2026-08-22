// src/components/gerenciamentoComponents/tiposDoCadastroDoPasso.ts
//
// O VOCABULÁRIO DO CADASTRO DE UM PASSO — tipos e constantes compartilhados.
//
// Eles moram fora do modal porque passo e SUBTAREFA usam os mesmos: ação, campo,
// opção, item de checklist e requisito são as mesmas peças nos dois níveis. Cada
// arquivo declarando as suas faria a subtarefa divergir do passo em silêncio.

/**
 * OPÇÃO COM IDENTIDADE.
 *
 * `key` é o que a execução grava. Ele nasce do rótulo e depois NÃO muda: renomear
 * "Cartório" para "Cartório de origem" tem de deixar as escolhas antigas apontando
 * para a mesma opção. Tirar de circulação é `ativo: false`, não remover.
 */
export interface OpcaoCfg { key?: string; label: string; descricao?: string | null; ordem?: number; ativo?: boolean }

export interface AcaoCfg {
  key?: string; label: string; descricao?: string | null; effectKey: string
  ordem?: number; requerCampos?: string[]; permissao?: string | null
  condicao?: unknown; ativo?: boolean
}

export interface CampoCfg {
  key?: string; label: string; tipo: string; obrigatorio?: boolean
  opcoes?: unknown; opcoesCadastradas?: OpcaoCfg[]
  ajuda?: string | null; condicao?: unknown; ordem?: number; ativo?: boolean
}

export interface ItemCfg {
  key?: string; label: string; descricao?: string | null
  obrigatorio?: boolean; ordem?: number; ativo?: boolean
}

export interface RequisitoCfg {
  key?: string; label: string; descricao?: string | null
  tipo: string; alvoKey?: string | null; minimo?: number
  obrigatorio?: boolean; acaoKey?: string | null; condicao?: unknown
  /// EVIDÊNCIA — só faz sentido em `tipo = EVIDENCIA_ANEXADA`.
  evidenciaTipoId?: number | null
  mimesPermitidos?: string[] | null
  momento?: string
  ordem?: number; ativo?: boolean
}

/**
 * SUBTAREFA — o que acontece DENTRO do passo.
 *
 * Tem as mesmas peças do passo mais o que só ela tem: condições de entrada e
 * conclusão, dependência entre irmãs, repetição, e de onde vêm os canais quando ela
 * envia algo para fora.
 */
export interface SubtarefaCfg {
  key?: string
  label: string
  descricao?: string | null
  ordem?: number
  ativo?: boolean
  obrigatoria?: boolean
  repetivel?: boolean
  maxOcorrencias?: number | null
  modoExecucao?: string
  responsavelRegra?: string
  responsavelId?: number | null
  slaDays?: number | null
  condicaoEntrada?: unknown
  condicaoConclusao?: unknown
  condicaoVisibilidade?: unknown
  dependeDe?: string[]
  executorKey?: string | null
  cardinalidade?: string | null
  fonteDeCanais?: string
  tiposDeCanal?: string[]
  reaberturaPermitida?: boolean | null
  reaberturaExigeJustificativa?: boolean | null
  reaberturaPermissao?: string | null
  acoes?: AcaoCfg[]
  campos?: CampoCfg[]
  checkItens?: ItemCfg[]
  requisitos?: RequisitoCfg[]
}

/** Os tipos de requisito que o motor sabe avaliar. Vocabulário fechado, não texto livre. */
export const TIPOS_DE_REQUISITO = [
  { key: "CAMPO_PREENCHIDO", label: "Campo preenchido", alvo: "campo" },
  { key: "CHECKLIST_COMPLETO", label: "Checklist completo", alvo: "item" },
  { key: "EVIDENCIA_ANEXADA", label: "Evidência anexada", alvo: null },
  { key: "ACAO_EXECUTADA", label: "Ação já executada", alvo: "acao" },
] as const

/** De onde a subtarefa tira os canais. Vocabulário fechado, espelha o do servidor. */
export const FONTES_DE_CANAIS = [
  { key: "NENHUMA", label: "Não usa canal", ajuda: "Esta subtarefa não envia nada para fora." },
  { key: "FORNECEDOR_RELACIONADO", label: "Canais do fornecedor relacionado", ajuda: "Os canais que o órgão daquele documento realmente atende." },
  { key: "TIPOS_PERMITIDOS", label: "Só estes tipos, entre os do fornecedor", ajuda: "Restringe; nunca habilita canal que o fornecedor não atende." },
] as const

/** Como a subtarefa é executada. */
export const MODOS_DE_EXECUCAO = [
  { key: "MANUAL", label: "Alguém executa" },
  { key: "AUTOMATICA", label: "O motor conclui ao satisfazer a condição" },
] as const

/** De onde sai o responsável da subtarefa. */
export const REGRAS_DE_RESPONSAVEL = [
  { key: "HERDA", label: "Herda o do passo" },
  { key: "ESPECIFICO", label: "Pessoa específica" },
  { key: "REGRA", label: "Pela regra de elegibilidade" },
] as const

/** Como o passo decide que terminou. */
export const REGRAS_DE_CONCLUSAO = [
  { key: "ACAO_DO_PASSO", label: "Quando a ação do passo for executada", ajuda: "É o que sempre valeu. As subtarefas não travam a conclusão." },
  { key: "TODAS_SUBTAREFAS_OBRIGATORIAS", label: "Quando todas as subtarefas obrigatórias estiverem concluídas", ajuda: "Subtarefa escondida por condição não é cobrada — ela está fora de escopo, não cumprida." },
  { key: "QUALQUER_SUBTAREFA", label: "Quando qualquer subtarefa for concluída", ajuda: "Para passos em que os caminhos são alternativos." },
] as const

/**
 * OS TIPOS DE CAMPO, com nome humano.
 *
 * A chave é o vocabulário do motor (`TIPOS_DE_CAMPO` do registro de executores) e não
 * muda. O que muda é o que o administrador lê: "textarea" e "upload" são palavras de
 * quem escreve o formulário, não de quem configura o negócio. A lista aqui é
 * APRESENTAÇÃO — quem decide quais tipos existem continua sendo o executor, e um tipo
 * que ele suporte e não esteja aqui aparece pela própria chave, sem sumir da tela.
 */
export const NOME_DO_TIPO_DE_CAMPO: Record<string, string> = {
  texto: "Texto curto",
  textarea: "Texto longo",
  numero: "Número",
  moeda: "Valor monetário",
  data: "Data",
  booleano: "Sim/Não",
  checkbox: "Caixa de marcação",
  select: "Seleção única",
  multiselect: "Seleção múltipla",
  radio: "Escolha entre opções",
  upload: "Arquivo/Evidência",
}
export function nomeDoTipoDeCampo(tipo: string): string {
  return NOME_DO_TIPO_DE_CAMPO[tipo] ?? tipo
}
/** Os tipos que oferecem opções ao operador. */
export const TIPOS_COM_OPCOES = ["select", "multiselect", "radio"]

/**
 * A CARDINALIDADE, explicada.
 *
 * A enum canônica não muda — o que faltava era dizer o que cada valor PRODUZ. "PESSOA"
 * não informa nada a quem configura; "uma unidade por pessoa aplicável da árvore"
 * informa tudo.
 */
export const CARDINALIDADES = [
  { key: "", label: "Herda o escopo da fase", ajuda: "O escopo operacional declarado no catálogo da fase decide quantas unidades existem." },
  { key: "PROCESSO", label: "Uma vez por processo", ajuda: "Uma única unidade deste passo por visita à fase." },
  { key: "PESSOA", label: "Uma vez por pessoa", ajuda: "Será criada uma unidade para cada pessoa aplicável da árvore." },
  { key: "NECESSIDADE", label: "Uma vez por registro a localizar", ajuda: "Uma unidade para cada necessidade documental — cada registro que precisa ser encontrado." },
  { key: "DOCUMENTO", label: "Uma vez por documento", ajuda: "Será criada uma unidade deste passo para cada documento aplicável." },
] as const

/** A prioridade, no vocabulário que o modelo realmente admite (low | medium | high). */
export const PRIORIDADES = [
  { key: "low", label: "Baixa" },
  { key: "medium", label: "Média" },
  { key: "high", label: "Alta" },
] as const

/**
 * AS CINCO ÁREAS DO CONFIGURADOR — a ordem em que o administrador pensa.
 *
 * A tela estava organizada pela estrutura interna do motor: onze abas de primeiro
 * nível, uma por tabela. Quem configura não pergunta "onde fica o requisito"; pergunta
 * o que é o passo, o que se faz nele, o que precisa estar cumprido, o que pode
 * acontecer, e que regras especiais existem. As áreas seguem essa ordem.
 */
export const AREAS = [
  { key: "geral", label: "Geral", ajuda: "Defina o que é este passo, sua obrigatoriedade, escopo e responsável." },
  { key: "execucao", label: "Execução", ajuda: "Defina o que o operador precisa fazer." },
  { key: "conclusao", label: "Conclusão", ajuda: "Defina o que precisa estar cumprido para finalizar." },
  { key: "resultados", label: "Resultados", ajuda: "Defina quais decisões ou resultados podem ser registrados." },
  { key: "avancado", label: "Avançado", ajuda: "Dependências, executor técnico e regras especiais." },
] as const
export type AreaDoPasso = (typeof AREAS)[number]["key"]

/** Chave estável a partir do rótulo — a mesma regra do servidor. */
export function chaveDe(s: string) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 60)
}
