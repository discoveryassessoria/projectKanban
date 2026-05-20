"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
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
  Loader2,
  AlertTriangle,
  Smartphone,  // ← ADICIONAR
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { uploadFiles, type UploadedFile } from "@/src/lib/storage"
import { PDFThumbnail } from "./pdf-thumbnail"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Upload, CheckCircle2, XCircle, FileImage, Shield, Home, CreditCard as CreditCardIcon, Car } from "lucide-react"
import RelatorioClientesButton from "@/src/components/contratantesComponents/RelatorioClientesButton"
import { AcessoAppTab } from "./contratantesComponents/AcessoAppTab"
import { usePermissoes } from "@/src/hooks/use-permissoes"

interface Contratante {
  id: number
  tipo?: string | null
  nome: string
  cpf?: string | null
  rg?: string | null
  passaporte?: string | null
  crnm?: string | null
  dataNascimento?: string | null
  sexo?: string | null
  estadoCivil?: string | null
  nacionalidade?: string | null
  telefone?: string | null
  email?: string | null
  pais?: string | null
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
  // ✅ NOVO: Callback para abrir processo no Kanban
  onOpenProcesso?: (processoId: number, pais: string) => void
}

// ✅ Interface para processos vinculados
interface ProcessoVinculado {
  id: number
  numero: string
  pais: string
  status: string
  etapaAtual?: string | null
}

interface DocumentoObrigatorio {
  categoria: string
  label: string
  icon: any // tipo do Lucide
  anexo: Anexo | null
}

const DOCUMENTOS_OBRIGATORIOS = [
{ categoria: "RG", label: "RG", icon: CreditCardIcon },
{ categoria: "CNH", label: "CNH", icon: Car },
{ categoria: "COMPROVANTE_ENDERECO", label: "Comprovante de Endereço", icon: Home },
] as const

// ✅ Componente de Tooltip para mostrar processos vinculados
function ProcessosTooltip({ 
  clienteId, 
  clienteTipo, 
  count,
  onOpenProcesso
}: { 
  clienteId: number
  clienteTipo: string
  count: number
  onOpenProcesso?: (processoId: number, pais: string) => void
}) {
  const router = useRouter()
  const [isHovering, setIsHovering] = useState(false)
  const [isTooltipHovering, setIsTooltipHovering] = useState(false)
  const [processos, setProcessos] = useState<ProcessoVinculado[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0, showAbove: false })
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Controlar visibilidade combinando hover do trigger e do tooltip
  const isVisible = isHovering || isTooltipHovering

  const fetchProcessos = async () => {
    if (loaded || loading || count === 0) return
    
    setLoading(true)
    try {
      const param = clienteTipo === 'requerente' ? 'requerenteId' : 'contratanteId'
      const response = await fetch(`/api/processos?${param}=${clienteId}`)
      if (response.ok) {
        const data = await response.json()
        setProcessos(data.processos?.map((p: any) => ({
          id: p.id,
          numero: p.numero || p.nome || `#${p.id}`,
          pais: p.pais || 'N/A',
          status: p.status?.nome || 'Em andamento',
          etapaAtual: p.etapaAtual
        })) || [])
        setLoaded(true)
      }
    } catch (error) {
      console.error("Erro ao buscar processos:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleMouseEnter = () => {
    // Cancelar qualquer timeout de esconder
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      
      // Verificar se há espaço acima (precisa de pelo menos 150px)
      const showAbove = rect.top > 180
      
      // Centralizar tooltip em relação ao número
      // Tooltip tem 288px de largura (w-72), então metade = 144px
      const tooltipWidth = 288
      const centerX = rect.left + (rect.width / 2) - (tooltipWidth / 2)
      
      // Garantir que não saia da tela
      const adjustedLeft = Math.max(10, Math.min(centerX, window.innerWidth - tooltipWidth - 10))
      
      setTooltipPosition({
        top: showAbove 
          ? rect.top - 8
          : rect.bottom + 8,
        left: adjustedLeft,
        showAbove
      })
    }
    timeoutRef.current = setTimeout(() => {
      setIsHovering(true)
      fetchProcessos()
    }, 100)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    // Delay para permitir mover o mouse para o tooltip
    hideTimeoutRef.current = setTimeout(() => {
      setIsHovering(false)
    }, 100)
  }

  const handleTooltipMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current)
    }
    setIsTooltipHovering(true)
  }

  const handleTooltipMouseLeave = () => {
    setIsTooltipHovering(false)
  }

  const handleClickProcesso = (processo: ProcessoVinculado, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsHovering(false)
    setIsTooltipHovering(false)
    
    if (onOpenProcesso) {
      // Usar callback para abrir na mesma página
      onOpenProcesso(processo.id, processo.pais)
    } else {
      // Fallback: navegar para o Kanban
      const paisNormalizado = processo.pais?.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      router.push(`/kanban?processoId=${processo.id}&pais=${paisNormalizado}`)
    }
  }

  const getBandeira = (pais: string) => {
    const paisNormalizado = pais?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    
    const bandeiras: Record<string, string> = {
      'italia': '🇮🇹',
      'portugal': '🇵🇹',
      'espanha': '🇪🇸',
      'alemanha': '🇩🇪',
    }
    return bandeiras[paisNormalizado] || '🌍'
  }

  if (count === 0) {
    return (
      <span className="px-2 py-1 bg-white/10 rounded text-xs text-white/40">
        0
      </span>
    )
  }

  const tooltipContent = isVisible && mounted ? createPortal(
    <div 
      className="fixed z-[9999] w-72 bg-white border border-gray-200 rounded-lg shadow-2xl p-3 animate-in fade-in-0 zoom-in-95 duration-200"
      style={tooltipPosition.showAbove ? {
        bottom: window.innerHeight - tooltipPosition.top,
        left: tooltipPosition.left,
      } : {
        top: tooltipPosition.top,
        left: tooltipPosition.left,
      }}
      onMouseEnter={handleTooltipMouseEnter}
      onMouseLeave={handleTooltipMouseLeave}
    >
      <div className="text-xs font-medium text-gray-500 mb-2">
        Processos vinculados ({count})
      </div>
      
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
          <span className="ml-2 text-xs text-gray-500">Carregando...</span>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {processos.map((processo) => (
            <div
              key={processo.id}
              onClick={(e) => handleClickProcesso(processo, e)}
              className="flex items-center justify-between p-2 bg-gray-50 hover:bg-gray-100 rounded-md cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{getBandeira(processo.pais)}</span>
                <div>
                  <div className="text-xs font-medium text-gray-800">
                    {processo.numero}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {processo.etapaAtual || processo.status}
                  </div>
                </div>
              </div>
              <Eye className="h-3 w-3 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </div>
          ))}
        </div>
      )}
      
      {!loading && processos.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200 text-center">
          <span className="text-[10px] text-gray-400">
            Clique para abrir no Kanban
          </span>
        </div>
      )}
    </div>,
    document.body
  ) : null

  return (
    <div 
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="px-2 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 rounded text-xs text-indigo-300 cursor-pointer transition-colors">
        {count}
      </span>
      {tooltipContent}
    </div>
  )
}

// ✅ EXPORTADO para uso em outros componentes
export const initialFormData = {
  tipo: "contratante",
  nome: "",
  cpf: "",
  rg: "",
  passaporte: "",
  crnm: "",
  dataNascimento: "",
  sexo: "",
  estadoCivil: "",
  nacionalidade: "",
  telefone: "",
  email: "",
  pais: "Brasil",
  paisOutro: "",
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
const NACIONALIDADE_OPTIONS = ["Brasileiro(a)", "Português(a)", "Italiano(a)", "Espanhol(a)", "Alemão(ã)", "Americano(a)", "Outro"]

// Lista de países com código para API de CEP
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

// ✅ EXPORTADO - Componente do Modal separado para usar Portal
export function ContratanteModal({
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
  podeEditar = true,  // ← NOVO
  // ✅ NOVO: Props para erros
  errors = {},
  setErrors,
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
  podeEditar?: boolean  // ← NOVO
  // ✅ NOVO: Tipagem dos erros
  errors?: { nome?: string; cpf?: string; geral?: string }
  setErrors?: (errors: { nome?: string; cpf?: string; geral?: string }) => void
}) {
  const [activeTab, setActiveTab] = useState<"dados" | "endereco" | "observacoes" | "acesso">("dados")
  const [mounted, setMounted] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [isUploading, setIsUploading] = useState(false)  // ← R2: controla estado de upload manualmente
  
  const [documentosObrigatorios, setDocumentosObrigatorios] = useState<Record<string, Anexo | null>>({
  RG: null,
  CNH: null,
  COMPROVANTE_ENDERECO: null,
  })

  // Estados para upload de arquivos
  const [arquivos, setArquivos] = useState<File[]>([])
  const [anexosExistentes, setAnexosExistentes] = useState<Anexo[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [carregandoAnexos, setCarregandoAnexos] = useState(false)

  // Verificar se é Brasil para aplicar máscaras específicas
  const isBrasil = formData.pais === "Brasil"
  
  // Pegar código do país para API
  const getCodigoPais = (nomePais: string): string | null => {
    const pais = PAISES_OPTIONS.find(p => p.nome === nomePais)
    return pais?.codigo || null
  }

  // Pegar placeholder de exemplo do CEP baseado no país
  const getCEPPlaceholder = (nomePais: string): string => {
    const exemplos: Record<string, string> = {
      "Brasil": "00000-000",
      "Estados Unidos": "00000",
      "Portugal": "0000-000",
      "Espanha": "00000",
      "Itália": "00000",
      "Alemanha": "00000",
      "França": "00000",
      "Reino Unido": "AA0A 0AA",
      "Argentina": "A0000AAA",
      "Canadá": "A0A 0A0",
      "Japão": "000-0000",
    }
    return exemplos[nomePais] || "Código postal"
  }

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
        const todosAnexos: Anexo[] = data.anexos || []
        
        // Separar documentos obrigatórios dos genéricos
        const docs: Record<string, Anexo | null> = {
          RG: null,
          CNH: null,
          COMPROVANTE_ENDERECO: null,
        }
        const genericos: Anexo[] = []
        
        for (const anexo of todosAnexos) {
          const cat = (anexo as any).categoria
          if (cat && docs.hasOwnProperty(cat)) {
            docs[cat] = anexo
          }
          genericos.push(anexo) // sempre adiciona (era dentro do else)
        }
        
        setDocumentosObrigatorios(docs)
        setAnexosExistentes(genericos)
      }
    } catch (error) {
      console.error("Erro ao carregar anexos:", error)
    } finally {
      setCarregandoAnexos(false)
    }
  }

  // ⬇️ R2: upload de documento obrigatório (RG, CNH, Comprovante)
  const handleDocumentoUpload = async (categoria: string, file: File) => {
    if (!editingId) return

    setIsUploading(true)
    setUploadProgress(0)
    try {
      const uploadResult = await uploadFiles([file], {
        prefix: "contratantes",
        onProgress: (_f, p) => setUploadProgress(p),
      })

      if (uploadResult && uploadResult.length > 0) {
        const uploaded = uploadResult[0]

        // Salvar no banco com categoria
        const response = await fetch("/api/anexos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nome: uploaded.name,
            nomeArquivo: uploaded.name,
            urlArquivo: uploaded.url,
            tamanho: uploaded.size,
            mimeType: uploaded.type,
            tipoCliente: editingTipo,
            contratanteId: editingTipo === "contratante" ? editingId : undefined,
            requerenteId: editingTipo === "requerente" ? editingId : undefined,
            categoria: categoria,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          setDocumentosObrigatorios(prev => ({
            ...prev,
            [categoria]: data.anexo,
          }))
          setAnexosExistentes(prev => [...prev, data.anexo])
        }
      }
    } catch (error) {
      console.error(`Erro ao enviar ${categoria}:`, error)
      alert(`Erro ao enviar documento: ${(error as Error).message}`)
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

const removerDocumentoObrigatorio = async (categoria: string) => {
  const anexo = documentosObrigatorios[categoria]
  if (!anexo || !editingId) return
  
  try {
    const response = await fetch(`/api/anexos?tipoCliente=${editingTipo}&id=${anexo.id}`, {
      method: "DELETE",
    })
    
    if (response.ok) {
      setDocumentosObrigatorios(prev => ({
        ...prev,
        [categoria]: null,
      }))
    } else {
      alert("Erro ao excluir documento")
    }
  } catch (error) {
    console.error("Erro ao excluir documento:", error)
    alert("Erro ao excluir documento")
  }
  setAnexosExistentes(prev => prev.filter(a => a.id !== anexo.id))
}

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const novosArquivos = Array.from(e.target.files)
      setArquivos(prev => [...prev, ...novosArquivos])
    }
  }

  // ⬇️ R2: upload de anexos genéricos (vários arquivos de uma vez)
  const handleUpload = async () => {
    if (arquivos.length === 0) return

    setIsUploading(true)
    setUploadProgress(0)

    try {
      const uploaded = await uploadFiles(arquivos, {
        prefix: "contratantes",
        onProgress: (_f, p) => setUploadProgress(p),
      })

      if (editingId) {
        // Cliente já salvo: persiste cada anexo via API
        for (const file of uploaded) {
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
      } else {
        // Cliente ainda não salvo: mantém em memória (Anexo "fake" só pra UI)
        const novosAnexos = uploaded.map(file => ({
          id: Date.now() + Math.random(),
          nome: file.name,
          nomeArquivo: file.name,
          urlArquivo: file.url,
          tamanho: file.size,
          mimeType: file.type,
        })) as Anexo[]
        setAnexosExistentes(prev => [...prev, ...novosAnexos])
      }

      setArquivos([])
    } catch (error: any) {
      alert(`Erro no upload: ${error.message}`)
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
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

    // Se era documento obrigatório, limpa de lá também
    const cat = (anexo as any).categoria
    if (cat && documentosObrigatorios[cat]?.id === anexo.id) {
      setDocumentosObrigatorios(prev => ({ ...prev, [cat]: null }))
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

  useEffect(() => {
    if (!isOpen) {
      setArquivos([])
      setAnexosExistentes([])
      setUploadProgress(0)
      setActiveTab("dados")
      setDocumentosObrigatorios({ RG: null, CNH: null, COMPROVANTE_ENDERECO: null }) // ← ADICIONAR
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

  // Formatar Passaporte (apenas maiúsculas, sem caracteres especiais)
  const formatPassaporte = (value: string) => {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)
  }

  // Formatar CRNM (apenas maiúsculas, sem caracteres especiais)
  const formatCRNM = (value: string) => {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)
  }

  // Formatar telefone
  const formatTelefone = (value: string) => {
    let cleaned = value.replace(/[^\d+]/g, '')
    
    if (cleaned && !cleaned.startsWith('+')) {
      cleaned = '+55' + cleaned
    }
    
    if (cleaned === '+') return '+'
    
    const digits = cleaned.slice(1)
    if (!digits) return '+'
    
    // Brasil +55
    if (digits.startsWith('55')) {
      const number = digits.slice(2)
      if (number.length === 0) return '+55'
      if (number.length <= 2) return `+55 (${number}`
      const ddd = number.slice(0, 2)
      const rest = number.slice(2)
      if (rest.length === 0) return `+55 (${ddd})`
      if (rest.length <= 5) return `+55 (${ddd}) ${rest}`
      if (rest.length <= 9) {
        if (rest.length === 9) {
          return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
        } else if (rest.length === 8) {
          return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
        }
        return `+55 (${ddd}) ${rest}`
      }
      const maxRest = rest.slice(0, 9)
      return `+55 (${ddd}) ${maxRest.slice(0, 5)}-${maxRest.slice(5)}`
    }
    
    // EUA/Canadá +1
    if (digits.startsWith('1')) {
      const number = digits.slice(1)
      if (number.length === 0) return '+1'
      if (number.length <= 3) return `+1 (${number}`
      const areaCode = number.slice(0, 3)
      const rest = number.slice(3)
      if (rest.length === 0) return `+1 (${areaCode})`
      if (rest.length <= 3) return `+1 (${areaCode}) ${rest}`
      if (rest.length <= 7) {
        return `+1 (${areaCode}) ${rest.slice(0, 3)}-${rest.slice(3)}`
      }
      const maxRest = rest.slice(0, 7)
      return `+1 (${areaCode}) ${maxRest.slice(0, 3)}-${maxRest.slice(3)}`
    }
    
    // Portugal +351
    if (digits.startsWith('351')) {
      const number = digits.slice(3)
      if (number.length === 0) return '+351'
      if (number.length <= 3) return `+351 ${number}`
      if (number.length <= 6) return `+351 ${number.slice(0, 3)} ${number.slice(3)}`
      if (number.length <= 9) return `+351 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`
      const maxNum = number.slice(0, 9)
      return `+351 ${maxNum.slice(0, 3)} ${maxNum.slice(3, 6)} ${maxNum.slice(6)}`
    }
    
    // Espanha +34
    if (digits.startsWith('34')) {
      const number = digits.slice(2)
      if (number.length === 0) return '+34'
      if (number.length <= 3) return `+34 ${number}`
      if (number.length <= 6) return `+34 ${number.slice(0, 3)} ${number.slice(3)}`
      if (number.length <= 9) return `+34 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`
      const maxNum = number.slice(0, 9)
      return `+34 ${maxNum.slice(0, 3)} ${maxNum.slice(3, 6)} ${maxNum.slice(6)}`
    }
    
    // Itália +39
    if (digits.startsWith('39')) {
      const number = digits.slice(2)
      if (number.length === 0) return '+39'
      if (number.length <= 3) return `+39 ${number}`
      if (number.length <= 6) return `+39 ${number.slice(0, 3)} ${number.slice(3)}`
      if (number.length <= 10) return `+39 ${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`
      const maxNum = number.slice(0, 10)
      return `+39 ${maxNum.slice(0, 3)} ${maxNum.slice(3, 6)} ${maxNum.slice(6)}`
    }
    
    // Alemanha +49
    if (digits.startsWith('49')) {
      const number = digits.slice(2)
      if (number.length === 0) return '+49'
      if (number.length <= 4) return `+49 ${number}`
      if (number.length <= 11) return `+49 ${number.slice(0, 4)} ${number.slice(4)}`
      const maxNum = number.slice(0, 11)
      return `+49 ${maxNum.slice(0, 4)} ${maxNum.slice(4)}`
    }
    
    // França +33
    if (digits.startsWith('33')) {
      const number = digits.slice(2)
      if (number.length === 0) return '+33'
      if (number.length <= 1) return `+33 ${number}`
      if (number.length <= 3) return `+33 ${number.slice(0, 1)} ${number.slice(1)}`
      if (number.length <= 5) return `+33 ${number.slice(0, 1)} ${number.slice(1, 3)} ${number.slice(3)}`
      if (number.length <= 7) return `+33 ${number.slice(0, 1)} ${number.slice(1, 3)} ${number.slice(3, 5)} ${number.slice(5)}`
      if (number.length <= 9) return `+33 ${number.slice(0, 1)} ${number.slice(1, 3)} ${number.slice(3, 5)} ${number.slice(5, 7)} ${number.slice(7)}`
      const maxNum = number.slice(0, 9)
      return `+33 ${maxNum.slice(0, 1)} ${maxNum.slice(1, 3)} ${maxNum.slice(3, 5)} ${maxNum.slice(5, 7)} ${maxNum.slice(7)}`
    }
    
    // Argentina +54
    if (digits.startsWith('54')) {
      const number = digits.slice(2)
      if (number.length === 0) return '+54'
      if (number.length <= 2) return `+54 ${number}`
      if (number.length <= 6) return `+54 ${number.slice(0, 2)} ${number.slice(2)}`
      if (number.length <= 10) return `+54 ${number.slice(0, 2)} ${number.slice(2, 6)} ${number.slice(6)}`
      const maxNum = number.slice(0, 10)
      return `+54 ${maxNum.slice(0, 2)} ${maxNum.slice(2, 6)} ${maxNum.slice(6)}`
    }
    
    // Para qualquer outro DDI - formatação genérica
    if (digits.length <= 3) return `+${digits}`
    if (digits.length <= 6) return `+${digits.slice(0, 3)} ${digits.slice(3)}`
    if (digits.length <= 9) return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    if (digits.length <= 12) return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
    
    // Limita a 15 dígitos (padrão E.164)
    const maxDigits = digits.slice(0, 15)
    return `+${maxDigits.slice(0, 3)} ${maxDigits.slice(3, 6)} ${maxDigits.slice(6, 9)} ${maxDigits.slice(9, 12)} ${maxDigits.slice(12)}`
  }

  // Formatar CEP brasileiro
  const formatCEPBrasil = (value: string) => {
    return value
      .replace(/\D/g, "")
      .replace(/(\d{5})(\d)/, "$1-$2")
      .replace(/(-\d{3})\d+?$/, "$1")
  }

  // Buscar CEP - Brasil (ViaCEP)
  const buscarCEPBrasil = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, "")
    if (cepLimpo.length !== 8) return false
    
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`)
      const data = await response.json()
      
      if (!data.erro) {
        setFormData({
          ...formData,
          cep: formatCEPBrasil(cepLimpo),
          endereco: data.logradouro || "",
          bairro: data.bairro || "",
          cidade: data.localidade || "",
          estado: data.uf || "",
          complemento: data.complemento || formData.complemento,
        })
        return true
      }
    } catch (error) {
      console.error("Erro ao buscar CEP Brasil:", error)
    }
    return false
  }

  // Buscar CEP - Internacional (Zippopotam.us)
  const buscarCEPInternacional = async (cep: string, codigoPais: string) => {
    const cepOriginal = cep.trim()
    const formatos: string[] = []
    const cepLimpo = cepOriginal.replace(/[\s-]/g, "").toUpperCase()
    
    if (cepOriginal !== cepLimpo) {
      formatos.push(cepOriginal.toUpperCase())
    }
    formatos.push(cepLimpo)
    
    if (codigoPais === "pt") {
      const sohNumeros = cepLimpo.replace(/\D/g, "")
      if (sohNumeros.length >= 4) {
        formatos.push(sohNumeros.slice(0, 4))
      }
    }
    
    if (codigoPais === "gb") {
      const match = cepLimpo.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/)
      if (match) {
        formatos.push(match[1])
      }
      if (cepLimpo.length >= 3) {
        formatos.push(cepLimpo.slice(0, 3))
        formatos.push(cepLimpo.slice(0, 4))
      }
    }
    
    if (codigoPais === "ca") {
      if (cepLimpo.length >= 3) {
        formatos.push(cepLimpo.slice(0, 3))
      }
    }
    
    if (codigoPais === "jp") {
      const sohNumeros = cepLimpo.replace(/\D/g, "")
      if (sohNumeros.length >= 3) {
        formatos.push(sohNumeros.slice(0, 3))
      }
    }
    
    if (codigoPais === "ar") {
      if (!cepLimpo.startsWith("C") && !cepLimpo.startsWith("B")) {
        formatos.push("C" + cepLimpo)
        formatos.push("B" + cepLimpo)
      }
    }
    
    for (const formato of formatos) {
      if (formato.length < 2) continue
      
      try {
        const response = await fetch(`https://api.zippopotam.us/${codigoPais}/${formato}`)
        
        if (response.ok) {
          const data = await response.json()
          
          if (data.places && data.places.length > 0) {
            const place = data.places[0]
            const estado = place["state"] || place["state abbreviation"] || ""
            
            setFormData({
              ...formData,
              cep: cepOriginal,
              cidade: place["place name"] || "",
              estado: estado,
              endereco: "",
              bairro: "",
              numero: "",
              complemento: "",
            })
            return true
          }
        }
      } catch (error) {
        console.error("Erro ao buscar CEP internacional:", error)
      }
    }
    
    setFormData({
      ...formData,
      cep: cepOriginal,
      cidade: "",
      estado: "",
      endereco: "",
      bairro: "",
      numero: "",
      complemento: "",
    })
    
    return false
  }

  const buscarCEP = async (cep: string) => {
    const codigoPais = getCodigoPais(formData.pais)
    
    if (!codigoPais) return
    
    setBuscandoCep(true)
    
    try {
      if (formData.pais === "Brasil") {
        await buscarCEPBrasil(cep)
      } else {
        await buscarCEPInternacional(cep, codigoPais)
      }
    } finally {
      setBuscandoCep(false)
    }
  }

  const handleCEPChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    
    if (isBrasil) {
      const formatted = formatCEPBrasil(value)
      setFormData({ ...formData, cep: formatted })
      
      if (formatted.length === 9) {
        buscarCEP(formatted)
      }
    } else {
      const formatted = value.toUpperCase().slice(0, 15)
      setFormData({ ...formData, cep: formatted })
    }
  }

  const handleCEPBlur = () => {
    if (!isBrasil && formData.cep && formData.cep.length >= 3) {
      buscarCEP(formData.cep)
    }
  }

  const handleCEPKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isBrasil && formData.cep && formData.cep.length >= 3) {
      e.preventDefault()
      buscarCEP(formData.cep)
    }
  }

  const handlePaisChange = (novoPais: string) => {
    setFormData({ 
      ...formData, 
      pais: novoPais, 
      paisOutro: novoPais === "Outro" ? formData.paisOutro : "",
      cep: "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      estado: "",
    })
  }

  // ✅ NOVO: Limpar erro quando usuário digita
  const handleNomeChange = (value: string) => {
    setFormData({ ...formData, nome: value })
    if (errors.nome && setErrors) {
      setErrors({ ...errors, nome: undefined })
    }
  }

  const handleCPFChange = (value: string) => {
    setFormData({ ...formData, cpf: formatCPF(value) })
    if (errors.cpf && setErrors) {
      setErrors({ ...errors, cpf: undefined })
    }
  }

  if (!isOpen || !mounted) return null
  
  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div 
        className="relative bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden"
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
              podeEditar && (
                <Button
                  onClick={() => setIsViewMode(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </Button>
              )
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

        {/* ✅ NOVO: Erro geral no topo */}
        {errors.geral && (
          <div className="mx-8 mt-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{errors.geral}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-8 bg-white shrink-0">
          {[
            { id: "dados", label: "Dados Pessoais", icon: User },
            { id: "endereco", label: "Endereço", icon: MapPin },
            { id: "observacoes", label: "Observações e Anexos", icon: FileText },
            { id: "acesso", label: "Acesso ao App", icon: Smartphone },
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
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Tipo <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.tipo}
                          onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                          disabled={isViewMode || !!editingId}
                          className={`w-full h-[42px] px-3 rounded-lg border text-gray-900 disabled:opacity-50 disabled:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500 appearance-none cursor-pointer ${
                            formData.tipo === 'requerente' 
                              ? 'bg-purple-50 border-purple-300' 
                              : 'bg-white border-gray-300'
                          }`}
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 12px center'
                          }}
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
                          onChange={(e) => handleNomeChange(e.target.value)}
                          placeholder="Nome completo"
                          disabled={isViewMode}
                          className={`bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white ${
                            errors.nome ? 'border-red-500 focus-visible:ring-red-500' : ''
                          }`}
                        />
                        {/* ✅ NOVO: Mensagem de erro para Nome */}
                        {errors.nome && (
                          <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {errors.nome}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          CPF <span className="text-red-500">*</span>
                        </label>
                        <Input
                          value={formData.cpf}
                          onChange={(e) => handleCPFChange(e.target.value)}
                          placeholder="000.000.000-00"
                          maxLength={14}
                          disabled={isViewMode}
                          className={`bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white ${
                            errors.cpf ? 'border-red-500 focus-visible:ring-red-500' : ''
                          }`}
                        />
                        {/* ✅ NOVO: Mensagem de erro para CPF */}
                        {errors.cpf && (
                          <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {errors.cpf}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">RG</label>
                        <Input
                          value={formData.rg}
                          onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                          placeholder="Número do RG"
                          disabled={isViewMode}
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Passaporte</label>
                        <Input
                          value={formData.passaporte}
                          onChange={(e) => setFormData({ ...formData, passaporte: formatPassaporte(e.target.value) })}
                          placeholder="Número do passaporte"
                          maxLength={15}
                          disabled={isViewMode}
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CRNM</label>
                        <Input
                          value={formData.crnm}
                          onChange={(e) => setFormData({ ...formData, crnm: formatCRNM(e.target.value) })}
                          placeholder="Número do CRNM"
                          maxLength={15}
                          disabled={isViewMode}
                          className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
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
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Data de Nascimento
                        </label>
                        <DatePickerField
                          value={formData.dataNascimento}
                          onChange={(value) => setFormData({ ...formData, dataNascimento: value })}
                          disabled={isViewMode}
                          placeholder="dd/mm/aaaa"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
                        <select
                          value={formData.sexo}
                          onChange={(e) => setFormData({ ...formData, sexo: e.target.value })}
                          disabled={isViewMode}
                          className="w-full h-[42px] px-3 rounded-lg bg-white border border-gray-300 text-gray-900 disabled:opacity-50 disabled:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500 appearance-none cursor-pointer"
style={{
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
}}
                        >
                          <option value="">Selecione</option>
                          {SEXO_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    </div>

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
                          className="w-full h-[42px] px-3 rounded-lg bg-white border border-gray-300 text-gray-900 disabled:opacity-50 disabled:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500 appearance-none cursor-pointer"
style={{
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
}}
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
                          className="w-full h-[42px] px-3 rounded-lg bg-white border border-gray-300 text-gray-900 disabled:opacity-50 disabled:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500 appearance-none cursor-pointer"
style={{
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
}}
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
                        placeholder="+55 (11) 99999-9999"
                        maxLength={25}
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
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
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
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
                  {formData.pais === "Outro" ? (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Globe className="h-4 w-4 inline mr-1 text-gray-400" />
                            País
                          </label>
                          <select
                            value={formData.pais}
                            onChange={(e) => handlePaisChange(e.target.value)}
                            disabled={isViewMode}
                            className="w-full h-[42px] px-3 rounded-lg bg-white border border-gray-300 text-gray-900 disabled:opacity-50 disabled:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500 appearance-none cursor-pointer"
style={{
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
}}
                          >
                            {PAISES_OPTIONS.map(pais => (
                              <option key={pais.nome} value={pais.nome}>{pais.nome}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Nome do País
                          </label>
                          <Input
                            value={formData.paisOutro || ""}
                            onChange={(e) => setFormData({ ...formData, paisOutro: e.target.value })}
                            placeholder="Digite o nome do país"
                            disabled={isViewMode}
                            className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Código Postal
                          </label>
                          <Input
                            value={formData.cep}
                            onChange={(e) => setFormData({ ...formData, cep: e.target.value.toUpperCase().slice(0, 15) })}
                            placeholder="Código postal"
                            maxLength={15}
                            disabled={isViewMode}
                            className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                          />
                          <p className="text-xs text-gray-500 mt-1">Preencha manualmente</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          <Globe className="h-4 w-4 inline mr-1 text-gray-400" />
                          País
                        </label>
                        <select
                          value={formData.pais}
                          onChange={(e) => handlePaisChange(e.target.value)}
                          disabled={isViewMode}
                          className="w-full h-[42px] px-3 rounded-lg bg-white border border-gray-300 text-gray-900 disabled:opacity-50 disabled:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500 appearance-none cursor-pointer"
style={{
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center'
}}
                        >
                          {PAISES_OPTIONS.map(pais => (
                            <option key={pais.nome} value={pais.nome}>{pais.nome}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {isBrasil ? "CEP" : "Código Postal"}
                        </label>
                        <div className="relative">
                          <Input
                            value={formData.cep}
                            onChange={handleCEPChange}
                            onBlur={handleCEPBlur}
                            onKeyDown={handleCEPKeyDown}
                            placeholder={getCEPPlaceholder(formData.pais)}
                            maxLength={isBrasil ? 9 : 15}
                            disabled={isViewMode}
                            className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white pr-10"
                          />
                          {buscandoCep && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {`Digite o ${isBrasil ? "CEP" : "código postal"} para preencher automaticamente`}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-4">
                    <div className="col-span-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
                      <Input
                        value={formData.endereco}
                        onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                        placeholder="Rua, Avenida..."
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
                      <Input
                        value={formData.numero}
                        onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                        placeholder="Nº"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
                      <Input
                        value={formData.complemento}
                        onChange={(e) => setFormData({ ...formData, complemento: e.target.value })}
                        placeholder="Apto, Bloco..."
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bairro
                      </label>
                      <Input
                        value={formData.bairro}
                        onChange={(e) => setFormData({ ...formData, bairro: e.target.value })}
                        placeholder="Nome do bairro"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                      <Input
                        value={formData.cidade}
                        onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                        placeholder="Nome da cidade"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Estado
                      </label>
                      <Input
                        value={formData.estado}
                        onChange={(e) => setFormData({ ...formData, estado: e.target.value })}
                        placeholder="UF"
                        disabled={isViewMode}
                        className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "observacoes" && (
              <div className="space-y-6">
                {/* Seção: Observações */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    Observações
                  </h3>
                  <textarea
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Anotações, informações importantes..."
                    rows={4}
                    disabled={isViewMode}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 disabled:opacity-50 disabled:bg-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 focus:border-indigo-500"
                  />
                </div>

                {/* Seção: Documentos Obrigatórios */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-indigo-600" />
                    Documentos Obrigatórios
                    {carregandoAnexos && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
                  </h3>

                  {!editingId && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-700">
                        ⚠️ Salve o cliente primeiro para poder adicionar documentos.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {DOCUMENTOS_OBRIGATORIOS.map(({ categoria, label, icon: Icon }) => {
                      const anexo = documentosObrigatorios[categoria]
                      const temDocumento = !!anexo
                      
                      return (
                        <div
                          key={categoria}
                          className={`
                            relative rounded-xl border-2 p-4 transition-all
                            ${temDocumento 
                              ? 'border-emerald-300 bg-emerald-50' 
                              : 'border-red-200 bg-red-50'
                            }
                          `}
                        >
                          {/* Header com status */}
                          <div className="flex items-center justify-between mb-3 min-h-[48px]">
                            <div className="flex items-center gap-2">
                              <Icon className={`h-4 w-4 ${temDocumento ? 'text-emerald-600' : 'text-red-500'}`} />
                              <span className="text-sm font-semibold text-gray-800">{label}</span>
                            </div>
                            {temDocumento ? (
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 rounded-full">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="text-xs font-medium text-emerald-700">Enviado</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 px-2 py-0.5 bg-red-100 rounded-full">
                                <XCircle className="h-3.5 w-3.5 text-red-500" />
                                <span className="text-xs font-medium text-red-600">Pendente</span>
                              </div>
                            )}
                          </div>

                          {/* Conteúdo */}
                          {temDocumento ? (
                            <div className="space-y-2">
                              {/* Preview do arquivo */}
                              <a
                                href={anexo.urlArquivo}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block group"
                              >
                                <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-white border border-gray-200">
                                  {anexo.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(anexo.nomeArquivo) ? (
                                    <img 
                                      src={anexo.urlArquivo} 
                                      alt={anexo.nomeArquivo}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (anexo.mimeType === 'application/pdf' || /\.pdf$/i.test(anexo.nomeArquivo)) ? (
                                    <PDFThumbnail 
                                      url={anexo.urlArquivo} 
                                      className="w-full h-full"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                      <FileText className="h-10 w-10 text-gray-400" />
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <Eye className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </div>
                              </a>
                              
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-gray-600 truncate flex-1" title={anexo.nomeArquivo}>
                                  {anexo.nomeArquivo}
                                </p>
                                {!isViewMode && (
                                  <button
                                    type="button"
                                    onClick={() => removerDocumentoObrigatorio(categoria)}
                                    className="ml-2 p-1 text-red-500 hover:bg-red-100 rounded transition-colors"
                                    title="Remover documento"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : (
                            /* Área de upload quando não tem documento */
                            editingId && !isViewMode ? (
                              <label className="block cursor-pointer">
                                <input
                                  type="file"
                                  className="hidden"
                                  accept="image/*,.pdf,.doc,.docx"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    if (file) {
                                      handleDocumentoUpload(categoria, file)
                                    }
                                    e.target.value = '' // Reset input
                                  }}
                                />
                                <div className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-red-300 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors">
                                  {isUploading ? (
                                    <>
                                      <Loader2 className="h-6 w-6 animate-spin text-indigo-500 mb-2" />
                                      <p className="text-xs text-gray-500">Enviando...</p>
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="h-6 w-6 text-gray-400 mb-2" />
                                      <p className="text-xs text-gray-600 font-medium">Enviar {label}</p>
                                      <p className="text-[10px] text-gray-400 mt-0.5">PDF, imagem ou documento</p>
                                    </>
                                  )}
                                </div>
                              </label>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
                                <FileText className="h-6 w-6 text-gray-300 mb-2" />
                                <p className="text-xs text-gray-400">Nenhum arquivo</p>
                              </div>
                            )
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Seção: Outros Documentos (genéricos) */}
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    Todos os Documentos
                    {carregandoAnexos && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
                  </h3>

                  {!editingId && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-700">
                        ⚠️ Salve o cliente primeiro para poder adicionar anexos.
                      </p>
                    </div>
                  )}
                  
                  {anexosExistentes.length > 0 && (
                    <div className="mb-4">
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
                                
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </a>
                              
                              <div className="p-2 border-t border-gray-200">
                                <p className="text-xs text-gray-700 truncate" title={fileName}>
                                  {fileName}
                                </p>
                                {anexo.tamanho && (
                                  <p className="text-xs text-gray-400">{formatFileSize(anexo.tamanho)}</p>
                                )}
                              </div>
                              
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

                  {isViewMode && anexosExistentes.length === 0 && !carregandoAnexos && (
                    <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
                      <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm text-gray-400">Nenhum documento adicional</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Tab Acesso ao App */}
            {activeTab === "acesso" && (
              <AcessoAppTab
                clienteId={editingId}
                clienteTipo={editingTipo}
                clienteEmail={formData.email}
                clienteNome={formData.nome}
                isViewMode={isViewMode}
              />
            )}

          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export function ContratantesTabela({ contratantes, onRefresh, onOpenProcesso }: ContratantesTabelaProps) {
  const { pode } = usePermissoes()
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isViewMode, setIsViewMode] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingTipo, setEditingTipo] = useState<string>("contratante")
  const [formData, setFormData] = useState(initialFormData)
  const [isLoading, setIsLoading] = useState(false)
  // ✅ NOVO: Estado para erros
  const [errors, setErrors] = useState<{ nome?: string; cpf?: string; geral?: string }>({})

  const itemsPerPage = 10

  const filteredContratantes = contratantes.filter(c => {
    const searchLower = searchTerm.toLowerCase()
    return (
      c.nome.toLowerCase().includes(searchLower) ||
      c.email?.toLowerCase().includes(searchLower) ||
      c.cpf?.includes(searchTerm) ||
      c.telefone?.includes(searchTerm)
    )
  })

  const totalPages = Math.ceil(filteredContratantes.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedContratantes = filteredContratantes.slice(startIndex, startIndex + itemsPerPage)

  const handleNew = () => {
    setFormData(initialFormData)
    setEditingId(null)
    setEditingTipo("contratante")
    setIsViewMode(false)
    setErrors({}) // ✅ Limpar erros
    setIsModalOpen(true)
  }

  const handleEdit = (contratante: Contratante) => {
    const tipo = contratante.tipo || "contratante"
    const paisSalvo = contratante.pais || "Brasil"
    const paisNaLista = PAISES_OPTIONS.some(p => p.nome === paisSalvo)
    
    setFormData({
      tipo,
      nome: contratante.nome || "",
      cpf: contratante.cpf || "",
      rg: contratante.rg || "",
      passaporte: contratante.passaporte || "",
      crnm: contratante.crnm || "",
      dataNascimento: contratante.dataNascimento 
        ? new Date(contratante.dataNascimento).toISOString().split("T")[0] 
        : "",
      sexo: contratante.sexo || "",
      estadoCivil: contratante.estadoCivil || "",
      nacionalidade: contratante.nacionalidade || "",
      telefone: contratante.telefone || "",
      email: contratante.email || "",
      pais: paisNaLista ? paisSalvo : "Outro",
      paisOutro: paisNaLista ? "" : paisSalvo,
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
    setErrors({}) // ✅ Limpar erros
    setIsModalOpen(true)
  }

  const handleView = (contratante: Contratante) => {
    const tipo = contratante.tipo || "contratante"
    const paisSalvo = contratante.pais || "Brasil"
    const paisNaLista = PAISES_OPTIONS.some(p => p.nome === paisSalvo)
    
    setFormData({
      tipo,
      nome: contratante.nome || "",
      cpf: contratante.cpf || "",
      rg: contratante.rg || "",
      passaporte: contratante.passaporte || "",
      crnm: contratante.crnm || "",
      dataNascimento: contratante.dataNascimento 
        ? new Date(contratante.dataNascimento).toISOString().split("T")[0] 
        : "",
      sexo: contratante.sexo || "",
      estadoCivil: contratante.estadoCivil || "",
      nacionalidade: contratante.nacionalidade || "",
      telefone: contratante.telefone || "",
      email: contratante.email || "",
      pais: paisNaLista ? paisSalvo : "Outro",
      paisOutro: paisNaLista ? "" : paisSalvo,
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
    setErrors({}) // ✅ Limpar erros
    setIsModalOpen(true)
  }

  const handleSave = async () => {
    // Limpar erros anteriores
    setErrors({})
  
    // Validação local - Nome obrigatório
    if (!formData.nome.trim()) {
      setErrors({ nome: "Nome é obrigatório" })
      return
    }
  
    // Validação local - CPF obrigatório
    const cpfLimpo = formData.cpf.replace(/\D/g, "")
    if (!cpfLimpo) {
      setErrors({ cpf: "CPF é obrigatório" })
      return
    }
  
    // Validação local - CPF deve ter 11 dígitos
    if (cpfLimpo.length !== 11) {
      setErrors({ cpf: "CPF deve ter 11 dígitos" })
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
  
      const { tipo, paisOutro, ...restData } = formData
  
      const dataToSend = {
        ...restData,
        pais: formData.pais === "Outro" ? (paisOutro || "Outro") : formData.pais,
      }
  
      // 🛡️ BLINDAGEM: serializa ANTES e garante que não tá vazio
      const bodySerialized = JSON.stringify(dataToSend)
  
      if (!bodySerialized || bodySerialized === '{}' || bodySerialized.length < 10) {
        console.error('[handleSave] body vazio detectado antes do envio:', {
          dataToSend,
          bodySerialized,
          formData,
        })
        setErrors({
          geral: 'Erro interno: nenhum dado foi montado para envio. Recarregue a página e tente novamente.',
        })
        setIsLoading(false)
        return
      }
  
      // 🔍 Log de debug — aparece no console do navegador
      console.log('[handleSave]', {
        url,
        method,
        bodyLength: bodySerialized.length,
        campos: Object.keys(dataToSend),
      })
  
      // 🛡️ Checa token antes de mandar
      const authToken = localStorage.getItem("authToken")
      if (!authToken) {
        setErrors({
          geral: 'Sua sessão expirou. Faça login novamente.',
        })
        setIsLoading(false)
        // Opcional: redirecionar pra página de login
        // window.location.href = '/login'
        return
      }
  
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: bodySerialized,
      })
  
      // 🛡️ Parse defensivo da resposta (caso venha vazio ou corrompido)
      let data: any
      try {
        const raw = await response.text()
        data = raw ? JSON.parse(raw) : {}
      } catch (parseErr) {
        console.error('[handleSave] resposta do servidor corrompida:', parseErr)
        setErrors({
          geral: 'O servidor retornou uma resposta inválida. Tente novamente.',
        })
        setIsLoading(false)
        return
      }
  
      if (!response.ok) {
        // 401 = sessão expirada
        if (response.status === 401) {
          setErrors({
            geral: 'Sua sessão expirou. Faça login novamente.',
          })
          return
        }
  
        // 403 = sem permissão
        if (response.status === 403) {
          setErrors({
            geral: 'Você não tem permissão para editar clientes.',
          })
          return
        }
  
        // 409 = conflito (duplicidade)
        if (response.status === 409) {
          if (data.campo === 'nome') {
            setErrors({ nome: data.error })
          } else if (data.campo === 'cpf') {
            setErrors({ cpf: data.error })
          } else {
            setErrors({ geral: data.error })
          }
          return
        }
  
        // 400 = request ruim (inclui body vazio)
        if (response.status === 400) {
          setErrors({ geral: data.error || 'Dados inválidos. Verifique e tente novamente.' })
          return
        }
  
        throw new Error(data.error || "Erro ao salvar")
      }
  
      setIsModalOpen(false)
      setFormData(initialFormData)
      setEditingId(null)
      setErrors({})
      onRefresh()
    } catch (error: any) {
      console.error('[handleSave] erro inesperado:', error)
      setErrors({
        geral: error.message || "Erro ao salvar cliente. Tente novamente.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (id: number, tipo?: string | null) => {
    if (!confirm("Tem certeza que deseja excluir este cliente?")) return

    try {
      const baseUrl = tipo === "requerente" ? "/api/requerentes" : "/api/contratantes"
      const response = await fetch(`${baseUrl}/${id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`,
        },
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR")
  }

  return (
    <>
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
        
        <div className="flex items-center gap-2">
          <RelatorioClientesButton />
          {pode('clientes.criar') && (
            <Button
              onClick={handleNew}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="h-4 w-4 mr-2" />
              Novo Cliente
            </Button>
          )}
        </div>
      </div>

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
                    <ProcessosTooltip 
                      clienteId={contratante.id}
                      clienteTipo={contratante.tipo || 'contratante'}
                      count={contratante._count?.processos || 0}
                      onOpenProcesso={onOpenProcesso}
                    />
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
                      <DropdownMenuContent align="end" className="bg-white border-gray-200">
                        <DropdownMenuItem 
                          onClick={() => handleView(contratante)}
                          className="text-gray-700 hover:bg-gray-100 cursor-pointer"
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Visualizar
                        </DropdownMenuItem>
                        {pode('clientes.editar') && (
                          <DropdownMenuItem 
                            onClick={() => handleEdit(contratante)}
                            className="text-gray-700 hover:bg-gray-100 cursor-pointer"
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                        )}
                        {pode('clientes.excluir') && (
                          <DropdownMenuItem 
                            onClick={() => handleDelete(contratante.id, contratante.tipo)}
                            className="text-red-500 focus:text-red-500 data-[highlighted]:text-red-500 data-[highlighted]:bg-red-500/10 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                            Excluir
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-white/50">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, filteredContratantes.length)} de {filteredContratantes.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="bg-transparent text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-white/70">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="bg-transparent text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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
        errors={errors}
        setErrors={setErrors}
        podeEditar={pode('clientes.editar')}
      />
    </>
  )
}