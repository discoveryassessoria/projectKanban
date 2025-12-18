"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  GitBranch
} from "lucide-react"
import { 
  Pais, 
  PAISES_CONFIG, 
  type Status,
  type ProcessoWithStatus,
  type Processo
} from "@/src/types/kanban"

interface ProcessoDetailsModalProps {
  processo: ProcessoWithStatus | Processo | null
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
  statusList?: Status[]
}

export function ProcessoDetailsModal({ 
  processo, 
  isOpen, 
  onClose, 
  onSave,
  statusList = []
}: ProcessoDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<"geral" | "faturas" | "historico" | "arvore">("geral")
  const [activeRightTab, setActiveRightTab] = useState<"atividade" | "tarefa" | "comentario">("atividade")
  const [novaTarefa, setNovaTarefa] = useState("")
  const [etapas, setEtapas] = useState<Status[]>([])
  const [statusIdAtual, setStatusIdAtual] = useState(processo?.statusId)
  const [mudouEtapa, setMudouEtapa] = useState(false)

// Atualizar quando o processo mudar
useEffect(() => {
  setStatusIdAtual(processo?.statusId)
}, [processo?.statusId])

const handleClose = () => {
  if (mudouEtapa) {
    onSave?.()
  }
  onClose()
}

  // Buscar etapas do país quando o modal abre
  useEffect(() => {
    if (isOpen && processo?.pais) {
      // Se recebeu statusList como prop, usa ela
      if (statusList.length > 0) {
        setEtapas(statusList)
      } else {
        // Senão busca da API
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

  // Fechar com ESC
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

  if (!isOpen || !processo) return null

  // Configuração do país
  const paisConfig = PAISES_CONFIG[processo.pais] || { label: processo.pais, bandeira: "🏳️" }
  
  // Ordenar etapas
  const sortedEtapas = [...etapas].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  
  // Encontrar índice da etapa atual
  const etapaAtualIndex = sortedEtapas.findIndex(e => e.id === statusIdAtual)
  const etapaAtual = sortedEtapas.find(e => e.id === processo.statusId)

  // Cores para as etapas baseadas no índice
  const getEtapaCor = (index: number, total: number) => {
    const cores = [
      "bg-blue-500",
      "bg-blue-400", 
      "bg-cyan-500",
      "bg-teal-500",
      "bg-green-500",
      "bg-emerald-500",
      "bg-yellow-500",
      "bg-orange-500",
      "bg-red-500",
      "bg-purple-500",
      "bg-pink-500",
    ]
    return cores[index % cores.length]
  }

  const handleAddTarefa = () => {
    if (novaTarefa.trim()) {
      console.log("Nova tarefa:", novaTarefa)
      setNovaTarefa("")
    }
  }

  // Formatar data de criação
  const dataCriacao = processo.createdAt
  const dataFormatada = dataCriacao 
    ? new Date(dataCriacao).toLocaleDateString('pt-BR')
    : ""

  // Dados do processo
  const contratante = processo.contratante
  const requerentes = processo.requerentes || []
  const tarefas = processo.tarefas || []

  const modalContent = (
    <>
      {/* Overlay escuro - cobre tudo */}
      <div 
        className="fixed inset-0 bg-black/50 z-[9998]"
        onClick={handleClose}
      />

      {/* Modal - com margens específicas */}
      <div 
        className="fixed z-[9999] bg-white shadow-2xl flex flex-col overflow-hidden rounded-tl-xl rounded-tr-xl"
        style={{
          left: '155px',
          top: '45px',
          right: '35px',
          bottom: '0px',
        }}
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
              <span className="text-sm text-gray-500">
                {paisConfig.label}
              </span>
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
            <Button className="bg-red-500 hover:bg-red-600 text-white">
              Orçamento
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>

{/* Barra de Etapas - Dinâmica */}
        <div className="flex border-b bg-gray-50 overflow-x-auto flex-shrink-0">
          {sortedEtapas.length > 0 ? (
            sortedEtapas.map((etapa, index) => {
              const isActive = etapa.id === statusIdAtual
              const isPast = index < etapaAtualIndex
              const cor = getEtapaCor(index, sortedEtapas.length)
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
      setMudouEtapa(true)  // <-- Marca que mudou
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
                    ${isActive 
                      ? `${cor} text-white` 
                      : isPast 
                        ? 'bg-gray-200 text-gray-600 hover:bg-gray-300' 
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }
                  `}
                >
                  {etapa.nome}
                </button>
              )
            })
          ) : (
            <div className="px-4 py-3 text-sm text-gray-500">
              Carregando etapas...
            </div>
          )}
        </div>

        {/* Abas principais */}
        <div className="flex border-b bg-white px-6 flex-shrink-0">
          {[
            { id: "geral", label: "Geral", icon: null },
            { id: "arvore", label: "Árvore Genealógica", icon: null },
            { id: "faturas", label: "Faturas", icon: null },
            { id: "historico", label: "Histórico", icon: null },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2
                ${activeTab === tab.id 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Conteúdo principal */}
        <div className="flex-1 overflow-hidden">
          {/* Tab Geral */}
          {activeTab === "geral" && (
            <div className="grid grid-cols-2 h-full">
              {/* Coluna Esquerda - Sobre o Negócio */}
              <div className="border-r overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                    Sobre o Negócio
                  </h2>
                  <button className="text-sm text-blue-600 hover:text-blue-700">
                    editar
                  </button>
                </div>

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
                  <p className="text-gray-900 font-medium">
                    {paisConfig.label}
                  </p>
                </div>

                {/* Requerentes */}
                <div className="mb-6">
                  <label className="text-xs text-gray-500 uppercase">Requerentes</label>
                  {requerentes.length > 0 ? (
                    requerentes.map((req) => (
                      <p key={req.id} className="text-gray-900">{req.nome}</p>
                    ))
                  ) : (
                    <p className="text-gray-400 italic">Nenhum requerente</p>
                  )}
                </div>

                {/* Contato (Contratante) */}
                {contratante && (
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <label className="text-xs text-gray-500 uppercase">Contato</label>
                    
                    <div className="mt-2 space-y-2">
                      <p className="text-gray-900 font-semibold text-lg">
                        {contratante.nome}
                      </p>
                      
                      {contratante.telefone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Phone className="h-4 w-4" />
                          <span>{contratante.telefone}</span>
                        </div>
                      )}
                      
                      {contratante.email && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Mail className="h-4 w-4" />
                          <span>{contratante.email}</span>
                        </div>
                      )}
                      
                      {contratante.endereco && (
                        <div className="mt-3 text-sm text-gray-600">
                          <p className="font-medium">Endereço de entrega:</p>
                          <p>{contratante.endereco}</p>
                          {contratante.cidade && <p>{contratante.cidade}</p>}
                          {contratante.estado && <p>{contratante.estado}</p>}
                          {contratante.cep && <p>{contratante.cep}</p>}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-4">
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
                )}

                {/* Botões de ação */}
                <div className="flex gap-2 text-sm">
                  <button className="text-blue-600 hover:text-blue-700">
                    Selecionar campo
                  </button>
                  <span className="text-gray-300">|</span>
                  <button className="text-blue-600 hover:text-blue-700">
                    Criar campo
                  </button>
                </div>
              </div>

              {/* Coluna Direita - Timeline de Atividades */}
              <div className="overflow-y-auto flex flex-col">
                {/* Abas da timeline */}
                <div className="flex border-b bg-white px-4 sticky top-0 flex-shrink-0">
                  {[
                    { id: "atividade", label: "Atividade" },
                    { id: "tarefa", label: "Tarefa" },
                    { id: "comentario", label: "Comentário" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveRightTab(tab.id as any)}
                      className={`
                        px-4 py-3 text-sm font-medium border-b-2 transition-colors
                        ${activeRightTab === tab.id 
                          ? 'border-blue-500 text-blue-600' 
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                        }
                      `}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Input de nova atividade/tarefa */}
                <div className="p-4 border-b flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Coisas a fazer"
                      value={novaTarefa}
                      onChange={(e) => setNovaTarefa(e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="ghost" size="sm" className="text-gray-500">
                      ações
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>

                {/* Área de adicionar atividade */}
                <div className="p-4 border-b bg-blue-50 flex-shrink-0">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <Plus className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Adicionar uma nova tarefa</p>
                      <p className="text-sm text-gray-500">
                        Planeje sua próxima ação no processo para nunca esquecer o cliente
                      </p>
                    </div>
                  </div>
                </div>

                {/* Filtro de data */}
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b flex-shrink-0">
                  <button className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}
                  </button>
                  <button className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                    <Filter className="h-4 w-4" />
                    FILTRO
                  </button>
                </div>

                {/* Lista de tarefas */}
                <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                  {tarefas.length > 0 ? (
                    tarefas.map((tarefa) => (
                      <div 
                        key={tarefa.id}
                        className="flex items-start gap-3 p-3 bg-white rounded-lg border hover:shadow-sm transition-shadow"
                      >
                        <div className={`
                          w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                          ${tarefa.concluida ? 'bg-green-100' : 'bg-blue-100'}
                        `}>
                          {tarefa.concluida ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <Clock className="h-4 w-4 text-blue-600" />
                          )}
                        </div>
                        
                        <div className="flex-1">
                          <p className={`font-medium ${tarefa.concluida ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {tarefa.titulo}
                          </p>
                          {tarefa.dataPrazo && (
                            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                              <Calendar className="h-3 w-3" />
                              Prazo: {new Date(tarefa.dataPrazo).toLocaleDateString('pt-BR')}
                            </p>
                          )}
                          {tarefa.responsavel && (
                            <p className="text-sm text-gray-500 mt-1">
                              Responsável: {tarefa.responsavel.nome}
                            </p>
                          )}
                        </div>

                        {!tarefa.concluida && (
                          <span className="px-2 py-1 bg-green-500 text-white text-xs rounded-full flex-shrink-0">
                            Pendente
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <MessageSquare className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                      <p>Nenhuma tarefa ainda</p>
                      <p className="text-sm">Adicione tarefas para acompanhar o progresso</p>
                    </div>
                  )}

                  {/* Item de histórico - Processo criado */}
                  <div className="flex items-start gap-3 p-3 text-sm text-gray-500">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs">i</span>
                    </div>
                    <div>
                      <p>Processo criado {dataFormatada && <span className="text-gray-400">{dataFormatada}</span>}</p>
                      <p className="font-medium text-gray-700">{processo.nome}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Árvore Genealógica */}
          {activeTab === "arvore" && (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <GitBranch className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium text-gray-700">Árvore Genealógica</h3>
                <p className="text-sm mt-2">Visualize e gerencie a árvore genealógica deste processo</p>
                <Button className="mt-4" variant="outline">
                  Vincular Árvore
                </Button>
              </div>
            </div>
          )}

          {/* Tab Faturas */}
          {activeTab === "faturas" && (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-700">Faturas</h3>
                <p className="text-sm mt-2">Gerencie as faturas deste processo</p>
              </div>
            </div>
          )}

          {/* Tab Histórico */}
          {activeTab === "historico" && (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-700">Histórico</h3>
                <p className="text-sm mt-2">Veja o histórico de alterações</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )

  // Renderiza no body usando Portal para escapar de qualquer container
  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body)
  }
  
  return null
}