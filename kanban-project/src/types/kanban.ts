export interface Status {
  id: number
  nome: string
}

export interface Atividade {
  id: number
  nome: string
  descricao: string | null
  statusId: number
  data?: string
  responsavel?: string
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
