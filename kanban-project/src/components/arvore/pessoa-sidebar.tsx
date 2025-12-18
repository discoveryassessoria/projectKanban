"use client"

import { useState } from "react"
import { PersonIcon } from "./pessoa-icon"
import { PessoaArvore, UniaoArvore } from "./pessoa-card"
import { X, Star, Share2, User, GitBranch, Plus, Pencil, Trash2 } from "lucide-react"

interface PessoaSidebarProps {
  pessoa: PessoaArvore | null
  conjuge?: PessoaArvore | null
  casamento?: UniaoArvore | null
  onClose: () => void
  onOpenFullDetails: (pessoa: PessoaArvore) => void
  onEdit?: (pessoa: PessoaArvore) => void
  onDelete?: (pessoa: PessoaArvore) => void
}

function formatDateFull(date: Date | string | null | undefined): string {
  if (!date) return ""
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatYear(date: Date | string | null | undefined): string {
  if (!date) return ""
  return new Date(date).getFullYear().toString()
}

export function PessoaSidebar({ pessoa, conjuge, casamento, onClose, onOpenFullDetails, onEdit, onDelete }: PessoaSidebarProps) {
  const [activeTab, setActiveTab] = useState<"pessoa" | "arvore">("pessoa")
  const [confirmDelete, setConfirmDelete] = useState(false)
  
  if (!pessoa) return null
  
  const nomeCompleto = pessoa.sobrenome ? `${pessoa.nome} ${pessoa.sobrenome}` : pessoa.nome

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete?.(pessoa)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
    }
  }
  
  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-[10001] overflow-y-auto border-l border-gray-200">
      {/* Botão fechar */}
      <button 
        onClick={onClose}
        className="absolute top-4 right-4 p-1 hover:bg-gray-100 rounded-full transition-colors z-10"
      >
        <X className="h-6 w-6 text-gray-500" />
      </button>
      
      {/* Header com info da pessoa */}
      <div className="p-6 pb-4">
        <div className="flex items-start gap-4">
          <PersonIcon gender={pessoa.sexo} size={56} />
          <div>
            <h2 
              className="text-xl font-semibold text-gray-900 hover:text-teal-600 cursor-pointer transition-colors"
              onClick={() => onOpenFullDetails(pessoa)}
            >
              {nomeCompleto}
            </h2>
            <p className="text-sm text-gray-500">ID: {pessoa.id}</p>
          </div>
        </div>
        
        {/* Info de nascimento e falecimento */}
        <div className="mt-4 text-sm text-gray-700">
          {pessoa.data_nasc && (
            <>
              <p><span className="font-semibold">Nascimento:</span> {formatDateFull(pessoa.data_nasc)}</p>
              {pessoa.local_nasc && <p className="text-gray-600">{pessoa.local_nasc}</p>}
            </>
          )}
        </div>
        {pessoa.data_obito && (
          <div className="mt-2 text-sm text-gray-700">
            <p><span className="font-semibold">Falecimento:</span> {formatDateFull(pessoa.data_obito)}</p>
          </div>
        )}
        
        {/* Botões de ação */}
        <div className="mt-4 flex items-center gap-2">
          <button 
            onClick={() => onEdit?.(pessoa)}
            className="flex items-center gap-2 px-3 py-2 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            <span className="text-sm font-medium">Editar</span>
          </button>
          <button 
            onClick={handleDelete}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              confirmDelete 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'bg-red-50 text-red-600 hover:bg-red-100'
            }`}
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm font-medium">{confirmDelete ? 'Confirmar?' : 'Excluir'}</span>
          </button>
          {confirmDelete && (
            <button 
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
      
      {/* Divisor */}
      <div className="border-t border-gray-200" />
      
      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("pessoa")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
              activeTab === "pessoa" 
                ? 'border-teal-500 bg-teal-50 text-teal-700' 
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <User className="h-4 w-4" />
            <span className="font-medium">PESSOA</span>
          </button>
          <button
            onClick={() => setActiveTab("arvore")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
              activeTab === "arvore" 
                ? 'border-teal-500 bg-teal-50 text-teal-700' 
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            <GitBranch className="h-4 w-4" />
            <span className="font-medium">ÁRVORE</span>
          </button>
        </div>
      </div>
      
      {/* Conteúdo da tab PESSOA */}
      {activeTab === "pessoa" && (
        <div className="p-6">
          {/* Dados vitais */}
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Dados vitais</h3>
          
          {/* Nascimento */}
          <div className="mb-4">
            <p className="font-semibold text-gray-900">
              Nascimento <span className="font-normal text-gray-500">• 0 Fonte</span>
            </p>
            {pessoa.data_nasc ? (
              <>
                <p className="text-gray-700">{formatDateFull(pessoa.data_nasc)}</p>
                {pessoa.local_nasc && <p className="text-gray-600">{pessoa.local_nasc}</p>}
              </>
            ) : (
              <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700 mt-1">
                <Plus className="h-4 w-4" />
                <span>ACRESCENTAR</span>
              </button>
            )}
          </div>
          
          {/* Batizado */}
          <div className="mb-4">
            <p className="font-semibold text-gray-900">Batizado</p>
            {pessoa.batizado ? (
              <p className="text-gray-700">{pessoa.batizado}</p>
            ) : (
              <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700 mt-1">
                <Plus className="h-4 w-4" />
                <span>ACRESCENTAR</span>
              </button>
            )}
          </div>
          
          {/* Falecimento */}
          <div className="mb-4">
            <p className="font-semibold text-gray-900">
              Falecimento <span className="font-normal text-gray-500">• 0 Fonte</span>
            </p>
            {pessoa.data_obito ? (
              <p className="text-gray-700">{formatDateFull(pessoa.data_obito)}</p>
            ) : (
              <p className="text-gray-500">Não informado</p>
            )}
          </div>
          
          {/* Sepultamento */}
          <div className="mb-6">
            <p className="font-semibold text-gray-900">Sepultamento</p>
            <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700 mt-1">
              <Plus className="h-4 w-4" />
              <span>ACRESCENTAR</span>
            </button>
          </div>
          
          {/* Divisor */}
          <div className="border-t border-gray-200 my-6" />
          
          {/* Sexo */}
          <div className="mb-4">
            <p className="font-semibold text-gray-900">Sexo</p>
            <p className="text-gray-700">{pessoa.sexo || 'Não informado'}</p>
          </div>
          
          {/* Divisor */}
          <div className="border-t border-gray-200 my-6" />
          
          {/* Eventos */}
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Eventos (0)</h3>
          <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700 mb-6">
            <Plus className="h-4 w-4" />
            <span>ACRESCENTAR EVENTO</span>
          </button>
          
          {/* Divisor */}
          <div className="border-t border-gray-200 my-6" />
          
          {/* Comentário */}
          {pessoa.comentario && (
            <div className="mb-4">
              <p className="font-semibold text-gray-900">Comentário</p>
              <p className="text-gray-600 text-sm mt-1">{pessoa.comentario}</p>
            </div>
          )}
        </div>
      )}
      
      {/* Conteúdo da tab ÁRVORE */}
      {activeTab === "arvore" && (
        <div className="p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Família</h3>
          
          {/* Pais */}
          <div className="mb-6">
            <p className="text-sm text-gray-500 mb-2">Pais</p>
            {pessoa.pai || pessoa.mae ? (
              <div className="space-y-2">
                {pessoa.pai && (
                  <div className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                    <PersonIcon gender="masculino" size={32} />
                    <div>
                      <p className="font-medium text-gray-900">{pessoa.pai.nome} {pessoa.pai.sobrenome}</p>
                      <p className="text-sm text-gray-500">Pai</p>
                    </div>
                  </div>
                )}
                {pessoa.mae && (
                  <div className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                    <PersonIcon gender="feminino" size={32} />
                    <div>
                      <p className="font-medium text-gray-900">{pessoa.mae.nome} {pessoa.mae.sobrenome}</p>
                      <p className="text-sm text-gray-500">Mãe</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                <Plus className="h-4 w-4" />
                <span>ACRESCENTAR PAIS</span>
              </button>
            )}
          </div>
          
          {/* Cônjuge */}
          <div className="mb-6">
            <p className="text-sm text-gray-500 mb-2">Cônjuge</p>
            {conjuge ? (
              <div className="flex items-center gap-3 py-2 px-3 bg-gray-50 rounded-lg">
                <PersonIcon gender={conjuge.sexo} size={32} />
                <div>
                  <p className="font-medium text-gray-900">{conjuge.nome} {conjuge.sobrenome}</p>
                  {casamento?.data_inicio && (
                    <p className="text-sm text-gray-500">Casamento: {formatDateFull(casamento.data_inicio)}</p>
                  )}
                </div>
              </div>
            ) : (
              <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
                <Plus className="h-4 w-4" />
                <span>ACRESCENTAR CÔNJUGE</span>
              </button>
            )}
          </div>
          
          {/* Filhos */}
          <div className="mb-6">
            <p className="text-sm text-gray-500 mb-2">Filhos</p>
            <button className="flex items-center gap-1 text-teal-600 hover:text-teal-700">
              <Plus className="h-4 w-4" />
              <span>ACRESCENTAR FILHO(A)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}