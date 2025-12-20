"use client"

import { useState, useEffect, useRef } from "react"
import { PessoaCard, PessoaArvore, UniaoArvore } from "./pessoa-card"
import { PersonCardSimple, AddPersonButtonSimple, AddSpouseButton } from "./person-card-simple"
import { AddPersonButton } from "./pessoa-card"
import { PessoaSidebar } from "./pessoa-sidebar"
import { PessoaDetailsPage } from "./pessoa-details-page"
import { PersonIcon } from "./pessoa-icon"
import {
  Plus,
  Minus,
  Home,
  Maximize2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  User,
  Loader2,
  Minimize2
} from "lucide-react"
import { TreeIcon } from "../icons/tree-icon"

interface ArvoreGenealogicaViewProps {
  processoId: number
  arvoreId?: number | null
  onArvoreCreated?: (arvoreId: number) => void
}

type ViewMode = 'paisagem' | 'retrato'

// Cores FamilySearch
const fsColors = {
  male: '#3073B5',
  female: '#BF3D79',
  green: '#87B940',
  line: '#9CA3AF'
}

// Botão de expandir/recolher branch
interface ExpandButtonProps {
  expanded: boolean
  onClick: () => void
  direction: 'right' | 'left' | 'up' | 'down'
  hasContent: boolean // Se tem conteúdo para mostrar (ancestrais ou descendentes)
}

function ExpandButton({ expanded, onClick, direction, hasContent }: ExpandButtonProps) {
  if (!hasContent && !expanded) return null

  const getIcon = () => {
    if (expanded) {
      // Quando expandido, mostra seta para recolher (direção oposta)
      switch (direction) {
        case 'right': return <ChevronLeft className="w-3 h-3" />
        case 'left': return <ChevronRight className="w-3 h-3" />
        case 'up': return <ChevronDown className="w-3 h-3" />
        case 'down': return <ChevronUp className="w-3 h-3" />
      }
    } else {
      // Quando recolhido, mostra seta para expandir
      switch (direction) {
        case 'right': return <ChevronRight className="w-3 h-3" />
        case 'left': return <ChevronLeft className="w-3 h-3" />
        case 'up': return <ChevronUp className="w-3 h-3" />
        case 'down': return <ChevronDown className="w-3 h-3" />
      }
    }
  }

  const getPosition = () => {
    switch (direction) {
      case 'right': return 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2'
      case 'left': return 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2'
      case 'up': return 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2'
      case 'down': return 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2'
    }
  }

  return (
    <button
      className={`absolute ${getPosition()} w-6 h-6 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center shadow-sm hover:bg-gray-50 hover:border-gray-400 transition-all z-10`}
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

  // Estado de tela cheia
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Estado de branches expandidos (controla quais ramos mostram seus ancestrais)
  // Formato: Set de IDs de pessoas cujos PAIS estão visíveis
  const [expandedBranches, setExpandedBranches] = useState<Set<number>>(new Set())
  
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

  // Inicializar branches expandidos quando a pessoa principal for definida
  useEffect(() => {
    if (pessoaPrincipal) {
      // Por padrão, expande o branch da pessoa principal
      setExpandedBranches(new Set([pessoaPrincipal.id]))
    }
  }, [pessoaPrincipal?.id])

  // Handlers de zoom
  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.1, 2))
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.1, 0.3))
  const handleResetView = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  // Handler de tela cheia com animação
  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return

    try {
      setIsTransitioning(true)
      
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
      // O estado isFullscreen será atualizado pelo listener fullscreenchange
    } catch (error) {
      console.error('Erro ao alternar tela cheia:', error)
      setIsTransitioning(false)
    }
  }

  // Listener para mudança de fullscreen (quando sai com ESC ou clica no botão)
  useEffect(() => {
    const handleFullscreenChange = () => {
      // Se não estava transitioning (ESC foi pressionado), inicia transição
      setIsTransitioning(true)
      setIsFullscreen(!!document.fullscreenElement)
      // Finaliza transição após a mudança
      setTimeout(() => setIsTransitioning(false), 250)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

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

  // Encontrar pai de uma pessoa
  const findPai = (pessoa: PessoaArvore): PessoaArvore | null => {
    if (!pessoa.paiId) return null
    return pessoas.find(p => p.id === pessoa.paiId) || null
  }

  // Encontrar mãe de uma pessoa
  const findMae = (pessoa: PessoaArvore): PessoaArvore | null => {
    if (!pessoa.maeId) return null
    return pessoas.find(p => p.id === pessoa.maeId) || null
  }

  // Encontrar filhos de uma pessoa
  const findFilhos = (pessoa: PessoaArvore): PessoaArvore[] => {
    return pessoas.filter(p => p.paiId === pessoa.id || p.maeId === pessoa.id)
  }

  // Verificar se um branch está expandido (mostrando ancestrais)
  const isBranchExpanded = (pessoaId: number): boolean => {
    return expandedBranches.has(pessoaId)
  }

  // Toggle expansão de branch
  const toggleBranch = (pessoaId: number) => {
    setExpandedBranches(prev => {
      const next = new Set(prev)
      if (next.has(pessoaId)) {
        next.delete(pessoaId)
      } else {
        next.add(pessoaId)
      }
      return next
    })
  }

  // Verificar se uma pessoa tem pais cadastrados
  const hasPais = (pessoa: PessoaArvore): boolean => {
    return !!(findPai(pessoa) || findMae(pessoa))
  }

  // Se não tem árvore vinculada
  if (!arvoreId && !loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center max-w-md px-6">
          {/* Ícone animado */}
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div
              className="absolute inset-0 rounded-full opacity-20 animate-pulse"
              style={{ backgroundColor: fsColors.green }}
            />
            <div
              className="absolute inset-2 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${fsColors.green}30` }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill={fsColors.green} />
                <path
                  d="M12 6v12M8 10v4M16 10v4"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <h3 className="text-2xl font-bold text-gray-800 mb-2">Árvore Genealógica</h3>
          <p className="text-gray-500 mb-6">
            Crie a árvore genealógica para este processo de cidadania e gerencie todos os membros da família
          </p>

          <button
            className="px-8 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: fsColors.green }}
            onClick={handleCreateArvore}
            disabled={creating}
          >
            {creating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Criando árvore...
              </>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                Criar Árvore Genealógica
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
    <div 
      ref={containerRef} 
      className="h-full flex flex-col bg-gradient-to-b from-gray-100 to-gray-200 relative"
    >
      {/* Overlay de transição com fade */}
      <div 
        className={`absolute inset-0 bg-white z-[9999] pointer-events-none transition-opacity duration-300 ${isTransitioning ? 'opacity-60' : 'opacity-0'}`}
      />
      
      {/* Controles de visualização */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <div className="flex items-center gap-2">
          <button 
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'paisagem' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
            onClick={() => setViewMode('paisagem')}
          >
            {/* Ícone horizontal - árvore deitada */}
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="9" width="6" height="6" rx="1" />
              <rect x="14" y="3" width="6" height="6" rx="1" />
              <rect x="14" y="15" width="6" height="6" rx="1" />
              <path d="M8 12 L14 6" />
              <path d="M8 12 L14 18" />
            </svg>
            <span className="text-sm font-medium">PAISAGEM</span>
          </button>
          <button 
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'retrato' ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
            onClick={() => setViewMode('retrato')}
          >
            {/* Ícone vertical - árvore em pé */}
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="2" width="6" height="6" rx="1" />
              <rect x="15" y="2" width="6" height="6" rx="1" />
              <rect x="9" y="16" width="6" height="6" rx="1" />
              <path d="M6 8 L12 16" />
              <path d="M18 8 L12 16" />
            </svg>
            <span className="text-sm font-medium">RETRATO</span>
          </button>
        </div>
        
        <div className="flex items-center gap-1">
          <button 
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            onClick={handleResetView}
            title="Voltar ao início"
          >
            <Home className="h-4 w-4" />
          </button>
          <button 
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
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
            <div className="flex flex-col items-center gap-8 max-w-sm text-center px-4">
              {/* Ilustração */}
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a7.5 7.5 0 0113 0" />
                  </svg>
                </div>
                <div
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: fsColors.green }}
                >
                  <Plus className="w-4 h-4 text-white" />
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Comece sua árvore</h3>
                <p className="text-gray-500 text-sm">
                  Adicione a primeira pessoa da família para começar a construir a árvore genealógica
                </p>
              </div>

              <button
                className="px-6 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2"
                style={{ backgroundColor: fsColors.green }}
                onClick={() => {
                  setAddPersonType('pessoa')
                  setAddPersonParentId(null)
                  setShowAddPersonModal(true)
                }}
              >
                <User className="w-5 h-5" />
                Adicionar primeira pessoa
              </button>
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
              // Cards: 180x100px, gap: 20px
              <div className="relative" style={{ minWidth: '1000px', minHeight: '360px' }}>

                {/* ===== COLUNA 1: Botão Filhos (x=0) ===== */}
                <div className="absolute" style={{ left: '0px', top: '130px' }}>
                  <AddPersonButtonSimple
                    type="filho"
                    mode="paisagem"
                    onClick={() => {
                      setAddPersonType('filho')
                      setAddPersonParentId(pessoaPrincipal?.id || null)
                      setShowAddPersonModal(true)
                    }}
                  />
                </div>

                {/* ===== COLUNA 2: Pessoa Principal (x=200) ===== */}
                {pessoaPrincipal && (
                  <div className="absolute" style={{ left: '200px', top: '130px' }}>
                    <div className="relative">
                      <PersonCardSimple
                        pessoa={pessoaPrincipal}
                        isMain={true}
                        mode="paisagem"
                        onClick={handlePersonClick}
                      />
                      {/* Botão de expandir para ancestrais */}
                      <ExpandButton
                        expanded={isBranchExpanded(pessoaPrincipal.id)}
                        onClick={() => toggleBranch(pessoaPrincipal.id)}
                        direction="right"
                        hasContent={hasPais(pessoaPrincipal) || true /* sempre pode adicionar pais */}
                      />
                    </div>
                  </div>
                )}

                {/* ===== COLUNA 3: Cônjuge (x=400) ===== */}
                <div className="absolute" style={{ left: '400px', top: '130px' }}>
                  {pessoaPrincipal && findConjuge(pessoaPrincipal) ? (
                    <PersonCardSimple
                      pessoa={findConjuge(pessoaPrincipal)!}
                      mode="paisagem"
                      onClick={handlePersonClick}
                    />
                  ) : pessoaPrincipal ? (
                    <AddSpouseButton mode="paisagem" onClick={() => handleAddConjuge(pessoaPrincipal)} />
                  ) : null}
                </div>

                {/* ===== COLUNA 4: Pais (x=600) - só mostra se branch expandido ===== */}
                {pessoaPrincipal && isBranchExpanded(pessoaPrincipal.id) && (
                  <>
                    {/* Pai (y=20) */}
                    <div className="absolute" style={{ left: '600px', top: '20px' }}>
                      {findPai(pessoaPrincipal) ? (
                        <div className="relative">
                          <PersonCardSimple
                            pessoa={findPai(pessoaPrincipal)!}
                            mode="paisagem"
                            onClick={handlePersonClick}
                          />
                          {/* Botão de expandir para avós paternos */}
                          <ExpandButton
                            expanded={isBranchExpanded(findPai(pessoaPrincipal)!.id)}
                            onClick={() => toggleBranch(findPai(pessoaPrincipal)!.id)}
                            direction="right"
                            hasContent={hasPais(findPai(pessoaPrincipal)!) || true}
                          />
                        </div>
                      ) : (
                        <AddPersonButtonSimple
                          type="pai"
                          mode="paisagem"
                          onClick={() => {
                            setAddPersonType('pai')
                            setAddPersonParentId(pessoaPrincipal.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>

                    {/* Mãe (y=240) */}
                    <div className="absolute" style={{ left: '600px', top: '240px' }}>
                      {findMae(pessoaPrincipal) ? (
                        <div className="relative">
                          <PersonCardSimple
                            pessoa={findMae(pessoaPrincipal)!}
                            mode="paisagem"
                            onClick={handlePersonClick}
                          />
                          {/* Botão de expandir para avós maternos */}
                          <ExpandButton
                            expanded={isBranchExpanded(findMae(pessoaPrincipal)!.id)}
                            onClick={() => toggleBranch(findMae(pessoaPrincipal)!.id)}
                            direction="right"
                            hasContent={hasPais(findMae(pessoaPrincipal)!) || true}
                          />
                        </div>
                      ) : (
                        <AddPersonButtonSimple
                          type="mae"
                          mode="paisagem"
                          onClick={() => {
                            setAddPersonType('mae')
                            setAddPersonParentId(pessoaPrincipal.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>
                  </>
                )}

                {/* ===== COLUNA 5: Avós Paternos (x=800) - só se branch do pai expandido ===== */}
                {pessoaPrincipal && findPai(pessoaPrincipal) &&
                 isBranchExpanded(pessoaPrincipal.id) &&
                 isBranchExpanded(findPai(pessoaPrincipal)!.id) && (
                  <>
                    {/* Avô paterno */}
                    <div className="absolute" style={{ left: '800px', top: '0px' }}>
                      {findPai(findPai(pessoaPrincipal)!) ? (
                        <PersonCardSimple
                          pessoa={findPai(findPai(pessoaPrincipal)!)!}
                          mode="paisagem"
                          onClick={handlePersonClick}
                        />
                      ) : (
                        <AddPersonButtonSimple
                          type="pai"
                          mode="paisagem"
                          onClick={() => {
                            setAddPersonType('pai')
                            setAddPersonParentId(findPai(pessoaPrincipal)!.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>

                    {/* Avó paterna */}
                    <div className="absolute" style={{ left: '800px', top: '120px' }}>
                      {findMae(findPai(pessoaPrincipal)!) ? (
                        <PersonCardSimple
                          pessoa={findMae(findPai(pessoaPrincipal)!)!}
                          mode="paisagem"
                          onClick={handlePersonClick}
                        />
                      ) : (
                        <AddPersonButtonSimple
                          type="mae"
                          mode="paisagem"
                          onClick={() => {
                            setAddPersonType('mae')
                            setAddPersonParentId(findPai(pessoaPrincipal)!.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>
                  </>
                )}

                {/* ===== COLUNA 5: Avós Maternos (x=800, y ajustado) - só se branch da mãe expandido ===== */}
                {pessoaPrincipal && findMae(pessoaPrincipal) &&
                 isBranchExpanded(pessoaPrincipal.id) &&
                 isBranchExpanded(findMae(pessoaPrincipal)!.id) && (
                  <>
                    {/* Avô materno */}
                    <div className="absolute" style={{ left: '800px', top: '220px' }}>
                      {findPai(findMae(pessoaPrincipal)!) ? (
                        <PersonCardSimple
                          pessoa={findPai(findMae(pessoaPrincipal)!)!}
                          mode="paisagem"
                          onClick={handlePersonClick}
                        />
                      ) : (
                        <AddPersonButtonSimple
                          type="pai"
                          mode="paisagem"
                          onClick={() => {
                            setAddPersonType('pai')
                            setAddPersonParentId(findMae(pessoaPrincipal)!.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>

                    {/* Avó materna */}
                    <div className="absolute" style={{ left: '800px', top: '340px' }}>
                      {findMae(findMae(pessoaPrincipal)!) ? (
                        <PersonCardSimple
                          pessoa={findMae(findMae(pessoaPrincipal)!)!}
                          mode="paisagem"
                          onClick={handlePersonClick}
                        />
                      ) : (
                        <AddPersonButtonSimple
                          type="mae"
                          mode="paisagem"
                          onClick={() => {
                            setAddPersonType('mae')
                            setAddPersonParentId(findMae(pessoaPrincipal)!.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>
                  </>
                )}

                {/* ===== SVG: Linhas de conexão ===== */}
                {/* Card: 180x100, centroY do card = top + 50 */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: -1 }}>
                  {/* Linha: Filhos (180,180) → Pessoa Principal (200,180) */}
                  <path d="M 180 180 L 200 180" stroke={fsColors.line} strokeWidth="2" fill="none" />

                  {/* Linha: Pessoa Principal (380,180) → Cônjuge (400,180) */}
                  <path d="M 380 180 L 400 180" stroke={fsColors.line} strokeWidth="2" fill="none" />

                  {/* Linhas: Cônjuge → bifurcação para Pais - só se expandido */}
                  {pessoaPrincipal && isBranchExpanded(pessoaPrincipal.id) && (
                    <>
                      {/* Saída do cônjuge, bifurcação, para pai */}
                      <path d="M 580 180 L 590 180 L 590 70 L 600 70" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      {/* Bifurcação para mãe */}
                      <path d="M 590 180 L 590 290 L 600 290" stroke={fsColors.line} strokeWidth="2" fill="none" />
                    </>
                  )}

                  {/* Linhas: Pai → Avós Paternos - só se branch do pai expandido */}
                  {pessoaPrincipal && findPai(pessoaPrincipal) &&
                   isBranchExpanded(pessoaPrincipal.id) &&
                   isBranchExpanded(findPai(pessoaPrincipal)!.id) && (
                    <>
                      {/* Saída do pai, bifurcação, para avô */}
                      <path d="M 780 70 L 790 70 L 790 50 L 800 50" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      {/* Bifurcação para avó */}
                      <path d="M 790 70 L 790 170 L 800 170" stroke={fsColors.line} strokeWidth="2" fill="none" />
                    </>
                  )}

                  {/* Linhas: Mãe → Avós Maternos - só se branch da mãe expandido */}
                  {pessoaPrincipal && findMae(pessoaPrincipal) &&
                   isBranchExpanded(pessoaPrincipal.id) &&
                   isBranchExpanded(findMae(pessoaPrincipal)!.id) && (
                    <>
                      {/* Saída da mãe para avós maternos */}
                      <path d="M 780 290 L 790 290 L 790 270 L 800 270" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      {/* Bifurcação para avó materna */}
                      <path d="M 790 290 L 790 390 L 800 390" stroke={fsColors.line} strokeWidth="2" fill="none" />
                    </>
                  )}
                </svg>
              </div>
            ) : (
              // Visualização Retrato (vertical) - Estilo FamilySearch
              // Cards: 140x160px
              <div className="relative" style={{ minWidth: '700px', minHeight: '600px' }}>

                {/* ===== LINHA 1: Pais (y=0) - só se branch expandido ===== */}
                {pessoaPrincipal && isBranchExpanded(pessoaPrincipal.id) && (
                  <>
                    {/* Pai da Pessoa Principal */}
                    <div className="absolute" style={{ left: '70px', top: '0px' }}>
                      {findPai(pessoaPrincipal) ? (
                        <PersonCardSimple
                          pessoa={findPai(pessoaPrincipal)!}
                          mode="retrato"
                          onClick={handlePersonClick}
                        />
                      ) : (
                        <AddPersonButtonSimple
                          type="pai"
                          mode="retrato"
                          onClick={() => {
                            setAddPersonType('pai')
                            setAddPersonParentId(pessoaPrincipal.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>

                    {/* Mãe da Pessoa Principal */}
                    <div className="absolute" style={{ left: '230px', top: '0px' }}>
                      {findMae(pessoaPrincipal) ? (
                        <PersonCardSimple
                          pessoa={findMae(pessoaPrincipal)!}
                          mode="retrato"
                          onClick={handlePersonClick}
                        />
                      ) : (
                        <AddPersonButtonSimple
                          type="mae"
                          mode="retrato"
                          onClick={() => {
                            setAddPersonType('mae')
                            setAddPersonParentId(pessoaPrincipal.id)
                            setShowAddPersonModal(true)
                          }}
                        />
                      )}
                    </div>
                  </>
                )}

                {/* Pais do Cônjuge - só se tiver cônjuge e branch expandido */}
                {pessoaPrincipal && findConjuge(pessoaPrincipal) && isBranchExpanded(pessoaPrincipal.id) && (
                  <>
                    {/* Pai do Cônjuge */}
                    <div className="absolute" style={{ left: '410px', top: '0px' }}>
                      {(() => {
                        const conjuge = findConjuge(pessoaPrincipal)!
                        return findPai(conjuge) ? (
                          <PersonCardSimple
                            pessoa={findPai(conjuge)!}
                            mode="retrato"
                            onClick={handlePersonClick}
                          />
                        ) : (
                          <AddPersonButtonSimple
                            type="pai"
                            mode="retrato"
                            onClick={() => {
                              setAddPersonType('pai')
                              setAddPersonParentId(conjuge.id)
                              setShowAddPersonModal(true)
                            }}
                          />
                        )
                      })()}
                    </div>

                    {/* Mãe do Cônjuge */}
                    <div className="absolute" style={{ left: '570px', top: '0px' }}>
                      {(() => {
                        const conjuge = findConjuge(pessoaPrincipal)!
                        return findMae(conjuge) ? (
                          <PersonCardSimple
                            pessoa={findMae(conjuge)!}
                            mode="retrato"
                            onClick={handlePersonClick}
                          />
                        ) : (
                          <AddPersonButtonSimple
                            type="mae"
                            mode="retrato"
                            onClick={() => {
                              setAddPersonType('mae')
                              setAddPersonParentId(conjuge.id)
                              setShowAddPersonModal(true)
                            }}
                          />
                        )
                      })()}
                    </div>
                  </>
                )}

                {/* ===== LINHA 2: Pessoa Principal e Cônjuge (y=220) ===== */}
                {/* Pessoa Principal */}
                <div className="absolute" style={{ left: '150px', top: '220px' }}>
                  {pessoaPrincipal && (
                    <div className="relative">
                      <PersonCardSimple
                        pessoa={pessoaPrincipal}
                        isMain={true}
                        mode="retrato"
                        onClick={handlePersonClick}
                      />
                      {/* Botão de expandir para ancestrais */}
                      <ExpandButton
                        expanded={isBranchExpanded(pessoaPrincipal.id)}
                        onClick={() => toggleBranch(pessoaPrincipal.id)}
                        direction="up"
                        hasContent={hasPais(pessoaPrincipal) || true}
                      />
                    </div>
                  )}
                </div>

                {/* Cônjuge */}
                <div className="absolute" style={{ left: '490px', top: '220px' }}>
                  {pessoaPrincipal && (
                    findConjuge(pessoaPrincipal) ? (
                      <PersonCardSimple
                        pessoa={findConjuge(pessoaPrincipal)!}
                        mode="retrato"
                        onClick={handlePersonClick}
                      />
                    ) : (
                      <AddSpouseButton
                        mode="retrato"
                        onClick={() => handleAddConjuge(pessoaPrincipal)}
                      />
                    )
                  )}
                </div>

                {/* ===== LINHA 3: Filhos (y=440) ===== */}
                <div className="absolute flex gap-4" style={{ left: '280px', top: '440px' }}>
                  {pessoaPrincipal && findFilhos(pessoaPrincipal).map((filho) => (
                    <PersonCardSimple
                      key={filho.id}
                      pessoa={filho}
                      mode="retrato"
                      onClick={handlePersonClick}
                    />
                  ))}

                  <AddPersonButtonSimple
                    type="filho"
                    mode="retrato"
                    onClick={() => {
                      setAddPersonType('filho')
                      setAddPersonParentId(pessoaPrincipal?.id || null)
                      setShowAddPersonModal(true)
                    }}
                  />
                </div>

                {/* ===== SVG: Linhas de conexão ===== */}
                {/* Cards retrato: 140x160, centroX = left + 70, centroY = top + 80 */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: -1 }}>
                  {/* Linhas dos pais da Pessoa Principal - só se expandido */}
                  {pessoaPrincipal && isBranchExpanded(pessoaPrincipal.id) && (
                    <>
                      {/* Pai desce e encontra no meio */}
                      <path d="M 140 160 L 140 180 L 220 180" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      {/* Mãe desce e encontra no meio */}
                      <path d="M 300 160 L 300 180 L 220 180" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      {/* Centro desce para Pessoa Principal */}
                      <path d="M 220 180 L 220 220" stroke={fsColors.line} strokeWidth="2" fill="none" />
                    </>
                  )}

                  {/* Linhas dos pais do Cônjuge - só se expandido */}
                  {pessoaPrincipal && findConjuge(pessoaPrincipal) && isBranchExpanded(pessoaPrincipal.id) && (
                    <>
                      <path d="M 480 160 L 480 180 L 560 180" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      <path d="M 640 160 L 640 180 L 560 180" stroke={fsColors.line} strokeWidth="2" fill="none" />
                      <path d="M 560 180 L 560 220" stroke={fsColors.line} strokeWidth="2" fill="none" />
                    </>
                  )}

                  {/* Linha horizontal de casamento */}
                  <path d="M 290 300 L 490 300" stroke={fsColors.line} strokeWidth="2" fill="none" />

                  {/* Linha vertical para Filhos */}
                  <path d="M 390 300 L 390 440" stroke={fsColors.line} strokeWidth="2" fill="none" />
                </svg>

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