export interface Status {
  id: number
  nome: string
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
  usuarios?: UserAtv[]
  tags?: { texto: string; cor: string }[]
}

export interface AtividadeWithStatus extends Atividade {
  status: Status
}

export interface Projeto {
  id: number
  nome: string
  descricao: string | null
  status: Status[]
  atividades: Atividade[]
}
