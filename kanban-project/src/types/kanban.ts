// ========================================
// ENUM DE PAÍSES - FIXO NO CÓDIGO
// ========================================
export enum Pais {
  PORTUGAL = 'PORTUGAL',
  ESPANHA = 'ESPANHA',
  ALEMANHA = 'ALEMANHA',
  ITALIA = 'ITALIA'
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

// Helper para obter lista de países
export const PAISES_LISTA = Object.values(Pais)

// ========================================
// INTERFACES
// ========================================
export interface Status {
  id: number
  nome: string
  ordem?: number
}

export interface Usuario {
  id: number
  nome: string
  email: string
  tipo?: string
}

export interface UserAtv {
  usuario: Usuario
}

export interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
  email?: string | null
}

export interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
  email?: string | null
}

export interface AtividadeRequerente {
  requerente: Requerente
}

// ========================================
// ATIVIDADE (PROCESSO)
// ========================================
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
  usuarios?: UserAtv[]
  requerentes?: AtividadeRequerente[]
  tags?: { texto: string; cor: string }[]
}

export interface AtividadeWithStatus extends Atividade {
  status: Status
}

// ========================================
// DADOS AGREGADOS POR PAÍS (para o Kanban)
// ========================================
export interface DadosPais {
  pais: Pais
  config: typeof PAISES_CONFIG[Pais]
  atividades: AtividadeWithStatus[]
  statusList: Status[]
}

// ========================================
// TIPOS PARA CRIAÇÃO/EDIÇÃO
// ========================================
export interface CriarAtividade {
  nome: string
  descricao?: string
  pais: Pais
  statusId: number
  contratanteId?: number
  requerenteIds?: number[]
  arvore_id?: number
  data_termino?: string
}

export interface AtualizarAtividade {
  nome?: string
  descricao?: string
  pais?: Pais
  statusId?: number
  contratanteId?: number | null
  requerenteIds?: number[]
  arvore_id?: number | null
  data_termino?: string | null
}

// ========================================
// LEGADO - Manter para compatibilidade temporária
// ========================================
/** @deprecated Use Atividade com pais ao invés de Projeto */
export interface Projeto {
  id: number
  nome: string
  descricao: string | null
  status: Status[]
  atividades: Atividade[]
  contratante?: Contratante | null
  requerentes?: { requerente: Requerente }[]
}