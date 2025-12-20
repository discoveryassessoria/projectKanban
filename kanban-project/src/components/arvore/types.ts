// ========================================
// TIPOS CENTRALIZADOS - ÁRVORE GENEALÓGICA
// ========================================

export interface PessoaArvore {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  
  // Datas
  data_nasc?: Date | string | null
  data_obito?: Date | string | null
  
  // Local de nascimento
  local_nasc?: string | null
  estado_nasc?: string | null
  pais_nasc?: string | null
  
  // Local de óbito
  local_obito?: string | null
  
  // Status vital
  vivo?: boolean
  
  // Batismo
  batizado?: string | null
  data_batismo?: Date | string | null
  local_batismo?: string | null
  igreja_batismo?: string | null
  
  // Profissão e nacionalidade
  profissao?: string | null
  nacionalidade?: string | null
  cidadanias_outras?: string | null
  
  // Naturalização
  naturalizado?: boolean
  data_naturalizacao?: Date | string | null
  pais_naturalizacao?: string | null
  
  // Emigração/Imigração
  data_emigracao?: Date | string | null
  local_emigracao?: string | null
  porto_embarque?: string | null
  data_chegada?: Date | string | null
  porto_chegada?: string | null
  pais_destino?: string | null
  navio?: string | null
  
  // Notas
  comentario?: string | null
  
  // Posição no canvas
  x?: number | null
  y?: number | null
  
  // IDs
  arvoreId?: number
  paiId?: number | null
  maeId?: number | null
  pid?: string | null
  
  // Timestamps
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
  
  // Relacionamentos
  pai?: PessoaArvore | null
  mae?: PessoaArvore | null
  filhosComoPai?: PessoaArvore[]
  filhosComoMae?: PessoaArvore[]
  unioesComoPessoa1?: UniaoArvore[]
  unioesComoPessoa2?: UniaoArvore[]
  documentos?: DocumentoArvore[]
}

export interface UniaoArvore {
  id: number
  data_inicio?: Date | string | null
  data_fim?: Date | string | null
  tipo?: string | null
  local?: string | null
  estado?: string | null
  pais?: string | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  numero_registro?: string | null
  observacoes?: string | null
  pessoa1Id?: number
  pessoa2Id?: number
  pessoa1?: PessoaArvore
  pessoa2?: PessoaArvore
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
}

export interface DocumentoArvore {
  id: number
  tipo: string
  descricao?: string | null
  status: string
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  data_emissao?: Date | string | null
  data_evento?: Date | string | null
  arquivo_url?: string | null
  traduzido?: boolean
  apostilado?: boolean
  data_traducao?: Date | string | null
  data_apostilamento?: Date | string | null
  observacoes?: string | null
  pessoaId?: number
  pessoa?: PessoaArvore
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
}

export type ViewMode = 'paisagem' | 'retrato'