"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Plus, 
  Search, 
  Pencil, 
  Trash2, 
  Phone, 
  Mail,
  User,
  MoreVertical,
  ChevronLeft,
  ChevronRight
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Contratante } from "@/src/types/kanban"

interface ContratantesTabelaProps {
  contratantes: Contratante[]
  onRefresh: () => void
}

export function ContratantesTabela({ contratantes, onRefresh }: ContratantesTabelaProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  
  // Form state
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    telefone: ""
  })

  const itemsPerPage = 10

  // Filtrar contratantes
  const filteredContratantes = contratantes.filter(c => 
    c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.telefone?.includes(searchTerm)
  )

  // Paginação
  const totalPages = Math.ceil(filteredContratantes.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedContratantes = filteredContratantes.slice(startIndex, startIndex + itemsPerPage)

  const handleAddNew = async () => {
    if (!formData.nome.trim()) {
      alert("Nome é obrigatório")
      return
    }

    try {
      const response = await fetch("/api/contratantes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })

      if (!response.ok) throw new Error("Erro ao criar contratante")

      setFormData({ nome: "", email: "", telefone: "" })
      setIsAddingNew(false)
      onRefresh()
    } catch (error) {
      console.error(error)
      alert("Erro ao criar contratante")
    }
  }

  const handleEdit = async (id: number) => {
    try {
      const response = await fetch(`/api/contratantes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })

      if (!response.ok) throw new Error("Erro ao atualizar contratante")

      setFormData({ nome: "", email: "", telefone: "" })
      setEditingId(null)
      onRefresh()
    } catch (error) {
      console.error(error)
      alert("Erro ao atualizar contratante")
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este contratante?")) return

    try {
      const response = await fetch(`/api/contratantes/${id}`, {
        method: "DELETE"
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Erro ao excluir contratante")
      }

      onRefresh()
    } catch (error: any) {
      console.error(error)
      alert(error.message || "Erro ao excluir contratante")
    }
  }

  const startEdit = (contratante: Contratante) => {
    setEditingId(contratante.id)
    setFormData({
      nome: contratante.nome,
      email: contratante.email || "",
      telefone: contratante.telefone || ""
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setFormData({ nome: "", email: "", telefone: "" })
  }

  return (
    <div className="space-y-4">
      {/* Header com busca e botão adicionar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <Input
            placeholder="Buscar contratante..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/40"
          />
        </div>
        <Button
          onClick={() => {
            setIsAddingNew(true)
            setFormData({ nome: "", email: "", telefone: "" })
          }}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Novo Contratante
        </Button>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Nome</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Email</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Telefone</th>
              <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Criado em</th>
              <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Ações</th>
            </tr>
          </thead>
          <tbody>
            {/* Linha de adicionar novo */}
            {isAddingNew && (
              <tr className="border-b border-white/10 bg-white/5">
                <td className="py-3 px-4">
                  <Input
                    placeholder="Nome *"
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 h-8"
                    autoFocus
                  />
                </td>
                <td className="py-3 px-4">
                  <Input
                    placeholder="Email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 h-8"
                  />
                </td>
                <td className="py-3 px-4">
                  <Input
                    placeholder="Telefone"
                    value={formData.telefone}
                    onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 h-8"
                  />
                </td>
                <td className="py-3 px-4 text-white/40 text-sm">-</td>
                <td className="py-3 px-4">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsAddingNew(false)}
                      className="text-white/60 hover:text-white hover:bg-white/10"
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddNew}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      Salvar
                    </Button>
                  </div>
                </td>
              </tr>
            )}

            {/* Linhas de contratantes */}
            {paginatedContratantes.map((contratante) => (
              <tr 
                key={contratante.id} 
                className="border-b border-white/10 hover:bg-white/5 transition-colors"
              >
                {editingId === contratante.id ? (
                  // Modo edição
                  <>
                    <td className="py-3 px-4">
                      <Input
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                        className="bg-white/10 border-white/20 text-white h-8"
                        autoFocus
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="bg-white/10 border-white/20 text-white h-8"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        value={formData.telefone}
                        onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                        className="bg-white/10 border-white/20 text-white h-8"
                      />
                    </td>
                    <td className="py-3 px-4 text-white/60 text-sm">
                      {contratante.createdAt ? new Date(contratante.createdAt).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEdit}
                          className="text-white/60 hover:text-white hover:bg-white/10"
                        >
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleEdit(contratante.id)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Salvar
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  // Modo visualização
                  <>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center">
                          <User className="h-4 w-4 text-white" />
                        </div>
                        <span className="text-white font-medium">{contratante.nome}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {contratante.email ? (
                        <div className="flex items-center gap-2 text-white/70">
                          <Mail className="h-4 w-4" />
                          <span>{contratante.email}</span>
                        </div>
                      ) : (
                        <span className="text-white/40">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {contratante.telefone ? (
                        <div className="flex items-center gap-2 text-white/70">
                          <Phone className="h-4 w-4" />
                          <span>{contratante.telefone}</span>
                        </div>
                      ) : (
                        <span className="text-white/40">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-white/60 text-sm">
                      {contratante.createdAt ? new Date(contratante.createdAt).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-gray-900 border-white/20">
                            <DropdownMenuItem 
                              onClick={() => startEdit(contratante)}
                              className="text-white hover:bg-white/10 cursor-pointer"
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDelete(contratante.id)}
                              className="text-red-400 hover:bg-red-500/20 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}

            {/* Mensagem quando não há resultados */}
            {paginatedContratantes.length === 0 && !isAddingNew && (
              <tr>
                <td colSpan={5} className="py-12 text-center text-white/40">
                  {searchTerm ? "Nenhum contratante encontrado" : "Nenhum contratante cadastrado"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-white/10">
          <span className="text-sm text-white/60">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, filteredContratantes.length)} de {filteredContratantes.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-white/60">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}