// ========================================
// ENUM DE PAÍSES - FIXO NO CÓDIGO
// ========================================
export enum Pais {
  PORTUGAL = 'PORTUGAL',
  ESPANHA = 'ESPANHA',
  ALEMANHA = 'ALEMANHA',
  ITALIA = 'ITALIA'
}

// Enum de Prioridade de Tarefa
export enum PrioridadeTarefa {
  BAIXA = 'BAIXA',
  MEDIA = 'MEDIA',
  ALTA = 'ALTA',
  URGENTE = 'URGENTE'
}

// Configuração visual de cada país (cores, ícones, etc)
export const PAISES_CONFIG: Record<Pais, {
  label: string
  bandeira: string
  cor: string
  corClara: string
}> = {
  [Pais.PORTUGAL]: {
    label: 'Portugal',
    bandeira: '🇵🇹',
    cor: '#006600',
    corClara: '#00660020'
  },
  [Pais.ESPANHA]: {
    label: 'Espanha',
    bandeira: '🇪🇸',
    cor: '#c60b1e',
    corClara: '#c60b1e20'
  },
  [Pais.ALEMANHA]: {
    label: 'Alemanha',
    bandeira: '🇩🇪',
    cor: '#000000',
    corClara: '#00000020'
  },
  [Pais.ITALIA]: {
    label: 'Itália',
    bandeira: '🇮🇹',
    cor: '#009246',
    corClara: '#00924620'
  }
}

// Configuração visual de prioridades
export const PRIORIDADE_CONFIG: Record<PrioridadeTarefa, {
  label: string
  cor: string
  corBg: string
}> = {
  [PrioridadeTarefa.BAIXA]: {
    label: 'Baixa',
    cor: '#6b7280',
    corBg: '#6b728020'
  },
  [PrioridadeTarefa.MEDIA]: {
    label: 'Média',
    cor: '#3b82f6',
    corBg: '#3b82f620'
  },
  [PrioridadeTarefa.ALTA]: {
    label: 'Alta',
    cor: '#f59e0b',
    corBg: '#f59e0b20'
  },
  [PrioridadeTarefa.URGENTE]: {
    label: 'Urgente',
    cor: '#ef4444',
    corBg: '#ef444420'
  }
}

// Helper para obter lista de países
export const PAISES_LISTA = Object.values(Pais)

// ========================================
// INTERFACES BASE
// ========================================

export interface Status {
  id: number
  nome: string
  ordem?: number
  pais?: Pais
  _count?: {
    processos: number
  }
}

export interface Usuario {
  id: number
  nome: string
  email: string
  tipo?: string
}

// ========================================
// CONTRATANTE - CLIENTE QUE CONTRATA
// ========================================
export interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  dataNascimento?: string | null
  sexo?: string | null
  estadoCivil?: string | null
  nacionalidade?: string | null
  telefone?: string | null
  email?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  observacoes?: string | null
  createdAt?: string
  updatedAt?: string
  _count?: {
    processos: number
  }
}

// ========================================
// REQUERENTE - QUEM VAI RECEBER CIDADANIA
// ========================================
export interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  dataNascimento?: string | null
  sexo?: string | null
  estadoCivil?: string | null
  nacionalidade?: string | null
  telefone?: string | null
  email?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  observacoes?: string | null
  createdAt?: string
  updatedAt?: string
}

// ========================================
// TAREFA - AFAZERES DOS FUNCIONÁRIOS
// ========================================
export interface Tarefa {
  id: number
  titulo: string
  descricao?: string | null
  processoId: number
  responsavelId?: number | null
  responsavel?: Usuario | null
  concluida: boolean
  prioridade: PrioridadeTarefa
  dataPrazo?: string | null
  dataConclusao?: string | null
  createdAt?: string
  updatedAt?: string
  processo?: {
    id: number
    nome: string
    pais: Pais
  }
}

// ========================================
// PROCESSO - CARD DO KANBAN (FAMÍLIA)
// ========================================
export interface Processo {
  id: number
  nome: string
  descricao?: string | null
  observacoes?: string | null
  pais: Pais
  statusId: number
  status?: Status
  contratantes?: Contratante[]
  arvoreId?: number | null
  arvore?: {
    id: number
    nome: string
  } | null
  dataInicio?: string
  previsaoTermino?: string | null
  dataConclusao?: string | null
  createdAt?: string
  updatedAt?: string
  requerentes?: Requerente[]
  tarefas?: Tarefa[]
  _count?: {
    tarefas: number
    anexos: number
  }
}

export interface ProcessoWithStatus extends Processo {
  status: Status
}

// ========================================
// DADOS AGREGADOS POR PAÍS (para o Kanban)
// ========================================
export interface DadosPais {
  pais: Pais
  config: typeof PAISES_CONFIG[Pais]
  processos: ProcessoWithStatus[]
  statusList: Status[]
}

// ========================================
// TIPOS PARA CRIAÇÃO/EDIÇÃO
// ========================================
export interface CriarProcesso {
  nome: string
  descricao?: string
  observacoes?: string
  pais: Pais
  statusId: number
  contratanteIds?: number[]
  requerenteIds?: number[]
  arvoreId?: number
  previsaoTermino?: string
}

export interface AtualizarProcesso {
  nome?: string
  descricao?: string
  observacoes?: string
  statusId?: number
  contratanteIds?: number[]
  requerenteIds?: number[]
  arvoreId?: number | null
  previsaoTermino?: string | null
  dataConclusao?: string | null
}

export interface CriarTarefa {
  titulo: string
  descricao?: string
  processoId: number
  responsavelId?: number
  prioridade?: PrioridadeTarefa
  dataPrazo?: string
}

export interface AtualizarTarefa {
  titulo?: string
  descricao?: string
  responsavelId?: number | null
  prioridade?: PrioridadeTarefa
  dataPrazo?: string | null
  concluida?: boolean
}

// ========================================
// LEGADO - Manter para compatibilidade temporária
// ========================================

/** @deprecated Use Processo ao invés de Atividade */
export interface Atividade {
  id: number
  nome: string
  descricao: string | null
  pais: Pais
  statusId: number
  data_termino?: string | null
  data_criacao?: string
  arvore_id?: number | null
  contratanteId?: number | null
  contratante?: Contratante | null
  requerentes?: Requerente[]
}

/** @deprecated Use ProcessoWithStatus ao invés de AtividadeWithStatus */
export interface AtividadeWithStatus extends Atividade {
  status: Status
}