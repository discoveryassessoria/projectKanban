"use client"

import { PersonIcon } from "./pessoa-icon"
import { PessoaArvore } from "./pessoa-card"

interface PersonCardSimpleProps {
  pessoa: PessoaArvore
  isMain?: boolean
  onClick?: (pessoa: PessoaArvore) => void
}

function formatDateRange(nascimento: Date | string | null | undefined, obito: Date | string | null | undefined): string {
  const formatYear = (date: Date | string | null | undefined) => {
    if (!date) return ""
    return new Date(date).getFullYear().toString()
  }
  
  const nasc = formatYear(nascimento)
  const obit = obito ? formatYear(obito) : ""
  
  if (!nasc && !obit) return ""
  if (!nasc && obit) return `Falecido`
  if (nasc && obit) return `${nasc}–${obit}`
  return nasc
}

function getBorderColor(sexo: string | null | undefined): string {
  const isMale = sexo?.toLowerCase() === 'masculino' || sexo?.toLowerCase() === 'm'
  const isFemale = sexo?.toLowerCase() === 'feminino' || sexo?.toLowerCase() === 'f'
  return isMale ? '#0284c7' : isFemale ? '#be185d' : '#6b7280'
}

export function PersonCardSimple({ pessoa, isMain = false, onClick }: PersonCardSimpleProps) {
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)

  return (
    <div 
      className={`relative bg-white rounded-lg shadow-md border border-gray-200 cursor-pointer hover:shadow-lg transition-all hover:-translate-y-0.5 ${isMain ? 'ring-2 ring-sky-400' : ''}`}
      style={{ width: '140px' }}
      onClick={() => onClick?.(pessoa)}
    >
      {/* Conteúdo do card */}
      <div className="p-3 flex flex-col items-center text-center">
        {/* Avatar */}
        <div className="mb-2">
          <PersonIcon gender={pessoa.sexo} size={48} />
        </div>
        
        {/* Nome */}
        <h3 className="font-semibold text-gray-900 text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
          {nomeCompleto}
        </h3>
        
        {/* Datas */}
        {dateRange && (
          <p className="text-xs text-gray-500 mt-1">{dateRange}</p>
        )}
        
        {/* Local */}
        {pessoa.local_nasc && (
          <p className="text-xs text-gray-400 mt-0.5 truncate w-full">{pessoa.local_nasc}</p>
        )}
      </div>
      
      {/* Borda inferior colorida */}
      <div 
        className="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg"
        style={{ backgroundColor: getBorderColor(pessoa.sexo) }}
      />
    </div>
  )
}

// Botão de adicionar pessoa (estilo FamilySearch)
interface AddPersonButtonSimpleProps {
  type: 'pai' | 'mae'
  onClick?: () => void
}

export function AddPersonButtonSimple({ type, onClick }: AddPersonButtonSimpleProps) {
  const isMale = type === 'pai'
  const label = isMale ? 'Adicionar pai' : 'Adicionar mãe'
  const borderColor = isMale ? '#0284c7' : '#be185d'
  
  return (
    <div 
      className="relative bg-white rounded-lg border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
      style={{ width: '140px', minHeight: '120px' }}
      onClick={onClick}
    >
      <div className="p-3 flex flex-col items-center justify-center h-full text-center">
        {/* Ícone */}
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-2">
          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        
        {/* Label */}
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      
      {/* Borda inferior colorida */}
      <div 
        className="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg opacity-30"
        style={{ backgroundColor: borderColor }}
      />
    </div>
  )
}