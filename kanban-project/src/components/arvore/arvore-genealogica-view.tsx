"use client"

import { useState, useEffect } from "react"
import { PessoaCard, PessoaArvore, UniaoArvore } from "./pessoa-card"
import { PessoaSidebar } from "./pessoa-sidebar"
import { PessoaDetailsPage } from "./pessoa-details-page"
import { PersonIcon } from "./pessoa-icon"
import { 
  Plus, 
  Minus, 
  Home, 
  Maximize2, 
  Target,
  ChevronDown,
  Filter,
  User,
  Loader2
} from "lucide-react"
import { TreeIcon } from "../icons/tree-icon"

interface ArvoreGenealogicaViewProps {
  processoId: number
  arvoreId?: number | null
  onArvoreCreated?: (arvoreId: number) => void
}

type ViewMode = 'paisagem' | 'retrato'

// Botão de adicionar pessoa
function AddPersonButton({ type, onClick, disabled }: { type: 'pai' | 'mae' | 'filho' | 'pessoa'; onClick?: () => void; disabled?: boolean }) {
  const labels = {
    pai: 'ACRESCENTAR O PAI',
    mae: 'ACRESCENTAR A MÃE',
    filho: 'ACRESCENTAR FILHO(A)',
    pessoa: 'ADICIONAR PESSOA'
  }
  
  return (
    <button 
      className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg border-2 border-dashed border-gray-300 cursor-pointer hover:border-teal-500 hover:bg-teal-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onClick}
      disabled={disabled}
    >
      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
        <User className="h-5 w-5 text-gray-400" />
      </div>
      <span className="text-teal-600 font-medium text-sm">{labels[type]}</span>
    </button>
  )
}

export function ArvoreGenealogicaView({ processoId, arvoreId: initialArvoreId, onArvoreCreated }: ArvoreGenealogicaViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('paisagem')
  const [pessoas, setPessoas] = useState<PessoaArvore[]>([])
  const [unioes, setUnioes] = useState<UniaoArvore[]>([])
  const [pessoaPrincipal, setPessoaPrincipal] = useState<PessoaArvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [arvoreId, setArvoreId] = useState<number | null>(initialArvoreId || null)
  
  // Estados de seleção
  const [selectedPerson, setSelectedPerson] = useState<PessoaArvore | null>(null)
  const [fullDetailsPerson, setFullDetailsPerson] = useState<PessoaArvore | null>(null)
  
  // Estados de zoom e pan
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  
  // Modal de adicionar pessoa
  const [showAddPersonModal, setShowAddPersonModal] = useState(false)
  const [addPersonType, setAddPersonType] = useState<'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null>(null)
  const [addPersonParentId, setAddPersonParentId] = useState<number | null>(null)
  const [addConjugeForPessoaId, setAddConjugeForPessoaId] = useState<number | null>(null)

  // Modal de editar pessoa
  const [showEditPersonModal, setShowEditPersonModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState<PessoaArvore | null>(null)

  // Handler para editar pessoa
  const handleEditPerson = (pessoa: PessoaArvore) => {
    setEditingPerson(pessoa)
    setShowEditPersonModal(true)
    setSelectedPerson(null)
  }

  // Handler para excluir pessoa
  const handleDeletePerson = async (pessoa: PessoaArvore) => {
    try {
      const response = await fetch(`/api/pessoas/${pessoa.id}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        await fetchArvore()
        setSelectedPerson(null)
      } else {
        alert('Erro ao excluir pessoa')
      }
    } catch (error) {
      console.error('Erro ao excluir pessoa:', error)
      alert('Erro ao excluir pessoa')
    }
  }

  // Handler para adicionar cônjuge
  const handleAddConjuge = (pessoa: PessoaArvore) => {
    setAddPersonType('conjuge')
    setAddConjugeForPessoaId(pessoa.id)
    setShowAddPersonModal(true)
  }

  // Criar árvore para o processo
  const handleCreateArvore = async () => {
    setCreating(true)
    try {
      // Criar a árvore
      const response = await fetch('/api/arvore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: `Árvore do Processo ${processoId}`,
          processoId: processoId
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        setArvoreId(data.id)
        onArvoreCreated?.(data.id)
      } else {
        alert('Erro ao criar árvore')
      }
    } catch (error) {
      console.error('Erro ao criar árvore:', error)
      alert('Erro ao criar árvore')
    } finally {
      setCreating(false)
    }
  }

  // Função para carregar dados da árvore
  const fetchArvore = async () => {
    if (!arvoreId) return
    
    try {
      const response = await fetch(`/api/arvore/${arvoreId}`)
      if (response.ok) {
        const data = await response.json()
        setPessoas(data.pessoas || [])
        
        // Extrair uniões das pessoas
        const todasUnioes: UniaoArvore[] = []
        data.pessoas?.forEach((p: PessoaArvore) => {
          p.unioesComoPessoa1?.forEach((u: UniaoArvore) => {
            if (!todasUnioes.find(x => x.id === u.id)) {
              todasUnioes.push(u)
            }
          })
          p.unioesComoPessoa2?.forEach((u: UniaoArvore) => {
            if (!todasUnioes.find(x => x.id === u.id)) {
              todasUnioes.push(u)
            }
          })
        })
        setUnioes(todasUnioes)
        
        // Encontrar pessoa principal
        if (data.pessoaPrincipalId) {
          const principal = data.pessoas?.find((p: PessoaArvore) => p.id === data.pessoaPrincipalId)
          setPessoaPrincipal(principal || null)
        } else if (data.pessoas?.length > 0) {
          setPessoaPrincipal(data.pessoas[0])
        }
      }
    } catch (error) {
      console.error('Erro ao carregar árvore:', error)
    } finally {
      setLoading(false)
    }
  }

  // Carregar dados da árvore
  useEffect(() => {
    if (!arvoreId) {
      setLoading(false)
      return
    }
    fetchArvore()
  }, [arvoreId])

  // Handlers de zoom
  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.1, 2))
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.3))
  const handleResetView = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  // Handlers de pan
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('.person-card')) return
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
      setScale(prev => Math.max(0.3, Math.min(2, prev + delta)))
    }
  }

  // Handlers de seleção
  const handlePersonClick = (pessoa: PessoaArvore) => {
    setSelectedPerson(pessoa)
  }

  const handleCloseSidebar = () => {
    setSelectedPerson(null)
  }

  const handleOpenFullDetails = (pessoa: PessoaArvore) => {
    setSelectedPerson(null)
    setFullDetailsPerson(pessoa)
  }

  const handleCloseFullDetails = () => {
    setFullDetailsPerson(null)
  }

  const handlePersonClickFromDetails = (pessoa: PessoaArvore) => {
    setFullDetailsPerson(pessoa)
  }

  // Encontrar cônjuge de uma pessoa
  const findConjuge = (pessoa: PessoaArvore): PessoaArvore | null => {
    const uniao = unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
    if (!uniao) return null
    const conjugeId = uniao.pessoa1Id === pessoa.id ? uniao.pessoa2Id : uniao.pessoa1Id
    return pessoas.find(p => p.id === conjugeId) || null
  }

  // Encontrar casamento de uma pessoa
  const findCasamento = (pessoa: PessoaArvore): UniaoArvore | null => {
    return unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id) || null
  }

  // Encontrar filhos de uma pessoa
  const findFilhos = (pessoa: PessoaArvore): PessoaArvore[] => {
    return pessoas.filter(p => p.paiId === pessoa.id || p.maeId === pessoa.id)
  }

  // Se não tem árvore vinculada
  if (!arvoreId && !loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <TreeIcon className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-700">Árvore Genealógica</h3>
          <p className="text-sm mt-2 mb-4">Crie a árvore genealógica para este processo</p>
          <button 
            className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center gap-2 mx-auto disabled:opacity-50"
            onClick={handleCreateArvore}
            disabled={creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Criando...
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                Criar Árvore
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-gray-100 to-gray-200">
      {/* Controles de visualização */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <div className="flex items-center gap-2">
          <button 
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'paisagem' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
            onClick={() => setViewMode('paisagem')}
          >
            <TreeIcon className="h-4 w-4" />
            <span className="text-sm font-medium">PAISAGEM</span>
          </button>
          <button 
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'retrato' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
            onClick={() => setViewMode('retrato')}
          >
            <TreeIcon className="h-4 w-4 rotate-90" />
            <span className="text-sm font-medium">RETRATO</span>
          </button>
        </div>
        
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-gray-100 rounded transition-colors">
            <Filter className="h-4 w-4" />
          </button>
          <button 
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            onClick={handleResetView}
            title="Resetar visualização"
          >
            <Home className="h-4 w-4" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded transition-colors">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button className="p-2 hover:bg-gray-100 rounded transition-colors">
            <Target className="h-4 w-4" />
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
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
        </div>
      </div>

      {/* Área da árvore */}
      <div 
        className="flex-1 overflow-hidden relative"
        style={{ cursor: pessoas.length > 0 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        onMouseDown={pessoas.length > 0 ? handleMouseDown : undefined}
        onMouseMove={pessoas.length > 0 ? handleMouseMove : undefined}
        onMouseUp={pessoas.length > 0 ? handleMouseUp : undefined}
        onMouseLeave={pessoas.length > 0 ? handleMouseUp : undefined}
        onWheel={pessoas.length > 0 ? handleWheel : undefined}
      >
        {/* Estado vazio - centralizado */}
        {pessoas.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              <div className="text-center">
                <User className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-700">Árvore vazia</h3>
                <p className="text-gray-500 text-sm mt-1">Comece adicionando a primeira pessoa da árvore</p>
              </div>
              <AddPersonButton 
                type="pessoa" 
                onClick={() => {
                  setAddPersonType('pessoa')
                  setAddPersonParentId(null)
                  setShowAddPersonModal(true)
                }} 
              />
            </div>
          </div>
        )}

        {/* Área com zoom e pan - só mostra quando tem pessoas */}
        {pessoas.length > 0 && (
          <div 
            className="p-8 transition-transform duration-75 min-w-max h-full flex items-center justify-center"
            style={{ 
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: 'center center'
            }}
          >
            {viewMode === 'paisagem' ? (
              // Visualização Paisagem (horizontal) - estilo FamilySearch
              <div className="flex items-center">
                {/* ===== COLUNA: Filhos ===== */}
                <div className="flex items-center">
                  <AddPersonButton 
                    type="filho" 
                    onClick={() => {
                      setAddPersonType('filho')
                      setAddPersonParentId(pessoaPrincipal?.id || null)
                      setShowAddPersonModal(true)
                    }}
                  />
                  {/* Linha horizontal conectora */}
                  <svg width="60" height="2" className="flex-shrink-0">
                    <line x1="0" y1="1" x2="60" y2="1" stroke="#d1d5db" strokeWidth="2" />
                  </svg>
                </div>

                {/* ===== COLUNA: Pessoa Principal ===== */}
                {pessoaPrincipal && (
                  <div className="flex items-center">
                    <PessoaCard 
                      pessoa={pessoaPrincipal}
                      conjuge={findConjuge(pessoaPrincipal)}
                      casamento={findCasamento(pessoaPrincipal)}
                      isMain={true}
                      onClick={handlePersonClick}
                      onConjugeClick={handlePersonClick}
                      onAddConjuge={() => handleAddConjuge(pessoaPrincipal)}
                    />
                    
                    {/* Linha horizontal + vertical em L para pais */}
                    <svg width="60" height="200" className="flex-shrink-0">
                      {/* Linha horizontal saindo do card */}
                      <line x1="0" y1="100" x2="40" y2="100" stroke="#d1d5db" strokeWidth="2" />
                      {/* Linha vertical */}
                      <line x1="40" y1="50" x2="40" y2="150" stroke="#d1d5db" strokeWidth="2" />
                      {/* Linha horizontal para pai (topo) */}
                      <line x1="40" y1="50" x2="60" y2="50" stroke="#d1d5db" strokeWidth="2" />
                      {/* Linha horizontal para mãe (baixo) */}
                      <line x1="40" y1="150" x2="60" y2="150" stroke="#d1d5db" strokeWidth="2" />
                    </svg>
                  </div>
                )}

                {/* ===== COLUNA: Pais ===== */}
                {pessoaPrincipal && (
                  <div className="flex flex-col gap-[100px]">
                    {/* Pai ou botão adicionar */}
                    <div className="flex items-center">
                      {pessoaPrincipal.pai ? (
                        <>
                          <PessoaCard 
                            pessoa={pessoaPrincipal.pai}
                            conjuge={pessoaPrincipal.mae}
                            onClick={handlePersonClick}
                            onConjugeClick={handlePersonClick}
                            onAddConjuge={() => handleAddConjuge(pessoaPrincipal.pai!)}
                          />
                          {/* Linha para avós */}
                          <svg width="60" height="200" className="flex-shrink-0">
                            <line x1="0" y1="100" x2="40" y2="100" stroke="#d1d5db" strokeWidth="2" />
                            <line x1="40" y1="50" x2="40" y2="150" stroke="#d1d5db" strokeWidth="2" />
                            <line x1="40" y1="50" x2="60" y2="50" stroke="#d1d5db" strokeWidth="2" />
                            <line x1="40" y1="150" x2="60" y2="150" stroke="#d1d5db" strokeWidth="2" />
                          </svg>
                        </>
                      ) : (
                        <AddPersonButton 
                          type="pai" 
                          onClick={() => {
                            setAddPersonType('pai')
                            setAddPersonParentId(pessoaPrincipal?.id || null)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>
                    
                    {/* Mãe ou botão adicionar */}
                    <div className="flex items-center">
                      {pessoaPrincipal.mae && !pessoaPrincipal.pai ? (
                        <PessoaCard 
                          pessoa={pessoaPrincipal.mae}
                          onClick={handlePersonClick}
                          onAddConjuge={() => handleAddConjuge(pessoaPrincipal.mae!)}
                        />
                      ) : !pessoaPrincipal.pai && !pessoaPrincipal.mae ? (
                        <AddPersonButton 
                          type="mae" 
                          onClick={() => {
                            setAddPersonType('mae')
                            setAddPersonParentId(pessoaPrincipal?.id || null)
                            setShowAddPersonModal(true)
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                )}

                {/* ===== COLUNA: Avós Paternos ===== */}
                {pessoaPrincipal?.pai && (
                  <div className="flex flex-col gap-[100px]">
                    {/* Avô paterno */}
                    {pessoaPrincipal.pai.pai ? (
                      <PessoaCard 
                        pessoa={pessoaPrincipal.pai.pai}
                        conjuge={pessoaPrincipal.pai.mae}
                        onClick={handlePersonClick}
                        onConjugeClick={handlePersonClick}
                        onAddConjuge={() => handleAddConjuge(pessoaPrincipal.pai!.pai!)}
                      />
                    ) : (
                      <AddPersonButton 
                        type="pai" 
                        onClick={() => {
                          setAddPersonType('pai')
                          setAddPersonParentId(pessoaPrincipal.pai?.id || null)
                          setShowAddPersonModal(true)
                        }}
                      />
                    )}
                    
                    {/* Avó paterna */}
                    {!pessoaPrincipal.pai.mae && (
                      <AddPersonButton 
                        type="mae" 
                        onClick={() => {
                          setAddPersonType('mae')
                          setAddPersonParentId(pessoaPrincipal.pai?.id || null)
                          setShowAddPersonModal(true)
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              // Visualização Retrato (vertical)
              <div className="flex flex-col items-center gap-8">
                {/* Bisavós */}
                <div className="flex gap-8">
                  <div className="flex gap-4">
                    <AddPersonButton type="pai" />
                    <AddPersonButton type="mae" />
                  </div>
                  <div className="flex gap-4">
                    <AddPersonButton type="pai" />
                    <AddPersonButton type="mae" />
                  </div>
                </div>
                
                {/* Linha conectora */}
                <div className="w-0.5 h-8 bg-gray-400" />
                
                {/* Avós */}
                <div className="flex gap-16">
                  {pessoaPrincipal?.pai?.pai && (
                    <div className="person-card">
                      <PessoaCard 
                        pessoa={pessoaPrincipal.pai.pai}
                        conjuge={pessoaPrincipal.pai.mae}
                        onClick={handlePersonClick}
                        onConjugeClick={handlePersonClick}
                        onAddConjuge={() => handleAddConjuge(pessoaPrincipal.pai!.pai!)}
                      />
                    </div>
                  )}
                  {pessoaPrincipal?.mae?.pai && (
                    <div className="person-card">
                      <PessoaCard 
                        pessoa={pessoaPrincipal.mae.pai}
                        conjuge={pessoaPrincipal.mae.mae}
                        onClick={handlePersonClick}
                        onConjugeClick={handlePersonClick}
                        onAddConjuge={() => handleAddConjuge(pessoaPrincipal.mae!.pai!)}
                      />
                    </div>
                  )}
                </div>
                
                {/* Linha conectora */}
                <div className="w-0.5 h-8 bg-gray-400" />
                
                {/* Pais */}
                <div className="flex gap-16">
                  {pessoaPrincipal?.pai && (
                    <div className="person-card">
                      <PessoaCard 
                        pessoa={pessoaPrincipal.pai}
                        conjuge={pessoaPrincipal.mae}
                        onClick={handlePersonClick}
                        onConjugeClick={handlePersonClick}
                        onAddConjuge={() => handleAddConjuge(pessoaPrincipal.pai!)}
                      />
                    </div>
                  )}
                </div>
                
                {/* Linha conectora */}
                <div className="w-0.5 h-8 bg-gray-400" />
                
                {/* Pessoa principal */}
                {pessoaPrincipal && (
                  <div className="person-card">
                    <PessoaCard 
                      pessoa={pessoaPrincipal}
                      conjuge={findConjuge(pessoaPrincipal)}
                      casamento={findCasamento(pessoaPrincipal)}
                      isMain={true}
                      onClick={handlePersonClick}
                      onConjugeClick={handlePersonClick}
                      onAddConjuge={() => handleAddConjuge(pessoaPrincipal)}
                    />
                  </div>
                )}
                
                {/* Linha conectora */}
                <div className="w-0.5 h-8 bg-gray-400" />
                
                {/* Filhos */}
                <div className="flex gap-4">
                  <AddPersonButton 
                    type="filho" 
                    onClick={() => {
                      setAddPersonType('filho')
                      setAddPersonParentId(pessoaPrincipal?.id || null)
                      setShowAddPersonModal(true)
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Overlay quando sidebar está aberta */}
      {selectedPerson && (
        <div 
          className="fixed inset-0 bg-black/20 z-[10000]"
          onClick={handleCloseSidebar}
        />
      )}

      {/* Sidebar de detalhes */}
      <PessoaSidebar 
        pessoa={selectedPerson}
        conjuge={selectedPerson ? findConjuge(selectedPerson) : null}
        casamento={selectedPerson ? findCasamento(selectedPerson) : null}
        onClose={handleCloseSidebar}
        onOpenFullDetails={handleOpenFullDetails}
        onEdit={handleEditPerson}
        onDelete={handleDeletePerson}
      />

      {/* Página completa de detalhes */}
      {fullDetailsPerson && (
        <PessoaDetailsPage 
          pessoa={fullDetailsPerson}
          conjuge={findConjuge(fullDetailsPerson)}
          casamento={findCasamento(fullDetailsPerson)}
          filhos={findFilhos(fullDetailsPerson)}
          onBack={handleCloseFullDetails}
          onPersonClick={handlePersonClickFromDetails}
        />
      )}

      {/* Modal de adicionar pessoa */}
      {showAddPersonModal && (
        <AddPersonModal 
          arvoreId={arvoreId!}
          type={addPersonType}
          parentId={addPersonParentId}
          conjugeDePessoaId={addConjugeForPessoaId}
          onClose={() => {
            setShowAddPersonModal(false)
            setAddPersonType(null)
            setAddPersonParentId(null)
            setAddConjugeForPessoaId(null)
          }}
          onSuccess={async (novaPessoa, novaUniao) => {
            // Recarrega toda a árvore para pegar os vínculos atualizados
            await fetchArvore()
            setShowAddPersonModal(false)
            setAddPersonType(null)
            setAddPersonParentId(null)
            setAddConjugeForPessoaId(null)
          }}
        />
      )}

      {/* Modal de editar pessoa */}
      {showEditPersonModal && editingPerson && (
        <EditPersonModal 
          pessoa={editingPerson}
          onClose={() => {
            setShowEditPersonModal(false)
            setEditingPerson(null)
          }}
          onSuccess={async () => {
            await fetchArvore()
            setShowEditPersonModal(false)
            setEditingPerson(null)
          }}
        />
      )}
    </div>
  )
}

// Modal de adicionar pessoa
function AddPersonModal({ 
  arvoreId, 
  type, 
  parentId,
  conjugeDePessoaId,
  onClose, 
  onSuccess 
}: { 
  arvoreId: number
  type: 'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null
  parentId: number | null
  conjugeDePessoaId?: number | null
  onClose: () => void
  onSuccess: (pessoa: PessoaArvore, uniao?: UniaoArvore) => void 
}) {
  const [nome, setNome] = useState('')
  const [sobrenome, setSobrenome] = useState('')
  const [sexo, setSexo] = useState<string>('')
  const [dataNasc, setDataNasc] = useState('')
  const [localNasc, setLocalNasc] = useState('')
  const [dataCasamento, setDataCasamento] = useState('')
  const [localCasamento, setLocalCasamento] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

    setSaving(true)
    try {
      const body: any = {
        nome: nome.trim(),
        sobrenome: sobrenome.trim() || null,
        sexo: sexo || null,
        data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null,
        local_nasc: localNasc.trim() || null,
        arvoreId
      }

      // Se está adicionando pai ou mãe de alguém
      if (type === 'pai' && parentId) {
        body.filhoId = parentId
        body.tipoPai = 'pai'
      } else if (type === 'mae' && parentId) {
        body.filhoId = parentId
        body.tipoPai = 'mae'
      } else if (type === 'filho' && parentId) {
        body.paiId = parentId
      }

      const response = await fetch('/api/pessoas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        const novaPessoa = await response.json()
        
        // Se está adicionando cônjuge, criar a união
        if (type === 'conjuge' && conjugeDePessoaId) {
          const uniaoResponse = await fetch('/api/unioes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pessoa1Id: conjugeDePessoaId,
              pessoa2Id: novaPessoa.id,
              data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null,
              local: localCasamento.trim() || null,
              tipo: 'casamento'
            })
          })
          
          if (uniaoResponse.ok) {
            const novaUniao = await uniaoResponse.json()
            onSuccess(novaPessoa, novaUniao)
          } else {
            // Pessoa foi criada mas união falhou
            onSuccess(novaPessoa)
            alert('Pessoa criada, mas houve erro ao criar a união')
          }
        } else {
          onSuccess(novaPessoa)
        }
      } else {
        alert('Erro ao adicionar pessoa')
      }
    } catch (error) {
      console.error('Erro ao adicionar pessoa:', error)
      alert('Erro ao adicionar pessoa')
    } finally {
      setSaving(false)
    }
  }

  const titles: Record<string, string> = {
    pai: 'Adicionar Pai',
    mae: 'Adicionar Mãe',
    filho: 'Adicionar Filho(a)',
    pessoa: 'Adicionar Pessoa',
    conjuge: 'Adicionar Cônjuge'
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-md">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">{titles[type || 'pessoa']}</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
              <input
                type="text"
                value={sobrenome}
                onChange={(e) => setSobrenome(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
            <select
              value={sexo}
              onChange={(e) => setSexo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Selecione...</option>
              <option value="Masculino">Masculino</option>
              <option value="Feminino">Feminino</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
              <input
                type="date"
                value={dataNasc}
                onChange={(e) => setDataNasc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local de Nascimento</label>
              <input
                type="text"
                value={localNasc}
                onChange={(e) => setLocalNasc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          
          {/* Campos de casamento - só aparecem para cônjuge */}
          {type === 'conjuge' && (
            <>
              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Dados do Casamento</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data do Casamento</label>
                    <input
                      type="date"
                      value={dataCasamento}
                      onChange={(e) => setDataCasamento(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Local do Casamento</label>
                    <input
                      type="text"
                      value={localCasamento}
                      onChange={(e) => setLocalCasamento(e.target.value)}
                      placeholder="Cidade, Estado, País"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
          
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !nome.trim()}
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// Modal de editar pessoa
function EditPersonModal({ 
  pessoa,
  onClose, 
  onSuccess 
}: { 
  pessoa: PessoaArvore
  onClose: () => void
  onSuccess: () => void 
}) {
  const [nome, setNome] = useState(pessoa.nome)
  const [sobrenome, setSobrenome] = useState(pessoa.sobrenome || '')
  const [sexo, setSexo] = useState(pessoa.sexo || '')
  const [dataNasc, setDataNasc] = useState(pessoa.data_nasc ? new Date(pessoa.data_nasc).toISOString().split('T')[0] : '')
  const [localNasc, setLocalNasc] = useState(pessoa.local_nasc || '')
  const [dataObito, setDataObito] = useState(pessoa.data_obito ? new Date(pessoa.data_obito).toISOString().split('T')[0] : '')
  const [batizado, setBatizado] = useState(pessoa.batizado || '')
  const [comentario, setComentario] = useState(pessoa.comentario || '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

    setSaving(true)
    try {
      const response = await fetch(`/api/pessoas/${pessoa.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          sobrenome: sobrenome.trim() || null,
          sexo: sexo || null,
          data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null,
          local_nasc: localNasc.trim() || null,
          data_obito: dataObito ? new Date(dataObito).toISOString() : null,
          batizado: batizado.trim() || null,
          comentario: comentario.trim() || null,
        })
      })

      if (response.ok) {
        onSuccess()
      } else {
        alert('Erro ao atualizar pessoa')
      }
    } catch (error) {
      console.error('Erro ao atualizar pessoa:', error)
      alert('Erro ao atualizar pessoa')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Editar Pessoa</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label>
              <input
                type="text"
                value={sobrenome}
                onChange={(e) => setSobrenome(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
            <select
              value={sexo}
              onChange={(e) => setSexo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Selecione...</option>
              <option value="Masculino">Masculino</option>
              <option value="Feminino">Feminino</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
              <input
                type="date"
                value={dataNasc}
                onChange={(e) => setDataNasc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local de Nascimento</label>
              <input
                type="text"
                value={localNasc}
                onChange={(e) => setLocalNasc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Data de Falecimento</label>
              <input
                type="date"
                value={dataObito}
                onChange={(e) => setDataObito(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batizado</label>
              <input
                type="text"
                value={batizado}
                onChange={(e) => setBatizado(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Comentário</label>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>
          
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !nome.trim()}
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}