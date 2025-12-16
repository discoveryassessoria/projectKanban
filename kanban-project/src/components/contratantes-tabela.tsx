"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  Plus, 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  Phone, 
  Mail, 
  User,
  MapPin,
  FileText,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  Globe,
  Heart
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  dataNascimento?: string | null
  sexo?: string | null
  estadoCivil?: string | null
  nacionalidade?: string | null
  telefone?: string | null
  email?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  observacoes?: string | null
  createdAt: string
  _count?: {
    atividades: number
  }
}

interface ContratantesTabelaProps {
  contratantes: Contratante[]
  onRefresh: () => void
}

const initialFormData = {
  nome: "",
  cpf: "",
  rg: "",
  dataNascimento: "",
  sexo: "",
  estadoCivil: "",
  nacionalidade: "",
  telefone: "",
  email: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  cep: "",
  observacoes: "",
}

const SEXO_OPTIONS = ["Masculino", "Feminino", "Outro"]
const ESTADO_CIVIL_OPTIONS = ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União Estável", "Separado(a)"]
const NACIONALIDADE_OPTIONS = ["Brasileiro(a)", "Português(a)", "Italiano(a)", "Espanhol(a)", "Alemão(ã)", "Outro"]

// Componente do Modal separado para usar Portal
function ContratanteModal({
  isOpen,
  onClose,
  isViewMode,
  setIsViewMode,
  editingId,
  formData,
  setFormData,
  onSave,
  isLoading,
}: {
  isOpen: boolean
  onClose: () => void
  isViewMode: boolean
  setIsViewMode: (v: boolean) => void
  editingId: number | null
  formData: typeof initialFormData
  setFormData: (data: typeof initialFormData) => void
  onSave: () => void
  isLoading: boolean
}) {
  const [activeTab, setActiveTab] = useState<"dados" | "endereco" | "observacoes">("dados")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Formatar CPF
  const formatCPF = (value: string) => {
    return value
      .replace(/\D/g, "")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})/, "$1-$2")
      .replace(/(-\d{2})\d+?$/, "$1")
  }

  // Formatar telefone
  const formatTelefone = (value: string) => {
    return value
      .replace(/\D/g, "")
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d)/, "$1-$2")
      .replace(/(-\d{4})\d+?$/, "$1")
  }

  // Formatar CEP
  const formatCEP = (value: string) => {
    return value
      .replace(/\D/g, "")
      .replace(/(\d{5})(\d)/, "$1-$2")
      .replace(/(-\d{3})\d+?$/, "$1")
  }

  if (!isOpen || !mounted) return null

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {/* Overlay */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          position: 'absolute',
          top: '2rem',
          left: '2rem',
          right: '2rem',
          bottom: '2rem',
          maxWidth: 'calc(100vw - 4rem)',
          maxHeight: 'calc(100vh - 4rem)',
        }}
      >
        {/* Header do Modal */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xl font-semibold">
              {formData.nome ? formData.nome.charAt(0).toUpperCase() : <User className="h-6 w-6" />}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {isViewMode ? formData.nome || "Visualizar Contratante" : editingId ? "Editar Contratante" : "Novo Contratante"}
              </h2>
              <p className="text-sm text-gray-500">
                {isViewMode ? "Detalhes do contratante" : "Preencha os dados do contratante"}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {isViewMode ? (
              <Button
                onClick={() => setIsViewMode(false)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Edit className="h-4 w-4 mr-2" />
                Editar
              </Button>
            ) : (
              <Button
                onClick={onSave}
                disabled={isLoading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isLoading ? "Salvando..." : editingId ? "Salvar Alterações" : "Criar Contratante"}
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-8 bg-white shrink-0">
          {[
            { id: "dados", label: "Dados Pessoais", icon: User },
            { id: "endereco", label: "Endereço", icon: MapPin },
            { id: "observacoes", label: "Observações e Anexos", icon: FileText },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id 
                  ? 'border-indigo-600 text-indigo-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
                }
              `}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Conteúdo do Modal */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
          <div className="max-w-4xl mx-auto">
            
            {/* Tab Dados Pessoais */}
            {activeTab === "dados" && (
              <div className="space-y-6">
                {/* Seção: Identificação */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <User className="h-4 w-4 text-indigo-600" />
                    Identificação
                  </h3>
                  
                  <div className="space-y-4">
                    {/* Nome */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nome Completo <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                        placeholder="Nome completo"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>

                    {/* CPF e RG */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                        <Input
                          value={formData.cpf}
                          onChange={(e) => setFormData({ ...formData, cpf: formatCPF(e.target.value) })}
                          placeholder="000.000.000-00"
                          maxLength={14}
                          disabled={isViewMode}
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">RG</label>
                        <Input
                          value={formData.rg}
                          onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                          placeholder="Número do RG"
                          disabled={isViewMode}
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seção: Dados Pessoais */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-indigo-600" />
                    Dados Pessoais
                  </h3>
                  
                  <div className="space-y-4">
                    {/* Data Nascimento e Sexo */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Data de Nascimento
                        </label>
                        <Input
                          type="date"
                          value={formData.dataNascimento}
                          onChange={(e) => setFormData({ ...formData, dataNascimento: e.target.value })}
                          disabled={isViewMode}
                          className="bg-white border-gray-300 text-gray-900 disabled:bg-gray-100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                        <select
                          value={formData.sexo}
                          onChange={(e) => setFormData({ ...formData, sexo: e.target.value })}
                          disabled={isViewMode}
                          className="w-full h-10 px-3 rounded-md bg-white border border-gray-300 text-gray-900 disabled:bg-gray-100"
                        >
                          <option value="">Selecione</option>
                          {SEXO_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Estado Civil e Nacionalidade */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <Heart className="h-4 w-4 inline mr-1 text-gray-400" />
                          Estado Civil
                        </label>
                        <select
                          value={formData.estadoCivil}
                          onChange={(e) => setFormData({ ...formData, estadoCivil: e.target.value })}
                          disabled={isViewMode}
                          className="w-full h-10 px-3 rounded-md bg-white border border-gray-300 text-gray-900 disabled:bg-gray-100"
                        >
                          <option value="">Selecione</option>
                          {ESTADO_CIVIL_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <Globe className="h-4 w-4 inline mr-1 text-gray-400" />
                          Nacionalidade
                        </label>
                        <select
                          value={formData.nacionalidade}
                          onChange={(e) => setFormData({ ...formData, nacionalidade: e.target.value })}
                          disabled={isViewMode}
                          className="w-full h-10 px-3 rounded-md bg-white border border-gray-300 text-gray-900 disabled:bg-gray-100"
                        >
                          <option value="">Selecione</option>
                          {NACIONALIDADE_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seção: Contato */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Phone className="h-4 w-4 text-indigo-600" />
                    Contato
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                      <Input
                        value={formData.telefone}
                        onChange={(e) => setFormData({ ...formData, telefone: formatTelefone(e.target.value) })}
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="email@exemplo.com"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab Endereço */}
            {activeTab === "endereco" && (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-600" />
                  Endereço
                </h3>
                
                <div className="space-y-4">
                  {/* CEP */}
                  <div className="w-1/3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
                    <Input
                      value={formData.cep}
                      onChange={(e) => setFormData({ ...formData, cep: formatCEP(e.target.value) })}
                      placeholder="00000-000"
                      maxLength={9}
                      disabled={isViewMode}
                      className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                    />
                  </div>

                  {/* Endereço e Número */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
                      <Input
                        value={formData.endereco}
                        onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                        placeholder="Rua, Avenida..."
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
                      <Input
                        value={formData.numero}
                        onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                        placeholder="Nº"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                  </div>

                  {/* Complemento e Bairro */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
                      <Input
                        value={formData.complemento}
                        onChange={(e) => setFormData({ ...formData, complemento: e.target.value })}
                        placeholder="Apto, Bloco..."
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
                      <Input
                        value={formData.bairro}
                        onChange={(e) => setFormData({ ...formData, bairro: e.target.value })}
                        placeholder="Nome do bairro"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                  </div>

                  {/* Cidade e Estado */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                      <Input
                        value={formData.cidade}
                        onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                        placeholder="Nome da cidade"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                      <select
                        value={formData.estado}
                        onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                        disabled={isViewMode}
                        className="w-full h-10 px-3 rounded-md bg-white border border-gray-300 text-gray-900 disabled:bg-gray-100"
                      >
                        <option value="">UF</option>
                        {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                          <option key={uf} value={uf}>{uf}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab Observações */}
            {activeTab === "observacoes" && (
              <div className="space-y-6">
                {/* Observações */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    Observações
                  </h3>
                  <textarea
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Anotações, informações importantes..."
                    rows={6}
                    disabled={isViewMode}
                    className="w-full px-3 py-2 rounded-md bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100 resize-none"
                  />
                </div>

                {/* Anexos */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    Anexos
                  </h3>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    <FileText className="h-10 w-10 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm text-gray-500">Área de anexos</p>
                    <p className="text-xs text-gray-400 mt-1">Em breve: upload de documentos</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // Usar createPortal para renderizar no body
  return createPortal(modalContent, document.body)
}

export function ContratantesTabela({ contratantes, onRefresh }: ContratantesTabelaProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isViewMode, setIsViewMode] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState(initialFormData)
  const [isLoading, setIsLoading] = useState(false)

  const itemsPerPage = 10

  // Filtrar contratantes
  const filteredContratantes = contratantes.filter(c => {
    const searchLower = searchTerm.toLowerCase()
    return (
      c.nome.toLowerCase().includes(searchLower) ||
      c.email?.toLowerCase().includes(searchLower) ||
      c.cpf?.includes(searchTerm) ||
      c.telefone?.includes(searchTerm)
    )
  })

  // Paginação
  const totalPages = Math.ceil(filteredContratantes.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedContratantes = filteredContratantes.slice(startIndex, startIndex + itemsPerPage)

  // Abrir modal para novo
  const handleNew = () => {
    setFormData(initialFormData)
    setEditingId(null)
    setIsViewMode(false)
    setIsModalOpen(true)
  }

  // Abrir modal para editar
  const handleEdit = (contratante: Contratante) => {
    setFormData({
      nome: contratante.nome || "",
      cpf: contratante.cpf || "",
      rg: contratante.rg || "",
      dataNascimento: contratante.dataNascimento 
        ? new Date(contratante.dataNascimento).toISOString().split("T")[0] 
        : "",
      sexo: contratante.sexo || "",
      estadoCivil: contratante.estadoCivil || "",
      nacionalidade: contratante.nacionalidade || "",
      telefone: contratante.telefone || "",
      email: contratante.email || "",
      endereco: contratante.endereco || "",
      numero: contratante.numero || "",
      complemento: contratante.complemento || "",
      bairro: contratante.bairro || "",
      cidade: contratante.cidade || "",
      estado: contratante.estado || "",
      cep: contratante.cep || "",
      observacoes: contratante.observacoes || "",
    })
    setEditingId(contratante.id)
    setIsViewMode(false)
    setIsModalOpen(true)
  }

  // Abrir modal para visualizar
  const handleView = (contratante: Contratante) => {
    setFormData({
      nome: contratante.nome || "",
      cpf: contratante.cpf || "",
      rg: contratante.rg || "",
      dataNascimento: contratante.dataNascimento 
        ? new Date(contratante.dataNascimento).toISOString().split("T")[0] 
        : "",
      sexo: contratante.sexo || "",
      estadoCivil: contratante.estadoCivil || "",
      nacionalidade: contratante.nacionalidade || "",
      telefone: contratante.telefone || "",
      email: contratante.email || "",
      endereco: contratante.endereco || "",
      numero: contratante.numero || "",
      complemento: contratante.complemento || "",
      bairro: contratante.bairro || "",
      cidade: contratante.cidade || "",
      estado: contratante.estado || "",
      cep: contratante.cep || "",
      observacoes: contratante.observacoes || "",
    })
    setEditingId(contratante.id)
    setIsViewMode(true)
    setIsModalOpen(true)
  }

  // Salvar
  const handleSave = async () => {
    if (!formData.nome.trim()) {
      alert("Nome é obrigatório")
      return
    }

    setIsLoading(true)

    try {
      const url = editingId 
        ? `/api/contratantes/${editingId}` 
        : "/api/contratantes"
      
      const method = editingId ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Erro ao salvar")
      }

      setIsModalOpen(false)
      setFormData(initialFormData)
      setEditingId(null)
      onRefresh()
    } catch (error: any) {
      alert(error.message || "Erro ao salvar contratante")
    } finally {
      setIsLoading(false)
    }
  }

  // Excluir
  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este contratante?")) return

    try {
      const response = await fetch(`/api/contratantes/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Erro ao excluir")
      }

      onRefresh()
    } catch (error: any) {
      alert(error.message || "Erro ao excluir contratante")
    }
  }

  // Formatar data
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR")
  }

  return (
    <>
      {/* Header da tabela */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <Input
            placeholder="Buscar contratante..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1)
            }}
            className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/40"
          />
        </div>
        
        <Button
          onClick={handleNew}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Contratante
        </Button>
      </div>

      {/* Tabela */}
      <div className="rounded-lg border border-white/20 overflow-hidden">
        <table className="w-full">
          <thead className="bg-white/10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">Nome</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">CPF</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">Telefone</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">Email</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">Processos</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">Criado em</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-white/60 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {paginatedContratantes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-white/50">
                  {searchTerm ? "Nenhum contratante encontrado" : "Nenhum contratante cadastrado"}
                </td>
              </tr>
            ) : (
              paginatedContratantes.map((contratante) => (
                <tr 
                  key={contratante.id} 
                  className="hover:bg-white/5 transition-colors cursor-pointer"
                  onClick={() => handleView(contratante)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-medium">
                        {contratante.nome.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white font-medium">{contratante.nome}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-white/70 text-sm">
                    {contratante.cpf || "-"}
                  </td>
                  <td className="px-4 py-3">
                    {contratante.telefone ? (
                      <div className="flex items-center gap-1 text-white/70 text-sm">
                        <Phone className="h-3 w-3" />
                        {contratante.telefone}
                      </div>
                    ) : (
                      <span className="text-white/40 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {contratante.email ? (
                      <div className="flex items-center gap-1 text-white/70 text-sm">
                        <Mail className="h-3 w-3" />
                        {contratante.email}
                      </div>
                    ) : (
                      <span className="text-white/40 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-white/10 rounded text-xs text-white/70">
                      {contratante._count?.atividades || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/50 text-sm">
                    {formatDate(contratante.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/10">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-gray-900 border-white/20">
                        <DropdownMenuItem 
                          onClick={() => handleView(contratante)}
                          className="text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Visualizar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleEdit(contratante)}
                          className="text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDelete(contratante.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-white/50">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, filteredContratantes.length)} de {filteredContratantes.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="border-white/20 text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-white/70">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="border-white/20 text-white/70 hover:bg-white/10 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modal usando Portal */}
      <ContratanteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        isViewMode={isViewMode}
        setIsViewMode={setIsViewMode}
        editingId={editingId}
        formData={formData}
        setFormData={setFormData}
        onSave={handleSave}
        isLoading={isLoading}
      />
    </>
  )
}