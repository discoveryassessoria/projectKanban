// src/lib/gerenciamento/cadastros-registry.ts
//
// REGISTRO ÚNICO dos cadastros simples do Gerenciamento (26/07/2026).
// Uma só declaração alimenta a API genérica (/api/gerenciamento/cadastros/[entidade])
// e a tela genérica (CadastroGenericoTab) — não existe spec duplicada entre
// backend e frontend, nem CRUD copiado 8 vezes.
//
// Só entram aqui CADASTROS PUROS (lista + criar/editar/ativar/excluir). Qualquer
// cadastro com regra de negócio própria continua na sua tela dedicada.

export type CampoTipo = "text" | "textarea" | "number" | "bool" | "select" | "multiselect"

export interface CampoSpec {
  key: string
  label: string
  tipo: CampoTipo
  obrigatorio?: boolean
  /** opções fixas do select (valor = rótulo quando string) */
  opcoes?: { valor: string; label: string }[]
  /** select/multiselect alimentado por outra fonte (ver FONTES) */
  fonte?: string
  ajuda?: string
  /** não editável depois de criado (identidade estável) */
  imutavel?: boolean
  /**
   * Campo administrado pelo SISTEMA: aparece só para leitura e nunca é aceito
   * do cliente. Usado pelo `code` (gerado do nome) e pela `ordem` (posição).
   */
  somenteLeitura?: boolean
  /** largura no formulário */
  largura?: "meia" | "cheia"
}

export interface ColunaSpec { key: string; label: string }

export interface CadastroSpec {
  /** slug da rota: /api/gerenciamento/cadastros/<entidade> */
  entidade: string
  /** delegate do Prisma (nome da propriedade em prisma.*) */
  model: string
  titulo: string
  /** Nome do registro no singular, para o título do modal ("Nova <singular>"). */
  singular?: string
  descricao: string
  /** rótulo do botão de criação */
  novoLabel: string
  colunas: ColunaSpec[]
  campos: CampoSpec[]
  /** campo usado para gerar `code` automaticamente quando vazio */
  codeDe?: string
  /**
   * Campo textual que IDENTIFICA o registro para o operador. Duplicidade é
   * recusada por equivalência semântica (sem caixa, acento ou espaço excedente).
   */
  identidade?: string
  /**
   * Posição administrada pelo sistema: nasce no fim e é reordenada por arrasto
   * (ou pelos botões de mover). O operador nunca digita número de ordem.
   */
  ordenavel?: boolean
  /** Nome da entidade na trilha de auditoria. Sem isto, não se audita. */
  auditoria?: string
  /**
   * Vínculos que IMPEDEM exclusão física. Havendo qualquer um, a API recusa a
   * exclusão e orienta a inativar — o histórico nunca é quebrado.
   */
  protegerExclusao?: { model: string; campo: string; rotulo: string }[]
  /** ordenação padrão da listagem */
  ordenarPor?: { campo: string; direcao: "asc" | "desc" }[]
  /** relação N:N gerida junto do registro (ex.: membros do grupo) */
  relacao?: {
    /** propriedade de relação no modelo */
    prop: string
    /** modelo da tabela de vínculo */
    model: string
    /** coluna que aponta para este cadastro */
    campoPai: string
    /** coluna que aponta para o alvo */
    campoAlvo: string
    /** chave do campo no formulário */
    campoForm: string
  }
}

/** Fontes de opções resolvidas pelo backend (somente leitura, sem dado sensível). */
export const FONTES: Record<string, {
  model: string
  valor: string
  label: string[]
  where?: Record<string, unknown>
  /**
   * O valor da opção é um ID numérico (FK Int), não um code de texto.
   *
   * Sem isto o motor gravava String num campo Int e o Prisma recusava. Estava
   * hard-coded para `tiposProcesso` — a segunda fonte numérica que entrasse
   * quebraria em silêncio até alguém tentar salvar.
   */
  valorNumerico?: boolean
  orderBy?: Record<string, unknown>[]
}> = {
  tiposProcesso: { model: "tipoProcessoNacionalidade", valor: "id", label: ["name"], where: { arquivado: false }, valorNumerico: true },
  paises: { model: "catalogoPais", valor: "id", label: ["countryLabel"], where: { ativo: true }, valorNumerico: true },
  modalidadesLegais: { model: "modalidadeLegal", valor: "id", label: ["nome"], where: { ativo: true }, valorNumerico: true },
  fases: { model: "catalogoFase", valor: "phaseKey", label: ["label"], where: { ativo: true } },
  // NOME + E-MAIL: dois funcionários homônimos ficavam indistinguíveis no
  // seletor, e escolher a pessoa errada para uma equipe é um erro silencioso —
  // ninguém percebe até o trabalho ir para quem não devia.
  usuarios: { model: "usuario", valor: "id", label: ["nome", "email"] },
  // MODELO DE MENSAGEM (e-mail/mensagem de notificação) — NÃO é modelo documental.
  // O repositório de modelos documentais (DOCX versionado) é outro domínio e vive
  // em ModeloDocumental. O nome distinto existe para que ninguém confunda os dois.
  modelosMensagem: { model: "modeloDocumento", valor: "code", label: ["nome"], where: { ativo: true } },
}

const CAMPOS_BASE: CampoSpec[] = [
  // Código é do SISTEMA em todos os cadastros: gerado do nome na criação,
  // exibido só para leitura e imutável depois — identidade não segue rótulo.
  { key: "code", label: "Código", tipo: "text", ajuda: "Gerado automaticamente a partir do nome. Identificador oficial e imutável.", imutavel: true, somenteLeitura: true, largura: "meia" },
  { key: "ativo", label: "Ativo", tipo: "bool", largura: "meia" },
]

export const CADASTROS: Record<string, CadastroSpec> = {
  // ── Serviços › Categorias ──────────────────────────────────────────────────
  "categorias-servico": {
    entidade: "categorias-servico",
    model: "categoriaServico",
    titulo: "Categorias de Serviço",
    singular: "categoria de serviço",
    descricao:
      "Organizam o Catálogo de Serviços. Categoria não guarda preço — valores pertencem exclusivamente à Tabela de Valores do Financeiro.",
    novoLabel: "+ Nova categoria",
    // Identidade e ordem são do SISTEMA: o operador digita nome e descrição, e
    // mais nada. Código sai do nome; posição sai do arrasto na listagem.
    codeDe: "nome",
    identidade: "nome",
    ordenavel: true,
    auditoria: "CategoriaServico",
    protegerExclusao: [
      { model: "itemCatalogo", campo: "categoriaId", rotulo: "itens do catálogo" },
    ],
    ordenarPor: [{ campo: "ordem", direcao: "asc" }, { campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Categoria" },
      { key: "code", label: "Código" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome da categoria", tipo: "text", obrigatorio: true, largura: "cheia" },
      {
        key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia",
        ajuda: "O que esta categoria agrupa no Catálogo de Serviços.",
      },
      ...CAMPOS_BASE,
    ],
  },

  // ── Órgãos e Organizações › Categorias ─────────────────────────────────────
  "categorias-organizacao": {
    entidade: "categorias-organizacao",
    model: "categoriaOrganizacao",
    titulo: "Categorias de Organização",
    descricao:
      "Classificam as entidades institucionais (cartório, consulado, tribunal, banco, tradutor, parceiro…). Uma organização pode ter várias categorias — não se cria cadastro separado por tipo de órgão.",
    novoLabel: "+ Nova categoria",
    // Identidade e ordem são do SISTEMA: o operador digita nome e descrição, e
    // mais nada. Código sai do nome; posição sai do arrasto na listagem.
    codeDe: "nome",
    identidade: "nome",
    ordenavel: true,
    auditoria: "CategoriaServico",
    protegerExclusao: [
      { model: "itemCatalogo", campo: "categoriaId", rotulo: "itens do catálogo" },
    ],
    ordenarPor: [{ campo: "ordem", direcao: "asc" }, { campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Categoria" },
      { key: "code", label: "Código" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome da categoria", tipo: "text", obrigatorio: true, largura: "cheia" },
      {
        key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia",
        ajuda: "O que esta categoria agrupa no Catálogo de Serviços.",
      },
      ...CAMPOS_BASE,
    ],
  },

  // ── Processos › Modalidades Legais ────────────────────────────────────────
  // A BASE JURÍDICA da rota. É aqui que mora a regra que decide se o
  // requerimento é individual ou coletivo — e ela precisava ser editável pela
  // operação, não por deploy: a tela do processo manda "declare em Gerenciamento"
  // quando a rota não tem modalidade, e essa frase só é honesta se a tela existir.
  "modalidades-legais": {
    entidade: "modalidades-legais",
    model: "modalidadeLegal",
    titulo: "Modalidades Legais",
    singular: "modalidade legal",
    descricao:
      "A base jurídica sob a qual a cidadania é requerida (Lei da Memória Democrática, Processo Judicial…). É a modalidade que decide se o requerimento é INDIVIDUAL — um por requerente, como no consulado espanhol — ou COLETIVO — um só para a família, como no ricorso ao tribunal italiano.",
    novoLabel: "+ Nova modalidade",
    codeDe: "nome",
    identidade: "nome",
    ordenavel: true,
    auditoria: "ModalidadeLegal",
    // Modalidade em uso não some: os enquadramentos dela — e, por eles, os
    // processos — ficariam sem base jurídica declarada.
    protegerExclusao: [
      { model: "enquadramentoLegal", campo: "modalidadeLegalId", rotulo: "enquadramentos legais" },
    ],
    ordenarPor: [{ campo: "ordem", direcao: "asc" }, { campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Modalidade" },
      { key: "code", label: "Código" },
      { key: "cardinalidadeRequerimento", label: "Requerimento" },
    ],
    campos: [
      { key: "nome", label: "Nome da modalidade", tipo: "text", obrigatorio: true, largura: "cheia" },
      { key: "paisId", label: "País", tipo: "select", fonte: "paises", obrigatorio: true, largura: "meia" },
      {
        key: "cardinalidadeRequerimento", label: "Requerimento", tipo: "select", obrigatorio: true, largura: "meia",
        opcoes: [
          { valor: "INDIVIDUAL", label: "Individual — um requerimento por requerente" },
          { valor: "COLETIVO", label: "Coletivo — um requerimento para vários requerentes" },
        ],
        ajuda: "Define o que a aba Protocolos do processo oferece: um requerente ou a lista inteira.",
      },
      { key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia" },
      ...CAMPOS_BASE,
    ],
  },

  // ── Processos › Enquadramentos Legais ─────────────────────────────────────
  // O recorte oficial dentro da modalidade (Anexo I, Anexo III…). O processo
  // aponta para o enquadramento, e é por ele que se chega na modalidade e na
  // regra — uma FK só carregando as três dimensões, sem campo redundante.
  "enquadramentos-legais": {
    entidade: "enquadramentos-legais",
    model: "enquadramentoLegal",
    titulo: "Enquadramentos Legais",
    singular: "enquadramento legal",
    descricao:
      "O recorte oficial dentro da modalidade legal (Anexo I, Anexo III…). Quando a rota não tem recortes, o enquadramento é um só e leva o nome da própria modalidade. O processo aponta para o enquadramento — é por ele que o sistema chega na base jurídica e na regra do requerimento.",
    novoLabel: "+ Novo enquadramento",
    codeDe: "nome",
    identidade: "nome",
    ordenavel: true,
    auditoria: "EnquadramentoLegal",
    protegerExclusao: [
      { model: "processo", campo: "enquadramentoLegalId", rotulo: "processos" },
    ],
    ordenarPor: [{ campo: "ordem", direcao: "asc" }, { campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Enquadramento" },
      { key: "code", label: "Código" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome do enquadramento", tipo: "text", obrigatorio: true, largura: "cheia" },
      {
        key: "modalidadeLegalId", label: "Modalidade legal", tipo: "select", fonte: "modalidadesLegais",
        obrigatorio: true, largura: "cheia",
        ajuda: "A base jurídica a que este recorte pertence. É dela que vem a regra do requerimento.",
      },
      { key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia" },
      ...CAMPOS_BASE,
    ],
  },

  // ── Documentos e Protocolos › Tipos de Protocolo ──────────────────────────
  // A regra "protocolo NÃO é cadastro" continua de pé: o ATO é uma ocorrência
  // dentro do processo. O que é cadastro aqui é a CLASSIFICAÇÃO do ato — antes
  // um enum de 7 valores fixos, que obrigava deploy para a operação registrar um
  // tipo novo e não tinha descrição, ordem nem inativação.
  "tipos-protocolo": {
    entidade: "tipos-protocolo",
    model: "tipoProtocoloCadastro",
    titulo: "Tipos de Protocolo",
    singular: "tipo de protocolo",
    descricao:
      "Classificam o ato de protocolar (consular, judicial, comune, cartório…). O protocolo em si continua sendo registrado dentro do processo, na aba Protocolos — aqui vive apenas a lista de tipos que aquela tela oferece.",
    novoLabel: "+ Novo tipo",
    codeDe: "nome",
    identidade: "nome",
    ordenavel: true,
    auditoria: "TipoProtocoloCadastro",
    // Tipo em uso não some do histórico: protocolo já registrado ficaria sem
    // classificação, e o relatório por tipo passaria a mentir.
    protegerExclusao: [
      { model: "protocolo", campo: "tipoProtocoloId", rotulo: "protocolos registrados" },
    ],
    ordenarPor: [{ campo: "ordem", direcao: "asc" }, { campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Tipo" },
      { key: "code", label: "Código" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome do tipo", tipo: "text", obrigatorio: true, largura: "cheia" },
      {
        key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia",
        ajuda: "Quando a operação deve escolher este tipo ao registrar um protocolo.",
      },
      ...CAMPOS_BASE,
    ],
  },

  // ── Órgãos e Organizações › Profissionais › Categorias ────────────────────
  "categorias-profissional": {
    entidade: "categorias-profissional",
    model: "categoriaProfissional",
    titulo: "Categorias Profissionais",
    singular: "categoria",
    descricao:
      "As profissões que atuam nos processos: advogado, tradutor juramentado, despachante. " +
      "Um profissional aponta para uma delas — a profissão não é digitada, senão \"advogado\" e " +
      "\"Advogado\" viram duas.",
    novoLabel: "+ Nova categoria",
    codeDe: "nome",
    identidade: "nome",
    ordenavel: true,
    auditoria: "CategoriaProfissional",
    // QUEM ESTÁ EM USO NÃO SE APAGA: um profissional cadastrado com esta profissão
    // continua tendo de dizer qual ela é.
    protegerExclusao: [
      { model: "profissional", campo: "categoriaId", rotulo: "profissionais" },
    ],
    ordenarPor: [{ campo: "ordem", direcao: "asc" }, { campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Profissão" },
      { key: "code", label: "Código" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome da profissão", tipo: "text", obrigatorio: true, largura: "cheia" },
      {
        key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia",
        ajuda: "O que esta profissão faz nos processos.",
      },
      ...CAMPOS_BASE,
    ],
  },

  // ── Usuários e Acessos › Grupos › Equipes ──────────────────────────────────
  grupos: {
    entidade: "grupos",
    model: "grupoUsuario",
    titulo: "Equipes",
    descricao:
      "Agrupam usuários para organização e distribuição de trabalho. Grupo NÃO concede permissão — autorização continua em Perfis e Permissões.",
    novoLabel: "+ Nova equipe",
    ordenarPor: [{ campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Equipe" },
      { key: "code", label: "Código" },
      { key: "_membros", label: "Membros" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome da equipe", tipo: "text", obrigatorio: true, largura: "cheia" },
      { key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia" },
      { key: "membros", label: "Membros", tipo: "multiselect", fonte: "usuarios", largura: "cheia" },
      { key: "code", label: "Código", tipo: "text", largura: "meia" },
      { key: "ativo", label: "Ativo", tipo: "bool", largura: "meia" },
    ],
    relacao: { prop: "membros", model: "grupoUsuarioMembro", campoPai: "grupoId", campoAlvo: "usuarioId", campoForm: "membros" },
  },


  // ── Sistema › Modelos ─────────────────────────────────────────────────────
  // O cadastro genérico de "modelos de texto" (ModeloDocumento, com o conteúdo
  // numa coluna `conteudo`) foi REMOVIDO daqui: ele era um mecanismo paralelo de
  // template, e o texto oficial não mora em coluna de banco. O repositório
  // oficial é a tela própria `?screen=templates` (ModelosDocumentaisTab), sobre
  // ModeloDocumental + ModeloDocumentalVersao, com DOCX versionado e publicação
  // auditada. Não existe entrada `modelos` no motor genérico de cadastros.

  // ── Sistema › Comunicações › Notificações ──────────────────────────────────
  notificacoes: {
    entidade: "notificacoes",
    model: "regraNotificacao",
    titulo: "Notificações",
    descricao:
      "Quem é avisado, por qual canal e em qual gatilho. O cadastro é a fonte da regra; o disparo é feito pelo módulo que gera o evento.",
    novoLabel: "+ Nova notificação",
    codeDe: "nome",
    ordenarPor: [{ campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Notificação" },
      { key: "gatilho", label: "Gatilho" },
      { key: "entidade", label: "Entidade" },
      { key: "canais", label: "Canais" },
      { key: "destinatarios", label: "Destinatários" },
    ],
    campos: [
      { key: "nome", label: "Nome", tipo: "text", obrigatorio: true, largura: "cheia" },
      { key: "gatilho", label: "Gatilho", tipo: "text", obrigatorio: true, ajuda: "Ex.: phase.entered, tarefa.concluida, cobranca.enviada", largura: "cheia" },
      { key: "entidade", label: "Entidade", tipo: "text", largura: "meia" },
      { key: "canais", label: "Canais", tipo: "text", ajuda: "Ex.: email, sistema", largura: "meia" },
      { key: "destinatarios", label: "Destinatários", tipo: "text", ajuda: "Cargos, equipes ou e-mails separados por vírgula.", largura: "cheia" },
      { key: "modeloCode", label: "Modelo de mensagem", tipo: "select", fonte: "modelosMensagem", largura: "cheia" },
      ...CAMPOS_BASE,
    ],
  },
}

/** "Emissão de Certidões" → "emissao_de_certidoes" */
export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
}
