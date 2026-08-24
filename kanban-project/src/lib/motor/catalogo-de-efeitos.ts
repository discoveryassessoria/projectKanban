// src/lib/motor/catalogo-de-efeitos.ts
// ============================================================================
// O QUE UMA AÇÃO CADASTRADA PODE FAZER — o catálogo fechado de efeitos.
//
// ─── POR QUE ELE EXISTE ─────────────────────────────────────────────────────
// O administrador precisa cadastrar resultados de negócio ("Aprovado com
// ressalvas", "Solicitar nova via") sem escrever código, e sem que cadastrar um
// resultado vire uma porta para fazer qualquer coisa com o banco. A ação
// cadastrada não descreve COMPORTAMENTO: ela aponta para um `effectKey` desta
// lista, e o comportamento continua sendo código revisado e testado.
//
// ─── O QUE UM EFEITO DECLARA ────────────────────────────────────────────────
// A chave, o que faz em português, a permissão exigida, os campos que precisa
// receber, e — decisivo — a COMPETÊNCIA que ele pressupõe. Decidir retificação é
// competência da Análise Documental; enquanto isso era um `case` no executor da
// Emissão, a Emissão decidia. Aqui o efeito diz de que competência ele é, e a
// publicação recusa colocá-lo numa fase que não a tem.
//
// ─── O QUE ELE NÃO É ────────────────────────────────────────────────────────
// Não é cadastro. Efeito é capacidade TÉCNICA: existe porque alguém escreveu o
// handler. Acrescentar um efeito é mudança de código, e deve ser. O que não pode
// exigir código é combinar os efeitos existentes de um jeito novo.
// ============================================================================

/** Competências operacionais. Uma fase declara as suas; o efeito exige a sua. */
export const COMPETENCIAS = {
  /** Pedir, aguardar, receber e conferir materialmente o documento. */
  EMISSAO: "EMISSAO",
  /** Comparar dados, registrar divergência e decidir se retifica. */
  ANALISE: "ANALISE",
  /** Executar a correção decidida pela análise. */
  RETIFICACAO: "RETIFICACAO",
  /** Andar com o processo; disponível a qualquer fase. */
  GERAL: "GERAL",
} as const
export type Competencia = (typeof COMPETENCIAS)[keyof typeof COMPETENCIAS]

export interface DefinicaoDeEfeito {
  key: string
  label: string
  /** O que acontece, em português do operador. Vai para a tela do administrador. */
  descricao: string
  competencia: Competencia
  /** Permissão exigida de quem executa. */
  permissao: string
  /** Campos que o efeito precisa receber preenchidos (chaves de `StepField`). */
  camposObrigatorios: string[]
  /** O efeito é seguro para repetir? Todos devem ser — declarado para não esquecer. */
  idempotente: boolean
  /** O efeito conclui o passo por si? Evita ação que "faz" e não fecha nada. */
  concluiPasso: boolean
  /**
   * Campos cujo VALOR passa a morar na entidade dona e por isso NÃO fica na execução.
   *
   * Sem esta lista, o payload guardaria uma cópia editável do que agora tem dono: o
   * operador corrigiria o protocolo no cadastro e a etapa continuaria mostrando o
   * número velho, sem ninguém para dizer qual está certo. A execução fica com a
   * referência; o valor, com quem responde por ele.
   */
  camposConsumidos?: string[]
  /**
   * O efeito NUNCA entra numa fase por herança de competência — só quando a fase o
   * declara nominalmente.
   *
   * `efeitosDaFase` devolve, para a fase que não gravou lista, TODOS os efeitos das
   * competências dela. Isso é razoável para "concluir a etapa" e "só registrar", e
   * deixa de ser no momento em que um efeito passa a ESCREVER numa entidade canônica:
   * acrescentar um efeito ao catálogo daria a oito fases, de uma vez, o poder de criar
   * protocolo — sem que ninguém tivesse pedido.
   */
  exigeAutorizacaoExplicita?: boolean
  /**
   * O ALVO DE REFERÊNCIA que o efeito precisa encontrar entre os campos do passo.
   *
   * Fica aqui, e não dentro do handler, para que a busca continue sendo por ESTRUTURA:
   * o handler pergunta ao catálogo o que procurar, em vez de trazer o nome do alvo
   * escrito no código.
   */
  alvoDeReferenciaEsperado?: string
}

export const CATALOGO_DE_EFEITOS: DefinicaoDeEfeito[] = [
  {
    key: "COMPLETE_STEP",
    label: "Concluir a etapa",
    descricao: "Fecha a etapa atual e libera as que dependem dela. Não mexe no documento.",
    competencia: COMPETENCIAS.GERAL,
    permissao: "tarefas.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: true,
  },
  {
    key: "MARK_DOCUMENT_RECEIVED",
    label: "Registrar o documento como recebido",
    descricao: "Marca o documento como RECEBIDO e conclui a etapa. É o fim material do pedido.",
    competencia: COMPETENCIAS.EMISSAO,
    permissao: "documentos.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: true,
  },
  {
    key: "APPROVE_FOR_ANALYSIS",
    label: "Aprovar e liberar para a Análise",
    descricao:
      "Encerra a conferência operacional aprovando o documento e o entrega à Análise Documental. " +
      "A Emissão não decide se há retificação — ela entrega o documento a quem decide.",
    competencia: COMPETENCIAS.EMISSAO,
    permissao: "documentos.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: true,
  },
  {
    key: "REQUEST_NEW_COPY",
    label: "Solicitar nova via",
    descricao:
      "Cria um documento NOVO derivado do atual e recomeça o pedido. O documento anterior " +
      "continua legível e a necessidade continua sendo a mesma — não se duplica necessidade.",
    competencia: COMPETENCIAS.EMISSAO,
    permissao: "documentos.editar",
    camposObrigatorios: ["motivo"],
    idempotente: true,
    concluiPasso: true,
  },
  {
    key: "REGISTER_DIVERGENCE",
    label: "Registrar divergência",
    descricao:
      "Anota uma divergência encontrada entre o documento e os demais registros, com a " +
      "criticidade informada. Registrar divergência NÃO decide retificação.",
    competencia: COMPETENCIAS.ANALISE,
    permissao: "documentos.editar",
    camposObrigatorios: ["descricao"],
    idempotente: true,
    concluiPasso: false,
  },
  {
    key: "GO_RETIFICATION",
    label: "Decidir pela retificação do registro",
    descricao:
      "Conclui que o registro precisa ser corrigido e ativa a fase de Retificação. " +
      "É a decisão jurídica da Análise Documental; nenhuma outra fase a toma.",
    competencia: COMPETENCIAS.ANALISE,
    permissao: "processos.editar",
    camposObrigatorios: ["justificativa"],
    idempotente: true,
    concluiPasso: true,
  },
  {
    key: "PAUSE_FOR_EXTERNAL_WAIT",
    label: "Marcar como aguardando terceiro",
    descricao:
      "A etapa fica parada esperando alguém de fora (cartório, consulado, tradutor). " +
      "O relógio interno pausa se o workflow estiver configurado para pausar.",
    competencia: COMPETENCIAS.GERAL,
    permissao: "tarefas.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: false,
  },
  {
    key: "RESUME",
    label: "Retomar",
    descricao: "Desfaz a espera externa e devolve a etapa ao fluxo normal.",
    competencia: COMPETENCIAS.GERAL,
    permissao: "tarefas.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: false,
  },
  {
    key: "COMPLETE_DOCUMENT",
    label: "Concluir o documento",
    descricao: "Dá o documento por pronto para o que o processo precisa dele. Conclui a etapa.",
    competencia: COMPETENCIAS.GERAL,
    permissao: "documentos.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: true,
  },
  {
    key: "INVALIDATE_DOCUMENT",
    label: "Invalidar o documento",
    descricao:
      "O documento não serve e não vai servir. Marca INVALIDO. Invalidado NÃO é concluído: " +
      "a obrigação continua aberta.",
    competencia: COMPETENCIAS.ANALISE,
    permissao: "documentos.editar",
    camposObrigatorios: ["motivo"],
    idempotente: true,
    concluiPasso: false,
  },
  {
    key: "REGISTER_PROTOCOL",
    label: "Registrar o protocolo",
    descricao:
      "Grava o protocolo no cadastro de Protocolos — número, data, órgão e responsável — e amarra a etapa a ele. " +
      "A etapa fica com a referência; o número mora no protocolo, que é o dono do fato.",
    // GERAL, e não RETIFICAÇÃO: protocolar é registrar um fato, não decidir nada.
    // Qualquer fase que entregue algo a um terceiro protocola, e amarrar o efeito a
    // uma competência faria a próxima precisar de um efeito gêmeo.
    competencia: COMPETENCIAS.GERAL,
    permissao: "processos.editar",
    // Sem número e sem data não há protocolo — não é preferência de tela, é o que
    // identifica o ato. O órgão vem do campo de referência quando o passo tiver um.
    camposObrigatorios: ["numero_protocolo", "data_protocolo"],
    idempotente: true,
    concluiPasso: true,
    // O número e a data passam a viver em `Protocolo`. O campo de referência ao órgão
    // NÃO entra aqui: ele já é uma referência, e referência não é cópia.
    camposConsumidos: ["numero_protocolo", "data_protocolo", "observacao_protocolo", "setor_do_orgao"],
    // NENHUMA FASE GANHA ISTO DE GRAÇA. Ele escreve em `Protocolo`; quem o quer,
    // declara. Sem esta linha, as fases que nunca gravaram lista de efeitos passariam
    // a poder protocolar só porque o efeito passou a existir.
    exigeAutorizacaoExplicita: true,
    alvoDeReferenciaEsperado: "ORGANIZACAO",
  },
  {
    key: "REGISTER_RETIFICATION_PLAN",
    label: "Definir o plano da retificação",
    descricao:
      "Grava no pedido de retificação o caminho escolhido (judicial ou administrativo) e, quando judicial, " +
      "o profissional responsável e o número do processo. A etapa fica com a referência; os dados moram no pedido.",
    competencia: COMPETENCIAS.RETIFICACAO,
    permissao: "processos.editar",
    // O MODO É O MÍNIMO. Profissional e número do processo são exigidos por REQUISITO
    // CONDICIONAL, não aqui — na via administrativa eles não existem, e um campo
    // obrigatório que some é um campo impossível de preencher.
    camposObrigatorios: ["modo"],
    idempotente: true,
    concluiPasso: true,
    // ESCREVE NO PEDIDO. Nenhuma fase ganha isso por herança de competência.
    exigeAutorizacaoExplicita: true,
    alvoDeReferenciaEsperado: "PROFISSIONAL",
    // O modo e o número do processo passam a morar no pedido, que é o dono deles.
    // O profissional NÃO entra aqui: referência não é cópia, e o ID continua na
    // execução como o que foi escolhido naquela tentativa.
    camposConsumidos: ["modo", "numero_processo_judicial"],
  },
  {
    key: "REGISTER_ONLY",
    label: "Somente registrar",
    descricao:
      "Grava o que foi preenchido na tentativa atual e não muda estado nenhum. " +
      "Serve para etapas de anotação, e para o administrador montar um passo que só coleta dados.",
    competencia: COMPETENCIAS.GERAL,
    permissao: "tarefas.editar",
    camposObrigatorios: [],
    idempotente: true,
    concluiPasso: false,
  },
]

const POR_CHAVE = new Map(CATALOGO_DE_EFEITOS.map((e) => [e.key, e]))

export function efeito(key: string): DefinicaoDeEfeito | null {
  return POR_CHAVE.get(key) ?? null
}

export function efeitoExiste(key: string): boolean {
  return POR_CHAVE.has(key)
}

/**
 * COMPETÊNCIA PADRÃO DE UMA FASE — o que ela pode fazer quando o cadastro ainda não
 * declarou nada.
 *
 * Este mapa NÃO é a fonte da competência: a fonte é `CatalogoFase.efeitosPermitidos`,
 * que o administrador edita. Ele existe para que as fases que já estão em produção
 * tenham competência declarada desde o primeiro instante, em vez de "sem restrição"
 * — que é como a decisão de retificação vazou para a Emissão. Uma fase nova criada
 * pelo administrador declara a sua na tela.
 */
export const COMPETENCIA_PADRAO_DA_FASE: Record<string, Competencia[]> = {
  emissao_documental: [COMPETENCIAS.EMISSAO, COMPETENCIAS.GERAL],
  emissao_retificada: [COMPETENCIAS.EMISSAO, COMPETENCIAS.GERAL],
  analise_documental: [COMPETENCIAS.ANALISE, COMPETENCIAS.GERAL],
  retificacao_registros: [COMPETENCIAS.RETIFICACAO, COMPETENCIAS.GERAL],
}

/** Os efeitos que uma fase pode usar, dada a lista declarada (ou o padrão). */
export function efeitosDaFase(phaseKey: string, declarados: unknown): string[] {
  if (Array.isArray(declarados) && declarados.every((x) => typeof x === "string")) {
    return declarados as string[]
  }
  // A HERANÇA POR COMPETÊNCIA NÃO ALCANÇA QUEM EXIGE AUTORIZAÇÃO NOMINAL. Uma fase
  // que não gravou lista recebe o que a competência dela permite — menos os efeitos
  // que só entram por decisão explícita de quem administra.
  const herdaveis = CATALOGO_DE_EFEITOS.filter((e) => !e.exigeAutorizacaoExplicita)
  const comps = COMPETENCIA_PADRAO_DA_FASE[phaseKey]
  if (!comps) return herdaveis.map((e) => e.key) // fase sem competência declarada
  return herdaveis.filter((e) => comps.includes(e.competencia)).map((e) => e.key)
}
