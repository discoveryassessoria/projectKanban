export interface Pessoa {
  id: number
  nome: string
  sobrenome?: string
  data_nasc?: Date
  local_nasc?: string
  data_obito?: Date
  batizado?: string
  arvoreId: number
  paiId?: number
  maeId?: number
  pai?: Pessoa
  mae?: Pessoa
  filhosComoPai?: Pessoa[]
  filhosComoMae?: Pessoa[]
  unioesComoPessoa1?: Uniao[]
  unioesComoPessoa2?: Uniao[]
}

export interface Uniao {
  id: number
  data_inicio?: Date
  data_fim?: Date
  tipo?: string
  pessoa1Id: number
  pessoa2Id: number
  pessoa1: Pessoa
  pessoa2: Pessoa
}

export interface Arvore {
  id: number
  nome: string
  descricao?: string
  pessoas: Pessoa[]
}

export interface TreeNode {
  id: string
  type: "person"
  position: { x: number; y: number }
  data: {
    pessoa: Pessoa
    onAddChild: (parentId: number) => void
    onAddParent: (childId: number, parentType: "pai" | "mae") => void
    onAddSpouse: (personId: number) => void
    onEdit: (pessoa: Pessoa) => void
    onDelete: (pessoaId: number) => void
  }
}

export interface TreeEdge {
  id: string
  source: string
  target: string
  type: "smoothstep"
  style: {
    stroke: string
    strokeWidth: number
  }
  label?: string
}
