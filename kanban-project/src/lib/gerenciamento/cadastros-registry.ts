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
export const FONTES: Record<string, { model: string; valor: string; label: string[]; where?: Record<string, unknown> }> = {
  tiposProcesso: { model: "tipoProcessoNacionalidade", valor: "id", label: ["name"], where: { arquivado: false } },
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

  // ── Usuários e Acessos › Grupos › Cargos ───────────────────────────────────
  cargos: {
    entidade: "cargos",
    model: "cargoCadastro",
    titulo: "Cargos",
    descricao:
      "Papéis funcionais usados como responsável padrão em tarefas, workflows e automações. A autorização em si continua em Perfis e Permissões.",
    novoLabel: "+ Novo cargo",
    codeDe: "nome",
    ordenarPor: [{ campo: "nome", direcao: "asc" }],
    colunas: [
      { key: "nome", label: "Cargo" },
      { key: "code", label: "Chave" },
      { key: "area", label: "Área" },
      { key: "descricao", label: "Descrição" },
    ],
    campos: [
      { key: "nome", label: "Nome do cargo", tipo: "text", obrigatorio: true, largura: "cheia" },
      { key: "area", label: "Área", tipo: "text", largura: "meia" },
      { key: "descricao", label: "Descrição", tipo: "textarea", largura: "cheia" },
      ...CAMPOS_BASE,
    ],
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
