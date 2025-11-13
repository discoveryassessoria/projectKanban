export type TipoCampoPersonalizado = 
  | 'texto' 
  | 'numero' 
  | 'data' 
  | 'email' 
  | 'telefone' 
  | 'boolean'

export interface CampoPersonalizado {
  id: string
  nome: string
  tipo: TipoCampoPersonalizado
  valor: string | number | boolean | null
}

export interface CamposPersonalizados {
  campos: CampoPersonalizado[]
}

export const MAX_CAMPOS_PERSONALIZADOS = 5

export const getTipoCampoLabel = (tipo: TipoCampoPersonalizado): string => {
  const labels: Record<TipoCampoPersonalizado, string> = {
    texto: 'Texto',
    numero: 'Número',
    data: 'Data',
    email: 'E-mail',
    telefone: 'Telefone',
    boolean: 'Sim/Não'
  }
  return labels[tipo]
}

export const getTipoCampoPlaceholder = (tipo: TipoCampoPersonalizado): string => {
  const placeholders: Record<TipoCampoPersonalizado, string> = {
    texto: 'Digite o texto',
    numero: 'Digite um número',
    data: 'Selecione uma data',
    email: 'exemplo@email.com',
    telefone: '(00) 00000-0000',
    boolean: 'Sim ou Não'
  }
  return placeholders[tipo]
}

export const validarValorCampo = (valor: any, tipo: TipoCampoPersonalizado): boolean => {
  if (valor === null || valor === undefined || valor === '') {
    return true // Campos são opcionais
  }

  switch (tipo) {
    case 'numero':
      return !isNaN(Number(valor))
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor))
    case 'telefone':
      return /^\(\d{2}\)\s?\d{4,5}-?\d{4}$/.test(String(valor).replace(/\s/g, ''))
    case 'data':
      return !isNaN(Date.parse(String(valor)))
    case 'boolean':
      return typeof valor === 'boolean' || valor === 'true' || valor === 'false'
    case 'texto':
    default:
      return true
  }
}
