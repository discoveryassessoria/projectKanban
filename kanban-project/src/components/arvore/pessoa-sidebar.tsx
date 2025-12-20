"use client"

import { useState } from "react"
import { 
  X, 
  User, 
  GitBranch, 
  Plus, 
  Pencil, 
  Trash2,
  FileText,
  MapPin,
  Calendar,
  Heart,
  Globe,
  AlertCircle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ExternalLink
} from "lucide-react"

// ========================================
// TIPOS
// ========================================
interface PessoaArvore {
  id: number
  nome: string
  sobrenome?: string | null
  sexo?: string | null
  data_nasc?: Date | string | null
  data_obito?: Date | string | null
  local_nasc?: string | null
  estado_nasc?: string | null
  pais_nasc?: string | null
  local_obito?: string | null
  vivo?: boolean
  batizado?: string | null
  data_batismo?: Date | string | null
  local_batismo?: string | null
  igreja_batismo?: string | null
  profissao?: string | null
  nacionalidade?: string | null
  naturalizado?: boolean
  data_naturalizacao?: Date | string | null
  data_emigracao?: Date | string | null
  porto_embarque?: string | null
  data_chegada?: Date | string | null
  porto_chegada?: string | null
  navio?: string | null
  local_emigracao?: string | null
  comentario?: string | null
  paiId?: number | null
  maeId?: number | null
  pai?: PessoaArvore | null
  mae?: PessoaArvore | null
  filhosComoPai?: PessoaArvore[]
  filhosComoMae?: PessoaArvore[]
  documentos?: DocumentoArvore[]
}

interface UniaoArvore {
  id: number
  data_inicio?: Date | string | null
  data_fim?: Date | string | null
  tipo?: string | null
  local?: string | null
  estado?: string | null
  pais?: string | null
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
}

interface DocumentoArvore {
  id: number
  tipo: string
  descricao?: string | null
  status: string
  cartorio?: string | null
  livro?: string | null
  folha?: string | null
  termo?: string | null
  arquivo_url?: string | null
  traduzido?: boolean
  apostilado?: boolean
}

interface PessoaSidebarProps {
  pessoa: PessoaArvore | null
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  onClose: () => void
  onOpenFullDetails: (pessoa: PessoaArvore) => void
  onEdit?: (pessoa: PessoaArvore) => void
  onDelete?: (pessoa: PessoaArvore) => void
  onAddFilho?: (pessoaId: number) => void
}

// ========================================
// HELPERS
// ========================================
const colors = {
  male: '#2563EB',
  female: '#DB2777',
  neutral: '#6B7280',
}

// Função corrigida para evitar problemas de timezone
function formatDateFull(date: Date | string | null | undefined): string {
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

function formatYear(date: Date | string | null | undefined): string {
  if (!date) return ""
  
  // Se for string ISO, extrair apenas o ano
  if (typeof date === 'string') {
    const datePart = date.split('T')[0]
    if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year] = datePart.split('-')
      return year
    }
  }
  
  return new Date(date).getUTCFullYear().toString()
}

function getGenderColor(sexo: string | null | undefined): string {
  const s = sexo?.toLowerCase()
  if (s === 'masculino' || s === 'm') return colors.male
  if (s === 'feminino' || s === 'f') return colors.female
  return colors.neutral
}

const TIPO_DOCUMENTO_LABELS: Record<string, string> = {
  CERTIDAO_NASCIMENTO: 'Certidão de Nascimento',
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: 'Certidão de Nascimento (Inteiro Teor)',
  CERTIDAO_CASAMENTO: 'Certidão de Casamento',
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: 'Certidão de Casamento (Inteiro Teor)',
  CERTIDAO_OBITO: 'Certidão de Óbito',
  CERTIDAO_OBITO_INTEIRO_TEOR: 'Certidão de Óbito (Inteiro Teor)',
  CERTIDAO_BATISMO: 'Certidão de Batismo',
  CNN: 'Certidão Negativa de Naturalização',
  RG: 'RG',
  CPF: 'CPF',
  PASSAPORTE: 'Passaporte',
  OUTRO: 'Outro'
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  PENDENTE: { label: 'Pendente', color: '#92400E', bg: '#FEF3C7', icon: Clock },
  SOLICITADO: { label: 'Solicitado', color: '#1E40AF', bg: '#DBEAFE', icon: Clock },
  RECEBIDO: { label: 'Recebido', color: '#065F46', bg: '#D1FAE5', icon: CheckCircle2 },
  EM_TRADUCAO: { label: 'Em Tradução', color: '#3730A3', bg: '#E0E7FF', icon: Clock },
  TRADUZIDO: { label: 'Traduzido', color: '#155E75', bg: '#CFFAFE', icon: CheckCircle2 },
  APOSTILADO: { label: 'Apostilado', color: '#6B21A8', bg: '#F3E8FF', icon: CheckCircle2 },
  ENTREGUE: { label: 'Entregue', color: '#166534', bg: '#DCFCE7', icon: CheckCircle2 },
  INVALIDO: { label: 'Inválido', color: '#991B1B', bg: '#FEE2E2', icon: AlertCircle },
}

// ========================================
// COMPONENTES AUXILIARES
// ========================================
function PersonAvatar({ pessoa, size = 56 }: { pessoa: PessoaArvore; size?: number }) {
  const color = getGenderColor(pessoa.sexo)
  const inicial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  
  return (
    <div
      className="rounded-xl flex items-center justify-center font-bold text-white shadow-md"
      style={{ 
        width: size, 
        height: size, 
        backgroundColor: color,
        fontSize: size * 0.4
      }}
    >
      {inicial}
    </div>
  )
}

function InfoItem({ 
  icon: Icon, 
  label, 
  value, 
  onAdd 
}: { 
  icon: any
  label: string
  value?: string | null
  onAdd?: () => void 
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        {value ? (
          <p className="text-sm text-slate-900 mt-0.5">{value}</p>
        ) : onAdd ? (
          <button 
            onClick={onAdd}
            className="flex items-center gap-1 text-teal-600 hover:text-teal-700 text-sm mt-0.5"
          >
            <Plus className="w-3 h-3" />
            Adicionar
          </button>
        ) : (
          <p className="text-sm text-slate-400 italic mt-0.5">Não informado</p>
        )}
      </div>
    </div>
  )
}

function CollapsibleSection({ 
  title, 
  icon: Icon,
  children, 
  defaultOpen = true
}: { 
  title: string
  icon?: any
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button 
        className="w-full flex items-center justify-between py-3 px-4 hover:bg-slate-50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-slate-500" />}
          <span className="font-semibold text-slate-900 text-sm">{title}</span>
        </div>
        <div className={`transform transition-transform ${isOpen ? '' : '-rotate-90'}`}>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

function DocumentoCard({ documento }: { documento: DocumentoArvore }) {
  const statusConfig = STATUS_CONFIG[documento.status] || STATUS_CONFIG.PENDENTE
  const StatusIcon = statusConfig.icon
  
  return (
    <div className="p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-900 text-sm truncate">
            {TIPO_DOCUMENTO_LABELS[documento.tipo] || documento.tipo}
          </p>
          {documento.cartorio && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {documento.cartorio}
            </p>
          )}
          {(documento.livro || documento.folha || documento.termo) && (
            <p className="text-xs text-slate-400 mt-0.5">
              {[
                documento.livro && `Livro: ${documento.livro}`,
                documento.folha && `Folha: ${documento.folha}`,
                documento.termo && `Termo: ${documento.termo}`,
              ].filter(Boolean).join(' • ')}
            </p>
          )}
        </div>
        <div 
          className="px-2 py-1 rounded-md flex items-center gap-1 flex-shrink-0"
          style={{ backgroundColor: statusConfig.bg }}
        >
          <StatusIcon className="w-3 h-3" style={{ color: statusConfig.color }} />
          <span className="text-[10px] font-medium" style={{ color: statusConfig.color }}>
            {statusConfig.label}
          </span>
        </div>
      </div>
      
      {/* Badges de tradução e apostilamento */}
      <div className="flex items-center gap-2 mt-2">
        {documento.traduzido && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-cyan-50 text-cyan-700">
            Traduzido
          </span>
        )}
        {documento.apostilado && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-50 text-purple-700">
            Apostilado
          </span>
        )}
        {documento.arquivo_url && (
          <a 
            href={documento.arquivo_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-teal-600 hover:text-teal-700"
          >
            <ExternalLink className="w-3 h-3" />
            Ver arquivo
          </a>
        )}
      </div>
    </div>
  )
}

// ========================================
// COMPONENTE PRINCIPAL
// ========================================
export function PessoaSidebar({ 
  pessoa, 
  conjuge, 
  casamento, 
  onClose, 
  onOpenFullDetails, 
  onEdit, 
  onDelete,
  onAddFilho
}: PessoaSidebarProps) {
  const [activeTab, setActiveTab] = useState<"info" | "familia" | "docs">("info")
  const [confirmDelete, setConfirmDelete] = useState(false)
  
  if (!pessoa) return null
  
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const isDeceased = pessoa.vivo === false || !!pessoa.data_obito
  const documentos = pessoa.documentos || []

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete?.(pessoa)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
    }
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl z-[10001] flex flex-col border-l border-slate-200">
      {/* Header */}
      <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <X className="h-5 w-5 text-slate-500" />
        </button>
        
        <div className="flex items-start gap-4">
          <PersonAvatar pessoa={pessoa} size={64} />
          <div className="flex-1 min-w-0">
            <h2 
              className="text-xl font-bold text-slate-900 hover:text-teal-600 cursor-pointer transition-colors truncate"
              onClick={() => onOpenFullDetails(pessoa)}
            >
              {nomeCompleto}
            </h2>
            
            <div className="flex items-center gap-2 mt-1">
              {isDeceased ? (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-600">
                  Falecido
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-700">
                  Vivo
                </span>
              )}
              {pessoa.nacionalidade && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-blue-50 text-blue-700">
                  {pessoa.nacionalidade}
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Ações */}
        <div className="mt-4 flex items-center gap-2">
          <button 
            onClick={() => onEdit?.(pessoa)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            <span className="text-sm font-medium">Editar</span>
          </button>
          <button 
            onClick={handleDelete}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              confirmDelete 
                ? 'bg-red-600 text-white hover:bg-red-700 flex-1' 
                : 'bg-red-50 text-red-600 hover:bg-red-100'
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete && <span className="text-sm font-medium">Confirmar?</span>}
          </button>
          {confirmDelete && (
            <button 
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
      
      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50">
        <button
          onClick={() => setActiveTab("info")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === "info" 
              ? 'text-teal-600 bg-white' 
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <User className="h-4 w-4" />
          Informações
          {activeTab === "info" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("familia")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === "familia" 
              ? 'text-teal-600 bg-white' 
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <GitBranch className="h-4 w-4" />
          Família
          {activeTab === "familia" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("docs")}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === "docs" 
              ? 'text-teal-600 bg-white' 
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" />
          Documentos
          {documentos.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-teal-100 text-teal-700">
              {documentos.length}
            </span>
          )}
          {activeTab === "docs" && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500" />
          )}
        </button>
      </div>
      
      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto">
        {/* TAB: Informações */}
        {activeTab === "info" && (
          <div>
            {/* Seção: Nascimento */}
            <CollapsibleSection title="Nascimento" icon={Calendar} defaultOpen={true}>
              <div className="space-y-1">
                <InfoItem 
                  icon={Calendar} 
                  label="Data de Nascimento" 
                  value={formatDateFull(pessoa.data_nasc)} 
                />
                <InfoItem 
                  icon={MapPin} 
                  label="Local de Nascimento" 
                  value={pessoa.local_nasc} 
                />
                <InfoItem 
                  icon={Globe} 
                  label="País de Nascimento" 
                  value={pessoa.pais_nasc} 
                />
                <InfoItem 
                  icon={Globe} 
                  label="Nacionalidade" 
                  value={pessoa.nacionalidade} 
                />
              </div>
            </CollapsibleSection>
            
            {/* Seção: Casamento */}
            <CollapsibleSection title="Casamento" icon={Heart} defaultOpen={!!casamento}>
              <div className="space-y-1">
                <InfoItem 
                  icon={Calendar} 
                  label="Data de Casamento" 
                  value={casamento ? formatDateFull(casamento.data_inicio) : null} 
                />
                <InfoItem 
                  icon={MapPin} 
                  label="Local de Casamento" 
                  value={casamento?.local} 
                />
              </div>
            </CollapsibleSection>
            
            {/* Seção: Falecimento */}
            <CollapsibleSection title="Falecimento" icon={Calendar} defaultOpen={isDeceased}>
              <div className="space-y-1">
                <InfoItem 
                  icon={Calendar} 
                  label="Data de Falecimento" 
                  value={formatDateFull(pessoa.data_obito)} 
                />
                <InfoItem 
                  icon={MapPin} 
                  label="Local de Falecimento" 
                  value={pessoa.local_obito || pessoa.local_emigracao} 
                />
              </div>
            </CollapsibleSection>
            
            {/* Seção: Observações */}
            {pessoa.comentario && (
              <CollapsibleSection title="Observações" defaultOpen={false}>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">
                  {pessoa.comentario}
                </p>
              </CollapsibleSection>
            )}
          </div>
        )}
        
        {/* TAB: Família */}
        {activeTab === "familia" && (
          <div className="p-4 space-y-4">
            {/* Pais */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pais</h4>
              {(pessoa.pai || pessoa.mae) ? (
                <div className="space-y-2">
                  {pessoa.pai && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
                      <PersonAvatar pessoa={pessoa.pai} size={40} />
                      <div>
                        <p className="font-medium text-slate-900 text-sm">
                          {pessoa.pai.nome} {pessoa.pai.sobrenome}
                        </p>
                        <p className="text-xs text-slate-500">Pai</p>
                      </div>
                    </div>
                  )}
                  {pessoa.mae && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
                      <PersonAvatar pessoa={pessoa.mae} size={40} />
                      <div>
                        <p className="font-medium text-slate-900 text-sm">
                          {pessoa.mae.nome} {pessoa.mae.sobrenome}
                        </p>
                        <p className="text-xs text-slate-500">Mãe</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors">
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">Adicionar pais</span>
                </button>
              )}
            </div>
            
            {/* Cônjuge */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cônjuge</h4>
              {conjuge ? (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <PersonAvatar pessoa={conjuge} size={40} />
                    <div>
                      <p className="font-medium text-slate-900 text-sm">
                        {conjuge.nome} {conjuge.sobrenome}
                      </p>
                      {casamento?.data_inicio && (
                        <p className="text-xs text-slate-500">
                          Casamento: {formatDateFull(casamento.data_inicio)}
                        </p>
                      )}
                    </div>
                  </div>
                  {casamento && (casamento.local || casamento.cartorio) && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
                      {casamento.local && <p>{casamento.local}</p>}
                      {casamento.cartorio && <p>{casamento.cartorio}</p>}
                    </div>
                  )}
                </div>
              ) : (
                <button className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors">
                  <Heart className="w-4 h-4" />
                  <span className="text-sm font-medium">Adicionar cônjuge</span>
                </button>
              )}
            </div>
            
            {/* Filhos */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Filhos</h4>
              {(() => {
                const filhos = [
                  ...(pessoa.filhosComoPai || []),
                  ...(pessoa.filhosComoMae || [])
                ].filter((filho, index, self) => 
                  self.findIndex(f => f.id === filho.id) === index
                )
                
                return (
                  <div className="space-y-2">
                    {filhos.map(filho => (
                      <div key={filho.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
                        <PersonAvatar pessoa={filho} size={40} />
                        <div>
                          <p className="font-medium text-slate-900 text-sm">
                            {filho.nome} {filho.sobrenome}
                          </p>
                          <p className="text-xs text-slate-500">Filho(a)</p>
                        </div>
                      </div>
                    ))}
                    <button 
                      onClick={() => onAddFilho?.(pessoa.id)}
                      className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm font-medium">Adicionar filho(a)</span>
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
        )}
        
        {/* TAB: Documentos */}
        {activeTab === "docs" && (
          <div className="p-4">
            {documentos.length > 0 ? (
              <div className="space-y-3">
                {documentos.map((doc) => (
                  <DocumentoCard key={doc.id} documento={doc} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-slate-500 text-sm mb-4">Nenhum documento cadastrado</p>
              </div>
            )}
            
            <button className="w-full mt-4 flex items-center justify-center gap-2 p-3 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors">
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Adicionar documento</span>
            </button>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50">
        <button 
          onClick={() => onOpenFullDetails(pessoa)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="font-medium">Ver detalhes completos</span>
        </button>
      </div>
    </div>
  )
}