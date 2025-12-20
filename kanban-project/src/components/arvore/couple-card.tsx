"use client"

import { useState } from "react"
import { PessoaArvore, UniaoArvore } from "./pessoa-card"
import { ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Plus } from "lucide-react"

// Cores estilo FamilySearch
const colors = {
  male: '#3073B5',
  maleBg: '#E8F4FC',
  female: '#BF3D79',
  femaleBg: '#FCE8F2',
  neutral: '#6B7280',
  neutralBg: '#F3F4F6',
  green: '#87B940',
  line: '#9CA3AF'
}

type ViewMode = 'paisagem' | 'retrato'

interface CoupleCardProps {
  pessoa1: PessoaArvore
  pessoa2?: PessoaArvore | null
  filhos?: PessoaArvore[]
  mode: ViewMode
  isMain?: boolean
  showFilhosDropdown?: boolean
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddConjuge?: () => void
  onAddFilho?: () => void
  onExpandPai?: () => void
  onExpandMae?: () => void
  expandedPai?: boolean
  expandedMae?: boolean
  showExpandButtons?: boolean
}

// Funções auxiliares
function getGenderColors(sexo: string | null | undefined) {
  const isMale = sexo?.toLowerCase() === 'masculino' || sexo?.toLowerCase() === 'm'
  const isFemale = sexo?.toLowerCase() === 'feminino' || sexo?.toLowerCase() === 'f'
  if (isMale) return { border: colors.male, bg: colors.maleBg }
  if (isFemale) return { border: colors.female, bg: colors.femaleBg }
  return { border: colors.neutral, bg: colors.neutralBg }
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

function generatePID(id: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let pid = ''
  const seed = id * 12345
  for (let i = 0; i < 4; i++) {
    pid += chars[(seed * (i + 1)) % chars.length]
  }
  return `${pid.slice(0, 4)}-${pid.slice(0, 3)}`
}

function isDeceased(pessoa: PessoaArvore): boolean {
  return !!pessoa.data_obito
}

// Mini card de pessoa dentro do CoupleCard
function PersonMiniCard({
  pessoa,
  onClick,
  showAddButton = false,
  onAdd,
  type
}: {
  pessoa?: PessoaArvore | null
  onClick?: (pessoa: PessoaArvore) => void
  showAddButton?: boolean
  onAdd?: () => void
  type?: 'pai' | 'mae' | 'conjuge'
}) {
  if (!pessoa && showAddButton) {
    const buttonConfig = {
      pai: { label: 'ACRESCENTAR O PAI', color: colors.male },
      mae: { label: 'ACRESCENTAR A MÃE', color: colors.female },
      conjuge: { label: 'ACRESCENTAR O CÔNJUGE', color: colors.green }
    }
    const config = buttonConfig[type || 'conjuge']

    return (
      <div
        className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors"
        onClick={onAdd}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `${config.color}15` }}
        >
          <svg className="w-4 h-4" style={{ color: config.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <span className="text-[10px] font-semibold" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>
    )
  }

  if (!pessoa) return null

  const genderColors = getGenderColors(pessoa.sexo)
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  const pid = pessoa.pid || generatePID(pessoa.id)
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const deceased = isDeceased(pessoa)

  return (
    <div
      className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-50 rounded-lg transition-colors"
      onClick={() => onClick?.(pessoa)}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
        style={{ backgroundColor: genderColors.border }}
      >
        {initial}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-gray-900 text-xs leading-tight truncate">
          {nomeCompleto}
        </h4>
        <div className="flex items-center gap-1 mt-0.5">
          {deceased ? (
            <span className="text-[8px] text-gray-500">{dateRange || 'Falecido'}</span>
          ) : (
            <span className="text-[8px] text-green-600 flex items-center gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {dateRange ? `${dateRange}-Vivo` : 'Vivo'}
            </span>
          )}
          <span className="text-[8px] text-gray-400">• {pid}</span>
        </div>
      </div>
    </div>
  )
}

// Botão de expandir com seta
function ExpandArrowButton({
  direction,
  expanded,
  onClick,
  label
}: {
  direction: 'up' | 'down' | 'left' | 'right'
  expanded: boolean
  onClick: () => void
  label?: string
}) {
  const getIcon = () => {
    if (expanded) {
      switch (direction) {
        case 'up': return <ChevronDown className="w-3 h-3" />
        case 'down': return <ChevronUp className="w-3 h-3" />
        case 'left': return <ChevronRight className="w-3 h-3" />
        case 'right': return <ChevronLeft className="w-3 h-3" />
      }
    }
    switch (direction) {
      case 'up': return <ChevronUp className="w-3 h-3" />
      case 'down': return <ChevronDown className="w-3 h-3" />
      case 'left': return <ChevronLeft className="w-3 h-3" />
      case 'right': return <ChevronRight className="w-3 h-3" />
    }
  }

  const getPosition = () => {
    switch (direction) {
      case 'up': return 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2'
      case 'down': return 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2'
      case 'left': return 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2'
      case 'right': return 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2'
    }
  }

  return (
    <button
      className={`absolute ${getPosition()} w-5 h-5 rounded-full bg-white border border-gray-300 flex items-center justify-center shadow-sm hover:bg-gray-50 hover:border-gray-400 transition-all z-20`}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={expanded ? 'Recolher' : 'Expandir'}
    >
      {getIcon()}
    </button>
  )
}

// Componente principal CoupleCard
export function CoupleCard({
  pessoa1,
  pessoa2,
  filhos = [],
  mode,
  isMain = false,
  showFilhosDropdown = true,
  onPersonClick,
  onAddConjuge,
  onAddFilho,
  onExpandPai,
  onExpandMae,
  expandedPai = false,
  expandedMae = false,
  showExpandButtons = true
}: CoupleCardProps) {
  const [filhosExpanded, setFilhosExpanded] = useState(false)

  // Identificar quem é homem e quem é mulher para ordenar
  const isMale = (p: PessoaArvore) => p.sexo?.toLowerCase() === 'masculino' || p.sexo?.toLowerCase() === 'm'
  const isFemale = (p: PessoaArvore) => p.sexo?.toLowerCase() === 'feminino' || p.sexo?.toLowerCase() === 'f'

  // Ordenar: homem primeiro (se houver)
  let marido: PessoaArvore | null = null
  let esposa: PessoaArvore | null = null

  if (pessoa2) {
    if (isMale(pessoa1)) {
      marido = pessoa1
      esposa = pessoa2
    } else if (isFemale(pessoa1)) {
      esposa = pessoa1
      marido = pessoa2
    } else {
      // Se não conseguir determinar, usa a ordem passada
      marido = pessoa1
      esposa = pessoa2
    }
  } else {
    // Só tem uma pessoa
    if (isMale(pessoa1)) {
      marido = pessoa1
    } else {
      esposa = pessoa1
    }
  }

  if (mode === 'paisagem') {
    return (
      <div className={`relative bg-white rounded-xl shadow-lg overflow-hidden ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}>
        {/* Container principal */}
        <div className="min-w-[200px]">
          {/* Pessoa 1 (marido ou principal) */}
          {marido && (
            <PersonMiniCard pessoa={marido} onClick={onPersonClick} />
          )}

          {/* Divisor */}
          {(marido && esposa) && <div className="border-t border-gray-100" />}

          {/* Pessoa 2 (esposa) ou botão de adicionar cônjuge */}
          {esposa ? (
            <PersonMiniCard pessoa={esposa} onClick={onPersonClick} />
          ) : !marido ? (
            <PersonMiniCard pessoa={esposa} onClick={onPersonClick} />
          ) : (
            <PersonMiniCard
              showAddButton={true}
              onAdd={onAddConjuge}
              type="conjuge"
            />
          )}

          {/* Se só tem esposa e não tem marido, mostra botão de adicionar cônjuge */}
          {esposa && !marido && !pessoa2 && (
            <>
              <div className="border-t border-gray-100" />
              <PersonMiniCard
                showAddButton={true}
                onAdd={onAddConjuge}
                type="conjuge"
              />
            </>
          )}

          {/* Dropdown de Filhos */}
          {showFilhosDropdown && (
            <>
              <div className="border-t border-gray-200" />
              <button
                className="w-full px-3 py-2 flex items-center justify-between text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                onClick={() => setFilhosExpanded(!filhosExpanded)}
              >
                <span>Filhos</span>
                {filhosExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {/* Lista de filhos expandida */}
              {filhosExpanded && (
                <div className="border-t border-gray-100 bg-gray-50">
                  {filhos.map(filho => (
                    <PersonMiniCard
                      key={filho.id}
                      pessoa={filho}
                      onClick={onPersonClick}
                    />
                  ))}
                  {/* Botão adicionar filho */}
                  <div
                    className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={onAddFilho}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-50">
                      <Plus className="w-4 h-4 text-green-600" />
                    </div>
                    <span className="text-[10px] font-semibold text-green-600">
                      ACRESCENTAR FILHO(A)
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Botão de expandir para pais (direita) */}
        {showExpandButtons && (
          <ExpandArrowButton
            direction="right"
            expanded={expandedPai || expandedMae}
            onClick={() => {
              if (onExpandPai) onExpandPai()
            }}
          />
        )}
      </div>
    )
  }

  // MODO RETRATO
  return (
    <div className={`relative bg-white rounded-xl shadow-lg overflow-hidden ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}>
      {/* Botões de expandir para pais (cima) */}
      {showExpandButtons && marido && (
        <ExpandArrowButton
          direction="up"
          expanded={expandedPai}
          onClick={() => onExpandPai?.()}
        />
      )}

      {/* Container com as duas pessoas lado a lado */}
      <div className="flex">
        {/* Pessoa 1 */}
        <div className="flex-1 border-r border-gray-100">
          {marido ? (
            <PersonMiniCard pessoa={marido} onClick={onPersonClick} />
          ) : (
            <PersonMiniCard
              pessoa={esposa}
              onClick={onPersonClick}
            />
          )}
        </div>

        {/* Pessoa 2 ou botão */}
        <div className="flex-1">
          {esposa && marido ? (
            <PersonMiniCard pessoa={esposa} onClick={onPersonClick} />
          ) : !pessoa2 ? (
            <PersonMiniCard
              showAddButton={true}
              onAdd={onAddConjuge}
              type="conjuge"
            />
          ) : (
            <PersonMiniCard pessoa={esposa || pessoa2} onClick={onPersonClick} />
          )}
        </div>
      </div>

      {/* Segundo botão de expandir para mãe */}
      {showExpandButtons && esposa && marido && (
        <div className="absolute top-0 right-1/4 -translate-y-1/2">
          <button
            className="w-5 h-5 rounded-full bg-white border border-gray-300 flex items-center justify-center shadow-sm hover:bg-gray-50 z-20"
            onClick={(e) => {
              e.stopPropagation()
              onExpandMae?.()
            }}
          >
            {expandedMae ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Dropdown de Filhos */}
      {showFilhosDropdown && (
        <>
          <div className="border-t border-gray-200" />
          <button
            className="w-full px-3 py-2 flex items-center justify-between text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            onClick={() => setFilhosExpanded(!filhosExpanded)}
          >
            <span>Filhos</span>
            {filhosExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {filhosExpanded && (
            <div className="border-t border-gray-100 bg-gray-50">
              {filhos.map(filho => (
                <PersonMiniCard
                  key={filho.id}
                  pessoa={filho}
                  onClick={onPersonClick}
                />
              ))}
              <div
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={onAddFilho}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-50">
                  <Plus className="w-4 h-4 text-green-600" />
                </div>
                <span className="text-[10px] font-semibold text-green-600">
                  ACRESCENTAR FILHO(A)
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Botão de expandir para filhos (baixo) */}
      <ExpandArrowButton
        direction="down"
        expanded={filhosExpanded}
        onClick={() => setFilhosExpanded(!filhosExpanded)}
      />
    </div>
  )
}

// Card simples de pessoa individual (para avós, etc)
export function PersonCardFS({
  pessoa,
  mode,
  onClick,
  onAddPai,
  onAddMae,
  expandedPai,
  expandedMae,
  onExpandPai,
  onExpandMae,
  showExpandButtons = true
}: {
  pessoa: PessoaArvore
  mode: ViewMode
  onClick?: (pessoa: PessoaArvore) => void
  onAddPai?: () => void
  onAddMae?: () => void
  expandedPai?: boolean
  expandedMae?: boolean
  onExpandPai?: () => void
  onExpandMae?: () => void
  showExpandButtons?: boolean
}) {
  const genderColors = getGenderColors(pessoa.sexo)
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  const pid = pessoa.pid || generatePID(pessoa.id)
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const deceased = isDeceased(pessoa)

  if (mode === 'paisagem') {
    return (
      <div
        className="relative bg-white rounded-xl shadow-md cursor-pointer hover:shadow-lg transition-all overflow-hidden"
        style={{ borderLeft: `3px solid ${genderColors.border}` }}
        onClick={() => onClick?.(pessoa)}
      >
        <div className="p-3 flex items-center gap-2 min-w-[160px]">
          {/* Avatar */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0"
            style={{ backgroundColor: genderColors.border }}
          >
            {initial}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-900 text-xs leading-tight truncate">
              {nomeCompleto}
            </h4>
            <div className="flex items-center gap-1 mt-0.5">
              {deceased ? (
                <span className="text-[8px] text-gray-500">{dateRange || 'Falecido'}</span>
              ) : (
                <span className="text-[8px] text-green-600 flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  Vivo
                </span>
              )}
            </div>
            <span className="text-[8px] text-gray-400">{pid}</span>
          </div>
        </div>

        {/* Botão expandir */}
        {showExpandButtons && (
          <ExpandArrowButton
            direction="right"
            expanded={expandedPai || false}
            onClick={() => onExpandPai?.()}
          />
        )}
      </div>
    )
  }

  // RETRATO
  return (
    <div
      className="relative bg-white rounded-xl shadow-md cursor-pointer hover:shadow-lg transition-all overflow-hidden"
      style={{ borderTop: `3px solid ${genderColors.border}` }}
      onClick={() => onClick?.(pessoa)}
    >
      {/* Botão de adicionar pai */}
      {showExpandButtons && onAddPai && (
        <button
          className="absolute -top-2 left-1/4 w-5 h-5 rounded-full bg-white border border-gray-300 flex items-center justify-center shadow-sm hover:bg-blue-50 z-20"
          onClick={(e) => {
            e.stopPropagation()
            onAddPai()
          }}
          title="Adicionar pai"
        >
          <Plus className="w-3 h-3 text-blue-600" />
        </button>
      )}

      {/* Botão de adicionar mãe */}
      {showExpandButtons && onAddMae && (
        <button
          className="absolute -top-2 right-1/4 w-5 h-5 rounded-full bg-white border border-gray-300 flex items-center justify-center shadow-sm hover:bg-pink-50 z-20"
          onClick={(e) => {
            e.stopPropagation()
            onAddMae()
          }}
          title="Adicionar mãe"
        >
          <Plus className="w-3 h-3 text-pink-600" />
        </button>
      )}

      <div className="p-3 flex flex-col items-center text-center min-w-[100px]">
        {/* Avatar */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg mb-2"
          style={{ backgroundColor: genderColors.border }}
        >
          {initial}
        </div>

        {/* Nome */}
        <h4 className="font-semibold text-gray-900 text-xs leading-tight line-clamp-2">
          {nomeCompleto}
        </h4>

        {/* Status */}
        <div className="flex items-center gap-1 mt-1">
          {deceased ? (
            <span className="text-[8px] text-gray-500">{dateRange || 'Falecido'}</span>
          ) : (
            <span className="text-[8px] text-green-600 flex items-center gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              {dateRange ? `${dateRange}-Vivo` : 'Vivo'}
            </span>
          )}
        </div>
        <span className="text-[8px] text-gray-400 mt-0.5">{pid}</span>
      </div>
    </div>
  )
}

// Botão de adicionar pessoa (para slots vazios)
export function AddPersonCardFS({
  type,
  mode,
  onClick
}: {
  type: 'pai' | 'mae' | 'filho'
  mode: ViewMode
  onClick: () => void
}) {
  const config = {
    pai: { label: 'ACRESCENTAR O PAI', color: colors.male },
    mae: { label: 'ACRESCENTAR A MÃE', color: colors.female },
    filho: { label: 'ACRESCENTAR FILHO(A)', color: colors.green }
  }
  const { label, color } = config[type]

  if (mode === 'paisagem') {
    return (
      <div
        className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
        onClick={onClick}
      >
        <div className="p-3 flex items-center gap-2 min-w-[160px]">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${color}15` }}
          >
            <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-[10px] font-semibold" style={{ color }}>
            {label}
          </span>
        </div>
      </div>
    )
  }

  // RETRATO
  return (
    <div
      className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all"
      onClick={onClick}
    >
      <div className="p-3 flex flex-col items-center text-center min-w-[100px]">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
          style={{ backgroundColor: `${color}15` }}
        >
          <svg className="w-6 h-6" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <span className="text-[9px] font-semibold leading-tight" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  )
}
