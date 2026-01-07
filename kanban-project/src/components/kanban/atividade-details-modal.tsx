// src/components/kanban/atividade-details-modal.tsx

"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MapTooltip } from "../ui/map-tooltip"
import { ArvoreGenealogicaView } from "../arvore"
import { ProcessoTarefas } from "./ProcessoTarefas"
import { ProcessoProtocolos } from "./ProcessoProtocolos"
import { ProcessoInformacoes } from "./ProcessoInformacoes"
import { ProcessoHistorico } from "./ProcessoHistorico"
import { ProcessoFaturas } from "./ProcessoFaturas"
// ✅ IMPORTAR o modal e o initialFormData
import { ContratanteModal, initialFormData } from "../contratantes-tabela"
import { 
  X, 
  Phone, 
  Mail, 
  Settings, 
  ChevronDown,
  Plus,
  MessageSquare,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  GitBranch,
  User,
  MapPin,
  Trash2,
  FileText
} from "lucide-react"
import { 
  Pais, 
  PAISES_CONFIG, 
  type Status,
  type ProcessoWithStatus,
  type Processo,
  type Contratante,
  type Requerente
} from "@/src/types/kanban"

// Lista de países (necessária para o modal)
const PAISES_OPTIONS = [
  { nome: "Brasil", codigo: "br" },
  { nome: "Estados Unidos", codigo: "us" },
  { nome: "Portugal", codigo: "pt" },
  { nome: "Espanha", codigo: "es" },
  { nome: "Itália", codigo: "it" },
  { nome: "Alemanha", codigo: "de" },
  { nome: "França", codigo: "fr" },
  { nome: "Reino Unido", codigo: "gb" },
  { nome: "Argentina", codigo: "ar" },
  { nome: "Canadá", codigo: "ca" },
  { nome: "Japão", codigo: "jp" },
  { nome: "Outro", codigo: null },
]

interface ProcessoDetailsModalProps {
  processo: ProcessoWithStatus | Processo | null
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
  statusList?: Status[]
  contratantes?: Contratante[]
  requerentes?: Requerente[]
  initialTab?: string
  initialPessoaId?: number
  initialSidebarTab?: string
}

export function ProcessoDetailsModal({ 
  processo, 
  isOpen, 
  onClose, 
  onSave,
  statusList = [],
  contratantes: contratantesProp = [],
  requerentes: requerentesProp = [],
  initialTab,
  initialPessoaId,
  initialSidebarTab
}: ProcessoDetailsModalProps) {
  // ✅ ATUALIZADO: Adicionado "informacoes" como possível aba
  const [activeTab, setActiveTab] = useState<"geral" | "faturas" | "historico" | "arvore" | "protocolos" | "informacoes">("geral")
  const [etapas, setEtapas] = useState<Status[]>([])
  const [statusIdAtual, setStatusIdAtual] = useState(processo?.statusId)
  const [mudouEtapa, setMudouEtapa] = useState(false)
  
  // Modo edição
  const [isEditing, setIsEditing] = useState(false)
  const [nomeEditado, setNomeEditado] = useState(processo?.nome || "")
  const [contratantesSelecionados, setContratantesSelecionados] = useState<Contratante[]>(processo?.contratantes || [])
  const [requerentesSelecionados, setRequerentesSelecionados] = useState<Requerente[]>(processo?.requerentes || [])
  
  // Busca de contatos
  const [buscaContratante, setBuscaContratante] = useState("")
  const [buscaRequerente, setBuscaRequerente] = useState("")
  const [showContratanteDropdown, setShowContratanteDropdown] = useState(false)
  const [showRequerenteDropdown, setShowRequerenteDropdown] = useState(false)
  
  // Listas de contatos
  const [contratantes, setContratantes] = useState<Contratante[]>(contratantesProp)
  const [requerentes, setRequerentes] = useState<Requerente[]>(requerentesProp)
  
  // Árvore genealógica
  const [arvoreIdLocal, setArvoreIdLocal] = useState<number | null>(processo?.arvoreId || null)
  
  // Estado para pessoa selecionada na árvore
  const [pessoaIdParaFocar, setPessoaIdParaFocar] = useState<number | undefined>(undefined)
  const [sidebarTabParaFocar, setSidebarTabParaFocar] = useState<string | undefined>(undefined)
  
  // ✅ NOVO: Estados para o modal de detalhes do cliente
  const [clienteModalOpen, setClienteModalOpen] = useState(false)
  const [clienteFormData, setClienteFormData] = useState(initialFormData)
  const [clienteEditingId, setClienteEditingId] = useState<number | null>(null)
  const [clienteTipo, setClienteTipo] = useState<string>("contratante")
  const [clienteIsViewMode, setClienteIsViewMode] = useState(true)
  
  const contratanteRef = useRef<HTMLDivElement>(null)
  const requerenteRef = useRef<HTMLDivElement>(null)
  
  const [initialParamsProcessed, setInitialParamsProcessed] = useState(false)

  // ✅ Verificar se o processo é da Espanha ou Itália
  const isEspanha = processo?.pais === "ESPANHA"
  const isItalia = processo?.pais === "ITALIA"

  // ✅ NOVO: Função para abrir o modal de detalhes do cliente
  const abrirDetalhesCliente = (cliente: Contratante | Requerente, tipo: "contratante" | "requerente") => {
    const clienteAny = cliente as any
    const paisSalvo = clienteAny.pais || "Brasil"
    const paisNaLista = PAISES_OPTIONS.some(p => p.nome === paisSalvo)
    
    setClienteFormData({
      tipo,
      nome: cliente.nome || "",
      cpf: cliente.cpf || "",
      rg: cliente.rg || "",
      passaporte: clienteAny.passaporte || "",
      crnm: clienteAny.crnm || "",
      dataNascimento: cliente.dataNascimento 
        ? new Date(cliente.dataNascimento).toISOString().split("T")[0] 
        : "",
      sexo: cliente.sexo || "",
      estadoCivil: cliente.estadoCivil || "",
      nacionalidade: cliente.nacionalidade || "",
      telefone: cliente.telefone || "",
      email: cliente.email || "",
      pais: paisNaLista ? paisSalvo : "Outro",
      paisOutro: paisNaLista ? "" : paisSalvo,
      endereco: cliente.endereco || "",
      numero: cliente.numero || "",
      complemento: cliente.complemento || "",
      bairro: cliente.bairro || "",
      cidade: cliente.cidade || "",
      estado: cliente.estado || "",
      cep: cliente.cep || "",
      observacoes: cliente.observacoes || "",
    })
    setClienteEditingId(cliente.id)
    setClienteTipo(tipo)
    setClienteIsViewMode(true)
    setClienteModalOpen(true)
  }

  // ✅ NOVO: Função para salvar alterações do cliente
  const handleSaveCliente = async () => {
    if (!clienteFormData.nome.trim()) {
      alert("Nome é obrigatório")
      return
    }

    try {
      const baseUrl = clienteTipo === "requerente" ? "/api/requerentes" : "/api/contratantes"
      const url = `${baseUrl}/${clienteEditingId}`
      
      const { tipo, paisOutro, ...restData } = clienteFormData
      
      const dataToSend = {
        ...restData,
        pais: clienteFormData.pais === "Outro" ? (paisOutro || "Outro") : clienteFormData.pais,
      }

      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSend),
      })

      if (response.ok) {
        setClienteModalOpen(false)
        // Atualizar a lista local
        if (clienteTipo === "contratante") {
          const atualizado = contratantesSelecionados.map(c => 
            c.id === clienteEditingId ? { ...c, ...dataToSend } : c
          )
          setContratantesSelecionados(atualizado as Contratante[])
        } else {
          const atualizado = requerentesSelecionados.map(r => 
            r.id === clienteEditingId ? { ...r, ...dataToSend } : r
          )
          setRequerentesSelecionados(atualizado as Requerente[])
        }
        onSave?.()
      } else {
        const data = await response.json()
        throw new Error(data.error || "Erro ao salvar")
      }
    } catch (error: any) {
      alert(error.message || "Erro ao salvar cliente")
    }
  }

  useEffect(() => {
    if (isOpen && initialTab && !initialParamsProcessed) {
      if (initialTab === "arvore") {
        setActiveTab("arvore")
      } else if (initialTab === "geral") {
        setActiveTab("geral")
      } else if (initialTab === "faturas") {
        setActiveTab("faturas")
      } else if (initialTab === "historico") {
        setActiveTab("historico")
      } else if (initialTab === "protocolos" && isEspanha) {
        setActiveTab("protocolos")
      } else if (initialTab === "informacoes" && isItalia) {
        setActiveTab("informacoes")
      }
      
      if (initialPessoaId) {
        setPessoaIdParaFocar(initialPessoaId)
      }
      
      if (initialSidebarTab) {
        setSidebarTabParaFocar(initialSidebarTab)
      }
      
      setInitialParamsProcessed(true)
    }
  }, [isOpen, initialTab, initialPessoaId, initialSidebarTab, initialParamsProcessed, isEspanha, isItalia])

  useEffect(() => {
    if (!isOpen) {
      setInitialParamsProcessed(false)
      setPessoaIdParaFocar(undefined)
      setSidebarTabParaFocar(undefined)
    }
  }, [isOpen])

  useEffect(() => {
    setStatusIdAtual(processo?.statusId)
    setNomeEditado(processo?.nome || "")
    setContratantesSelecionados(processo?.contratantes || [])
    setRequerentesSelecionados(processo?.requerentes || [])
    setArvoreIdLocal(processo?.arvoreId || null)
  }, [processo])

  useEffect(() => {
    if (isOpen && contratantesProp.length === 0) {
      fetch('/api/contratantes')
        .then(res => res.json())
        .then(data => setContratantes(data.contratantes || []))
        .catch(console.error)
    }
    if (isOpen && requerentesProp.length === 0) {
      fetch('/api/requerentes')
        .then(res => res.json())
        .then(data => setRequerentes(data.requerentes || []))
        .catch(console.error)
    }
  }, [isOpen, contratantesProp.length, requerentesProp.length])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contratanteRef.current && !contratanteRef.current.contains(e.target as Node)) {
        setShowContratanteDropdown(false)
      }
      if (requerenteRef.current && !requerenteRef.current.contains(e.target as Node)) {
        setShowRequerenteDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleClose = () => {
    if (mudouEtapa) {
      onSave?.()
    }
    setIsEditing(false)
    setActiveTab("geral")
    onClose()
  }

  useEffect(() => {
    if (isOpen && processo?.pais) {
      if (statusList.length > 0) {
        setEtapas(statusList)
      } else {
        fetch(`/api/status?pais=${processo.pais}`)
          .then(res => res.json())
          .then(data => {
            if (data.status) {
              setEtapas(data.status)
            }
          })
          .catch(console.error)
      }
    }
  }, [isOpen, processo?.pais, statusList])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'auto'
    }
  }, [isOpen, handleClose])

  const handleSaveEdit = async () => {
    if (!processo) return
    
    try {
      const response = await fetch(`/api/processos/${processo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nomeEditado,
          contratanteIds: contratantesSelecionados.map(c => c.id),
          requerenteIds: requerentesSelecionados.map(r => r.id)
        })
      })
      
      if (response.ok) {
        setIsEditing(false)
        onSave?.()
      } else {
        alert('Erro ao salvar alterações')
      }
    } catch (error) {
      console.error('Erro ao salvar:', error)
      alert('Erro ao salvar alterações')
    }
  }

  const handleCancelEdit = () => {
    setNomeEditado(processo?.nome || "")
    setContratantesSelecionados(processo?.contratantes || [])
    setRequerentesSelecionados(processo?.requerentes || [])
    setIsEditing(false)
  }

  const handleDelete = async () => {
    if (!processo) return
    
    const confirmDelete = window.confirm(
      `Tem certeza que deseja excluir o processo "${processo.nome}"?\n\nEsta ação não pode ser desfeita.`
    )
    
    if (!confirmDelete) return
    
    try {
      const response = await fetch(`/api/processos/${processo.id}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        onSave?.()
        onClose()
      } else {
        alert('Erro ao excluir processo')
      }
    } catch (error) {
      console.error('Erro ao excluir:', error)
      alert('Erro ao excluir processo')
    }
  }

  const contratantesFiltrados = contratantes.filter(c => 
    !contratantesSelecionados.find(sel => sel.id === c.id) &&
    (c.nome.toLowerCase().includes(buscaContratante.toLowerCase()) ||
    c.email?.toLowerCase().includes(buscaContratante.toLowerCase()) ||
    c.telefone?.includes(buscaContratante))
  )

  const requerentesFiltrados = requerentes.filter(r => 
    !requerentesSelecionados.find(sel => sel.id === r.id) &&
    (r.nome.toLowerCase().includes(buscaRequerente.toLowerCase()) ||
    r.email?.toLowerCase().includes(buscaRequerente.toLowerCase()) ||
    r.telefone?.includes(buscaRequerente))
  )

  const addContratante = (cont: Contratante) => {
    setContratantesSelecionados([...contratantesSelecionados, cont])
    setBuscaContratante("")
    setShowContratanteDropdown(false)
  }

  const removeContratante = (id: number) => {
    setContratantesSelecionados(contratantesSelecionados.filter(c => c.id !== id))
  }

  const addRequerente = (req: Requerente) => {
    setRequerentesSelecionados([...requerentesSelecionados, req])
    setBuscaRequerente("")
    setShowRequerenteDropdown(false)
  }

  const removeRequerente = (id: number) => {
    setRequerentesSelecionados(requerentesSelecionados.filter(r => r.id !== id))
  }

  if (!isOpen || !processo) return null

  const paisConfig = PAISES_CONFIG[processo.pais] || { label: processo.pais, bandeira: "🏳️" }
  const sortedEtapas = [...etapas].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const etapaAtualIndex = sortedEtapas.findIndex(e => e.id === statusIdAtual)
  const etapaAtual = sortedEtapas.find(e => e.id === statusIdAtual)

  const getEtapaCor = (index: number) => {
    const cores = [
      "bg-blue-500", "bg-blue-400", "bg-cyan-500", "bg-teal-500",
      "bg-green-500", "bg-emerald-500", "bg-yellow-500", "bg-orange-500",
      "bg-red-500", "bg-purple-500", "bg-pink-500",
    ]
    return cores[index % cores.length]
  }

  const dataCriacao = processo.createdAt
  const dataFormatada = dataCriacao ? new Date(dataCriacao).toLocaleDateString('pt-BR') : ""

  // ✅ Definir abas dinamicamente baseado no país
  const tabs = [
    { id: "geral", label: "Geral" },
    { id: "arvore", label: "Árvore Genealógica" },
    // Aba Informações só aparece para ITÁLIA
    ...(isItalia ? [{ id: "informacoes", label: "Informações" }] : []),
    // Aba Protocolos só aparece para ESPANHA
    ...(isEspanha ? [{ id: "protocolos", label: "Protocolos" }] : []),
    { id: "faturas", label: "Faturas" },
    { id: "historico", label: "Histórico" },
  ]

  const modalContent = (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={handleClose} />

      <div 
        className="fixed z-[9999] bg-white shadow-2xl flex flex-col overflow-hidden rounded-tl-xl rounded-tr-xl"
        style={{ left: '155px', top: '45px', right: '35px', bottom: '0px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-white flex-shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={handleClose}
              className="w-10 h-10 bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center justify-center transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
            
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{processo.nome}</h1>
              <span className="text-sm text-gray-500">{paisConfig.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-700">
              <Phone className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-700">
              <Mail className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-700">
              <Settings className="h-5 w-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
              onClick={handleDelete}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
            <Button className="bg-red-500 hover:bg-red-600 text-white">
              Orçamento
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>

        {/* Barra de Etapas */}
        <div className="flex border-b bg-gray-50 overflow-x-auto flex-shrink-0">
          {sortedEtapas.length > 0 ? (
            sortedEtapas.map((etapa, index) => {
              const isActive = etapa.id === statusIdAtual
              const isPast = index < etapaAtualIndex
              const cor = getEtapaCor(index)
              return (
                <button
                  key={etapa.id}
                  onClick={async () => {
                    if (etapa.id === statusIdAtual) return
                    try {
                      const response = await fetch(`/api/processos/${processo.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ statusId: etapa.id })
                      })
                      if (response.ok) {
                        setStatusIdAtual(etapa.id)
                        setMudouEtapa(true)
                        onSave?.()
                      } else {
                        alert('Erro ao mover processo')
                      }
                    } catch (error) {
                      console.error('Erro ao mover processo:', error)
                      alert('Erro ao mover processo')
                    }
                  }}
                  className={`
                    flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors relative cursor-pointer
                    ${isActive ? `${cor} text-white` : isPast ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}
                  `}
                >
                  {etapa.nome}
                </button>
              )
            })
          ) : (
            <div className="px-4 py-3 text-sm text-gray-500">Carregando etapas...</div>
          )}
        </div>

        {/* Abas principais - dinâmicas */}
        <div className="flex border-b bg-white px-6 flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Conteúdo principal */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "geral" && (
            <div className="grid grid-cols-2 h-full">
              {/* ========== COLUNA ESQUERDA - SOBRE O NEGÓCIO ========== */}
              <div className="border-r overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                    Sobre o Negócio
                  </h2>
                  {!isEditing ? (
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="text-sm text-blue-600 hover:text-blue-700"
                    >
                      editar
                    </button>
                  ) : (
                    <button 
                      onClick={handleCancelEdit}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      cancelar
                    </button>
                  )}
                </div>

                {/* ===== MODO VISUALIZAÇÃO ===== */}
                {!isEditing ? (
                  <>
                    {/* Etapa */}
                    <div className="mb-6">
                      <label className="text-xs text-gray-500 uppercase">Etapa</label>
                      <p className="text-gray-900 font-medium">
                        {etapaAtual?.nome || processo.status?.nome || "Não definida"}
                      </p>
                    </div>

                    {/* País */}
                    <div className="mb-6">
                      <label className="text-xs text-gray-500 uppercase">País</label>
                      <p className="text-gray-900 font-medium">{paisConfig.label}</p>
                    </div>

                    {/* Contratantes - ✅ AGORA CLICÁVEIS */}
                    <div className="mb-6">
                      <label className="text-xs text-gray-500 uppercase mb-2 block">Contratantes</label>
                      {contratantesSelecionados.length > 0 ? (
                        <div className="space-y-3">
                          {contratantesSelecionados.map((cont) => (
                            <div 
                              key={cont.id} 
                              onClick={() => abrirDetalhesCliente(cont, "contratante")}
                              className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                            >
                              <p className="text-gray-900 font-semibold">{cont.nome}</p>
                              
                              {cont.telefone && (
                                <div className="flex items-center gap-2 text-sm text-gray-600 mt-2">
                                  <Phone className="h-4 w-4" />
                                  <span>{cont.telefone}</span>
                                </div>
                              )}
                              
                              {cont.email && (
                                <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                                  <Mail className="h-4 w-4" />
                                  <span>{cont.email}</span>
                                </div>
                              )}
                              
                              {cont.endereco && (
                                <div 
                                  className="flex items-start gap-2 text-sm text-gray-600 mt-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MapTooltip
                                    endereco={cont.endereco}
                                    numero={cont.numero}
                                    bairro={cont.bairro}
                                    cidade={cont.cidade}
                                    estado={cont.estado}
                                    cep={cont.cep}
                                  >
                                    <div className="flex items-start gap-2 cursor-pointer hover:text-blue-600">
                                      <MapPin className="h-4 w-4 mt-0.5" />
                                      <div className="underline decoration-dotted underline-offset-2">
                                        <p>{cont.endereco}{cont.numero && `, ${cont.numero}`}</p>
                                        {cont.bairro && <p>{cont.bairro}</p>}
                                        <p>{cont.cidade && cont.cidade}{cont.estado && ` - ${cont.estado}`}</p>
                                        {cont.cep && <p>CEP: {cont.cep}</p>}
                                      </div>
                                    </div>
                                  </MapTooltip>
                                </div>
                              )}

                              <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                                <Button variant="outline" size="sm" className="text-gray-600">
                                  <Phone className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" className="text-gray-600">
                                  <Mail className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="sm" className="text-gray-600">
                                  <MessageSquare className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 italic">Nenhum contratante vinculado</p>
                      )}
                    </div>

                    {/* Requerentes - ✅ AGORA CLICÁVEIS */}
                    <div className="mb-6">
                      <label className="text-xs text-gray-500 uppercase mb-2 block">Requerentes</label>
                      {requerentesSelecionados.length > 0 ? (
                        <div className="space-y-3">
                          {requerentesSelecionados.map((req) => (
                            <div 
                              key={req.id} 
                              onClick={() => abrirDetalhesCliente(req, "requerente")}
                              className="p-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                            >
                              <p className="text-gray-900 font-medium">{req.nome}</p>
                              {req.telefone && (
                                <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                                  <Phone className="h-3 w-3" />
                                  <span>{req.telefone}</span>
                                </div>
                              )}
                              {req.email && (
                                <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                                  <Mail className="h-3 w-3" />
                                  <span>{req.email}</span>
                                </div>
                              )}
                              {req.endereco && (
                                <div 
                                  className="flex items-start gap-2 text-sm text-gray-600 mt-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MapTooltip
                                    endereco={req.endereco}
                                    numero={req.numero}
                                    bairro={req.bairro}
                                    cidade={req.cidade}
                                    estado={req.estado}
                                    cep={req.cep}
                                  >
                                    <div className="flex items-start gap-2 cursor-pointer hover:text-blue-600">
                                      <MapPin className="h-3 w-3 mt-0.5" />
                                      <div className="underline decoration-dotted underline-offset-2">
                                        <p>{req.endereco}{req.numero && `, ${req.numero}`}</p>
                                        {req.bairro && <p>{req.bairro}</p>}
                                        <p>{req.cidade && req.cidade}{req.estado && ` - ${req.estado}`}</p>
                                        {req.cep && <p>CEP: {req.cep}</p>}
                                      </div>
                                    </div>
                                  </MapTooltip>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 italic">Nenhum requerente vinculado</p>
                      )}
                    </div>
                  </>
                ) : (
                  /* ===== MODO EDIÇÃO ===== */
                  <>
                    {/* Nome */}
                    <div className="mb-6">
                      <label className="text-xs text-gray-500 uppercase mb-1 block">Nome</label>
                      <Input
                        value={nomeEditado}
                        onChange={(e) => setNomeEditado(e.target.value)}
                        className="w-full"
                      />
                    </div>

                    {/* Etapa (select) */}
                    <div className="mb-6">
                      <label className="text-xs text-gray-500 uppercase mb-1 block">Etapa</label>
                      <select
                        value={statusIdAtual}
                        onChange={(e) => setStatusIdAtual(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {sortedEtapas.map((etapa) => (
                          <option key={etapa.id} value={etapa.id}>{etapa.nome}</option>
                        ))}
                      </select>
                    </div>

                    {/* Contratantes (busca múltipla) */}
                    <div className="mb-6" ref={contratanteRef}>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">Contratantes</label>
                      
                      {contratantesSelecionados.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {contratantesSelecionados.map((cont) => (
                            <div key={cont.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-gray-600" />
                                <span className="text-gray-900 text-sm">{cont.nome}</span>
                              </div>
                              <button 
                                onClick={() => removeContratante(cont.id)}
                                className="text-gray-400 hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="relative">
                        <button
                          onClick={() => setShowContratanteDropdown(!showContratanteDropdown)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar contratante
                        </button>
                        
                        {showContratanteDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                            <div className="p-2 border-b">
                              <Input
                                placeholder="Buscar contratante..."
                                value={buscaContratante}
                                onChange={(e) => setBuscaContratante(e.target.value)}
                                className="h-8 text-sm"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {contratantesFiltrados.length > 0 ? (
                                contratantesFiltrados.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => addContratante(c)}
                                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-blue-600" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-gray-900 text-sm">{c.nome}</p>
                                      <p className="text-xs text-gray-500">{c.email || c.telefone}</p>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <p className="px-4 py-3 text-sm text-gray-500 text-center">
                                  Nenhum contratante encontrado
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Requerentes (busca múltipla) */}
                    <div className="mb-6" ref={requerenteRef}>
                      <label className="text-xs text-gray-500 uppercase mb-1 block">Requerentes</label>
                      
                      {requerentesSelecionados.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {requerentesSelecionados.map((req) => (
                            <div key={req.id} className="flex items-center justify-between p-2 bg-blue-50 rounded-lg">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-blue-600" />
                                <span className="text-gray-900 text-sm">{req.nome}</span>
                              </div>
                              <button 
                                onClick={() => removeRequerente(req.id)}
                                className="text-gray-400 hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className="relative">
                        <button
                          onClick={() => setShowRequerenteDropdown(!showRequerenteDropdown)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar requerente
                        </button>
                        
                        {showRequerenteDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                            <div className="p-2 border-b">
                              <Input
                                placeholder="Buscar requerente..."
                                value={buscaRequerente}
                                onChange={(e) => setBuscaRequerente(e.target.value)}
                                className="h-8 text-sm"
                                autoFocus
                              />
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {requerentesFiltrados.length > 0 ? (
                                requerentesFiltrados.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => addRequerente(r)}
                                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                                  >
                                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-green-600" />
                                    </div>
                                    <div>
                                      <p className="font-medium text-gray-900 text-sm">{r.nome}</p>
                                      <p className="text-xs text-gray-500">{r.email || r.telefone}</p>
                                    </div>
                                  </button>
                                ))
                              ) : (
                                <p className="px-4 py-3 text-sm text-gray-500 text-center">
                                  Nenhum requerente encontrado
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Botões salvar/cancelar */}
                    <div className="flex gap-3 pt-4 border-t">
                      <Button onClick={handleSaveEdit} className="bg-blue-600 hover:bg-blue-700">
                        Salvar
                      </Button>
                      <Button variant="outline" onClick={handleCancelEdit}>
                        Cancelar
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* ========== COLUNA DIREITA - TAREFAS (COMPONENTE) ========== */}
              <ProcessoTarefas 
                processoId={processo.id} 
                onUpdate={onSave}
              />
            </div>
          )}

          {activeTab === "arvore" && (
            <ArvoreGenealogicaView 
              processoId={processo.id}
              arvoreId={arvoreIdLocal}
              onArvoreCreated={(novoArvoreId) => {
                setArvoreIdLocal(novoArvoreId)
                onSave?.()
              }}
              pessoaIdParaFocar={pessoaIdParaFocar}
              sidebarTabParaFocar={sidebarTabParaFocar}
            />
          )}

          {/* ✅ Aba Informações (apenas para Itália) */}
          {activeTab === "informacoes" && isItalia && (
            <ProcessoInformacoes
              processoId={processo.id}
              onUpdate={onSave}
            />
          )}

          {/* ✅ Aba Protocolos (apenas para Espanha) */}
          {activeTab === "protocolos" && isEspanha && (
            <ProcessoProtocolos
              processoId={processo.id}
              contratantes={contratantesSelecionados}
              requerentes={requerentesSelecionados}
              onUpdate={onSave}
            />
          )}

          {activeTab === "faturas" && (
            <ProcessoFaturas
            processoId={processo.id}
            onUpdate={onSave}
            />
          )}

          {activeTab === "historico" && (
            <ProcessoHistorico
            processoId={processo.id}
            onUpdate={onSave}
            />
          )}
        </div>
      </div>

      {/* ✅ NOVO: Modal de detalhes do cliente */}
      <ContratanteModal
        isOpen={clienteModalOpen}
        onClose={() => {
          setClienteModalOpen(false)
          setClienteFormData(initialFormData)
          setClienteEditingId(null)
        }}
        isViewMode={clienteIsViewMode}
        setIsViewMode={setClienteIsViewMode}
        editingId={clienteEditingId}
        editingTipo={clienteTipo}
        formData={clienteFormData}
        setFormData={setClienteFormData}
        onSave={handleSaveCliente}
        isLoading={false}
      />
    </>
  )

  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body)
  }
  
  return null
}