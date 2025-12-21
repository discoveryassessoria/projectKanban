"use client"

import { useState, useEffect, useRef } from "react"
import type { PessoaArvore, UniaoArvore, DocumentoArvore } from "./types"
import { PessoaSidebar } from "./pessoa-sidebar"
import { PessoaDetailsPage } from "./pessoa-details-page"
import { ReactFlowTree } from "./react-flow-tree"
import { TreeOnboarding } from "./tree-onboarding"
import { DocumentoModal } from "./documento-modal"
import {
  Plus,
  User,
  Loader2,
  Minimize2,
  Maximize2
} from "lucide-react"

interface ArvoreGenealogicaViewProps {
  processoId: number
  arvoreId?: number | null
  onArvoreCreated?: (arvoreId: number) => void
}

type ViewMode = 'paisagem' | 'retrato'

const fsColors = {
  male: '#3073B5',
  female: '#BF3D79',
  green: '#87B940',
  line: '#9CA3AF'
}

export function ArvoreGenealogicaView({ processoId, arvoreId: initialArvoreId, onArvoreCreated }: ArvoreGenealogicaViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('paisagem')
  const [pessoas, setPessoas] = useState<PessoaArvore[]>([])
  const [unioes, setUnioes] = useState<UniaoArvore[]>([])
  const [pessoaPrincipal, setPessoaPrincipal] = useState<PessoaArvore | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [arvoreId, setArvoreId] = useState<number | null>(initialArvoreId || null)
  
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<PessoaArvore | null>(null)
  const [fullDetailsPerson, setFullDetailsPerson] = useState<PessoaArvore | null>(null)

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [showAddPersonModal, setShowAddPersonModal] = useState(false)
  const [addPersonType, setAddPersonType] = useState<'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null>(null)
  const [addPersonParentId, setAddPersonParentId] = useState<number | null>(null)
  const [addConjugeForPessoaId, setAddConjugeForPessoaId] = useState<number | null>(null)

  const [showEditPersonModal, setShowEditPersonModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState<PessoaArvore | null>(null)

  // Estados para modal de documento
  const [showDocumentoModal, setShowDocumentoModal] = useState(false)
  const [documentoPessoaId, setDocumentoPessoaId] = useState<number | null>(null)
  const [documentoPessoaNome, setDocumentoPessoaNome] = useState('')
  const [editingDocumento, setEditingDocumento] = useState<DocumentoArvore | null>(null)

  const handleAddDocumento = (pessoaId: number) => {
    const pessoa = pessoas.find(p => p.id === pessoaId)
    setDocumentoPessoaId(pessoaId)
    setDocumentoPessoaNome(pessoa ? `${pessoa.nome} ${pessoa.sobrenome || ''}`.trim() : '')
    setEditingDocumento(null) // Modo adicionar
    setShowDocumentoModal(true)
  }

  const handleEditDocumento = (documento: DocumentoArvore) => {
    const pessoa = pessoas.find(p => p.id === documento.pessoaId)
    setDocumentoPessoaId(documento.pessoaId || null)
    setDocumentoPessoaNome(pessoa ? `${pessoa.nome} ${pessoa.sobrenome || ''}`.trim() : '')
    setEditingDocumento(documento) // Modo editar
    setShowDocumentoModal(true)
  }

  const handleEditPerson = (pessoa: PessoaArvore) => {
    setEditingPerson(pessoa)
    setShowEditPersonModal(true)
    setSelectedPerson(null)
  }

  const handleDeletePerson = async (pessoa: PessoaArvore) => {
    try {
      const response = await fetch(`/api/pessoas/${pessoa.id}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        await fetchArvore()
        setSelectedPerson(null)
      } else {
        const error = await response.json()
        alert(error.error || 'Erro ao excluir pessoa')
      }
    } catch (error) {
      console.error('Erro ao excluir pessoa:', error)
      alert('Erro ao excluir pessoa')
    }
  }

  const handleAddConjuge = (pessoa: PessoaArvore) => {
    setAddPersonType('conjuge')
    setAddConjugeForPessoaId(pessoa.id)
    setShowAddPersonModal(true)
  }

  const handleCreateArvore = async () => {
    setCreating(true)
    try {
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
        setShowOnboarding(true)
        onArvoreCreated?.(data.id)
      } else {
        const error = await response.json()
        console.error('Erro da API:', error)
        alert(error.error || 'Erro ao criar árvore')
      }
    } catch (error) {
      console.error('Erro ao criar árvore:', error)
      alert('Erro ao criar árvore')
    } finally {
      setCreating(false)
    }
  }

  const fetchArvore = async () => {
    if (!arvoreId) return
    
    try {
      const response = await fetch(`/api/arvore/${arvoreId}`)
      if (response.ok) {
        const data = await response.json()
        setPessoas(data.pessoas || [])
        
        if (!data.pessoas || data.pessoas.length === 0) {
          setShowOnboarding(true)
        } else {
          setShowOnboarding(false)
        }
        
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

  useEffect(() => {
    if (!arvoreId) {
      setLoading(false)
      return
    }
    fetchArvore()
  }, [arvoreId])

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return

    try {
      setIsTransitioning(true)
      
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (error) {
      console.error('Erro ao alternar tela cheia:', error)
      setIsTransitioning(false)
    }
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsTransitioning(true)
      setIsFullscreen(!!document.fullscreenElement)
      setTimeout(() => setIsTransitioning(false), 250)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

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

  const findConjuge = (pessoa: PessoaArvore): PessoaArvore | null => {
    const uniao = unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
    if (!uniao) return null
    const conjugeId = uniao.pessoa1Id === pessoa.id ? uniao.pessoa2Id : uniao.pessoa1Id
    return pessoas.find(p => p.id === conjugeId) || null
  }

  const findCasamento = (pessoa: PessoaArvore): UniaoArvore | null => {
    return unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id) || null
  }

  const findConjuges = (pessoa: PessoaArvore): PessoaArvore[] => {
    const unioesP = unioes.filter(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
    return unioesP
      .map(u => {
        const conjugeId = u.pessoa1Id === pessoa.id ? u.pessoa2Id : u.pessoa1Id
        return pessoas.find(p => p.id === conjugeId)
      })
      .filter(Boolean) as PessoaArvore[]
  }

  const findCasamentos = (pessoa: PessoaArvore): UniaoArvore[] => {
    return unioes.filter(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
  }

  const findFilhos = (pessoa: PessoaArvore): PessoaArvore[] => {
    return pessoas.filter(p => p.paiId === pessoa.id || p.maeId === pessoa.id)
  }

  const handleAddPai = (pessoaId: number) => {
    setAddPersonType('pai')
    setAddPersonParentId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleAddMae = (pessoaId: number) => {
    setAddPersonType('mae')
    setAddPersonParentId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleAddFilho = (pessoaId: number) => {
    setAddPersonType('filho')
    setAddPersonParentId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleAddConjugeById = (pessoaId: number) => {
    setAddPersonType('conjuge')
    setAddConjugeForPessoaId(pessoaId)
    setShowAddPersonModal(true)
  }

  const handleOnboardingComplete = async () => {
    setShowOnboarding(false)
    await fetchArvore()
  }

  if (!arvoreId && !loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center max-w-md px-6">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full opacity-20 animate-pulse" style={{ backgroundColor: fsColors.green }} />
            <div className="absolute inset-2 rounded-full flex items-center justify-center" style={{ backgroundColor: `${fsColors.green}30` }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" fill={fsColors.green} />
                <path d="M12 6v12M8 10v4M16 10v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-800 mb-2">Árvore Genealógica</h3>
          <p className="text-gray-500 mb-6">Crie a árvore genealógica para este processo de cidadania e gerencie todos os membros da família</p>
          <button
            className="px-8 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: fsColors.green }}
            onClick={handleCreateArvore}
            disabled={creating}
          >
            {creating ? (<><Loader2 className="h-5 w-5 animate-spin" />Criando árvore...</>) : (<><Plus className="h-5 w-5" />Criar Árvore Genealógica</>)}
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

  if (showOnboarding && arvoreId) {
    return (
      <div ref={containerRef} className="h-full">
        <TreeOnboarding arvoreId={arvoreId} onComplete={handleOnboardingComplete} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-gradient-to-b from-gray-100 to-gray-200 relative">
      <div className={`absolute inset-0 bg-white z-[9999] pointer-events-none transition-opacity duration-300 ${isTransitioning ? 'opacity-60' : 'opacity-0'}`} />
      
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <div className="flex items-center gap-2">
          <button className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'paisagem' ? 'bg-gray-100' : 'hover:bg-gray-50'}`} onClick={() => setViewMode('paisagem')}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="9" width="6" height="6" rx="1" />
              <rect x="14" y="3" width="6" height="6" rx="1" />
              <rect x="14" y="15" width="6" height="6" rx="1" />
              <path d="M8 12 L14 6" />
              <path d="M8 12 L14 18" />
            </svg>
            <span className="text-sm font-medium">PAISAGEM</span>
          </button>
          <button className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${viewMode === 'retrato' ? 'bg-gray-100' : 'hover:bg-gray-50'}`} onClick={() => setViewMode('retrato')}>
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
          <button className="p-2 hover:bg-gray-100 rounded transition-colors" onClick={handleToggleFullscreen} title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {pessoas.length === 0 && !showOnboarding && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-8 max-w-sm text-center px-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a7.5 7.5 0 0113 0" />
                  </svg>
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: fsColors.green }}>
                  <Plus className="w-4 h-4 text-white" />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Comece sua árvore</h3>
                <p className="text-gray-500 text-sm">Adicione a primeira pessoa da família para começar a construir a árvore genealógica</p>
              </div>
              <button className="px-6 py-3 text-white rounded-xl font-semibold transition-all hover:shadow-lg hover:-translate-y-0.5 flex items-center gap-2" style={{ backgroundColor: fsColors.green }} onClick={() => setShowOnboarding(true)}>
                <User className="w-5 h-5" />
                Adicionar primeira pessoa
              </button>
            </div>
          </div>
        )}

        {pessoas.length > 0 && pessoaPrincipal && (
          <ReactFlowTree
            pessoas={pessoas}
            unioes={unioes}
            pessoaPrincipal={pessoaPrincipal}
            mode={viewMode}
            onPersonClick={handlePersonClick}
            onAddPai={handleAddPai}
            onAddMae={handleAddMae}
            onAddFilho={handleAddFilho}
            onAddConjuge={handleAddConjugeById}
          />
        )}
      </div>

      {selectedPerson && (<div className="fixed inset-0 bg-black/20 z-[10000]" onClick={handleCloseSidebar} />)}

      <PessoaSidebar 
        pessoa={selectedPerson}
        conjuges={selectedPerson ? findConjuges(selectedPerson) : []}
        casamentos={selectedPerson ? findCasamentos(selectedPerson) : []}
        onClose={handleCloseSidebar}
        onOpenFullDetails={handleOpenFullDetails}
        onEdit={handleEditPerson}
        onDelete={handleDeletePerson}
        onAddFilho={handleAddFilho}
        onAddPai={handleAddPai}
        onAddMae={handleAddMae}
        onAddConjuge={handleAddConjugeById}
        onAddDocumento={handleAddDocumento}
        onEditDocumento={handleEditDocumento}
      />

      {fullDetailsPerson && (
        <PessoaDetailsPage 
          pessoa={fullDetailsPerson}
          conjuge={findConjuge(fullDetailsPerson)}
          casamento={findCasamento(fullDetailsPerson)}
          filhos={findFilhos(fullDetailsPerson)}
          onBack={handleCloseFullDetails}
          onPersonClick={handlePersonClickFromDetails}
          onAddPai={handleAddPai}
          onAddMae={handleAddMae}
          onAddFilho={handleAddFilho}
          onAddConjuge={handleAddConjugeById}
        />
      )}

      {showAddPersonModal && (
        <AddPersonModal 
          arvoreId={arvoreId!}
          type={addPersonType}
          parentId={addPersonParentId}
          conjugeDePessoaId={addConjugeForPessoaId}
          pessoas={pessoas}
          unioes={unioes}
          onClose={() => { setShowAddPersonModal(false); setAddPersonType(null); setAddPersonParentId(null); setAddConjugeForPessoaId(null) }}
          onSuccess={async () => { await fetchArvore(); setShowAddPersonModal(false); setAddPersonType(null); setAddPersonParentId(null); setAddConjugeForPessoaId(null) }}
        />
      )}

      {showEditPersonModal && editingPerson && (
        <EditPersonModal 
          pessoa={editingPerson}
          pessoas={pessoas}
          unioes={unioes}
          onClose={() => { setShowEditPersonModal(false); setEditingPerson(null) }}
          onSuccess={async () => { await fetchArvore(); setShowEditPersonModal(false); setEditingPerson(null) }}
        />
      )}

      {showDocumentoModal && documentoPessoaId && (
        <DocumentoModal
          pessoaId={documentoPessoaId}
          pessoaNome={documentoPessoaNome}
          documento={editingDocumento}
          onClose={() => { setShowDocumentoModal(false); setDocumentoPessoaId(null); setDocumentoPessoaNome(''); setEditingDocumento(null) }}
          onSuccess={async () => { await fetchArvore(); setShowDocumentoModal(false); setDocumentoPessoaId(null); setDocumentoPessoaNome(''); setEditingDocumento(null) }}
        />
      )}
    </div>
  )
}

// ========================================
// MODAL DE ADICIONAR PESSOA
// ========================================
function AddPersonModal({ arvoreId, type, parentId, conjugeDePessoaId, pessoas, unioes, onClose, onSuccess }: { arvoreId: number; type: 'pai' | 'mae' | 'filho' | 'pessoa' | 'conjuge' | null; parentId: number | null; conjugeDePessoaId?: number | null; pessoas: PessoaArvore[]; unioes: UniaoArvore[]; onClose: () => void; onSuccess: () => void }) {
  const [nome, setNome] = useState('')
  const [sobrenome, setSobrenome] = useState('')
  const [sexo, setSexo] = useState<string>('')
  const [dataNasc, setDataNasc] = useState('')
  const [localNasc, setLocalNasc] = useState('')
  const [paisNasc, setPaisNasc] = useState('')
  const [nacionalidade, setNacionalidade] = useState('')
  const [isFalecido, setIsFalecido] = useState(false)
  const [dataObito, setDataObito] = useState('')
  const [localObito, setLocalObito] = useState('')
  const [isCasado, setIsCasado] = useState(false)
  const [dataCasamento, setDataCasamento] = useState('')
  const [localCasamento, setLocalCasamento] = useState('')
  const [conjugeId, setConjugeId] = useState<number | string>('')
  const [comentario, setComentario] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (type === 'conjuge') setIsCasado(true) }, [type])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return
    setSaving(true)
    try {
      const body: any = { nome: nome.trim(), sobrenome: sobrenome.trim() || null, sexo: sexo || null, data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null, local_nasc: localNasc.trim() || null, pais_nasc: paisNasc.trim() || null, nacionalidade: nacionalidade.trim() || null, vivo: !isFalecido, data_obito: isFalecido && dataObito ? new Date(dataObito).toISOString() : null, local_emigracao: isFalecido && localObito ? localObito.trim() : null, comentario: comentario.trim() || null, arvoreId }
      if (type === 'pai' && parentId) { body.filhoId = parentId; body.tipoPai = 'pai' }
      else if (type === 'mae' && parentId) { body.filhoId = parentId; body.tipoPai = 'mae' }
      else if (type === 'filho' && parentId) {
        const pessoaPai = pessoas.find(p => p.id === parentId)
        if (pessoaPai) {
          if (pessoaPai.sexo === 'Feminino') body.maeId = parentId
          else body.paiId = parentId
          const uniaoExistente = unioes.find(u => u.pessoa1Id === parentId || u.pessoa2Id === parentId)
          if (uniaoExistente) {
            const cId = uniaoExistente.pessoa1Id === parentId ? uniaoExistente.pessoa2Id : uniaoExistente.pessoa1Id
            const conjuge = pessoas.find(p => p.id === cId)
            if (conjuge) { if (conjuge.sexo === 'Feminino') body.maeId = cId; else body.paiId = cId }
          }
        } else body.paiId = parentId
      }
      const response = await fetch('/api/pessoas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (response.ok) {
        const novaPessoa = await response.json()
        if ((type === 'conjuge' && conjugeDePessoaId) || (isCasado && conjugeId)) {
          const pessoa1Id = conjugeDePessoaId || novaPessoa.id
          const pessoa2Id = conjugeDePessoaId ? novaPessoa.id : Number(conjugeId)
          await fetch('/api/unioes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pessoa1Id, pessoa2Id, data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null, local: localCasamento.trim() || null, tipo: 'casamento' }) })
        }
        onSuccess()
      } else { const error = await response.json(); alert(error.error || 'Erro ao adicionar pessoa') }
    } catch (error) { console.error('Erro ao adicionar pessoa:', error); alert('Erro ao adicionar pessoa') }
    finally { setSaving(false) }
  }

  const titles: Record<string, string> = { pai: 'Adicionar Pai', mae: 'Adicionar Mãe', filho: 'Adicionar Filho(a)', pessoa: 'Adicionar Pessoa', conjuge: 'Adicionar Cônjuge' }
  const pessoasDisponiveis = pessoas.filter(p => true)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-3xl">
        <div className="px-6 py-4 border-b"><h2 className="text-xl font-semibold text-gray-900">{titles[type || 'pessoa']}</h2></div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label><input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" required autoFocus /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label><input type="text" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label><select value={sexo} onChange={(e) => setSexo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"><option value="">Selecione...</option><option value="Masculino">Masculino</option><option value="Feminino">Feminino</option></select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label><input type="date" value={dataNasc} onChange={(e) => setDataNasc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Cidade de Nascimento</label><input type="text" value={localNasc} onChange={(e) => setLocalNasc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">País de Nascimento</label><input type="text" value={paisNasc} onChange={(e) => setPaisNasc(e.target.value)} placeholder="Ex: Brasil, Itália..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3 items-end">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nacionalidade</label><input type="text" value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} placeholder="Ex: Brasileiro..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            {type !== 'conjuge' && (<div className="flex items-center h-[42px]"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isCasado} onChange={(e) => setIsCasado(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" /><span className="text-sm font-medium text-gray-700">Pessoa casada</span></label></div>)}
            <div className="flex items-center h-[42px]"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isFalecido} onChange={(e) => setIsFalecido(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" /><span className="text-sm font-medium text-gray-700">Pessoa falecida</span></label></div>
          </div>
          {(isCasado || type === 'conjuge') && (<div className="bg-purple-50 rounded-lg p-3 border border-purple-200"><h3 className="text-sm font-medium text-purple-800 mb-2">Dados do Casamento</h3><div className="grid grid-cols-3 gap-3">{type !== 'conjuge' && (<div><label className="block text-sm font-medium text-gray-700 mb-1">Cônjuge</label><select value={conjugeId} onChange={(e) => setConjugeId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"><option value="">Selecione...</option>{pessoasDisponiveis.map(p => (<option key={p.id} value={p.id}>{p.nome} {p.sobrenome || ''}</option>))}</select></div>)}<div><label className="block text-sm font-medium text-gray-700 mb-1">Data do Casamento</label><input type="date" value={dataCasamento} onChange={(e) => setDataCasamento(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Local do Casamento</label><input type="text" value={localCasamento} onChange={(e) => setLocalCasamento(e.target.value)} placeholder="Cidade, País" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div></div></div>)}
          {isFalecido && (<div className="bg-gray-50 rounded-lg p-3 border border-gray-200"><h3 className="text-sm font-medium text-gray-700 mb-2">Dados do Falecimento</h3><div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-gray-700 mb-1">Data de Falecimento</label><input type="date" value={dataObito} onChange={(e) => setDataObito(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Local de Falecimento</label><input type="text" value={localObito} onChange={(e) => setLocalObito(e.target.value)} placeholder="Cidade, País" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div></div></div>)}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Observações</label><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button><button type="submit" disabled={saving || !nome.trim()} className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50">{saving ? 'Salvando...' : 'Adicionar'}</button></div>
        </form>
      </div>
    </>
  )
}

// ========================================
// MODAL DE EDITAR PESSOA
// ========================================
function EditPersonModal({ pessoa, pessoas, unioes, onClose, onSuccess }: { pessoa: PessoaArvore; pessoas: PessoaArvore[]; unioes: UniaoArvore[]; onClose: () => void; onSuccess: () => void }) {
  const uniaoExistente = unioes.find(u => u.pessoa1Id === pessoa.id || u.pessoa2Id === pessoa.id)
  const conjugeExistenteId = uniaoExistente ? (uniaoExistente.pessoa1Id === pessoa.id ? uniaoExistente.pessoa2Id : uniaoExistente.pessoa1Id) : null
  const [nome, setNome] = useState(pessoa.nome)
  const [sobrenome, setSobrenome] = useState(pessoa.sobrenome || '')
  const [sexo, setSexo] = useState(pessoa.sexo || '')
  const [dataNasc, setDataNasc] = useState(pessoa.data_nasc ? new Date(pessoa.data_nasc).toISOString().split('T')[0] : '')
  const [localNasc, setLocalNasc] = useState(pessoa.local_nasc || '')
  const [paisNasc, setPaisNasc] = useState(pessoa.pais_nasc || '')
  const [nacionalidade, setNacionalidade] = useState(pessoa.nacionalidade || '')
  const [isFalecido, setIsFalecido] = useState(pessoa.vivo === false || !!pessoa.data_obito)
  const [dataObito, setDataObito] = useState(pessoa.data_obito ? new Date(pessoa.data_obito).toISOString().split('T')[0] : '')
  const [localObito, setLocalObito] = useState(pessoa.local_emigracao || '')
  const [isCasado, setIsCasado] = useState(!!uniaoExistente)
  const [dataCasamento, setDataCasamento] = useState(uniaoExistente?.data_inicio ? new Date(uniaoExistente.data_inicio).toISOString().split('T')[0] : '')
  const [localCasamento, setLocalCasamento] = useState(uniaoExistente?.local || '')
  const [conjugeId, setConjugeId] = useState<number | string>(conjugeExistenteId || '')
  const [comentario, setComentario] = useState(pessoa.comentario || '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return
    setSaving(true)
    try {
      const response = await fetch(`/api/pessoas/${pessoa.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nome.trim(), sobrenome: sobrenome.trim() || null, sexo: sexo || null, data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null, local_nasc: localNasc.trim() || null, pais_nasc: paisNasc.trim() || null, nacionalidade: nacionalidade.trim() || null, vivo: !isFalecido, data_obito: isFalecido && dataObito ? new Date(dataObito).toISOString() : null, local_emigracao: isFalecido && localObito ? localObito.trim() : null, comentario: comentario.trim() || null }) })
      if (!response.ok) { const error = await response.json(); alert(error.error || 'Erro ao atualizar pessoa'); return }
      if (isCasado && conjugeId) {
        if (uniaoExistente) await fetch(`/api/unioes/${uniaoExistente.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null, local: localCasamento.trim() || null }) })
        else await fetch('/api/unioes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pessoa1Id: pessoa.id, pessoa2Id: Number(conjugeId), data_inicio: dataCasamento ? new Date(dataCasamento).toISOString() : null, local: localCasamento.trim() || null, tipo: 'casamento' }) })
      } else if (!isCasado && uniaoExistente) await fetch(`/api/unioes/${uniaoExistente.id}`, { method: 'DELETE' })
      onSuccess()
    } catch (error) { console.error('Erro ao atualizar pessoa:', error); alert('Erro ao atualizar pessoa') }
    finally { setSaving(false) }
  }

  const pessoasDisponiveis = pessoas.filter(p => p.id !== pessoa.id)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-3xl">
        <div className="px-6 py-4 border-b"><h2 className="text-xl font-semibold text-gray-900">Editar Pessoa</h2></div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label><input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" required autoFocus /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Sobrenome</label><input type="text" value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label><select value={sexo} onChange={(e) => setSexo(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"><option value="">Selecione...</option><option value="Masculino">Masculino</option><option value="Feminino">Feminino</option></select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label><input type="date" value={dataNasc} onChange={(e) => setDataNasc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Cidade de Nascimento</label><input type="text" value={localNasc} onChange={(e) => setLocalNasc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">País de Nascimento</label><input type="text" value={paisNasc} onChange={(e) => setPaisNasc(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3 items-end">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nacionalidade</label><input type="text" value={nacionalidade} onChange={(e) => setNacionalidade(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div className="flex items-center h-[42px]"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isCasado} onChange={(e) => setIsCasado(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" /><span className="text-sm font-medium text-gray-700">Pessoa casada</span></label></div>
            <div className="flex items-center h-[42px]"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isFalecido} onChange={(e) => setIsFalecido(e.target.checked)} className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500" /><span className="text-sm font-medium text-gray-700">Pessoa falecida</span></label></div>
          </div>
          {isCasado && (<div className="bg-purple-50 rounded-lg p-3 border border-purple-200"><h3 className="text-sm font-medium text-purple-800 mb-2">Dados do Casamento</h3><div className="grid grid-cols-3 gap-3"><div><label className="block text-sm font-medium text-gray-700 mb-1">Cônjuge</label><select value={conjugeId} onChange={(e) => setConjugeId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"><option value="">Selecione...</option>{pessoasDisponiveis.map(p => (<option key={p.id} value={p.id}>{p.nome} {p.sobrenome || ''}</option>))}</select></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Data do Casamento</label><input type="date" value={dataCasamento} onChange={(e) => setDataCasamento(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Local do Casamento</label><input type="text" value={localCasamento} onChange={(e) => setLocalCasamento(e.target.value)} placeholder="Cidade, País" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div></div></div>)}
          {isFalecido && (<div className="bg-gray-50 rounded-lg p-3 border border-gray-200"><h3 className="text-sm font-medium text-gray-700 mb-2">Dados do Falecimento</h3><div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-gray-700 mb-1">Data de Falecimento</label><input type="date" value={dataObito} onChange={(e) => setDataObito(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Local de Falecimento</label><input type="text" value={localObito} onChange={(e) => setLocalObito(e.target.value)} placeholder="Cidade, País" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div></div></div>)}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Observações</label><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancelar</button><button type="submit" disabled={saving || !nome.trim()} className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar'}</button></div>
        </form>
      </div>
    </>
  )
}