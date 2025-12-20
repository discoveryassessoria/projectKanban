"use client"

import { PersonIcon } from "./pessoa-icon"
import { ChevronDown, UserPlus, ExternalLink } from "lucide-react"

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
  pid?: string | null // ID estilo FamilySearch
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

function getGenderColors(sexo: string | null | undefined) {
  const isMale = sexo?.toLowerCase() === 'masculino' || sexo?.toLowerCase() === 'm'
  const isFemale = sexo?.toLowerCase() === 'feminino' || sexo?.toLowerCase() === 'f'

  if (isMale) return { border: colors.male, bg: colors.maleBg, borderLight: colors.maleBorder }
  if (isFemale) return { border: colors.female, bg: colors.femaleBg, borderLight: colors.femaleBorder }
  return { border: colors.neutral, bg: colors.neutralBg, borderLight: '#D1D5DB' }
}

function generatePID(id: number): string {
  // Gera um PID estilo FamilySearch
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

// Componente de Avatar estilo FamilySearch
function PersonAvatar({ pessoa, size = 40 }: { pessoa: PessoaArvore; size?: number }) {
  const genderColors = getGenderColors(pessoa.sexo)
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'

  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shadow-sm"
      style={{
        width: size,
        height: size,
        backgroundColor: genderColors.border,
        fontSize: size * 0.4
      }}
    >
      {initial}
    </div>
  )
}

// Ícone de árvore FamilySearch
function FamilySearchIcon({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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

// Badge de status (Vivo/Falecido)
function StatusBadge({ deceased }: { deceased: boolean }) {
  if (deceased) {
    return (
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
        Falecido
      </span>
    )
  }
  return (
    <span
      className="px-2 py-0.5 text-xs font-medium rounded-full text-white"
      style={{ backgroundColor: colors.green }}
    >
      Vivo
    </span>
  )
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
  const genderColors = getGenderColors(pessoa.sexo)
  const conjugeGenderColors = conjuge ? getGenderColors(conjuge.sexo) : null
  const pid = pessoa.pid || generatePID(pessoa.id)
  const conjugePid = conjuge ? (conjuge.pid || generatePID(conjuge.id)) : null

  return (
    <div
      className={`relative bg-white rounded-xl shadow-lg overflow-hidden transition-all hover:shadow-xl ${isMain ? 'ring-2 ring-offset-2' : ''}`}
      style={{
        minWidth: '260px',
        maxWidth: '320px',
        borderLeft: `4px solid ${genderColors.border}`,
        ...(isMain && { ringColor: colors.green })
      }}
    >
      {/* Pessoa principal */}
      <div
        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => onClick?.(pessoa)}
      >
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <PersonAvatar pessoa={pessoa} size={44} />

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-gray-900 text-base leading-tight">
                {nomeCompleto}
              </h3>
              <FamilySearchIcon />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <StatusBadge deceased={isDeceased(pessoa)} />
              <span className="text-xs text-gray-400 font-mono">{pid}</span>
            </div>
          </div>
        </div>

        {/* Info de casamento */}
        {casamento && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <span className="font-medium text-gray-600">Casamento:</span>
              {casamento.data_inicio ? formatFullDate(casamento.data_inicio) : 'Data não informada'}
            </p>
          </div>
        )}
      </div>

      {/* Cônjuge */}
      {conjuge && conjugeGenderColors && (
        <div
          className="border-t border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
          style={{ borderLeftColor: conjugeGenderColors.border }}
          onClick={(e) => {
            e.stopPropagation()
            onConjugeClick?.(conjuge)
          }}
        >
          <div
            className="p-3"
            style={{ borderLeft: `4px solid ${conjugeGenderColors.border}`, marginLeft: -4 }}
          >
            <div className="flex items-center gap-3">
              <PersonAvatar pessoa={conjuge} size={36} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-gray-800 text-sm leading-tight">
                    {conjugeNome}
                  </h4>
                  <FamilySearchIcon />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge deceased={isDeceased(conjuge)} />
                  <span className="text-xs text-gray-400 font-mono">{conjugePid}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Botão de adicionar cônjuge */}
      {!conjuge && onAddConjuge && (
        <div
          className="border-t border-dashed border-gray-200 p-3 cursor-pointer hover:bg-gray-50 transition-colors group"
          onClick={(e) => {
            e.stopPropagation()
            onAddConjuge(pessoa)
          }}
        >
          <div className="flex items-center gap-2 text-gray-400 group-hover:text-teal-600">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-teal-50">
              <UserPlus className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium">Adicionar cônjuge</span>
          </div>
        </div>
      )}

      {/* Filhos dropdown */}
      {showChildrenDropdown && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors">
          <span className="text-sm font-medium text-gray-600">Filhos</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
      )}
    </div>
  )
}

// Botão de adicionar pessoa estilo FamilySearch
interface AddPersonButtonProps {
  type: 'pai' | 'mae' | 'filho' | 'pessoa'
  onClick?: () => void
  disabled?: boolean
}

export function AddPersonButton({ type, onClick, disabled }: AddPersonButtonProps) {
  const config = {
    pai: { label: 'ACRESCENTAR O PAI', color: colors.male },
    mae: { label: 'ACRESCENTAR A MÃE', color: colors.female },
    filho: { label: 'ACRESCENTAR FILHO(A)', color: colors.green },
    pessoa: { label: 'ADICIONAR PESSOA', color: colors.neutral }
  }

  const { label, color } = config[type]

  return (
    <button
      className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-teal-500 hover:bg-teal-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
      onClick={onClick}
      disabled={disabled}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ backgroundColor: `${color}20` }}
      >
        <svg className="w-5 h-5" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
      <span style={{ color }} className="font-semibold text-sm tracking-wide">
        {label}
      </span>
    </button>
  )
}
