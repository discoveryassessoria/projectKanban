// src/components/arvore/pessoa-sidebar.tsx

"use client"

import { useState, useEffect } from "react"
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
import type { PessoaArvore, UniaoArvore, DocumentoArvore } from "./types"

// ========================================
// TIPOS
// ========================================
interface PessoaSidebarProps {
  pessoa: PessoaArvore | null
  conjuges?: PessoaArvore[]
  casamentos?: UniaoArvore[]
  onClose: () => void
  onOpenFullDetails: (pessoa: PessoaArvore) => void
  onEdit?: (pessoa: PessoaArvore) => void
  onDelete?: (pessoa: PessoaArvore) => void
  onAddFilho?: (pessoaId: number) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
  onAddDocumento?: (pessoaId: number) => void
  onEditDocumento?: (documento: DocumentoArvore) => void
  onDeleteDocumento?: (documento: DocumentoArvore) => void
  // NOVO: Callback para selecionar outra pessoa (navegar na sidebar + centralizar árvore)
  onSelectPerson?: (pessoa: PessoaArvore) => void
  // Prop para abrir em aba específica (ex: "documentos" vindo da pesquisa)
  initialTab?: string
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
  CERTIDAO_NASCIMENTO_INTEIRO_TEOR: 'Certidão de Nascimento (Inteiro Teor)',
  CERTIDAO_CASAMENTO_INTEIRO_TEOR: 'Certidão de Casamento (Inteiro Teor)',
  CERTIDAO_OBITO_INTEIRO_TEOR: 'Certidão de Óbito (Inteiro Teor)',
  CERTIDAO_BATISMO: 'Certidão de Batismo',
  CNN: 'Certidão Negativa de Naturalização (CNN)',
  RG: 'RG',
  CPF: 'CPF',
  OUTRO: 'Outro'
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  PENDENTE: { label: 'Pendente', color: '#92400E', bg: '#FEF3C7', icon: Clock },           // 🟡 Amarelo
  EM_BUSCA: { label: 'Em Busca', color: '#1D4ED8', bg: '#DBEAFE', icon: Clock },           // 🔵 Azul
  SOLICITAR: { label: 'Solicitar', color: '#DC2626', bg: '#FEE2E2', icon: AlertCircle },   // 🔴 Vermelho (urgente!)
  SOLICITADO: { label: 'Solicitado', color: '#EA580C', bg: '#FFEDD5', icon: Clock },       // 🟠 Laranja
  RECEBIDO: { label: 'Recebido', color: '#059669', bg: '#D1FAE5', icon: CheckCircle2 },    // 🟢 Verde
  EM_TRADUCAO: { label: 'Em Tradução', color: '#7C3AED', bg: '#EDE9FE', icon: Clock },     // 🟣 Roxo
  TRADUZIDO: { label: 'Traduzido', color: '#0891B2', bg: '#CFFAFE', icon: CheckCircle2 },  // 🔵 Ciano
  APOSTILADO: { label: 'Apostilado', color: '#059669', bg: '#D1FAE5', icon: CheckCircle2 },// 🟢 Verde
  ENTREGUE: { label: 'Entregue', color: '#166534', bg: '#DCFCE7', icon: CheckCircle2 },    // 🟢 Verde escuro
  INVALIDO: { label: 'Inválido', color: '#991B1B', bg: '#FEE2E2', icon: AlertCircle },     // 🔴 Vermelho
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

function DocumentoCard({ 
  documento, 
  onClick,
  onDelete 
}: { 
  documento: DocumentoArvore
  onClick?: () => void
  onDelete?: () => void
}) {
  const statusConfig = STATUS_CONFIG[documento.status] || STATUS_CONFIG.PENDENTE
  const StatusIcon = statusConfig.icon
  const [confirmDelete, setConfirmDelete] = useState(false)
  
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDelete) {
      onDelete?.()
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      // Reset após 3 segundos
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }
  
  return (
    <div 
      className={`p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors ${onClick ? 'cursor-pointer hover:shadow-sm' : ''}`}
      onClick={onClick}
    >
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
        <div className="flex items-center gap-1 flex-shrink-0">
          <div 
            className="px-2 py-1 rounded-md flex items-center gap-1"
            style={{ backgroundColor: statusConfig.bg }}
          >
            <StatusIcon className="w-3 h-3" style={{ color: statusConfig.color }} />
            <span className="text-[10px] font-medium" style={{ color: statusConfig.color }}>
              {statusConfig.label}
            </span>
          </div>
          {onDelete && (
            <button
              onClick={handleDelete}
              className={`p-1.5 rounded-md transition-colors ${
                confirmDelete 
                  ? 'bg-red-500 text-white hover:bg-red-600' 
                  : 'hover:bg-red-50 text-slate-400 hover:text-red-500'
              }`}
              title={confirmDelete ? 'Clique para confirmar' : 'Excluir documento'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      
      {/* Badges e links de arquivos */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
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
      </div>
      
      {/* Links para arquivos */}
      {(documento.arquivo_url || documento.arquivo_traducao_url || documento.arquivo_apostila_url) && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
          {documento.arquivo_url && (
            <a 
              href={documento.arquivo_url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-teal-600 hover:text-teal-700 font-medium"
            >
              <FileText className="w-3 h-3" />
              Original
            </a>
          )}
          {documento.arquivo_traducao_url && (
            <a 
              href={documento.arquivo_traducao_url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-cyan-600 hover:text-cyan-700 font-medium"
            >
              <FileText className="w-3 h-3" />
              Tradução
            </a>
          )}
          {documento.arquivo_apostila_url && (
            <a 
              href={documento.arquivo_apostila_url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-purple-600 hover:text-purple-700 font-medium"
            >
              <FileText className="w-3 h-3" />
              Apostila
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ========================================
// NOVO: Card de familiar clicável
// ========================================
function FamiliarCard({ 
  familiar, 
  relacao, 
  extra,
  onClick 
}: { 
  familiar: PessoaArvore
  relacao: string
  extra?: React.ReactNode
  onClick?: () => void 
}) {
  return (
    <div 
      className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-teal-50 hover:ring-1 hover:ring-teal-200 transition-all cursor-pointer group"
      onClick={onClick}
    >
      <PersonAvatar pessoa={familiar} size={40} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-900 text-sm group-hover:text-teal-700 transition-colors">
          {familiar.nome} {familiar.sobrenome}
        </p>
        <p className="text-xs text-slate-500">{relacao}</p>
        {extra}
      </div>
      <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-teal-500 transition-colors" />
    </div>
  )
}

// ========================================
// COMPONENTE PRINCIPAL
// ========================================
export function PessoaSidebar({ 
  pessoa, 
  conjuges = [], 
  casamentos = [], 
  onClose, 
  onOpenFullDetails, 
  onEdit, 
  onDelete,
  onAddFilho,
  onAddPai,
  onAddMae,
  onAddConjuge,
  onAddDocumento,
  onEditDocumento,
  onDeleteDocumento,
  onSelectPerson,
  initialTab
}: PessoaSidebarProps) {
  const [activeTab, setActiveTab] = useState<"info" | "familia" | "docs">("info")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [initialTabProcessed, setInitialTabProcessed] = useState(false)
  
  // Efeito para definir aba inicial quando a sidebar abre (vindo da pesquisa)
  useEffect(() => {
    if (pessoa && initialTab && !initialTabProcessed) {
      if (initialTab === "documentos" || initialTab === "docs") {
        setActiveTab("docs")
      } else if (initialTab === "familia") {
        setActiveTab("familia")
      } else if (initialTab === "info") {
        setActiveTab("info")
      }
      setInitialTabProcessed(true)
    }
  }, [pessoa, initialTab, initialTabProcessed])

  // Reset quando a pessoa muda (clique manual em outra pessoa)
  useEffect(() => {
    if (pessoa && !initialTab) {
      setActiveTab("info")
    }
    // Reset flag quando pessoa muda
    setInitialTabProcessed(false)
  }, [pessoa?.id])
  
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

  // Handler para selecionar um familiar
  const handleSelectFamiliar = (familiar: PessoaArvore) => {
    if (onSelectPerson) {
      onSelectPerson(familiar)
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
            
            {/* Seção: Casamentos */}
            <CollapsibleSection title="Casamento" icon={Heart} defaultOpen={casamentos.length > 0}>
              <div className="space-y-3">
                {casamentos.length > 0 ? (
                  casamentos.map((casamento, index) => {
                    const conjuge = conjuges.find(c => 
                      (casamento.pessoa1Id === pessoa.id && casamento.pessoa2Id === c.id) ||
                      (casamento.pessoa2Id === pessoa.id && casamento.pessoa1Id === c.id)
                    )
                    return (
                      <div key={casamento.id} className="space-y-1">
                        {casamentos.length > 1 && (
                          <p className="text-xs font-medium text-slate-500">
                            {index + 1}º Casamento {conjuge && `- ${conjuge.nome}`}
                          </p>
                        )}
                        <InfoItem 
                          icon={Calendar} 
                          label="Data de Casamento" 
                          value={formatDateFull(casamento.data_inicio)} 
                        />
                        <InfoItem 
                          icon={MapPin} 
                          label="Local de Casamento" 
                          value={casamento.local} 
                        />
                      </div>
                    )
                  })
                ) : (
                  <p className="text-sm text-slate-400">Nenhum casamento registrado</p>
                )}
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
                    <FamiliarCard 
                      familiar={pessoa.pai}
                      relacao="Pai"
                      onClick={() => handleSelectFamiliar(pessoa.pai!)}
                    />
                  )}
                  {pessoa.mae && (
                    <FamiliarCard 
                      familiar={pessoa.mae}
                      relacao="Mãe"
                      onClick={() => handleSelectFamiliar(pessoa.mae!)}
                    />
                  )}
                  {/* Botão para adicionar pai se não tem */}
                  {!pessoa.pai && (
                    <button 
                      onClick={() => onAddPai?.(pessoa.id)}
                      className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm font-medium">Adicionar Pai</span>
                    </button>
                  )}
                  {/* Botão para adicionar mãe se não tem */}
                  {!pessoa.mae && (
                    <button 
                      onClick={() => onAddMae?.(pessoa.id)}
                      className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-sm font-medium">Adicionar Mãe</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <button 
                    onClick={() => onAddPai?.(pessoa.id)}
                    className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm font-medium">Adicionar Pai</span>
                  </button>
                  <button 
                    onClick={() => onAddMae?.(pessoa.id)}
                    className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="text-sm font-medium">Adicionar Mãe</span>
                  </button>
                </div>
              )}
            </div>
            
            {/* Cônjuges */}
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cônjuge</h4>
              <div className="space-y-2">
                {conjuges.map((conjuge) => {
                  // Encontrar o casamento correspondente
                  const casamento = casamentos.find(c => 
                    (c.pessoa1Id === pessoa.id && c.pessoa2Id === conjuge.id) ||
                    (c.pessoa2Id === pessoa.id && c.pessoa1Id === conjuge.id)
                  )
                  
                  return (
                    <div 
                      key={conjuge.id} 
                      className="p-3 bg-slate-50 rounded-lg hover:bg-teal-50 hover:ring-1 hover:ring-teal-200 transition-all cursor-pointer group"
                      onClick={() => handleSelectFamiliar(conjuge)}
                    >
                      <div className="flex items-center gap-3">
                        <PersonAvatar pessoa={conjuge} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 text-sm group-hover:text-teal-700 transition-colors">
                            {conjuge.nome} {conjuge.sobrenome}
                          </p>
                          {casamento?.data_inicio && (
                            <p className="text-xs text-slate-500">
                              Casamento: {formatDateFull(casamento.data_inicio)}
                            </p>
                          )}
                        </div>
                        <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-teal-500 transition-colors" />
                      </div>
                      {casamento && (casamento.local || casamento.cartorio) && (
                        <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
                          {casamento.local && <p>{casamento.local}</p>}
                          {casamento.cartorio && <p>{casamento.cartorio}</p>}
                        </div>
                      )}
                    </div>
                  )
                })}
                
                {/* Botão para adicionar cônjuge - sempre visível */}
                <button 
                  onClick={() => onAddConjuge?.(pessoa.id)}
                  className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg text-teal-600 hover:border-teal-300 hover:bg-teal-50 transition-colors"
                >
                  <Heart className="w-4 h-4" />
                  <span className="text-sm font-medium">Adicionar cônjuge</span>
                </button>
              </div>
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
                      <FamiliarCard 
                        key={filho.id}
                        familiar={filho}
                        relacao="Filho(a)"
                        onClick={() => handleSelectFamiliar(filho)}
                      />
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
                  <DocumentoCard 
                    key={doc.id} 
                    documento={doc} 
                    onClick={() => onEditDocumento?.(doc)}
                    onDelete={() => onDeleteDocumento?.(doc)}
                  />
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
            
            <button 
              onClick={() => onAddDocumento?.(pessoa.id)}
              className="w-full mt-4 flex items-center justify-center gap-2 p-3 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
            >
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