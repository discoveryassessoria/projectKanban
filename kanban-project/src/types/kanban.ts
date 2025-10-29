export interface Status {
  id: number
  nome: string
  ordem?: number
}

export interface Usuario {
  id: number
  nome: string
  email: string
}

export interface UserAtv {
  usuario: Usuario
}

export interface Atividade {
  id: number
  nome: string
  descricao: string | null
  statusId: number
  data_termino?: string
  data_criacao?: string
  arvore_id?: number | null
  usuarios?: UserAtv[]
  tags?: { texto: string; cor: string }[]
}

export interface AtividadeWithStatus extends Atividade {
  status: Status
}

export interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
}

export interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
}

export interface Projeto {
  id: number
  nome: string
  descricao: string | null
  status: Status[]
  atividades: Atividade[]
  contratante?: Contratante | null
  requerentes?: { requerente: Requerente }[]
}
