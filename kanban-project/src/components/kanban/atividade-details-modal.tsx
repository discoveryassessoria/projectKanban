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
  Filter
} from "lucide-react"

// Tipos temporários (depois vão vir do banco)
interface Contratante {
  id: number
  nome: string
  telefone?: string
  email?: string
  endereco?: string
  cidade?: string
  estado?: string
  cep?: string
}

interface Requerente {
  id: number
  nome: string
  telefone?: string
  email?: string
}

interface Tarefa {
  id: number
  titulo: string
  prazo?: string
  responsavel?: string
  concluida: boolean
  criadoEm: string
}

interface Processo {
  id: number
  nome: string
  etapaAtual: string
  contratante?: Contratante
  requerentes?: Requerente[]
  tarefas?: Tarefa[]
  criadoEm: string
}

const ETAPAS = [
  { id: 1, nome: "Busca documental", cor: "bg-blue-500" },
  { id: 2, nome: "Emissão documentos", cor: "bg-blue-400" },
  { id: 3, nome: "Análise documental", cor: "bg-cyan-500" },
  { id: 4, nome: "Retificação", cor: "bg-teal-500" },
  { id: 5, nome: "Tradução juramentada", cor: "bg-green-500" },
  { id: 6, nome: "Apostilamento", cor: "bg-emerald-500" },
  { id: 7, nome: "Aguardando protocolo", cor: "bg-yellow-500" },
  { id: 8, nome: "Protocolado", cor: "bg-orange-500" },
  { id: 9, nome: "Fechar negócio", cor: "bg-red-500" },
]

interface ProcessoDetailsModalProps {
  processo: Processo | null
  isOpen: boolean
  onClose: () => void
  onSave?: () => void
}

export function ProcessoDetailsModal({ 
  processo, 
  isOpen, 
  onClose, 
  onSave 
}: ProcessoDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<"geral" | "faturas" | "historico">("geral")
  const [activeRightTab, setActiveRightTab] = useState<"atividade" | "tarefa" | "comentario">("atividade")
  const [novaTarefa, setNovaTarefa] = useState("")

  // Fechar com ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'auto'
    }
  }, [isOpen, onClose])

  if (!isOpen || !processo) return null

  const etapaAtualIndex = ETAPAS.findIndex(e => e.nome === processo.etapaAtual)

  const handleAddTarefa = () => {
    if (novaTarefa.trim()) {
      console.log("Nova tarefa:", novaTarefa)
      setNovaTarefa("")
    }
  }

  const modalContent = (
    <>
      {/* Overlay escuro - cobre tudo */}
      <div 
        className="fixed inset-0 bg-black/50 z-[9998]"
        onClick={onClose}
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
              onClick={onClose}
              className="w-10 h-10 bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center justify-center transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
            
            <div>
              <h1 className="text-xl font-semibold text-gray-900">{processo.nome}</h1>
              <span className="text-sm text-gray-500">Itália</span>
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

        {/* Barra de Etapas */}
        <div className="flex border-b bg-gray-50 overflow-x-auto flex-shrink-0">
          {ETAPAS.map((etapa, index) => {
            const isActive = index === etapaAtualIndex
            const isPast = index < etapaAtualIndex
            
            return (
              <button
                key={etapa.id}
                className={`
                  flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors relative
                  ${isActive 
                    ? `${etapa.cor} text-white` 
                    : isPast 
                      ? 'bg-gray-200 text-gray-600' 
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }
                `}
              >
                {etapa.nome}
              </button>
            )
          })}
        </div>

        {/* Abas principais */}
        <div className="flex border-b bg-white px-6 flex-shrink-0">
          {[
            { id: "geral", label: "Geral" },
            { id: "faturas", label: "Faturas" },
            { id: "historico", label: "Histórico" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
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

        {/* Conteúdo principal - Grid de 2 colunas */}
        <div className="flex-1 overflow-hidden">
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
                <p className="text-gray-900 font-medium">{processo.etapaAtual || "Não definida"}</p>
              </div>

              {/* Requerente */}
              <div className="mb-6">
                <label className="text-xs text-gray-500 uppercase">Requerente</label>
                {processo.requerentes && processo.requerentes.length > 0 ? (
                  processo.requerentes.map((req) => (
                    <p key={req.id} className="text-gray-900">{req.nome}</p>
                  ))
                ) : (
                  <p className="text-gray-400 italic">Nenhum requerente</p>
                )}
              </div>

              {/* Contato (Contratante) */}
              {processo.contratante && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                  <label className="text-xs text-gray-500 uppercase">Contato</label>
                  
                  <div className="mt-2 space-y-2">
                    <p className="text-gray-900 font-semibold text-lg">
                      {processo.contratante.nome}
                    </p>
                    
                    {processo.contratante.telefone && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-4 w-4" />
                        <span>{processo.contratante.telefone}</span>
                      </div>
                    )}
                    
                    {processo.contratante.email && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="h-4 w-4" />
                        <span>{processo.contratante.email}</span>
                      </div>
                    )}
                    
                    {processo.contratante.endereco && (
                      <div className="mt-3 text-sm text-gray-600">
                        <p className="font-medium">Endereço de entrega:</p>
                        <p>{processo.contratante.endereco}</p>
                        {processo.contratante.cidade && <p>{processo.contratante.cidade}</p>}
                        {processo.contratante.estado && <p>{processo.contratante.estado}</p>}
                        {processo.contratante.cep && <p>{processo.contratante.cep}</p>}
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
                    <p className="font-medium text-gray-900">Adicionar uma nova atividade</p>
                    <p className="text-sm text-gray-500">
                      Planeje sua próxima ação no negócio para nunca esquecer o cliente
                    </p>
                  </div>
                </div>
              </div>

              {/* Filtro de data */}
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b flex-shrink-0">
                <button className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  15 de dezembro
                </button>
                <button className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                  <Filter className="h-4 w-4" />
                  FILTRO
                </button>
              </div>

              {/* Lista de tarefas/atividades */}
              <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                {processo.tarefas && processo.tarefas.length > 0 ? (
                  processo.tarefas.map((tarefa) => (
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
                        {tarefa.prazo && (
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                            <Calendar className="h-3 w-3" />
                            Prazo: {tarefa.prazo}
                          </p>
                        )}
                      </div>

                      {!tarefa.concluida && (
                        <span className="px-2 py-1 bg-green-500 text-white text-xs rounded-full flex-shrink-0">
                          Coisas a fazer
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <MessageSquare className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                    <p>Nenhuma atividade ainda</p>
                    <p className="text-sm">Adicione tarefas para acompanhar o progresso</p>
                  </div>
                )}

                {/* Item de histórico - Negócio criado */}
                <div className="flex items-start gap-3 p-3 text-sm text-gray-500">
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs">i</span>
                  </div>
                  <div>
                    <p>Negócio criado <span className="text-gray-400">{processo.criadoEm || ""}</span></p>
                    <p className="font-medium text-gray-700">{processo.nome}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
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