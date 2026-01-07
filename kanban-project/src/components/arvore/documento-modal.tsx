"use client"

import { useState, useCallback, useEffect } from "react"
import { X, FileText, Upload, File, Trash2, Eye, Loader2 } from "lucide-react"
import { useUploadThing } from "@/src/lib/uploadthing"

// Tipos de documento
const TIPO_DOCUMENTO_OPTIONS = [
  { value: 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR', label: 'Certidão de Nascimento (Inteiro Teor)' },
  { value: 'CERTIDAO_CASAMENTO_INTEIRO_TEOR', label: 'Certidão de Casamento (Inteiro Teor)' },
  { value: 'CERTIDAO_OBITO_INTEIRO_TEOR', label: 'Certidão de Óbito (Inteiro Teor)' },
  { value: 'CERTIDAO_BATISMO', label: 'Certidão de Batismo' },
  { value: 'CNN', label: 'Certidão Negativa de Naturalização (CNN)' },
  { value: 'RG', label: 'RG' },
  { value: 'CPF', label: 'CPF' },
  { value: 'OUTRO', label: 'Outro' },
]

const STATUS_OPTIONS = [
  { value: 'PENDENTE', label: 'Pendente' },
  { value: 'SOLICITADO', label: 'Solicitado' },
  { value: 'RECEBIDO', label: 'Recebido' },
]

interface UploadedFile {
  url: string
  name: string
}

// Usar o tipo do types.ts diretamente
import type { DocumentoArvore } from "./types"

interface DocumentoModalProps {
  pessoaId: number
  pessoaNome: string
  documento?: DocumentoArvore | null  // Se passar, é edição
  onClose: () => void
  onSuccess: () => void
}

// Componente de Upload reutilizável
function FileUploadZone({
  onFileUploaded,
  label,
  colorScheme = "teal"
}: {
  onFileUploaded: (file: UploadedFile) => void
  label: string
  colorScheme?: "teal" | "cyan" | "purple"
}) {
  const [isUploading, setIsUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const { startUpload } = useUploadThing("anexoUploader", {
    onClientUploadComplete: (res) => {
      if (res && res[0]) {
        onFileUploaded({
          url: res[0].url,
          name: res[0].name
        })
      }
      setIsUploading(false)
    },
    onUploadError: (error) => {
      alert(`Erro no upload: ${error.message}`)
      setIsUploading(false)
    },
  })

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    setIsUploading(true)
    startUpload(Array.from(files))
  }, [startUpload])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const colors = {
    teal: {
      border: dragActive ? "border-teal-400" : "border-gray-300",
      bg: dragActive ? "bg-teal-50" : "bg-gray-50",
      text: "text-teal-600",
      icon: "text-teal-500"
    },
    cyan: {
      border: dragActive ? "border-cyan-400" : "border-gray-300",
      bg: dragActive ? "bg-cyan-50" : "bg-gray-50",
      text: "text-cyan-600",
      icon: "text-cyan-500"
    },
    purple: {
      border: dragActive ? "border-purple-400" : "border-gray-300",
      bg: dragActive ? "bg-purple-50" : "bg-gray-50",
      text: "text-purple-600",
      icon: "text-purple-500"
    }
  }

  const scheme = colors[colorScheme]

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${scheme.border} ${scheme.bg}`}
    >
      {isUploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className={`w-8 h-8 animate-spin ${scheme.icon}`} />
          <span className="text-sm text-gray-600">Enviando...</span>
        </div>
      ) : (
        <label className="cursor-pointer flex flex-col items-center gap-2">
          <Upload className={`w-8 h-8 ${scheme.icon}`} />
          <span className={`text-sm font-medium ${scheme.text}`}>{label}</span>
          <span className="text-xs text-gray-500">Clique ou arraste o arquivo</span>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      )}
    </div>
  )
}

// Componente de Preview de arquivo
function FilePreview({
  file,
  label,
  onRemove
}: {
  file: UploadedFile
  label: string
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
      <File className="w-8 h-8 text-green-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
        <p className="text-xs text-green-600">{label}</p>
      </div>
      <div className="flex gap-1">
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 hover:bg-green-100 rounded-lg transition-colors"
          title="Visualizar"
        >
          <Eye className="w-4 h-4 text-green-600" />
        </a>
        <button
          type="button"
          onClick={onRemove}
          className="p-2 hover:bg-red-100 rounded-lg transition-colors"
          title="Remover"
        >
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>
    </div>
  )
}

export function DocumentoModal({
  pessoaId,
  pessoaNome,
  documento,
  onClose,
  onSuccess
}: DocumentoModalProps) {
  const isEditing = !!documento
  const [saving, setSaving] = useState(false)
  
  // Campos do formulário
  const [tipo, setTipo] = useState(documento?.tipo || 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR')
  const [status, setStatus] = useState(documento?.status || 'PENDENTE')
  const [descricao, setDescricao] = useState(documento?.descricao || '')
  const [cartorio, setCartorio] = useState(documento?.cartorio || '')
  const [livro, setLivro] = useState(documento?.livro || '')
  const [folha, setFolha] = useState(documento?.folha || '')
  const [termo, setTermo] = useState(documento?.termo || '')
  const [dataEmissao, setDataEmissao] = useState(
    documento?.data_emissao 
      ? String(documento.data_emissao).split('T')[0] 
      : ''
  )
  const [traduzido, setTraduzido] = useState(documento?.traduzido || false)
  const [apostilado, setApostilado] = useState(documento?.apostilado || false)
  const [dataTraducao, setDataTraducao] = useState(
    documento?.data_traducao 
      ? String(documento.data_traducao).split('T')[0] 
      : ''
  )
  const [dataApostilamento, setDataApostilamento] = useState(
    documento?.data_apostilamento 
      ? String(documento.data_apostilamento).split('T')[0] 
      : ''
  )
  const [observacoes, setObservacoes] = useState(documento?.observacoes || '')
  
  // Arquivos
  const [arquivoOriginal, setArquivoOriginal] = useState<UploadedFile | null>(
    documento?.arquivo_url ? { url: documento.arquivo_url, name: documento.arquivo_nome || 'Arquivo' } : null
  )
  const [arquivoTraducao, setArquivoTraducao] = useState<UploadedFile | null>(
    documento?.arquivo_traducao_url ? { url: documento.arquivo_traducao_url, name: documento.arquivo_traducao_nome || 'Tradução' } : null
  )
  const [arquivoApostila, setArquivoApostila] = useState<UploadedFile | null>(
    documento?.arquivo_apostila_url ? { url: documento.arquivo_apostila_url, name: 'Apostila' } : null
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setSaving(true)
    try {
      const body = {
        tipo,
        status,
        descricao: descricao.trim() || null,
        cartorio: cartorio.trim() || null,
        livro: livro.trim() || null,
        folha: folha.trim() || null,
        termo: termo.trim() || null,
        data_emissao: dataEmissao || null,
        traduzido,
        apostilado,
        data_traducao: traduzido && dataTraducao ? dataTraducao : null,
        data_apostilamento: apostilado && dataApostilamento ? dataApostilamento : null,
        observacoes: observacoes.trim() || null,
        pessoaId,
        // Arquivos
        arquivo_url: arquivoOriginal?.url || null,
        arquivo_nome: arquivoOriginal?.name || null,
        arquivo_traducao_url: arquivoTraducao?.url || null,
        arquivo_traducao_nome: arquivoTraducao?.name || null,
        arquivo_apostila_url: arquivoApostila?.url || null,
      }

      const url = isEditing ? `/api/documentos/${documento.id}` : '/api/documentos'
      const method = isEditing ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        onSuccess()
      } else {
        const error = await response.json()
        alert(error.error || `Erro ao ${isEditing ? 'atualizar' : 'adicionar'} documento`)
      }
    } catch (error) {
      console.error(`Erro ao ${isEditing ? 'atualizar' : 'adicionar'} documento:`, error)
      alert(`Erro ao ${isEditing ? 'atualizar' : 'adicionar'} documento`)
    } finally {
      setSaving(false)
    }
  }

  // Verifica se o tipo é uma certidão (para mostrar campos específicos)
  const isCertidao = tipo.includes('CERTIDAO')

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[10003]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[10004] w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-100 rounded-lg">
              <FileText className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isEditing ? 'Editar Documento' : 'Adicionar Documento'}
              </h2>
              <p className="text-sm text-gray-500">{pessoaNome}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body - Scrollable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Tipo e Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo de Documento *
                </label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  required
                >
                  {TIPO_DOCUMENTO_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status *
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  required
                >
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Descrição */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descrição
              </label>
              <input
                type="text"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Ex: Segunda via, Inteiro teor..."
              />
            </div>

            {/* Campos de Certidão */}
            {isCertidao && (
              <div className="p-4 bg-gray-50 rounded-lg space-y-4">
                <h3 className="text-sm font-medium text-gray-700">Dados da Certidão</h3>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cartório
                  </label>
                  <input
                    type="text"
                    value={cartorio}
                    onChange={(e) => setCartorio(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="Nome do cartório"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Livro
                    </label>
                    <input
                      type="text"
                      value={livro}
                      onChange={(e) => setLivro(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Ex: B2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Folha
                    </label>
                    <input
                      type="text"
                      value={folha}
                      onChange={(e) => setFolha(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Ex: 123"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Termo
                    </label>
                    <input
                      type="text"
                      value={termo}
                      onChange={(e) => setTermo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Ex: 456"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Data de Emissão */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Data de Emissão
              </label>
              <input
                type="date"
                value={dataEmissao}
                onChange={(e) => setDataEmissao(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            {/* Upload do Documento Original */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Documento Original (PDF/Imagem)
              </label>
              {arquivoOriginal ? (
                <FilePreview
                  file={arquivoOriginal}
                  label="Documento original enviado"
                  onRemove={() => setArquivoOriginal(null)}
                />
              ) : (
                <FileUploadZone
                  label="Enviar documento original"
                  onFileUploaded={setArquivoOriginal}
                  colorScheme="teal"
                />
              )}
            </div>

            {/* Tradução */}
            <div className="p-4 bg-cyan-50 rounded-lg space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="traduzido"
                  checked={traduzido}
                  onChange={(e) => setTraduzido(e.target.checked)}
                  className="w-4 h-4 text-cyan-600 border-gray-300 rounded focus:ring-cyan-500"
                />
                <label htmlFor="traduzido" className="text-sm font-medium text-gray-700">
                  Documento traduzido
                </label>
              </div>

              {traduzido && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Data da Tradução
                    </label>
                    <input
                      type="date"
                      value={dataTraducao}
                      onChange={(e) => setDataTraducao(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Arquivo da Tradução
                    </label>
                    {arquivoTraducao ? (
                      <FilePreview
                        file={arquivoTraducao}
                        label="Tradução enviada"
                        onRemove={() => setArquivoTraducao(null)}
                      />
                    ) : (
                      <FileUploadZone
                        label="Enviar tradução"
                        onFileUploaded={setArquivoTraducao}
                        colorScheme="cyan"
                      />
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Apostilamento */}
            <div className="p-4 bg-purple-50 rounded-lg space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="apostilado"
                  checked={apostilado}
                  onChange={(e) => setApostilado(e.target.checked)}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="apostilado" className="text-sm font-medium text-gray-700">
                  Documento apostilado
                </label>
              </div>

              {apostilado && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Data do Apostilamento
                    </label>
                    <input
                      type="date"
                      value={dataApostilamento}
                      onChange={(e) => setDataApostilamento(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Arquivo da Apostila
                    </label>
                    {arquivoApostila ? (
                      <FilePreview
                        file={arquivoApostila}
                        label="Apostila enviada"
                        onRemove={() => setArquivoApostila(null)}
                      />
                    ) : (
                      <FileUploadZone
                        label="Enviar apostila"
                        onFileUploaded={setArquivoApostila}
                        colorScheme="purple"
                      />
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Observações */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Observações
              </label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                placeholder="Observações adicionais..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Salvando...' : (isEditing ? 'Salvar Alterações' : 'Adicionar Documento')}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

// Manter compatibilidade com o nome antigo
export { DocumentoModal as AddDocumentoModal }