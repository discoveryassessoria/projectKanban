"use client"

import { useState } from "react"
import type { PessoaArvore, UniaoArvore } from "./types"
import { 
  ChevronLeft, 
  ChevronUp, 
  Plus,
  MapPin,
  Calendar,
  Heart,
  Church,
  FileText,
  Users
} from "lucide-react"

interface PessoaDetailsPageProps {
  pessoa: PessoaArvore
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  filhos?: PessoaArvore[]
  onBack: () => void
  onPersonClick?: (pessoa: PessoaArvore) => void
  onAddPai?: (pessoaId: number) => void
  onAddMae?: (pessoaId: number) => void
  onAddFilho?: (pessoaId: number) => void
  onAddConjuge?: (pessoaId: number) => void
}

// Cores por gênero
const colors = {
  male: '#2563EB',
  female: '#DB2777',
  neutral: '#6B7280',
}

function getGenderColor(sexo: string | null | undefined): string {
  const s = sexo?.toLowerCase()
  if (s === 'masculino' || s === 'm') return colors.male
  if (s === 'feminino' || s === 'f') return colors.female
  return colors.neutral
}

// Avatar com inicial
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

// Avatar simples para membros da família
function SmallAvatar({ pessoa, size = 32 }: { pessoa: PessoaArvore; size?: number }) {
  const color = getGenderColor(pessoa.sexo)
  const inicial = pessoa.nome?.charAt(0)?.toUpperCase() || '?'
  
  return (
    <div
      className="rounded-lg flex items-center justify-center font-semibold text-white"
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

function formatDateFull(date: Date | string | null | undefined): string {
  if (!date) return ""
  
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ]
  
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
  
  if (typeof date === 'string') {
    const datePart = date.split('T')[0]
    if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year] = datePart.split('-')
      return year
    }
  }
  
  return new Date(date).getUTCFullYear().toString()
}

function formatDateRange(nascimento: Date | string | null | undefined, obito: Date | string | null | undefined, vivo?: boolean): string {
  const nasc = formatYear(nascimento)
  const obit = obito ? formatYear(obito) : (vivo === false ? "?" : "Presente")
  if (!nasc && !obito) return ""
  if (!nasc) return `?–${obit}`
  return `${nasc}–${obit}`
}

// Toggle Switch component
function ToggleSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-teal-500' : 'bg-gray-300'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-gray-600">{label}</span>
    </label>
  )
}

// Collapsible Section component
function CollapsibleSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  
  return (
    <div className="border border-gray-200 rounded-lg mb-4 bg-white">
      <button 
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <div className={`transform transition-transform ${isOpen ? '' : 'rotate-180'}`}>
          <ChevronUp className="h-5 w-5" />
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

// Item de informação simples (sem botão de editar)
function InfoItem({ 
  label, 
  value, 
  icon: Icon
}: { 
  label: string
  value: string | null | undefined
  icon?: React.ElementType
}) {
  return (
    <div className="flex items-start gap-2 py-2">
      {Icon && <Icon className="h-4 w-4 text-gray-400 mt-0.5" />}
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="font-medium text-gray-900">{value || 'Não informado'}</p>
      </div>
    </div>
  )
}

export function PessoaDetailsPage({ 
  pessoa, 
  conjuge, 
  casamento, 
  filhos = [],
  onBack, 
  onPersonClick,
  onAddPai,
  onAddMae,
  onAddFilho,
  onAddConjuge
}: PessoaDetailsPageProps) {
  const [activeTab, setActiveTab] = useState<'sobre' | 'detalhes' | 'fontes'>('detalhes')
  const [showDetailedView, setShowDetailedView] = useState(false)
  const [showAllFamily, setShowAllFamily] = useState(false)
  const [childrenOpen, setChildrenOpen] = useState(true)
  
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito, pessoa.vivo)
  
  // Construir local de nascimento
  const localNascimento = [pessoa.local_nasc, pessoa.estado_nasc, pessoa.pais_nasc].filter(Boolean).join(', ')

  const tabs = [
    { id: 'sobre', label: 'Sobre' },
    { id: 'detalhes', label: 'Detalhes' },
    { id: 'fontes', label: `Fontes (${pessoa.documentos?.length || 0})` },
  ]
  
  return (
    <div className="fixed inset-0 bg-gray-100 z-[10002] overflow-auto">
      {/* Header fixo */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto">
          {/* Top section with avatar and name */}
          <div className="p-6 pb-4">
            <button 
              onClick={onBack}
              className="flex items-center gap-1 text-gray-600 hover:text-gray-900 mb-4"
            >
              <ChevronLeft className="h-5 w-5" />
              <span>Voltar</span>
            </button>
            
            <div className="flex items-start gap-4">
              <PersonAvatar pessoa={pessoa} size={64} />
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900">{nomeCompleto}</h1>
                <div className="flex items-center gap-2 text-gray-500">
                  {dateRange && <span>{dateRange}</span>}
                  {pessoa.vivo === false && <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">Falecido</span>}
                  {pessoa.vivo === true && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Vivo</span>}
                </div>
              </div>
            </div>
          </div>
          
          {/* Tabs */}
          <div className="flex border-b border-gray-200">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-6 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id 
                    ? 'text-teal-600' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Content com scroll normal */}
      <div className="max-w-4xl mx-auto p-6">
        {activeTab === 'detalhes' && (
          <>
            {/* Dados vitais */}
            <CollapsibleSection title="Dados vitais">
              <ToggleSwitch 
                label="Visualização detalhada" 
                checked={showDetailedView} 
                onChange={() => setShowDetailedView(!showDetailedView)} 
              />
              
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-4">
                <InfoItem label="Nome completo" value={nomeCompleto} />
                <InfoItem label="Sexo" value={pessoa.sexo} />
                
                <InfoItem 
                  label="Nascimento" 
                  value={formatDateFull(pessoa.data_nasc)} 
                  icon={Calendar}
                />
                <InfoItem 
                  label="Local de nascimento" 
                  value={localNascimento} 
                  icon={MapPin}
                />
                
                {(pessoa.data_obito || pessoa.vivo === false) && (
                  <>
                    <InfoItem 
                      label="Falecimento" 
                      value={formatDateFull(pessoa.data_obito)} 
                      icon={Calendar}
                    />
                    <InfoItem 
                      label="Local de falecimento" 
                      value={pessoa.local_obito} 
                      icon={MapPin}
                    />
                  </>
                )}
                
                <InfoItem label="Nacionalidade" value={pessoa.nacionalidade} />
                {pessoa.cidadanias_outras && (
                  <InfoItem label="Outras cidadanias" value={pessoa.cidadanias_outras} />
                )}
              </div>
              
              {/* Batismo */}
              {showDetailedView && (pessoa.batizado || pessoa.data_batismo) && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <Church className="h-4 w-4" />
                    Batismo
                  </h4>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                    <InfoItem label="Batizado" value={pessoa.batizado || 'Sim'} />
                    <InfoItem label="Data do batismo" value={formatDateFull(pessoa.data_batismo)} />
                    <InfoItem label="Local do batismo" value={pessoa.local_batismo} />
                    <InfoItem label="Igreja" value={pessoa.igreja_batismo} />
                  </div>
                </div>
              )}
            </CollapsibleSection>
            
            {/* Membros da família */}
            <CollapsibleSection title="Membros da família">
              <ToggleSwitch 
                label="Mostrar todos os membros da família" 
                checked={showAllFamily} 
                onChange={() => setShowAllFamily(!showAllFamily)} 
              />
              
              <div className="grid grid-cols-2 gap-6 mt-4">
                {/* Cônjuges e filhos */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    Cônjuges e filhos
                  </h4>
                  
                  {/* Card do casal */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {/* Pessoa principal */}
                    <div className={`p-3 border-l-4 bg-gray-50 ${pessoa.sexo?.toLowerCase() === 'masculino' ? 'border-blue-500' : 'border-pink-500'}`}>
                      <div className="flex items-center gap-2">
                        <SmallAvatar pessoa={pessoa} size={32} />
                        <div>
                          <p className="font-semibold text-gray-900">{nomeCompleto}</p>
                          <p className="text-sm text-gray-500">{dateRange}</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Cônjuge */}
                    {conjuge && (
                      <div 
                        className={`p-3 border-l-4 cursor-pointer hover:bg-gray-50 ${conjuge.sexo?.toLowerCase() === 'masculino' ? 'border-blue-500' : 'border-pink-500'}`}
                        onClick={() => onPersonClick?.(conjuge)}
                      >
                        <div className="flex items-center gap-2">
                          <SmallAvatar pessoa={conjuge} size={32} />
                          <div>
                            <p className="font-medium text-gray-900">{conjuge.nome} {conjuge.sobrenome}</p>
                            <p className="text-sm text-gray-500">{formatDateRange(conjuge.data_nasc, conjuge.data_obito, conjuge.vivo)}</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Casamento info */}
                    {casamento && (
                      <div className="p-3 border-t border-gray-100 bg-gray-50">
                        <p className="text-sm font-medium text-gray-700">Casamento</p>
                        <p className="text-sm text-gray-600">{formatDateFull(casamento.data_inicio)}</p>
                        {casamento.local && <p className="text-sm text-gray-500">{casamento.local}{casamento.pais && `, ${casamento.pais}`}</p>}
                        {casamento.tipo && <p className="text-xs text-gray-400">{casamento.tipo}</p>}
                      </div>
                    )}
                    
                    {/* Filhos */}
                    {filhos.length > 0 && (
                      <div className="border-t border-gray-200">
                        <button 
                          className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
                          onClick={() => setChildrenOpen(!childrenOpen)}
                        >
                          <span className="text-sm font-medium text-gray-700">Filhos ({filhos.length})</span>
                          <div className={`transform transition-transform ${childrenOpen ? '' : 'rotate-180'}`}>
                            <ChevronUp className="h-5 w-5" />
                          </div>
                        </button>
                        
                        {childrenOpen && (
                          <div className="border-t border-gray-100">
                            {filhos.map((filho) => (
                              <div 
                                key={filho.id}
                                className={`p-3 hover:bg-gray-50 cursor-pointer border-l-4 ${filho.sexo?.toLowerCase() === 'masculino' ? 'border-blue-500' : 'border-pink-500'}`}
                                onClick={() => onPersonClick?.(filho)}
                              >
                                <div className="flex items-center gap-2">
                                  <SmallAvatar pessoa={filho} size={28} />
                                  <div>
                                    <p className="font-medium text-gray-900">{filho.nome} {filho.sobrenome}</p>
                                    <p className="text-sm text-gray-500">{formatDateRange(filho.data_nasc, filho.data_obito, filho.vivo)}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                            
                            <button 
                              onClick={() => onAddFilho?.(pessoa.id)}
                              className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 hover:bg-gray-50"
                            >
                              <Plus className="h-4 w-4" />
                              <span className="text-sm font-medium">ACRESCENTAR FILHO(A)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Botões extras */}
                  {!conjuge && (
                    <button 
                      onClick={() => onAddConjuge?.(pessoa.id)}
                      className="w-full mt-3 p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <Plus className="h-4 w-4" />
                      <span className="text-sm font-medium">ACRESCENTAR CÔNJUGE</span>
                    </button>
                  )}
                  
                  {filhos.length === 0 && (
                    <button 
                      onClick={() => onAddFilho?.(pessoa.id)}
                      className="w-full mt-2 p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <Plus className="h-4 w-4" />
                      <span className="text-sm font-medium">ACRESCENTAR FILHO(A)</span>
                    </button>
                  )}
                </div>
                
                {/* Pais e irmãos */}
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Pais e irmãos
                  </h4>
                  
                  {pessoa.pai || pessoa.mae ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      {pessoa.pai && (
                        <div 
                          className="p-3 border-l-4 border-blue-500 cursor-pointer hover:bg-gray-50"
                          onClick={() => onPersonClick?.(pessoa.pai!)}
                        >
                          <div className="flex items-center gap-2">
                            <SmallAvatar pessoa={pessoa.pai} size={32} />
                            <div>
                              <p className="font-medium text-gray-900">{pessoa.pai.nome} {pessoa.pai.sobrenome}</p>
                              <p className="text-sm text-gray-500">Pai</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {pessoa.mae && (
                        <div 
                          className="p-3 border-l-4 border-pink-500 cursor-pointer hover:bg-gray-50 border-t border-gray-100"
                          onClick={() => onPersonClick?.(pessoa.mae!)}
                        >
                          <div className="flex items-center gap-2">
                            <SmallAvatar pessoa={pessoa.mae} size={32} />
                            <div>
                              <p className="font-medium text-gray-900">{pessoa.mae.nome} {pessoa.mae.sobrenome}</p>
                              <p className="text-sm text-gray-500">Mãe</p>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {!pessoa.pai && (
                        <button 
                          onClick={() => onAddPai?.(pessoa.id)}
                          className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border-t border-gray-100 hover:bg-gray-50"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="text-sm font-medium">ACRESCENTAR PAI</span>
                        </button>
                      )}
                      {!pessoa.mae && (
                        <button 
                          onClick={() => onAddMae?.(pessoa.id)}
                          className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border-t border-gray-100 hover:bg-gray-50"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="text-sm font-medium">ACRESCENTAR MÃE</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button 
                        onClick={() => onAddPai?.(pessoa.id)}
                        className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <Plus className="h-4 w-4" />
                        <span className="text-sm font-medium">ACRESCENTAR PAI</span>
                      </button>
                      <button 
                        onClick={() => onAddMae?.(pessoa.id)}
                        className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <Plus className="h-4 w-4" />
                        <span className="text-sm font-medium">ACRESCENTAR MÃE</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleSection>
          </>
        )}
        
        {activeTab === 'sobre' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Sobre {nomeCompleto}</h3>
            <p className="text-gray-600 whitespace-pre-wrap">{pessoa.comentario || 'Nenhuma informação adicional disponível.'}</p>
          </div>
        )}
        
        {activeTab === 'fontes' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documentos ({pessoa.documentos?.length || 0})
            </h3>
            
            {pessoa.documentos && pessoa.documentos.length > 0 ? (
              <div className="space-y-3">
                {pessoa.documentos.map((doc) => (
                  <div key={doc.id} className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{doc.tipo.replace(/_/g, ' ')}</p>
                        {doc.descricao && <p className="text-sm text-gray-600">{doc.descricao}</p>}
                        <p className="text-xs text-gray-400 mt-1">Status: {doc.status}</p>
                      </div>
                      {doc.arquivo_url && (
                        <a 
                          href={doc.arquivo_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-teal-600 hover:text-teal-700 text-sm"
                        >
                          Ver documento
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600">Nenhum documento cadastrado.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}