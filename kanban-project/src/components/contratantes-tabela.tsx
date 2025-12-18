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
  Heart,
  Loader2
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUploadThing } from "@/src/lib/uploadthing"
import { PDFThumbnail } from "./pdf-thumbnail"

interface Contratante {
  id: number
  tipo?: string | null
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
    processos: number
  }
}

interface Anexo {
  id: number
  nome: string
  nomeArquivo: string
  urlArquivo: string
  tamanho?: number | null
  mimeType?: string | null
}

interface ContratantesTabelaProps {
  contratantes: Contratante[]
  onRefresh: () => void
}

const initialFormData = {
  tipo: "contratante",
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

const TIPO_OPTIONS = [
  { value: "contratante", label: "Contratante" },
  { value: "requerente", label: "Requerente" },
]
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
  editingTipo,
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
  editingTipo: string
  formData: typeof initialFormData
  setFormData: (data: typeof initialFormData) => void
  onSave: () => void
  isLoading: boolean
}) {
  const [activeTab, setActiveTab] = useState<"dados" | "endereco" | "observacoes">("dados")
  const [mounted, setMounted] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)
  
  // Estados para upload de arquivos
  const [arquivos, setArquivos] = useState<File[]>([])
  const [anexosExistentes, setAnexosExistentes] = useState<Anexo[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [carregandoAnexos, setCarregandoAnexos] = useState(false)

  // Carregar anexos existentes quando abrir para editar/visualizar
  useEffect(() => {
    if (isOpen && editingId) {
      carregarAnexos()
    }
  }, [isOpen, editingId])

  const carregarAnexos = async () => {
    if (!editingId) return
    
    setCarregandoAnexos(true)
    try {
      const response = await fetch(`/api/anexos?tipoCliente=${editingTipo}&id=${editingId}`)
      if (response.ok) {
        const data = await response.json()
        setAnexosExistentes(data.anexos || [])
      }
    } catch (error) {
      console.error("Erro ao carregar anexos:", error)
    } finally {
      setCarregandoAnexos(false)
    }
  }

  const { startUpload, isUploading } = useUploadThing("anexoUploader", {
    onUploadProgress: (progress) => {
      setUploadProgress(progress)
    },
    onClientUploadComplete: async (res) => {
      if (res && editingId) {
        // Salvar cada arquivo no banco de dados
        for (const file of res) {
          try {
            const response = await fetch("/api/anexos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nome: file.name,
                nomeArquivo: file.name,
                urlArquivo: file.url,
                tamanho: file.size,
                mimeType: file.type,
                tipoCliente: editingTipo,
                contratanteId: editingTipo === "contratante" ? editingId : undefined,
                requerenteId: editingTipo === "requerente" ? editingId : undefined,
              }),
            })
            
            if (response.ok) {
              const data = await response.json()
              setAnexosExistentes(prev => [...prev, data.anexo])
            }
          } catch (error) {
            console.error("Erro ao salvar anexo:", error)
          }
        }
        setArquivos([])
        setUploadProgress(0)
      } else if (res && !editingId) {
        // Se ainda não salvou o cliente, guarda temporariamente
        const novosAnexos = res.map(file => ({
          id: Date.now() + Math.random(),
          nome: file.name,
          nomeArquivo: file.name,
          urlArquivo: file.url,
          tamanho: file.size,
          mimeType: file.type,
        }))
        setAnexosExistentes(prev => [...prev, ...novosAnexos] as Anexo[])
        setArquivos([])
        setUploadProgress(0)
      }
    },
    onUploadError: (error) => {
      alert(`Erro no upload: ${error.message}`)
      setUploadProgress(0)
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const novosArquivos = Array.from(e.target.files)
      setArquivos(prev => [...prev, ...novosArquivos])
    }
  }

  const handleUpload = async () => {
    if (arquivos.length === 0) return
    await startUpload(arquivos)
  }

  const removerArquivo = (index: number) => {
    setArquivos(prev => prev.filter((_, i) => i !== index))
  }

  const removerAnexoExistente = async (anexo: Anexo, index: number) => {
    if (editingId && anexo.id) {
      try {
        const response = await fetch(`/api/anexos?tipoCliente=${editingTipo}&id=${anexo.id}`, {
          method: "DELETE",
        })
        
        if (response.ok) {
          setAnexosExistentes(prev => prev.filter((_, i) => i !== index))
        } else {
          alert("Erro ao excluir anexo")
        }
      } catch (error) {
        console.error("Erro ao excluir anexo:", error)
        alert("Erro ao excluir anexo")
      }
    } else {
      setAnexosExistentes(prev => prev.filter((_, i) => i !== index))
    }
  }

  const formatFileSize = (bytes: number | null | undefined) => {
    if (!bytes || bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  // Limpar arquivos quando fechar o modal
  useEffect(() => {
    if (!isOpen) {
      setArquivos([])
      setAnexosExistentes([])
      setUploadProgress(0)
      setActiveTab("dados")
    }
  }, [isOpen])

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

  // Buscar CEP na API ViaCEP
  const buscarCEP = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, "")
    
    if (cepLimpo.length !== 8) return
    
    setBuscandoCep(true)
    
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`)
      const data = await response.json()
      
      if (!data.erro) {
        setFormData({
          ...formData,
          cep: formatCEP(cepLimpo),
          endereco: data.logradouro || "",
          bairro: data.bairro || "",
          cidade: data.localidade || "",
          estado: data.uf || "",
          complemento: data.complemento || formData.complemento,
        })
      }
    } catch (error) {
      console.error("Erro ao buscar CEP:", error)
    } finally {
      setBuscandoCep(false)
    }
  }

  // Handler do CEP com busca automática
  const handleCEPChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCEP(e.target.value)
    setFormData({ ...formData, cep: formatted })
    
    // Buscar quando completar 9 caracteres (00000-000)
    if (formatted.length === 9) {
      buscarCEP(formatted)
    }
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
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-semibold ${
              formData.tipo === 'requerente' ? 'bg-purple-600' : 'bg-indigo-600'
            }`}>
              {formData.nome ? formData.nome.charAt(0).toUpperCase() : <User className="h-6 w-6" />}
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {isViewMode ? formData.nome || "Visualizar Cliente" : editingId ? "Editar Cliente" : "Novo Cliente"}
              </h2>
              <p className="text-sm text-gray-500">
                {isViewMode ? "Detalhes do cliente" : "Preencha os dados do cliente"}
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
                {isLoading ? "Salvando..." : editingId ? "Salvar Alterações" : "Criar Cliente"}
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
                    {/* Tipo e Nome */}
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Tipo <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.tipo}
                          onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                          disabled={isViewMode || !!editingId}
                          className={`w-full h-10 px-3 rounded-md border text-gray-900 disabled:bg-gray-100 ${
                            formData.tipo === 'requerente' 
                              ? 'bg-purple-50 border-purple-300' 
                              : 'bg-white border-gray-300'
                          }`}
                        >
                          {TIPO_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        {!editingId && !isViewMode && (
                          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                            <span>⚠️</span>
                            O tipo não poderá ser alterado após a criação
                          </p>
                        )}
                      </div>
                      <div className="col-span-3">
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
                  {/* CEP com busca automática */}
                  <div className="w-1/3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
                    <div className="relative">
                      <Input
                        value={formData.cep}
                        onChange={handleCEPChange}
                        placeholder="00000-000"
                        maxLength={9}
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:bg-gray-100 pr-10"
                      />
                      {buscandoCep && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Digite o CEP para preencher automaticamente</p>
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
                    {carregandoAnexos && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
                  </h3>

                  {/* Aviso para salvar primeiro */}
                  {!editingId && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-700">
                        ⚠️ Salve o cliente primeiro para poder adicionar anexos.
                      </p>
                    </div>
                  )}
                  
                  {/* Anexos já enviados - Grid com Preview */}
                  {anexosExistentes.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 font-medium mb-3">Arquivos enviados:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {anexosExistentes.map((anexo, index) => {
                          const fileName = anexo.nomeArquivo || anexo.nome || ''
                          const isImage = anexo.mimeType?.startsWith('image/') || 
                            /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)
                          const isPDF = anexo.mimeType === 'application/pdf' || 
                            /\.pdf$/i.test(fileName)
                          const isWord = /\.(doc|docx)$/i.test(fileName)
                          const isExcel = /\.(xls|xlsx)$/i.test(fileName)
                          
                          return (
                            <div 
                              key={anexo.id || index} 
                              className="group relative bg-gray-50 rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                            >
                              {/* Thumbnail/Preview */}
                              <a 
                                href={anexo.urlArquivo} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="block aspect-square relative overflow-hidden"
                              >
                                {isImage ? (
                                  <img 
                                    src={anexo.urlArquivo} 
                                    alt={fileName}
                                    className="w-full h-full object-cover"
                                  />
                                ) : isPDF ? (
                                  <PDFThumbnail 
                                    url={anexo.urlArquivo} 
                                    className="w-full h-full"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                    {isWord ? (
                                      <div className="text-center">
                                        <div className="w-12 h-14 mx-auto bg-blue-600 rounded-sm flex items-center justify-center text-white text-xs font-bold">
                                          DOC
                                        </div>
                                      </div>
                                    ) : isExcel ? (
                                      <div className="text-center">
                                        <div className="w-12 h-14 mx-auto bg-green-600 rounded-sm flex items-center justify-center text-white text-xs font-bold">
                                          XLS
                                        </div>
                                      </div>
                                    ) : (
                                      <FileText className="h-12 w-12 text-gray-400" />
                                    )}
                                  </div>
                                )}
                                
                                {/* Overlay no hover */}
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </a>
                              
                              {/* Nome do arquivo */}
                              <div className="p-2 border-t border-gray-200">
                                <p className="text-xs text-gray-700 truncate" title={fileName}>
                                  {fileName}
                                </p>
                                {anexo.tamanho && (
                                  <p className="text-xs text-gray-400">{formatFileSize(anexo.tamanho)}</p>
                                )}
                              </div>
                              
                              {/* Botão de remover */}
                              {!isViewMode && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    removerAnexoExistente(anexo, index)
                                  }}
                                  className="absolute top-1 right-1 p-1 bg-red-500 hover:bg-red-600 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Arquivos selecionados para upload */}
                  {arquivos.length > 0 && editingId && (
                    <div className="mb-4 space-y-2">
                      <p className="text-sm text-gray-600 font-medium">Arquivos selecionados:</p>
                      {arquivos.map((arquivo, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-amber-600" />
                            <div>
                              <p className="text-sm font-medium text-gray-700">{arquivo.name}</p>
                              <p className="text-xs text-gray-500">{formatFileSize(arquivo.size)}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removerArquivo(index)}
                            className="p-1 hover:bg-red-100 rounded text-red-500"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      
                      {/* Botão de Upload */}
                      <button
                        type="button"
                        onClick={handleUpload}
                        disabled={isUploading}
                        className="mt-2 w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg font-medium transition-colors"
                      >
                        {isUploading ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Enviando... {uploadProgress}%
                          </span>
                        ) : (
                          `Enviar ${arquivos.length} arquivo(s)`
                        )}
                      </button>
                    </div>
                  )}

                  {/* Área de drop/seleção */}
                  {!isViewMode && editingId && (
                    <label className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors block">
                      <input
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                      />
                      <FileText className="h-10 w-10 mx-auto mb-3 text-gray-400" />
                      <p className="text-sm text-gray-600 font-medium">Clique para selecionar arquivos</p>
                      <p className="text-xs text-gray-400 mt-1">Imagens, PDF, Word, Excel (máx. 64MB cada)</p>
                    </label>
                  )}

                  {/* Mensagem quando não há anexos no modo visualização */}
                  {isViewMode && anexosExistentes.length === 0 && !carregandoAnexos && (
                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
                      <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm text-gray-400">Nenhum anexo</p>
                    </div>
                  )}
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
  const [editingTipo, setEditingTipo] = useState<string>("contratante")
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
    setEditingTipo("contratante")
    setIsViewMode(false)
    setIsModalOpen(true)
  }

  // Abrir modal para editar
  const handleEdit = (contratante: Contratante) => {
    const tipo = contratante.tipo || "contratante"
    setFormData({
      tipo,
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
    setEditingTipo(tipo)
    setIsViewMode(false)
    setIsModalOpen(true)
  }

  // Abrir modal para visualizar
  const handleView = (contratante: Contratante) => {
    const tipo = contratante.tipo || "contratante"
    setFormData({
      tipo,
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
    setEditingTipo(tipo)
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
      const isRequerente = formData.tipo === "requerente"
      const baseUrl = isRequerente ? "/api/requerentes" : "/api/contratantes"
      
      const url = editingId 
        ? `${editingTipo === "requerente" ? "/api/requerentes" : "/api/contratantes"}/${editingId}` 
        : baseUrl
      
      const method = editingId ? "PUT" : "POST"

      const { tipo, ...dataToSend } = formData

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSend),
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
      alert(error.message || "Erro ao salvar cliente")
    } finally {
      setIsLoading(false)
    }
  }

  // Excluir
  const handleDelete = async (id: number, tipo?: string | null) => {
    if (!confirm("Tem certeza que deseja excluir este cliente?")) return

    try {
      const baseUrl = tipo === "requerente" ? "/api/requerentes" : "/api/contratantes"
      const response = await fetch(`${baseUrl}/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Erro ao excluir")
      }

      onRefresh()
    } catch (error: any) {
      alert(error.message || "Erro ao excluir cliente")
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
            placeholder="Buscar cliente..."
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
          Novo Cliente
        </Button>
      </div>

      {/* Tabela */}
      <div className="rounded-lg border border-white/20 overflow-hidden">
        <table className="w-full">
          <thead className="bg-white/10">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-white/60 uppercase">Tipo</th>
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
                <td colSpan={8} className="px-4 py-8 text-center text-white/50">
                  {searchTerm ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
                </td>
              </tr>
            ) : (
              paginatedContratantes.map((contratante) => (
                <tr 
                  key={`${contratante.tipo}-${contratante.id}`} 
                  className="hover:bg-white/5 transition-colors cursor-pointer"
                  onClick={() => handleView(contratante)}
                >
                  <td className="px-4 py-3">
                    <span className={`
                      px-2 py-1 rounded text-xs font-medium
                      ${contratante.tipo === 'requerente' 
                        ? 'bg-purple-500/20 text-purple-300' 
                        : 'bg-blue-500/20 text-blue-300'
                      }
                    `}>
                      {contratante.tipo === 'requerente' ? 'Requerente' : 'Contratante'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                        contratante.tipo === 'requerente' ? 'bg-purple-600' : 'bg-indigo-600'
                      }`}>
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
                      {contratante._count?.processos || 0}
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
                          onClick={() => handleDelete(contratante.id, contratante.tipo)}
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
        editingTipo={editingTipo}
        formData={formData}
        setFormData={setFormData}
        onSave={handleSave}
        isLoading={isLoading}
      />
    </>
  )
}