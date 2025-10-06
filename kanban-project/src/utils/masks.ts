// Utilitários para máscaras de formatação

export const formatCPF = (value: string): string => {
  const cleaned = value.replace(/\D/g, '')
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,3})(\d{0,2})$/)
  if (!match) return value
  
  let formatted = match[1]
  if (match[2]) formatted += '.' + match[2]
  if (match[3]) formatted += '.' + match[3]
  if (match[4]) formatted += '-' + match[4]
  
  return formatted
}

export const formatRG = (value: string): string => {
  const cleaned = value.replace(/\D/g, '')
  const match = cleaned.match(/^(\d{0,2})(\d{0,3})(\d{0,3})(\d{0,1})$/)
  if (!match) return value
  
  let formatted = match[1]
  if (match[2]) formatted += '.' + match[2]
  if (match[3]) formatted += '.' + match[3]
  if (match[4]) formatted += '-' + match[4]
  
  return formatted
}

export const formatTelefone = (value: string): string => {
  const cleaned = value.replace(/\D/g, '')
  const match = cleaned.match(/^(\d{0,2})(\d{0,5})(\d{0,4})$/)
  if (!match) return value
  
  let formatted = ''
  if (match[1]) formatted = '(' + match[1]
  if (match[2]) formatted += ') ' + match[2]
  if (match[3]) formatted += '-' + match[3]
  
  return formatted
}

export const removeMask = (value: string): string => {
  return value.replace(/\D/g, '')
}

export const applyCPFMask = (value: string): string => {
  if (!value) return ''
  return formatCPF(removeMask(value))
}

export const applyRGMask = (value: string): string => {
  if (!value) return ''
  return formatRG(removeMask(value))
}

export const applyTelefoneMask = (value: string): string => {
  if (!value) return ''
  return formatTelefone(removeMask(value))
}