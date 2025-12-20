"use client"

import { PersonIcon } from "./pessoa-icon"
import { ChevronDown, UserPlus, ExternalLink } from "lucide-react"

// ✅ ATUALIZADO: Interface com todos os novos campos
export interface PessoaArvore {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  
  // Datas
  data_nasc?: Date | string | null
  data_obito?: Date | string | null
  
  // Local de nascimento (expandido)
  local_nasc?: string | null
  estado_nasc?: string | null      // ✅ NOVO
  pais_nasc?: string | null        // ✅ NOVO - importante para cidadania
  
  // Status vital
  vivo?: boolean                   // ✅ NOVO
  
  // Batismo (expandido)
  batizado?: string | null
  data_batismo?: Date | string | null    // ✅ NOVO
  local_batismo?: string | null          // ✅ NOVO
  igreja_batismo?: string | null         // ✅ NOVO
  
  // Profissão e nacionalidade
  profissao?: string | null              // ✅ NOVO
  nacionalidade?: string | null          // ✅ NOVO
  cidadanias_outras?: string | null      // ✅ NOVO
  
  // Naturalização
  naturalizado?: boolean                 // ✅ NOVO
  data_naturalizacao?: Date | string | null  // ✅ NOVO
  pais_naturalizacao?: string | null     // ✅ NOVO
  
  // Emigração/Imigração
  data_emigracao?: Date | string | null  // ✅ NOVO
  local_emigracao?: string | null        // ✅ NOVO
  porto_embarque?: string | null         // ✅ NOVO
  data_chegada?: Date | string | null    // ✅ NOVO
  porto_chegada?: string | null          // ✅ NOVO
  pais_destino?: string | null           // ✅ NOVO
  navio?: string | null                  // ✅ NOVO
  
  // Notas
  comentario?: string | null
  
  // Posição no canvas
  x?: number | null
  y?: number | null
  
  // IDs
  arvoreId: number
  paiId?: number | null
  maeId?: number | null
  pid?: string | null
  
  // Timestamps
  createdAt?: Date | string | null       // ✅ NOVO
  updatedAt?: Date | string | null       // ✅ NOVO
  
  // Relacionamentos
  pai?: PessoaArvore | null
  mae?: PessoaArvore | null
  filhosComoPai?: PessoaArvore[]
  filhosComoMae?: PessoaArvore[]
  unioesComoPessoa1?: UniaoArvore[]
  unioesComoPessoa2?: UniaoArvore[]
  documentos?: DocumentoArvore[]         // ✅ NOVO
}

// ✅ ATUALIZADO: Interface de União com campos de certidão
export interface UniaoArvore {
  id: number
  data_inicio?: Date | string | null
  data_fim?: Date | string | null
  tipo?: string | null
  
  // Local (expandido)
  local?: string | null
  estado?: string | null                 // ✅ NOVO
  pais?: string | null                   // ✅ NOVO
  
  // Dados da certidão de casamento
  cartorio?: string | null               // ✅ NOVO
  livro?: string | null                  // ✅ NOVO
  folha?: string | null                  // ✅ NOVO
  termo?: string | null                  // ✅ NOVO
  numero_registro?: string | null        // ✅ NOVO
  data_registro?: Date | string | null   // ✅ NOVO
  
  // Observações
  observacoes?: string | null            // ✅ NOVO
  
  // IDs
  pessoa1Id: number
  pessoa2Id: number
  
  // Timestamps
  createdAt?: Date | string | null       // ✅ NOVO
  updatedAt?: Date | string | null       // ✅ NOVO
  
  // Relacionamentos
  pessoa1?: PessoaArvore
  pessoa2?: PessoaArvore
}

// ✅ NOVO: Interface de Documento
export interface DocumentoArvore {
  id: number
  pessoaId: number
  tipo: string
  status: string
  descricao?: string | null
  
  // Dados do registro
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  numero_registro?: string | null
  data_registro?: Date | string | null
  cidade_registro?: string | null
  estado_registro?: string | null
  pais_registro?: string | null
  
  // Documentos de identidade
  numero?: string | null
  orgao_emissor?: string | null
  data_emissao?: Date | string | null
  data_validade?: Date | string | null
  
  // Arquivo
  arquivo_url?: string | null
  arquivo_nome?: string | null
  
  // Tradução
  traduzido?: boolean
  tradutor?: string | null
  data_traducao?: Date | string | null
  
  // Apostilamento
  apostilado?: boolean
  numero_apostila?: string | null
  data_apostila?: Date | string | null
  
  // Observações
  observacoes?: string | null
  
  // Timestamps
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
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
  
  // Se for string ISO, extrair apenas a parte da data para evitar problemas de timezone
  if (typeof date === 'string') {
    const datePart = date.split('T')[0]
    if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year] = datePart.split('-')
      return year
    }
  }
  
  const d = new Date(date)
  return d.getUTCFullYear().toString()
}

function formatFullDate(date: Date | string | null | undefined): string {
  if (!date) return ""
  
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ]
  
  // Se for string ISO, extrair apenas a parte da data para evitar problemas de timezone
  if (typeof date === 'string') {
    const datePart = date.split('T')[0]
    if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = datePart.split('-')
      const mes = meses[parseInt(month, 10) - 1]
      return `${parseInt(day, 10)} de ${mes} de ${year}`
    }
  }
  
  const d = new Date(date)
  const day = d.getUTCDate()
  const month = meses[d.getUTCMonth()]
  const year = d.getUTCFullYear()
  return `${day} de ${month} de ${year}`
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let pid = ''
  const seed = id * 12345
  for (let i = 0; i < 4; i++) {
    pid += chars[(seed * (i + 1)) % chars.length]
  }
  return `${pid.slice(0, 4)}-${pid.slice(0, 3)}`
}

// ✅ ATUALIZADO: Usa campo 'vivo' se disponível, senão verifica data_obito
function isDeceased(pessoa: PessoaArvore): boolean {
  if (pessoa.vivo !== undefined) {
    return !pessoa.vivo
  }
  return !!pessoa.data_obito
}

// Componente de Avatar estilo FamilySearch
function PersonAvatar({ pessoa, size = 40 }: { pessoa: PessoaArvore; size?: number }) {
  const genderColors = getGenderColors(pessoa.sexo)
  const initial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  const deceased = isDeceased(pessoa)
  
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shadow-sm relative"
      style={{
        width: size,
        height: size,
        backgroundColor: genderColors.border,
        fontSize: size * 0.4,
        opacity: deceased ? 0.7 : 1
      }}
    >
      {initial}
      {deceased && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-gray-500 rounded-full flex items-center justify-center">
          <span className="text-white text-[8px]">†</span>
        </div>
      )}
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

// ✅ NOVO: Badge de país de nascimento
function CountryBadge({ pais }: { pais?: string | null }) {
  if (!pais) return null
  
  // Mapeia países para bandeiras emoji
  const flags: Record<string, string> = {
    'brasil': '🇧🇷',
    'brazil': '🇧🇷',
    'itália': '🇮🇹',
    'italia': '🇮🇹',
    'italy': '🇮🇹',
    'portugal': '🇵🇹',
    'espanha': '🇪🇸',
    'spain': '🇪🇸',
    'alemanha': '🇩🇪',
    'germany': '🇩🇪',
  }
  
  const flag = flags[pais.toLowerCase()] || '🌍'
  
  return (
    <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600" title={pais}>
      {flag}
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
            
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge deceased={isDeceased(pessoa)} />
              <CountryBadge pais={pessoa.pais_nasc} />
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
            {casamento.local && (
              <p className="text-xs text-gray-400 mt-0.5">
                {casamento.local}{casamento.pais ? `, ${casamento.pais}` : ''}
              </p>
            )}
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
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <StatusBadge deceased={isDeceased(conjuge)} />
                  <CountryBadge pais={conjuge.pais_nasc} />
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
  type: 'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge'
  onClick?: () => void
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function AddPersonButton({ type, onClick, disabled, size = 'md' }: AddPersonButtonProps) {
  const config = {
    pai: { label: 'ACRESCENTAR O PAI', color: colors.male },
    mae: { label: 'ACRESCENTAR A MÃE', color: colors.female },
    filho: { label: 'ACRESCENTAR FILHO(A)', color: colors.green },
    pessoa: { label: 'ADICIONAR PESSOA', color: colors.neutral },
    conjuge: { label: 'ADICIONAR CÔNJUGE', color: colors.greenDark }
  }

  const { label, color } = config[type]
  
  const sizeClasses = {
    sm: 'px-3 py-2 text-xs',
    md: 'px-4 py-3 text-sm',
    lg: 'px-6 py-4 text-base'
  }
  
  const iconSizes = {
    sm: 32,
    md: 40,
    lg: 48
  }

  return (
    <button
      className={`flex items-center gap-3 ${sizeClasses[size]} bg-white rounded-xl border-2 border-dashed border-gray-300 cursor-pointer hover:border-teal-500 hover:bg-teal-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md`}
      onClick={onClick}
      disabled={disabled}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{ 
          backgroundColor: `${color}20`,
          width: iconSizes[size],
          height: iconSizes[size]
        }}
      >
        <svg 
          className="w-5 h-5" 
          style={{ color }} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
          />
        </svg>
      </div>
      <span style={{ color }} className="font-semibold tracking-wide">
        {label}
      </span>
    </button>
  )
}