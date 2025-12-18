"use client"

import { PersonIcon } from "./pessoa-icon"
import { ChevronDown, UserPlus } from "lucide-react"

export interface PessoaArvore {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  data_nasc?: Date | string | null
  local_nasc?: string | null
  data_obito?: Date | string | null
  batizado?: string | null
  comentario?: string | null
  paiId?: number | null
  maeId?: number | null
  x?: number | null
  y?: number | null
  arvoreId: number
  // Relacionamentos
  pai?: PessoaArvore | null
  mae?: PessoaArvore | null
  filhosComoPai?: PessoaArvore[]
  filhosComoMae?: PessoaArvore[]
  unioesComoPessoa1?: UniaoArvore[]
  unioesComoPessoa2?: UniaoArvore[]
}

export interface UniaoArvore {
  id: number
  data_inicio?: Date | string | null
  data_fim?: Date | string | null
  tipo?: string | null
  local?: string | null
  pessoa1Id: number
  pessoa2Id: number
  pessoa1?: PessoaArvore
  pessoa2?: PessoaArvore
}

interface PessoaCardProps {
  pessoa: PessoaArvore
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  isMain?: boolean
  showChildrenDropdown?: boolean
  onClick?: (pessoa: PessoaArvore) => void
  onConjugeClick?: (pessoa: PessoaArvore) => void
  onAddConjuge?: (pessoa: PessoaArvore) => void
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = new Date(date)
  return d.getFullYear().toString()
}

function formatFullDate(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateRange(nascimento: Date | string | null | undefined, obito: Date | string | null | undefined): string {
  const nasc = formatDate(nascimento)
  const obit = obito ? formatDate(obito) : ""
  if (!nasc && !obit) return ""
  if (!nasc && obit) return `Falecido`
  if (nasc && !obit) return nasc
  return `${nasc}–${obit}`
}

function getBorderColor(sexo: string | null | undefined): string {
  const isMale = sexo?.toLowerCase() === 'masculino' || sexo?.toLowerCase() === 'm'
  const isFemale = sexo?.toLowerCase() === 'feminino' || sexo?.toLowerCase() === 'f'
  return isMale ? '#0284c7' : isFemale ? '#be185d' : '#6b7280'
}

export function PessoaCard({ 
  pessoa, 
  conjuge, 
  casamento,
  isMain = false, 
  showChildrenDropdown = true,
  onClick,
  onConjugeClick,
  onAddConjuge
}: PessoaCardProps) {
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const conjugeNome = conjuge?.sobrenome ? `${conjuge.nome} ${conjuge.sobrenome}` : conjuge?.nome
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const conjugeDateRange = conjuge ? formatDateRange(conjuge.data_nasc, conjuge.data_obito) : ""

  return (
    <div 
      className={`relative bg-white rounded-lg shadow-md border border-gray-200 cursor-pointer hover:shadow-lg transition-shadow ${isMain ? 'ring-2 ring-sky-400' : ''}`}
      style={{ minWidth: '220px', maxWidth: '280px' }}
    >
      {/* Borda lateral colorida - colada no card */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg"
        style={{ backgroundColor: getBorderColor(pessoa.sexo) }}
      />
      
      {/* Pessoa principal */}
      <div 
        className="p-3 pl-5"
        onClick={() => onClick?.(pessoa)}
      >
        <div className="flex items-start gap-3">
          <PersonIcon gender={pessoa.sexo} size={44} />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-base leading-tight">{nomeCompleto}</h3>
            {dateRange && (
              <p className="text-sm text-gray-600 mt-0.5">{dateRange}</p>
            )}
            {pessoa.local_nasc && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{pessoa.local_nasc}</p>
            )}
          </div>
        </div>
        
        {/* Informações do casamento */}
        {casamento && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              <span className="font-medium">Casamento:</span> {formatFullDate(casamento.data_inicio)}
            </p>
            {casamento.local && (
              <p className="text-xs text-gray-400 truncate">{casamento.local}</p>
            )}
          </div>
        )}
      </div>
      
      {/* Cônjuge */}
      {conjuge && (
        <div 
          className="relative border-t border-gray-100"
          onClick={(e) => {
            e.stopPropagation()
            onConjugeClick?.(conjuge)
          }}
        >
          {/* Borda lateral do cônjuge */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-1.5"
            style={{ backgroundColor: getBorderColor(conjuge.sexo) }}
          />
          <div className="p-3 pl-5">
            <div className="flex items-start gap-3">
              <PersonIcon gender={conjuge.sexo} size={36} />
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-gray-800 text-sm leading-tight">{conjugeNome}</h4>
                {conjugeDateRange && (
                  <p className="text-xs text-gray-500">{conjugeDateRange}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Botão de adicionar cônjuge (quando não tem cônjuge) */}
      {!conjuge && onAddConjuge && (
        <div 
          className="relative border-t border-gray-100 border-dashed"
          onClick={(e) => {
            e.stopPropagation()
            onAddConjuge(pessoa)
          }}
        >
          <div 
            className="absolute left-0 top-0 bottom-0 w-1.5 opacity-30"
            style={{ backgroundColor: '#6b7280' }}
          />
          <div className="p-2 pl-5 flex items-center gap-2 text-gray-400 hover:text-teal-600 hover:bg-gray-50 transition-colors">
            <UserPlus className="h-4 w-4" />
            <span className="text-xs font-medium">Adicionar cônjuge</span>
          </div>
        </div>
      )}
      
      {/* Filhos dropdown */}
      {showChildrenDropdown && (
        <div className="px-3 pl-5 py-2 border-t border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50">
          <span className="text-sm text-gray-600">Filhos</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
      )}
    </div>
  )
}