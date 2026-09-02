// src/lib/relatorios/motor/tipos.ts
//
// O CONTRATO DO MOTOR DE RELATÓRIOS.
//
// ─── A IDEIA ────────────────────────────────────────────────────────────────
// "Todos os protocolos de janeiro de 2023" NÃO é um relatório. É o domínio
// Protocolos com um filtro de período. "Protocolos italianos de janeiro no
// Tribunal de Roma agrupados por família" também não é: é o MESMO domínio com
// mais três escolhas.
//
// Por isso aqui não existe lista de relatórios. Existem POUCOS domínios, cada um
// declarando o que se pode perguntar sobre ele: filtros, agrupamentos, colunas.
// A pergunta do usuário vira uma `QuerySpec`, e é o motor que a traduz para o
// banco. Pergunta nova não custa código.
//
// ─── POR QUE TUDO É DECLARADO ───────────────────────────────────────────────
// Nada de SQL solto. Um filtro só existe se o domínio o declarou, e é ele quem
// diz COMO se traduz. Isso não é burocracia: é o que impede o relatório de virar
// uma segunda porta de acesso ao banco, sem permissão e sem regra.

/** O que uma linha do resultado É. Declarar isso impede JOIN que multiplica. */
import type { PermissaoChave } from "@/src/lib/permissoes"

export type Grain = string

export type TipoDeFiltro =
  | "texto"          // busca textual (contains, sem acento quando o banco permite)
  | "numero"
  | "intervalo_numero"
  | "data"
  | "intervalo_data"
  | "booleano"
  | "selecao"        // uma opção
  | "multi_selecao"  // várias opções
  | "entidade"       // busca uma entidade e guarda o ID

/**
 * De onde saem as opções de um filtro. NUNCA de um array escrito à mão: ou é um
 * catálogo fechado do domínio (situação de protocolo, por exemplo, que é enum de
 * negócio) ou é uma consulta ao Cadastro Mestre.
 */
export type FonteDeOpcoes =
  | { tipo: "catalogo"; valores: { valor: string; rotulo: string }[] }
  | { tipo: "cadastro"; chave: string }

export interface FiltroDef {
  /** Chave estável — entra na visão salva e no deep-link. Nunca renomear. */
  key: string
  rotulo: string
  tipo: TipoDeFiltro
  /**
   * DATA PRECISA TER SEMÂNTICA. "Data" sozinho é ambíguo: em Protocolos existe
   * a data do ato e a data da situação; em Processos, entrada e conclusão.
   * O rótulo diz qual é, e a chave também.
   */
  descricao?: string
  opcoes?: FonteDeOpcoes
  /**
   * Traduz o valor escolhido para o `where` do Prisma.
   *
   * Pode ser assíncrono pela mesma razão do recorte de nacionalidade: onde não
   * existe relação declarada, o filtro resolve os ids antes numa consulta e
   * devolve um `in` — em vez de fingir uma relação que o schema não tem.
   */
  paraWhere: (valor: ValorDeFiltro) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>
}

export type ValorDeFiltro =
  | { tipo: "texto"; texto: string }
  | { tipo: "numero"; numero: number }
  | { tipo: "intervalo_numero"; min?: number | null; max?: number | null }
  | { tipo: "data"; data: string }
  | { tipo: "intervalo_data"; de?: string | null; ate?: string | null }
  | { tipo: "booleano"; valor: boolean }
  | { tipo: "selecao"; valor: string }
  /** `rotulos` é só apresentação: o resumo mostra "Estados Unidos", não "11". */
  | { tipo: "multi_selecao"; valores: string[]; rotulos?: string[] }
  | { tipo: "entidade"; id: number; rotulo?: string }

export interface ColunaDef {
  key: string
  rotulo: string
  /** Extrai o valor de exibição da linha crua que o domínio carregou. */
  valor: (linha: any) => string | number | null
  /** Para onde a célula leva. Drill-down é do sistema, não do relatório. */
  link?: (linha: any) => string | null
  alinhamento?: "esquerda" | "direita"
  /** Coluna numérica que faz sentido somar no rodapé de um grupo. */
  somavel?: boolean
  /**
   * PERMISSÃO ALÉM DA DO DOMÍNIO. Um domínio expõe UMA permissão, mas nem toda
   * coluna dele pertence ao mesmo assunto: "Certidões" abre com `processos.ver`
   * e trazia a coluna "Custo pago" junto — dinheiro liberado para quem só podia
   * ver processo. Declarada aqui, a coluna é REMOVIDA do resultado de quem não
   * tem a permissão, e com ela somem o filtro e a ordenação correspondentes.
   */
  permissao?: PermissaoChave
}

export interface AgrupamentoDef {
  key: string
  rotulo: string
  /** Chave do grupo a que a linha pertence, e como ele se chama na tela. */
  de: (linha: any) => { chave: string; rotulo: string }
}

export interface OrdenacaoDef {
  key: string
  rotulo: string
  orderBy: (direcao: "asc" | "desc") => Record<string, unknown> | Record<string, unknown>[]
}

/**
 * O QUE O USUÁRIO PERGUNTOU. É só configuração — nunca resultado. É isto que a
 * visão salva guarda, e é por isso que reabrir uma visão devolve dado fresco em
 * vez de uma fotografia velha.
 */
export interface QuerySpec {
  dominio: string
  /**
   * CONTEXTO DE NACIONALIDADE — a `countryKey` da oferta, ou null para todas.
   * É uma dimensão global porque a operação inteira se divide assim.
   */
  nacionalidade?: string | null
  filtros: { key: string; valor: ValorDeFiltro }[]
  agruparPor?: string | null
  colunas?: string[]
  ordenarPor?: string | null
  direcao?: "asc" | "desc"
  pagina?: number
  porPagina?: number
}

export interface DominioDef {
  key: string
  rotulo: string
  /** A pergunta que este domínio responde, em uma linha. */
  descricao: string
  /** 1 linha = ? — declarado, e verificado pelo teste de consistência. */
  grain: Grain
  /**
   * A NACIONALIDADE PODE MUDAR A UNIDADE REAL.
   *
   * Itália protocola o processo inteiro (um ricorso cobre a família); Espanha
   * protocola por pessoa (um expediente por requerente). É a MESMA tabela e a
   * mesma consulta — o que muda é o que cada linha significa, e o operador
   * precisa ler isso na tela.
   *
   * A diferença NÃO sai de `if (pais)`: sai de
   * `ModalidadeLegal.cardinalidadeRequerimento`, que é cadastro. Nacionalidade
   * nova entra com a cardinalidade dela e o texto se ajusta sozinho.
   */
  grainNoContexto?: (countryKey: string | null) => Promise<string>
  /** Tipada pelo catálogo de permissões: chave inventada não compila. */
  permissao: PermissaoChave
  /** Ordem na home. */
  ordem: number
  /**
   * A QUE ASSUNTO ESTE DOMÍNIO PERTENCE.
   *
   * Dezessete cartões iguais numa grade não são uma navegação: são dezessete
   * coisas do mesmo tamanho, e quem chega não sabe por onde começar. O grupo dá
   * a hierarquia que faltava — "documentação" reúne Certidões, Documentos e
   * Completude porque quem procura uma procura as três.
   */
  grupo: string
  /** O domínio aceita o contexto de nacionalidade? */
  aceitaNacionalidade: boolean
  filtros: FiltroDef[]
  agrupamentos: AgrupamentoDef[]
  colunas: ColunaDef[]
  ordenacoes: OrdenacaoDef[]
  /** Com que colunas a exploração começa. O usuário troca à vontade. */
  colunasIniciais: string[]
  /**
   * OS FILTROS QUE FICAM À MOSTRA.
   *
   * O resto vive atrás de "+ Adicionar filtro". Estes não: são os que a pessoa
   * usa toda vez que abre a tela, e obrigá-la a caçar o período dentro de um
   * dropdown para responder "o que foi protocolado em janeiro" é transformar a
   * pergunta mais comum na mais trabalhosa.
   *
   * Ordem importa: é a ordem em que aparecem na barra.
   */
  filtrosPrincipais: string[]
  ordenacaoPadrao: { key: string; direcao: "asc" | "desc" }
  /**
   * Recorte da nacionalidade escolhida, na linguagem deste domínio.
   *
   * É ASSÍNCRONO porque nem toda tabela tem relação declarada para Processo —
   * `ObrigacaoEconomica`, por exemplo, guarda só o `processoId` escalar. Esses
   * domínios resolvem os ids numa consulta e devolvem um `in`, em vez de
   * inventar uma relação que o schema não tem.
   */
  ondeNacionalidade: (countryKey: string) => Record<string, unknown> | Promise<Record<string, unknown>>
  /** Conta e carrega. O motor cuida de where/paginação; o domínio, do include. */
  contar: (where: any) => Promise<number>
  carregar: (where: any, orderBy: any, pular: number, levar: number) => Promise<any[]>
  /** Visões prontas — QuerySpecs pré-salvas, não relatórios separados. */
  visoesDoSistema: { key: string; nome: string; spec: Omit<QuerySpec, "dominio"> }[]
}
