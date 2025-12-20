"use client"

import { PessoaArvore } from "./pessoa-card"

// Cores estilo FamilySearch
const colors = {
  male: '#3073B5',
  maleBg: '#E8F4FC',
  maleBorder: '#B8D4EA',
  female: '#BF3D79',
  femaleBg: '#FCE8F2',
  femaleBorder: '#E8B8D0',
  neutral: '#6B7280',
  neutralBg: '#F3F4F6',
  green: '#87B940',
  greenDark: '#5B8A20',
}

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

function getGenderColors(sexo: string | null | undefined) {
  const isMale = sexo?.toLowerCase() === 'masculino' || sexo?.toLowerCase() === 'm'
  const isFemale = sexo?.toLowerCase() === 'feminino' || sexo?.toLowerCase() === 'f'

  if (isMale) return { border: colors.male, bg: colors.maleBg }
  if (isFemale) return { border: colors.female, bg: colors.femaleBg }
  return { border: colors.neutral, bg: colors.neutralBg }
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

// Ícone FamilySearch
function FamilySearchIcon() {
  return (
    <div className="absolute top-2 right-2">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill={colors.green} />
        <path
          d="M12 6v12M8 10v4M16 10v4"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

// Badge de status
function StatusBadge({ deceased, small = false }: { deceased: boolean; small?: boolean }) {
  const sizeClasses = small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'

  if (deceased) {
    return (
      <span className={`${sizeClasses} font-medium rounded-full bg-gray-100 text-gray-600`}>
        Falecido
      </span>
    )
  }
  return (
    <span
      className={`${sizeClasses} font-medium rounded-full text-white`}
      style={{ backgroundColor: colors.green }}
    >
      Vivo
    </span>
  )
}

export function PersonCardSimple({ pessoa, isMain = false, onClick }: PersonCardSimpleProps) {
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const genderColors = getGenderColors(pessoa.sexo)
  const pid = pessoa.pid || generatePID(pessoa.id)
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'

  return (
    <div
      className={`person-card relative bg-white rounded-xl shadow-lg cursor-pointer hover:shadow-xl transition-all hover:-translate-y-0.5 overflow-hidden ${isMain ? 'ring-2 ring-offset-2' : ''}`}
      style={{
        width: '160px',
        borderLeft: `4px solid ${genderColors.border}`,
        ...(isMain && { ringColor: colors.green })
      }}
      onClick={() => onClick?.(pessoa)}
    >
      {/* Ícone FamilySearch */}
      <FamilySearchIcon />

      {/* Conteúdo do card */}
      <div className="p-3 pt-4">
        {/* Avatar */}
        <div className="flex justify-center mb-2">
          <div
            className="rounded-full flex items-center justify-center font-bold text-white shadow-sm"
            style={{
              width: 48,
              height: 48,
              backgroundColor: genderColors.border,
              fontSize: 18
            }}
          >
            {initial}
          </div>
        </div>

        {/* Nome */}
        <h3 className="font-bold text-gray-900 text-sm leading-tight text-center line-clamp-2 min-h-[2.5rem]">
          {nomeCompleto}
        </h3>

        {/* Status e PID */}
        <div className="flex flex-col items-center gap-1 mt-2">
          <StatusBadge deceased={isDeceased(pessoa)} small />
          <span className="text-[10px] text-gray-400 font-mono">{pid}</span>
        </div>

        {/* Datas */}
        {dateRange && (
          <p className="text-xs text-gray-500 text-center mt-1">{dateRange}</p>
        )}
      </div>
    </div>
  )
}

// Botão de adicionar pessoa (estilo FamilySearch melhorado)
interface AddPersonButtonSimpleProps {
  type: 'pai' | 'mae' | 'filho' | 'conjuge'
  onClick?: () => void
}

export function AddPersonButtonSimple({ type, onClick }: AddPersonButtonSimpleProps) {
  const config = {
    pai: { label: 'ACRESCENTAR O PAI', color: colors.male, icon: 'M' },
    mae: { label: 'ACRESCENTAR A MÃE', color: colors.female, icon: 'F' },
    filho: { label: 'ACRESCENTAR FILHO(A)', color: colors.green, icon: '+' },
    conjuge: { label: 'ACRESCENTAR CÔNJUGE', color: colors.neutral, icon: '♥' }
  }

  const { label, color, icon } = config[type]

  return (
    <div
      className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-teal-400 hover:bg-teal-50/50 transition-all shadow-sm hover:shadow-md group"
      style={{ width: '160px', minHeight: '140px' }}
      onClick={onClick}
    >
      <div className="p-4 flex flex-col items-center justify-center h-full text-center">
        {/* Ícone com pessoa */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors"
          style={{ backgroundColor: `${color}15` }}
        >
          <svg
            className="w-6 h-6 transition-colors"
            style={{ color: color }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>

        {/* Label */}
        <span
          className="text-xs font-semibold tracking-wide transition-colors"
          style={{ color: color }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

// Botão de adicionar cônjuge inline (para dentro do card)
export function AddSpouseButton({ onClick }: { onClick?: () => void }) {
  return (
    <div
      className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-teal-400 hover:bg-teal-50/50 transition-all shadow-sm hover:shadow-md"
      style={{ width: '160px', minHeight: '140px' }}
      onClick={onClick}
    >
      <div className="p-4 flex flex-col items-center justify-center h-full text-center">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-gray-100"
        >
          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <span className="text-xs text-gray-500 font-medium">Adicionar cônjuge</span>
      </div>
    </div>
  )
}
