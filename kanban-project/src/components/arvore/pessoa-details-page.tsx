"use client"

import { useState } from "react"
import { PersonIcon } from "./pessoa-icon"
import { PessoaArvore, UniaoArvore } from "./pessoa-card"
import { 
  ChevronLeft, 
  ChevronUp, 
  Edit2, 
  GitBranch, 
  Users, 
  Star,
  Plus,
  Minus,
  Home
} from "lucide-react"

interface PessoaDetailsPageProps {
  pessoa: PessoaArvore
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  filhos?: PessoaArvore[]
  onBack: () => void
  onPersonClick?: (pessoa: PessoaArvore) => void
}

function formatDateFull(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatYear(date: Date | string | null | undefined): string {
  if (!date) return ""
  return new Date(date).getFullYear().toString()
}

function formatDateRange(nascimento: Date | string | null | undefined, obito: Date | string | null | undefined): string {
  const nasc = formatYear(nascimento)
  const obit = obito ? formatYear(obito) : "Presente"
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

export function PessoaDetailsPage({ 
  pessoa, 
  conjuge, 
  casamento, 
  filhos = [],
  onBack, 
  onPersonClick 
}: PessoaDetailsPageProps) {
  const [activeTab, setActiveTab] = useState<'sobre' | 'detalhes' | 'fontes' | 'colaborar' | 'recordacoes'>('detalhes')
  const [showDetailedView, setShowDetailedView] = useState(false)
  const [showAllFamily, setShowAllFamily] = useState(false)
  const [childrenOpen, setChildrenOpen] = useState(true)
  
  // Estado para zoom e pan
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome
  const dateRange = formatDateRange(pessoa.data_nasc, pessoa.data_obito)
  
  // Handlers de zoom
  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.1, 2))
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.5))
  const handleResetView = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }
  
  // Handlers de pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a') || (e.target as HTMLElement).closest('input')) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }
  
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    })
  }
  
  const handleMouseUp = () => setIsDragging(false)
  
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setScale(prev => Math.max(0.5, Math.min(2, prev + delta)))
    }
  }

  const tabs = [
    { id: 'sobre', label: 'Sobre' },
    { id: 'detalhes', label: 'Detalhes' },
    { id: 'fontes', label: 'Fontes (0)' },
    { id: 'colaborar', label: 'Colaborar (0)' },
    { id: 'recordacoes', label: 'Recordações (0)' },
  ]
  
  return (
    <div className="fixed inset-0 bg-gray-100 z-[10002] overflow-hidden">
      {/* Controles de zoom flutuantes */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 bg-white rounded-lg shadow-md p-1">
        <button 
          className="p-2 hover:bg-gray-100 rounded transition-colors"
          onClick={handleZoomOut}
          title="Diminuir zoom"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="text-xs text-gray-500 w-12 text-center">{Math.round(scale * 100)}%</span>
        <button 
          className="p-2 hover:bg-gray-100 rounded transition-colors"
          onClick={handleZoomIn}
          title="Aumentar zoom"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="w-px h-6 bg-gray-200" />
        <button 
          className="p-2 hover:bg-gray-100 rounded transition-colors"
          onClick={handleResetView}
          title="Resetar visualização"
        >
          <Home className="h-4 w-4" />
        </button>
      </div>
      
      {/* Área com zoom e pan */}
      <div 
        className="h-full overflow-hidden"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div 
          className="min-h-full transition-transform duration-75"
          style={{ 
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: 'top center'
          }}
        >
          {/* Header */}
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
                  <PersonIcon gender={pessoa.sexo} size={64} />
                  <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900">{nomeCompleto}</h1>
                    <p className="text-gray-500">
                      {dateRange} • ID: {pessoa.id}
                    </p>
                    
                    {/* Action links */}
                    <div className="flex items-center gap-6 mt-3">
                      <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                        <GitBranch className="h-4 w-4" />
                        <span className="text-sm font-medium">VER ÁRVORE</span>
                      </button>
                      <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                        <Users className="h-4 w-4" />
                        <span className="text-sm font-medium">VER PARENTESCO</span>
                      </button>
                      <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                        <Star className="h-4 w-4" />
                        <span className="text-sm font-medium">MONITORAR</span>
                      </button>
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
          
          {/* Content */}
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
                  
                  <div className="grid grid-cols-2 gap-6 mt-4">
                    {/* Left column */}
                    <div className="space-y-4">
                      {/* Nome */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Nome • 0 Fonte</p>
                          <p className="font-medium text-gray-900">{nomeCompleto}</p>
                        </div>
                        <button className="p-1 text-gray-400 hover:text-gray-600">
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                      
                      {/* Nascimento */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Nascimento • 0 Fonte</p>
                          <p className="font-medium text-gray-900">{formatDateFull(pessoa.data_nasc) || 'Não informado'}</p>
                          {pessoa.local_nasc && <p className="text-gray-600">{pessoa.local_nasc}</p>}
                        </div>
                        <button className="p-1 text-gray-400 hover:text-gray-600">
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                      
                      {/* Falecimento */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Falecimento • 0 Fonte</p>
                          <p className="font-medium text-gray-900">{formatDateFull(pessoa.data_obito) || 'Não informado'}</p>
                        </div>
                        <button className="p-1 text-gray-400 hover:text-gray-600">
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    
                    {/* Right column */}
                    <div className="space-y-4">
                      {/* Sexo */}
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm text-gray-500">Sexo • 0 Fonte</p>
                          <p className="font-medium text-gray-900">{pessoa.sexo || 'Não informado'}</p>
                        </div>
                        <button className="p-1 text-gray-400 hover:text-gray-600">
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                      
                      {/* Batizado */}
                      <div>
                        <p className="text-sm text-gray-500">Batizado</p>
                        {pessoa.batizado ? (
                          <p className="font-medium text-gray-900">{pessoa.batizado}</p>
                        ) : (
                          <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700 mt-1">
                            <Plus className="h-4 w-4" />
                            <span className="text-sm font-medium">ACRESCENTAR</span>
                          </button>
                        )}
                      </div>
                      
                      {/* Sepultamento */}
                      <div>
                        <p className="text-sm text-gray-500">Sepultamento</p>
                        <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700 mt-1">
                          <Plus className="h-4 w-4" />
                          <span className="text-sm font-medium">ACRESCENTAR</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>
                
                {/* Outras informações */}
                <CollapsibleSection title="Outras informações">
                  <ToggleSwitch 
                    label="Visualização detalhada" 
                    checked={showDetailedView} 
                    onChange={() => setShowDetailedView(!showDetailedView)} 
                  />
                  
                  <div className="mt-4 space-y-4">
                    {/* Nomes alternativos */}
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-700">Nomes alternativos</span>
                      <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                        <Plus className="h-4 w-4" />
                        <span className="text-sm font-medium">ACRESCENTAR NOME ALTERNATIVO</span>
                      </button>
                    </div>
                    
                    {/* Eventos */}
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-gray-700">Eventos</span>
                      <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                        <Plus className="h-4 w-4" />
                        <span className="text-sm font-medium">ACRESCENTAR EVENTO</span>
                      </button>
                    </div>
                    
                    {/* Fatos */}
                    <div className="flex items-center justify-between py-2">
                      <span className="text-gray-700">Fatos</span>
                      <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                        <Plus className="h-4 w-4" />
                        <span className="text-sm font-medium">ACRESCENTAR FATO</span>
                      </button>
                    </div>
                  </div>
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
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Cônjuges e filhos</h4>
                      
                      {/* Card do casal */}
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        {/* Pessoa principal */}
                        <div className={`p-3 border-l-4 bg-gray-50 ${pessoa.sexo?.toLowerCase() === 'masculino' ? 'border-blue-500' : 'border-pink-500'}`}>
                          <div className="flex items-center gap-2">
                            <PersonIcon gender={pessoa.sexo} size={32} />
                            <div>
                              <p className="font-semibold text-gray-900">{nomeCompleto}</p>
                              <p className="text-sm text-gray-500">{dateRange} • ID: {pessoa.id}</p>
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
                              <PersonIcon gender={conjuge.sexo} size={32} />
                              <div>
                                <p className="font-medium text-gray-900">{conjuge.nome} {conjuge.sobrenome}</p>
                                <p className="text-sm text-gray-500">{formatDateRange(conjuge.data_nasc, conjuge.data_obito)} • ID: {conjuge.id}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Casamento info */}
                        {casamento && (
                          <div className="p-3 flex items-start justify-between border-t border-gray-100">
                            <div>
                              <p className="text-sm font-medium text-gray-700">Casamento</p>
                              <p className="text-sm text-gray-600">{formatDateFull(casamento.data_inicio)}</p>
                            </div>
                            <button className="p-1 text-gray-400 hover:text-gray-600">
                              <Edit2 className="h-4 w-4" />
                            </button>
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
                                    className={`p-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer border-l-4 ${filho.sexo?.toLowerCase() === 'masculino' ? 'border-blue-500' : 'border-pink-500'}`}
                                    onClick={() => onPersonClick?.(filho)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <PersonIcon gender={filho.sexo} size={28} />
                                      <div>
                                        <p className="font-medium text-gray-900">{filho.nome} {filho.sobrenome}</p>
                                        <p className="text-sm text-gray-500">{formatDateRange(filho.data_nasc, filho.data_obito)} • ID: {filho.id}</p>
                                      </div>
                                    </div>
                                    <button className="p-1 text-gray-400 hover:text-gray-600">
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                                
                                <button className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 hover:bg-gray-50">
                                  <Plus className="h-4 w-4" />
                                  <span className="text-sm font-medium">ACRESCENTAR FILHO(A)</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Outros botões */}
                      {!conjuge && (
                        <button className="w-full mt-3 p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <Plus className="h-4 w-4" />
                          <span className="text-sm font-medium">ACRESCENTAR O CÔNJUGE</span>
                        </button>
                      )}
                      
                      <button className="w-full mt-2 p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <Plus className="h-4 w-4" />
                        <span className="text-sm font-medium">ACRESCENTAR FILHO(A)</span>
                      </button>
                    </div>
                    
                    {/* Pais e irmãos */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Pais e irmãos</h4>
                      
                      {pessoa.pai || pessoa.mae ? (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          {pessoa.pai && (
                            <div 
                              className="p-3 border-l-4 border-blue-500 cursor-pointer hover:bg-gray-50"
                              onClick={() => onPersonClick?.(pessoa.pai!)}
                            >
                              <div className="flex items-center gap-2">
                                <PersonIcon gender="masculino" size={32} />
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
                                <PersonIcon gender="feminino" size={32} />
                                <div>
                                  <p className="font-medium text-gray-900">{pessoa.mae.nome} {pessoa.mae.sobrenome}</p>
                                  <p className="text-sm text-gray-500">Mãe</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button className="w-full p-3 flex items-center gap-1 text-teal-600 hover:text-teal-700 border border-gray-200 rounded-lg hover:bg-gray-50">
                          <Plus className="h-4 w-4" />
                          <span className="text-sm font-medium">ACRESCENTAR PAI OU MÃE</span>
                        </button>
                      )}
                    </div>
                  </div>
                </CollapsibleSection>
              </>
            )}
            
            {activeTab === 'sobre' && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Sobre {nomeCompleto}</h3>
                <p className="text-gray-600">{pessoa.comentario || 'Nenhuma informação adicional disponível.'}</p>
              </div>
            )}
            
            {activeTab === 'fontes' && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Fontes (0)</h3>
                <p className="text-gray-600">Nenhuma fonte cadastrada.</p>
              </div>
            )}
            
            {activeTab === 'colaborar' && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Colaborar</h3>
                <p className="text-gray-600">Nenhuma colaboração ativa.</p>
              </div>
            )}
            
            {activeTab === 'recordacoes' && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Recordações (0)</h3>
                <p className="text-gray-600">Fotos, histórias e documentos da família.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}