"use client"

import { PessoaArvore } from "./pessoa-card"

// Cores estilo FamilySearch
const colors = {
  male: '#3073B5',
  maleBg: '#E8F4FC',
  female: '#BF3D79',
  femaleBg: '#FCE8F2',
  neutral: '#6B7280',
  neutralBg: '#F3F4F6',
  green: '#87B940',
}

// Tamanhos padronizados
const cardSizes = {
  paisagem: { width: 180, height: 100 },
  retrato: { width: 140, height: 160 }
}

type ViewMode = 'paisagem' | 'retrato'

interface PersonCardSimpleProps {
  pessoa: PessoaArvore
  isMain?: boolean
  mode?: ViewMode
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

// Badge de status
function StatusBadge({ deceased }: { deceased: boolean }) {
  if (deceased) {
    return (
      <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-gray-200 text-gray-600">
        Falecido
      </span>
    )
  }
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-semibold rounded text-white"
      style={{ backgroundColor: colors.green }}
    >
      Vivo
    </span>
  )
}

// Ícone FamilySearch pequeno
function FSIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill={colors.green} />
      <path d="M12 7v10M9 10v4M15 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function PersonCardSimple({ pessoa, isMain = false, mode = 'paisagem', onClick }: PersonCardSimpleProps) {
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const genderColors = getGenderColors(pessoa.sexo)
  const pid = pessoa.pid || generatePID(pessoa.id)
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  const size = cardSizes[mode]

  if (mode === 'paisagem') {
    // Card HORIZONTAL (retangular)
    return (
      <div
        className={`person-card relative bg-white rounded-xl shadow-md cursor-pointer hover:shadow-lg transition-all overflow-hidden ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}
        style={{
          width: size.width,
          height: size.height,
          borderLeft: `4px solid ${genderColors.border}`,
        }}
        onClick={() => onClick?.(pessoa)}
      >
        {/* Ícone FS */}
        <div className="absolute top-2 right-2">
          <FSIcon />
        </div>

        <div className="p-3 h-full flex items-center gap-3">
          {/* Avatar */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg flex-shrink-0"
            style={{ backgroundColor: genderColors.border }}
          >
            {initial}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-gray-900 text-sm leading-tight truncate">
              {nomeCompleto}
            </h3>
            <div className="flex items-center gap-1.5 mt-1">
              <StatusBadge deceased={isDeceased(pessoa)} />
              <span className="text-[9px] text-gray-400 font-mono">{pid}</span>
            </div>
            {dateRange && (
              <p className="text-[10px] text-gray-500 mt-0.5">{dateRange}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Card VERTICAL (quadrado)
  return (
    <div
      className={`person-card relative bg-white rounded-xl shadow-md cursor-pointer hover:shadow-lg transition-all overflow-hidden ${isMain ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}
      style={{
        width: size.width,
        height: size.height,
        borderLeft: `4px solid ${genderColors.border}`,
      }}
      onClick={() => onClick?.(pessoa)}
    >
      {/* Ícone FS */}
      <div className="absolute top-2 right-2">
        <FSIcon />
      </div>

      <div className="p-3 h-full flex flex-col items-center justify-center text-center">
        {/* Avatar */}
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-lg mb-2"
          style={{ backgroundColor: genderColors.border }}
        >
          {initial}
        </div>

        {/* Nome */}
        <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2">
          {nomeCompleto}
        </h3>

        {/* Status + PID */}
        <div className="flex items-center gap-1 mt-1.5">
          <StatusBadge deceased={isDeceased(pessoa)} />
        </div>
        <span className="text-[9px] text-gray-400 font-mono mt-0.5">{pid}</span>

        {/* Datas */}
        {dateRange && (
          <p className="text-[10px] text-gray-500 mt-0.5">{dateRange}</p>
        )}
      </div>
    </div>
  )
}

// Botão de adicionar pessoa padronizado
interface AddPersonButtonSimpleProps {
  type: 'pai' | 'mae' | 'filho' | 'conjuge'
  mode?: ViewMode
  onClick?: () => void
}

export function AddPersonButtonSimple({ type, mode = 'paisagem', onClick }: AddPersonButtonSimpleProps) {
  const config = {
    pai: { label: 'ACRESCENTAR O PAI', color: colors.male },
    mae: { label: 'ACRESCENTAR A MÃE', color: colors.female },
    filho: { label: 'ACRESCENTAR FILHO(A)', color: colors.green },
    conjuge: { label: 'ADICIONAR CÔNJUGE', color: colors.neutral }
  }

  const { label, color } = config[type]
  const size = cardSizes[mode]

  if (mode === 'paisagem') {
    // Botão HORIZONTAL
    return (
      <div
        className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
        style={{ width: size.width, height: size.height }}
        onClick={onClick}
      >
        <div className="h-full flex items-center gap-3 px-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${color}20` }}
          >
            <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-[10px] font-semibold leading-tight" style={{ color }}>
            {label}
          </span>
        </div>
      </div>
    )
  }

  // Botão VERTICAL
  return (
    <div
      className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
      style={{ width: size.width, height: size.height }}
      onClick={onClick}
    >
      <div className="h-full flex flex-col items-center justify-center text-center px-2">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center mb-2"
          style={{ backgroundColor: `${color}20` }}
        >
          <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

// Botão de adicionar cônjuge
export function AddSpouseButton({ mode = 'paisagem', onClick }: { mode?: ViewMode; onClick?: () => void }) {
  const size = cardSizes[mode]

  if (mode === 'paisagem') {
    return (
      <div
        className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
        style={{ width: size.width, height: size.height }}
        onClick={onClick}
      >
        <div className="h-full flex items-center gap-3 px-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-100 flex-shrink-0">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <span className="text-[10px] text-gray-500 font-semibold">
            ADICIONAR CÔNJUGE
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all shadow-sm"
      style={{ width: size.width, height: size.height }}
      onClick={onClick}
    >
      <div className="h-full flex flex-col items-center justify-center text-center">
        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gray-100 mb-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <span className="text-[9px] text-gray-500 font-semibold">
          ADICIONAR<br />CÔNJUGE
        </span>
      </div>
    </div>
  )
}
