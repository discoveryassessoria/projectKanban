// src/components/kanban/ProcessoProtocolos.tsx

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { useUploadThing } from "@/src/lib/uploadthing"
import {
  Plus,
  FileText,
  Calendar,
  Hash,
  User,
  Trash2,
  Loader2,
  Edit2,
  X,
  Building2,
  Paperclip,
  Eye
} from "lucide-react"

// Tipos compatíveis com os do modal
interface PessoaBase {
  id: number
  nome: string
  email?: string | null
  telefone?: string | null
}

interface Anexo {
  id: number
  nome: string
  tipo?: string | null
  nomeArquivo: string
  urlArquivo: string
  tamanho?: number | null
  mimeType?: string | null
  createdAt: string
}

interface Protocolo {
  id: number
  processoId: number
  contratanteId?: number | null
  requerenteId?: number | null
  contratante?: PessoaBase | null
  requerente?: PessoaBase | null
  consulado: string
  consuladoOutro?: string | null
  dataProtocolo?: string | null
  numeroProtocolo?: string | null
  observacoes?: string | null
  anexos?: Anexo[]
  createdAt: string
}

interface ProcessoProtocolosProps {
  processoId: number
  contratantes: PessoaBase[]
  requerentes: PessoaBase[]
  onUpdate?: () => void
}

// Mapa de consulados
const CONSULADOS = [
  { value: "SAO_PAULO", label: "São Paulo" },
  { value: "PORTO_ALEGRE", label: "Porto Alegre" },
  { value: "RIO_DE_JANEIRO", label: "Rio de Janeiro" },
  { value: "SALVADOR", label: "Salvador" },
  { value: "BRASILIA", label: "Brasília" },
  { value: "OUTROS", label: "Outros" },
]

const getConsuladoLabel = (value: string, outro?: string | null) => {
  if (value === "OUTROS" && outro) return outro
  return CONSULADOS.find(c => c.value === value)?.label || value
}

// Helper para formatar tamanho de arquivo
const formatFileSize = (bytes?: number | null) => {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProcessoProtocolos({ 
  processoId, 
  contratantes, 
  requerentes,
  onUpdate 
}: ProcessoProtocolosProps) {
  const [protocolos, setProtocolos] = useState<Protocolo[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState<Protocolo | null>(null)
  const [salvando, setSalvando] = useState(false)
  
  // Estados para upload
  const [arquivosPendentes, setArquivosPendentes] = useState<{[protocoloId: number]: File[]}>({})
  const [uploadingProtocoloId, setUploadingProtocoloId] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // Verificar permissão do usuário
  const [podeEditar, setPodeEditar] = useState(false)
  
  useEffect(() => {
    // Pegar tipo do usuário do localStorage
    const userData = localStorage.getItem("user")
    if (userData) {
      try {
        const user = JSON.parse(userData)
        // admin e gestor podem editar, usuario não
        const tiposComPermissao = ["admin", "Administrador", "gestor", "Gestor"]
        setPodeEditar(tiposComPermissao.includes(user.tipo))
      } catch {
        setPodeEditar(false)
      }
    }
  }, [])

  // Form state
  const [form, setForm] = useState({
    tipoPessoa: "contratante" as "contratante" | "requerente",
    pessoaId: "",
    consulado: "",
    consuladoOutro: "",
    dataProtocolo: "",
    numeroProtocolo: "",
    observacoes: ""
  })

  // Hook de upload
  const { startUpload, isUploading } = useUploadThing("anexoUploader", {
    onUploadProgress: (progress) => {
      setUploadProgress(progress)
    },
    onClientUploadComplete: async (res) => {
      if (res && uploadingProtocoloId) {
        // Salvar cada arquivo no banco
        for (const file of res) {
          try {
            await fetch(`/api/protocolos/${uploadingProtocoloId}/anexos`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                nome: file.name,
                nomeArquivo: file.name,
                urlArquivo: file.url,
                tamanho: file.size,
                mimeType: file.type || null
              })
            })
          } catch (error) {
            console.error("Erro ao salvar anexo:", error)
          }
        }
        
        // Limpar arquivos pendentes desse protocolo
        setArquivosPendentes(prev => {
          const novo = { ...prev }
          delete novo[uploadingProtocoloId]
          return novo
        })
        
        setUploadingProtocoloId(null)
        setUploadProgress(0)
        fetchProtocolos()
      }
    },
    onUploadError: (error) => {
      alert(`Erro no upload: ${error.message}`)
      setUploadingProtocoloId(null)
      setUploadProgress(0)
    },
  })

  // Buscar protocolos
  const fetchProtocolos = async () => {
    try {
      const response = await fetch(`/api/protocolos?processoId=${processoId}`)
      const data = await response.json()
      if (data.protocolos) {
        // Buscar anexos para cada protocolo
        const protocolosComAnexos = await Promise.all(
          data.protocolos.map(async (protocolo: Protocolo) => {
            try {
              const anexosRes = await fetch(`/api/protocolos/${protocolo.id}/anexos`)
              const anexosData = await anexosRes.json()
              return { ...protocolo, anexos: anexosData.anexos || [] }
            } catch {
              return { ...protocolo, anexos: [] }
            }
          })
        )
        setProtocolos(protocolosComAnexos)
      }
    } catch (error) {
      console.error("Erro ao buscar protocolos:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (processoId) {
      fetchProtocolos()
    }
  }, [processoId])

  // Resetar form
  const resetForm = () => {
    setForm({
      tipoPessoa: "contratante",
      pessoaId: "",
      consulado: "",
      consuladoOutro: "",
      dataProtocolo: "",
      numeroProtocolo: "",
      observacoes: ""
    })
    setEditando(null)
    setShowForm(false)
  }

  // Abrir edição
  const abrirEdicao = (protocolo: Protocolo) => {
    setEditando(protocolo)
    setForm({
      tipoPessoa: protocolo.contratanteId ? "contratante" : "requerente",
      pessoaId: (protocolo.contratanteId || protocolo.requerenteId || "").toString(),
      consulado: protocolo.consulado,
      consuladoOutro: protocolo.consuladoOutro || "",
      dataProtocolo: protocolo.dataProtocolo ? protocolo.dataProtocolo.split("T")[0] : "",
      numeroProtocolo: protocolo.numeroProtocolo || "",
      observacoes: protocolo.observacoes || ""
    })
    setShowForm(true)
  }

  // Salvar (criar ou atualizar)
  const handleSalvar = async () => {
    if (!form.pessoaId || !form.consulado) {
      alert("Preencha a pessoa e o consulado")
      return
    }

    if (form.consulado === "OUTROS" && !form.consuladoOutro) {
      alert("Informe o nome do consulado")
      return
    }

    setSalvando(true)
    try {
      const payload = {
        processoId,
        contratanteId: form.tipoPessoa === "contratante" ? parseInt(form.pessoaId) : null,
        requerenteId: form.tipoPessoa === "requerente" ? parseInt(form.pessoaId) : null,
        consulado: form.consulado,
        consuladoOutro: form.consulado === "OUTROS" ? form.consuladoOutro : null,
        dataProtocolo: form.dataProtocolo || null,
        numeroProtocolo: form.numeroProtocolo || null,
        observacoes: form.observacoes || null
      }

      const url = editando 
        ? `/api/protocolos/${editando.id}`
        : "/api/protocolos"
      
      const method = editando ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        resetForm()
        fetchProtocolos()
        onUpdate?.()
      } else {
        const data = await response.json()
        alert(data.error || "Erro ao salvar protocolo")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      alert("Erro ao salvar protocolo")
    } finally {
      setSalvando(false)
    }
  }

  // Excluir protocolo
  const handleExcluir = async (id: number) => {
    if (!confirm("Excluir este protocolo e todos os seus anexos?")) return

    try {
      const response = await fetch(`/api/protocolos/${id}`, {
        method: "DELETE"
      })

      if (response.ok) {
        fetchProtocolos()
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao excluir:", error)
    }
  }

  // Excluir anexo
  const handleExcluirAnexo = async (protocoloId: number, anexoId: number) => {
    if (!confirm("Excluir este anexo?")) return

    try {
      const response = await fetch(`/api/protocolos/${protocoloId}/anexos/${anexoId}`, {
        method: "DELETE"
      })

      if (response.ok) {
        fetchProtocolos()
      }
    } catch (error) {
      console.error("Erro ao excluir anexo:", error)
    }
  }

  // Selecionar arquivos
  const handleFileSelect = (protocoloId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const novosArquivos = Array.from(e.target.files)
      setArquivosPendentes(prev => ({
        ...prev,
        [protocoloId]: [...(prev[protocoloId] || []), ...novosArquivos]
      }))
    }
  }

  // Remover arquivo pendente
  const removerArquivoPendente = (protocoloId: number, index: number) => {
    setArquivosPendentes(prev => ({
      ...prev,
      [protocoloId]: prev[protocoloId].filter((_, i) => i !== index)
    }))
  }

  // Fazer upload
  const handleUpload = async (protocoloId: number) => {
    const arquivos = arquivosPendentes[protocoloId]
    if (!arquivos || arquivos.length === 0) return
    
    setUploadingProtocoloId(protocoloId)
    await startUpload(arquivos)
  }

  // Obter nome da pessoa do protocolo
  const getNomePessoa = (protocolo: Protocolo) => {
    if (protocolo.contratante) return protocolo.contratante.nome
    if (protocolo.requerente) return protocolo.requerente.nome
    return "Pessoa não encontrada"
  }

  // Obter tipo da pessoa
  const getTipoPessoa = (protocolo: Protocolo) => {
    if (protocolo.contratanteId) return "Contratante"
    if (protocolo.requerenteId) return "Requerente"
    return ""
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-orange-600" />
          <h3 className="font-semibold text-gray-900">Protocolos</h3>
          {protocolos.length > 0 && (
            <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-medium rounded-full">
              {protocolos.length}
            </span>
          )}
        </div>
        <Button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          size="sm"
          className={`bg-orange-600 hover:bg-orange-700 ${!podeEditar ? 'hidden' : ''}`}
        >
          <Plus className="h-4 w-4 mr-1" />
          Novo Protocolo
        </Button>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : showForm ? (
          /* ===== FORMULÁRIO ===== */
          <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h4 className="font-semibold text-gray-900">
                {editando ? "Editar Protocolo" : "Novo Protocolo"}
              </h4>
              <button
                onClick={resetForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Pessoa */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="h-4 w-4 inline mr-1" />
                  Pessoa
                </label>
                <select
                  value={`${form.tipoPessoa}-${form.pessoaId}`}
                  onChange={(e) => {
                    const [tipo, id] = e.target.value.split("-")
                    setForm({
                      ...form,
                      tipoPessoa: tipo as "contratante" | "requerente",
                      pessoaId: id
                    })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Selecione uma pessoa</option>
                  {contratantes.length > 0 && (
                    <optgroup label="Contratantes">
                      {contratantes.map(c => (
                        <option key={`c-${c.id}`} value={`contratante-${c.id}`}>
                          {c.nome}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {requerentes.length > 0 && (
                    <optgroup label="Requerentes">
                      {requerentes.map(r => (
                        <option key={`r-${r.id}`} value={`requerente-${r.id}`}>
                          {r.nome}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Consulado */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building2 className="h-4 w-4 inline mr-1" />
                  Consulado
                </label>
                <select
                  value={form.consulado}
                  onChange={(e) => setForm({ ...form, consulado: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Selecione o consulado</option>
                  {CONSULADOS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Consulado Outro */}
              {form.consulado === "OUTROS" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome do Consulado
                  </label>
                  <Input
                    value={form.consuladoOutro}
                    onChange={(e) => setForm({ ...form, consuladoOutro: e.target.value })}
                    placeholder="Digite o nome do consulado"
                  />
                </div>
              )}

              {/* Data */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Data do Protocolo
                </label>
                <DatePickerField
                  value={form.dataProtocolo}
                  onChange={(value) => setForm({ ...form, dataProtocolo: value })}
                />
              </div>

              {/* Número */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Hash className="h-4 w-4 inline mr-1" />
                  Número do Protocolo
                </label>
                <Input
                  value={form.numeroProtocolo}
                  onChange={(e) => setForm({ ...form, numeroProtocolo: e.target.value })}
                  placeholder="Ex: M8371/2"
                />
              </div>

              {/* Observações */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={form.observacoes}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                  placeholder="Anotações sobre o protocolo..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  rows={3}
                />
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleSalvar}
                  disabled={salvando}
                  className="flex-1 bg-orange-600 hover:bg-orange-700"
                >
                  {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editando ? "Salvar Alterações" : "Criar Protocolo"}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetForm}
                  disabled={salvando}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        ) : protocolos.length === 0 ? (
          /* ===== EMPTY STATE ===== */
          <div className="text-center py-12">
            <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-700">Nenhum protocolo cadastrado</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              {podeEditar 
                ? "Cadastre os protocolos de solicitação de nacionalidade"
                : "Ainda não há protocolos cadastrados para este processo"
              }
            </p>
            {podeEditar && (
              <Button
                onClick={() => setShowForm(true)}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Primeiro Protocolo
              </Button>
            )}
          </div>
        ) : (
          /* ===== LISTA DE PROTOCOLOS ===== */
          <div className="space-y-4">
            {protocolos.map((protocolo) => {
              const anexos = protocolo.anexos || []
              const arquivosPendentesProtocolo = arquivosPendentes[protocolo.id] || []
              const isUploadingThis = uploadingProtocoloId === protocolo.id
              
              return (
                <div
                  key={protocolo.id}
                  className="bg-white border border-gray-200 rounded-lg overflow-hidden"
                >
                  {/* Card principal */}
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Nome da pessoa */}
                        <div className="flex items-center gap-2 mb-2">
                          <User className="h-4 w-4 text-gray-500" />
                          <span className="font-semibold text-gray-900">
                            {getNomePessoa(protocolo)}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {getTipoPessoa(protocolo)}
                          </span>
                        </div>

                        {/* Info do protocolo */}
                        <div className="grid grid-cols-2 gap-3 text-sm ml-5">
                          {/* Consulado */}
                          <div className="flex items-center gap-2 text-gray-600">
                            <Building2 className="h-4 w-4 text-gray-400" />
                            <span>{getConsuladoLabel(protocolo.consulado, protocolo.consuladoOutro)}</span>
                          </div>

                          {/* Data */}
                          {protocolo.dataProtocolo && (
                            <div className="flex items-center gap-2 text-gray-600">
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span>
                                {new Date(protocolo.dataProtocolo).toLocaleDateString("pt-BR")}
                              </span>
                            </div>
                          )}

                          {/* Número */}
                          {protocolo.numeroProtocolo && (
                            <div className="flex items-center gap-2 text-gray-600">
                              <Hash className="h-4 w-4 text-gray-400" />
                              <span className="font-mono">{protocolo.numeroProtocolo}</span>
                            </div>
                          )}
                        </div>

                        {/* Observações */}
                        {protocolo.observacoes && (
                          <p className="text-sm text-gray-500 mt-2 ml-5 italic">
                            {protocolo.observacoes}
                          </p>
                        )}
                      </div>

                      {/* Ações - Apenas para quem pode editar */}
                      {podeEditar && (
                        <div className="flex items-center gap-1 ml-4">
                          <button
                            onClick={() => abrirEdicao(protocolo)}
                            className="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50"
                            title="Editar"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleExcluir(protocolo.id)}
                            className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Seção de Anexos */}
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-3">
                        <Paperclip className="h-4 w-4" />
                        Anexos
                        {anexos.length > 0 && (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">
                            {anexos.length}
                          </span>
                        )}
                      </h4>

                      {/* Grid de anexos existentes */}
                      {anexos.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
                          {anexos.map((anexo) => {
                            const isImage = anexo.mimeType?.startsWith("image/")
                            const isPDF = anexo.mimeType === "application/pdf"
                            
                            return (
                              <div
                                key={anexo.id}
                                className="group relative bg-gray-50 rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                              >
                                {/* Preview */}
                                <a
                                  href={anexo.urlArquivo}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block aspect-square relative overflow-hidden"
                                >
                                  {isImage ? (
                                    <img
                                      src={anexo.urlArquivo}
                                      alt={anexo.nome}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                      {isPDF ? (
                                        <div className="w-12 h-14 bg-red-600 rounded-sm flex items-center justify-center text-white text-xs font-bold">
                                          PDF
                                        </div>
                                      ) : (
                                        <FileText className="h-12 w-12 text-gray-400" />
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Overlay */}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                    <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </a>
                                
                                {/* Info */}
                                <div className="p-2 border-t border-gray-200">
                                  <p className="text-xs text-gray-700 truncate" title={anexo.nome}>
                                    {anexo.nome}
                                  </p>
                                  {anexo.tamanho && (
                                    <p className="text-xs text-gray-400">{formatFileSize(anexo.tamanho)}</p>
                                  )}
                                </div>
                                
                                {/* Botão remover - apenas para quem pode editar */}
                                {podeEditar && (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      handleExcluirAnexo(protocolo.id, anexo.id)
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
                      )}

                      {/* Arquivos selecionados (pendentes de upload) - apenas para quem pode editar */}
                      {podeEditar && arquivosPendentesProtocolo.length > 0 && (
                        <div className="mb-4 space-y-2">
                          <p className="text-sm text-gray-600 font-medium">Arquivos selecionados:</p>
                          {arquivosPendentesProtocolo.map((arquivo, index) => (
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
                                onClick={() => removerArquivoPendente(protocolo.id, index)}
                                className="p-1 hover:bg-red-100 rounded text-red-500"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                          
                          {/* Botão de Upload */}
                          <button
                            type="button"
                            onClick={() => handleUpload(protocolo.id)}
                            disabled={isUploading}
                            className="mt-2 w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                          >
                            {isUploadingThis ? (
                              <span className="flex items-center justify-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Enviando... {uploadProgress}%
                              </span>
                            ) : (
                              `Enviar ${arquivosPendentesProtocolo.length} arquivo(s)`
                            )}
                          </button>
                        </div>
                      )}

                      {/* Área de drop/seleção - apenas para quem pode editar */}
                      {podeEditar && (
                        <label className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors block">
                          <input
                            type="file"
                            multiple
                            onChange={(e) => handleFileSelect(protocolo.id, e)}
                            className="hidden"
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                          />
                          <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                          <p className="text-sm text-gray-600 font-medium">Clique para selecionar arquivos</p>
                          <p className="text-xs text-gray-400 mt-1">Imagens, PDF, Word, Excel (máx. 64MB cada)</p>
                        </label>
                      )}
                      
                      {/* Mensagem quando não pode editar e não tem anexos */}
                      {!podeEditar && anexos.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">Nenhum anexo</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}