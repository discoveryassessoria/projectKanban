// src/components/kanban/ProcessoInformacoes.tsx

"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { uploadFiles } from "@/src/lib/storage"
import {
  Plus,
  FileText,
  Calendar,
  Hash,
  Trash2,
  Loader2,
  Edit2,
  X,
  Building2,
  Paperclip,
  Eye,
  Gavel,
  Info
} from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"

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

interface InformacaoItalia {
  id: number
  processoId: number
  tribunal: string
  dataProtocolo?: string | null
  dataDistribuicao?: string | null
  numeroRuoloGenerale?: string | null
  observacoes?: string | null
  anexos?: Anexo[]
  createdAt: string
}

interface ProcessoInformacoesProps {
  processoId: number
  onUpdate?: () => void
}

// Lista de tribunais da Itália
const TRIBUNAIS = [
  { value: "ANCONA", label: "Tribunal de Ancona" },
  { value: "BARI", label: "Tribunal de Bari" },
  { value: "BOLOGNA", label: "Tribunal de Bologna" },
  { value: "BRESCIA", label: "Tribunal de Brescia" },
  { value: "CAGLIARI", label: "Tribunal de Cagliari" },
  { value: "CALTANISSETTA", label: "Tribunal de Caltanissetta" },
  { value: "CAMPOBASSO", label: "Tribunal de Campobasso" },
  { value: "CATANIA", label: "Tribunal de Catania" },
  { value: "CATANZARO", label: "Tribunal de Catanzaro" },
  { value: "FIRENZE", label: "Tribunal de Firenze" },
  { value: "GENOVA", label: "Tribunal de Genova" },
  { value: "L_AQUILA", label: "Tribunal de L'Aquila" },
  { value: "LECCE", label: "Tribunal de Lecce" },
  { value: "MESSINA", label: "Tribunal de Messina" },
  { value: "MILANO", label: "Tribunal de Milano" },
  { value: "NAPOLI", label: "Tribunal de Napoli" },
  { value: "PALERMO", label: "Tribunal de Palermo" },
  { value: "PERUGIA", label: "Tribunal de Perugia" },
  { value: "POTENZA", label: "Tribunal de Potenza" },
  { value: "REGGIO_CALABRIA", label: "Tribunal de Reggio Calabria" },
  { value: "ROMA", label: "Tribunal de Roma" },
  { value: "SALERNO", label: "Tribunal de Salerno" },
  { value: "TORINO", label: "Tribunal de Torino" },
  { value: "TRENTO", label: "Tribunal de Trento" },
  { value: "TRIESTE", label: "Tribunal de Trieste" },
  { value: "VENEZIA", label: "Tribunal de Venezia" },
]

const getTribunalLabel = (value: string) => {
  return TRIBUNAIS.find(t => t.value === value)?.label || value
}

// Helper para formatar tamanho de arquivo
const formatFileSize = (bytes?: number | null) => {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProcessoInformacoes({ 
  processoId, 
  onUpdate 
}: ProcessoInformacoesProps) {
  const [informacao, setInformacao] = useState<InformacaoItalia | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  
  // Estados para upload
  const [arquivosPendentes, setArquivosPendentes] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // Verificar permissão do usuário
  const { pode } = usePermissoes()
  const podeEditar = pode('processos.editar_paginas')

  // Form state
  const [form, setForm] = useState({
    tribunal: "",
    dataProtocolo: "",
    dataDistribuicao: "",
    numeroRuoloGenerale: "",
    observacoes: ""
  })

  // Buscar informação
  const fetchInformacao = async () => {
    try {
      const response = await fetch(`/api/informacoes-italia?processoId=${processoId}`)
      const data = await response.json()
      if (data.informacao) {
        setInformacao(data.informacao)
      } else {
        setInformacao(null)
      }
    } catch (error) {
      console.error("Erro ao buscar informação:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (processoId) {
      fetchInformacao()
    }
  }, [processoId])

  // Resetar form
  const resetForm = () => {
    setForm({
      tribunal: "",
      dataProtocolo: "",
      dataDistribuicao: "",
      numeroRuoloGenerale: "",
      observacoes: ""
    })
    setEditando(false)
    setShowForm(false)
  }

  // Abrir edição
  const abrirEdicao = () => {
    if (!informacao) return
    setForm({
      tribunal: informacao.tribunal,
      dataProtocolo: informacao.dataProtocolo ? informacao.dataProtocolo.split("T")[0] : "",
      dataDistribuicao: informacao.dataDistribuicao ? informacao.dataDistribuicao.split("T")[0] : "",
      numeroRuoloGenerale: informacao.numeroRuoloGenerale || "",
      observacoes: informacao.observacoes || ""
    })
    setEditando(true)
    setShowForm(true)
  }

  // Salvar (criar ou atualizar)
  const handleSalvar = async () => {
    if (!form.tribunal) {
      alert("Selecione o tribunal")
      return
    }

    setSalvando(true)
    try {
      const payload = {
        processoId,
        tribunal: form.tribunal,
        dataProtocolo: form.dataProtocolo || null,
        dataDistribuicao: form.dataDistribuicao || null,
        numeroRuoloGenerale: form.numeroRuoloGenerale || null,
        observacoes: form.observacoes || null
      }

      const url = editando && informacao
        ? `/api/informacoes-italia/${informacao.id}`
        : "/api/informacoes-italia"
      
      const method = editando ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        resetForm()
        fetchInformacao()
        onUpdate?.()
      } else {
        const data = await response.json()
        alert(data.error || "Erro ao salvar informação")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      alert("Erro ao salvar informação")
    } finally {
      setSalvando(false)
    }
  }

  // Excluir informação
  const handleExcluir = async () => {
    if (!informacao) return
    if (!confirm("Excluir as informações e todos os anexos?")) return

    try {
      const response = await fetch(`/api/informacoes-italia/${informacao.id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
      })

      if (response.ok) {
        setInformacao(null)
        onUpdate?.()
      }
    } catch (error) {
      console.error("Erro ao excluir:", error)
    }
  }

  // Excluir anexo
  const handleExcluirAnexo = async (anexoId: number) => {
    if (!informacao) return
    if (!confirm("Excluir este anexo?")) return

    try {
      const response = await fetch(`/api/informacoes-italia/${informacao.id}/anexos/${anexoId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`
        },
      })

      if (response.ok) {
        fetchInformacao()
      }
    } catch (error) {
      console.error("Erro ao excluir anexo:", error)
    }
  }

  // Selecionar arquivos
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const novosArquivos = Array.from(e.target.files)
      setArquivosPendentes(prev => [...prev, ...novosArquivos])
    }
  }

  // Remover arquivo pendente
  const removerArquivoPendente = (index: number) => {
    setArquivosPendentes(prev => prev.filter((_, i) => i !== index))
  }

  // ⬇️ R2: Fazer upload (envia pro R2 e salva metadata na API)
  const handleUpload = async () => {
    if (arquivosPendentes.length === 0 || !informacao) return

    setUploading(true)
    setUploadProgress(0)

    try {
      const uploaded = await uploadFiles(arquivosPendentes, {
        prefix: "processos/informacoes",
        onProgress: (_f, p) => setUploadProgress(p),
      })

      for (const file of uploaded) {
        try {
          await fetch(`/api/informacoes-italia/${informacao.id}/anexos`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${localStorage.getItem("authToken")}`,
            },
            body: JSON.stringify({
              nome: file.name,
              nomeArquivo: file.name,
              urlArquivo: file.url,
              tamanho: file.size,
              mimeType: file.type || null,
            }),
          })
        } catch (error) {
          console.error("Erro ao salvar anexo:", error)
        }
      }

      setArquivosPendentes([])
      fetchInformacao()
    } catch (error: any) {
      alert(`Erro no upload: ${error.message}`)
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const anexos = informacao?.anexos || []

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-green-600" />
          <h3 className="font-semibold text-gray-900">Informações do Processo</h3>
        </div>
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
                {editando ? "Editar Informações" : "Cadastrar Informações"}
              </h4>
              <button
                onClick={resetForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Tribunal */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Building2 className="h-4 w-4 inline mr-1" />
                  Tribunal *
                </label>
                <select
                  value={form.tribunal}
                  onChange={(e) => setForm({ ...form, tribunal: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Selecione o tribunal</option>
                  {TRIBUNAIS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Data Protocolo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Data Protocolo
                </label>
                <DatePickerField
                  value={form.dataProtocolo}
                  onChange={(value) => setForm({ ...form, dataProtocolo: value })}
                />
              </div>

              {/* Data Distribuição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Calendar className="h-4 w-4 inline mr-1" />
                  Data Distribuição
                </label>
                <DatePickerField
                  value={form.dataDistribuicao}
                  onChange={(value) => setForm({ ...form, dataDistribuicao: value })}
                />
              </div>

              {/* Nº Ruolo Generale */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Hash className="h-4 w-4 inline mr-1" />
                  Nº Ruolo Generale
                </label>
                <Input
                  value={form.numeroRuoloGenerale}
                  onChange={(e) => setForm({ ...form, numeroRuoloGenerale: e.target.value })}
                  placeholder="Ex: 12345/2025"
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
                  placeholder="Anotações sobre o processo..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  rows={3}
                />
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-4">
                <Button
                  onClick={handleSalvar}
                  disabled={salvando}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editando ? "Salvar Alterações" : "Cadastrar"}
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
        ) : !informacao ? (
          /* ===== EMPTY STATE ===== */
          <div className="text-center py-12">
            <Gavel className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-medium text-gray-700">Nenhuma informação cadastrada</h3>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              {podeEditar 
                ? "Cadastre as informações do processo judicial"
                : "Ainda não há informações cadastradas para este processo"
              }
            </p>
            {podeEditar && (
              <Button
                onClick={() => setShowForm(true)}
                className="bg-green-600 hover:bg-green-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Cadastrar Informações
              </Button>
            )}
          </div>
        ) : (
          /* ===== EXIBIÇÃO DAS INFORMAÇÕES ===== */
          <div className="max-w-2xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              {/* Header do card */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                      <Gavel className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {getTribunalLabel(informacao.tribunal)}
                      </h3>
                      <p className="text-sm text-gray-500">Informações do Processo Judicial</p>
                    </div>
                  </div>
                  
                  {podeEditar && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={abrirEdicao}
                        className="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50"
                        title="Editar"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={handleExcluir}
                        className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Dados */}
              <div className="p-6">
                <div className="grid grid-cols-2 gap-6">
                  {/* Data Protocolo */}
                  <div>
                    <label className="text-xs text-gray-500 uppercase font-medium">Data Protocolo</label>
                    <p className="text-gray-900 font-medium mt-1">
                      {informacao.dataProtocolo 
                        ? new Date(informacao.dataProtocolo).toLocaleDateString("pt-BR")
                        : <span className="text-gray-400 italic">Não informada</span>
                      }
                    </p>
                  </div>

                  {/* Data Distribuição */}
                  <div>
                    <label className="text-xs text-gray-500 uppercase font-medium">Data Distribuição</label>
                    <p className="text-gray-900 font-medium mt-1">
                      {informacao.dataDistribuicao 
                        ? new Date(informacao.dataDistribuicao).toLocaleDateString("pt-BR")
                        : <span className="text-gray-400 italic">Não informada</span>
                      }
                    </p>
                  </div>

                  {/* Nº Ruolo Generale */}
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 uppercase font-medium">Nº Ruolo Generale</label>
                    <p className="text-gray-900 font-medium font-mono mt-1 text-lg">
                      {informacao.numeroRuoloGenerale || <span className="text-gray-400 italic text-base font-normal">Não informado</span>}
                    </p>
                  </div>

                  {/* Observações */}
                  {informacao.observacoes && (
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500 uppercase font-medium">Observações</label>
                      <p className="text-gray-700 mt-1 bg-gray-50 p-3 rounded-lg">
                        {informacao.observacoes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Seção de Anexos */}
                <div className="mt-6 pt-6 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-4">
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
                            
                            {/* Botão remover */}
                            {podeEditar && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault()
                                  handleExcluirAnexo(anexo.id)
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

                  {/* Arquivos pendentes de upload */}
                  {podeEditar && arquivosPendentes.length > 0 && (
                    <div className="mb-4 space-y-2">
                      <p className="text-sm text-gray-600 font-medium">Arquivos selecionados:</p>
                      {arquivosPendentes.map((arquivo, index) => (
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
                            onClick={() => removerArquivoPendente(index)}
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
                        disabled={uploading}
                        className="mt-2 w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors"
                      >
                        {uploading ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Enviando... {uploadProgress}%
                          </span>
                        ) : (
                          `Enviar ${arquivosPendentes.length} arquivo(s)`
                        )}
                      </button>
                    </div>
                  )}

                  {/* Área de drop/seleção */}
                  {podeEditar && (
                    <label className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-green-400 hover:bg-green-50/50 transition-colors block">
                      <input
                        type="file"
                        multiple
                        onChange={handleFileSelect}
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
          </div>
        )}
      </div>
    </div>
  )
}