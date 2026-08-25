"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Search, 
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Users,
  CheckSquare
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProcessoDetailsModal } from "./kanban/atividade-details-modal"
import { SlaBadge } from "@/src/components/sla/sla-ui"
import type { ProcessoWithStatus, Contratante } from "@/src/types/kanban"
import type { StatusSla } from "@/src/types/sla"

interface ProcessosListaProps {
  processos: ProcessoWithStatus[]
  contratantes: Contratante[]
  onRefresh: () => void
}

// Filtro de SLA. Os rótulos e a classificação vêm da ENGINE (processo.sla) —
// a lista só compara o status já calculado, nunca recalcula prazo.
const FILTROS_SLA: { valor: StatusSla | "todos"; rotulo: string }[] = [
  { valor: "todos", rotulo: "SLA: todos" },
  { valor: "no_prazo", rotulo: "No prazo" },
  { valor: "proximo_vencimento", rotulo: "Próximo do vencimento" },
  { valor: "atrasado", rotulo: "Atrasado" },
  { valor: "sem_prazo", rotulo: "Sem prazo definido" },
]

export function ProcessosLista({
  processos,
  contratantes,
  onRefresh
}: ProcessosListaProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [filtroSla, setFiltroSla] = useState<StatusSla | "todos">("todos")
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  // Estados para o modal de edição
  const [selectedProcesso, setSelectedProcesso] = useState<ProcessoWithStatus | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Função para abrir modal de edição
  const handleEdit = (processo: ProcessoWithStatus) => {
    setSelectedProcesso(processo)
    setIsModalOpen(true)
  }

  // Função para fechar modal
  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedProcesso(null)
  }

  // Filtrar processos (texto + situação de SLA — o status vem pronto da engine)
  const filteredProcessos = processos.filter(p => {
    const casaTexto =
      p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.contratantes?.some(c => c.nome?.toLowerCase().includes(searchTerm.toLowerCase()))
    if (!casaTexto) return false
    if (filtroSla === "todos") return true
    return (p.sla?.status ?? "sem_prazo") === filtroSla
  })

  // Paginação — a página é limitada ao total atual: mudar busca ou filtro nunca
  // deixa a lista numa página que não existe mais.
  const totalPages = Math.ceil(filteredProcessos.length / itemsPerPage)
  const paginaAtual = Math.min(currentPage, Math.max(1, totalPages))
  const startIndex = (paginaAtual - 1) * itemsPerPage
  const paginatedProcessos = filteredProcessos.slice(startIndex, startIndex + itemsPerPage)

  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este processo?")) return

    try {
      const response = await fetch(`/api/processos/${id}`, {
        method: "DELETE"
      })

      if (!response.ok) throw new Error("Erro ao excluir processo")
      onRefresh()
    } catch (error) {
      console.error(error)
      alert("Erro ao excluir processo")
    }
  }

  return (
    <div className="space-y-4">
      {/* Header com busca */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Buscar processo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-[var(--surface-primary)] border-[var(--border-strong)] text-white placeholder:text-[var(--text-muted)]"
          />
        </div>
        <select
          value={filtroSla}
          onChange={(e) => setFiltroSla(e.target.value as StatusSla | "todos")}
          aria-label="Filtrar por status de SLA"
          className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-white/40 [&>option]:bg-[var(--surface-popover)]"
        >
          {FILTROS_SLA.map((f) => (
            <option key={f.valor} value={f.valor}>{f.rotulo}</option>
          ))}
        </select>
        <div className="text-sm text-[var(--text-secondary)]">
          {filteredProcessos.length} processo(s) encontrado(s)
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border-default)]">
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Processo</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Fase</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Status SLA</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Dias</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Contratante</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Requerentes</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Tarefas</th>
              <th className="text-left py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Criado</th>
              <th className="text-right py-3 px-4 text-[var(--text-secondary)] font-medium text-sm">Ações</th>
            </tr>
          </thead>
          <tbody>
            {paginatedProcessos.map((processo) => {
              const tarefasCount = processo._count?.tarefas ?? processo.tarefas?.length ?? 0
              const tarefasConcluidas = processo.tarefas?.filter(t => t.concluida)?.length ?? 0
              const requerentesCount = processo.requerentes?.length ?? 0
              const primeiroContratante = processo.contratantes?.[0]

              return (
                <tr 
                  key={processo.id} 
                  className="border-b border-[var(--border-default)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                  onClick={() => handleEdit(processo)}
                >
                  <td className="py-3 px-4">
                    <div>
                      <span className="text-white font-medium">{processo.nome}</span>
                      {processo.descricao && (
                        <p className="text-[var(--text-secondary)] text-sm truncate max-w-[200px]">
                          {processo.descricao}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-indigo-500" />
                      <span className="text-white/80 text-sm">{processo.faseAtualKey ?? "—"}</span>
                    </div>
                  </td>
                  {/* Status SLA e Dias: exibição pura do que a engine calculou. */}
                  <td className="py-3 px-4">
                    <SlaBadge
                      status={processo.sla?.status ?? "sem_prazo"}
                      rotulo={processo.sla?.rotuloStatus ?? "Sem prazo definido"}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-sm ${
                        processo.sla?.status === "atrasado"
                          ? "text-red-700"
                          : processo.sla?.status === "proximo_vencimento"
                            ? "text-amber-700"
                            : "text-white/70"
                      }`}
                    >
                      {processo.sla?.rotuloDias ?? "—"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {primeiroContratante ? (
                      <span className="text-indigo-700 hover:underline cursor-pointer">
                        {primeiroContratante.nome}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {requerentesCount > 0 ? (
                      <span className="flex items-center gap-1 text-slate-700">
                        <Users className="h-3 w-3" />
                        {requerentesCount}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {tarefasCount > 0 ? (
                      <span className="flex items-center gap-1 text-blue-700">
                        <CheckSquare className="h-3 w-3" />
                        {tarefasConcluidas}/{tarefasCount}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[var(--text-secondary)] text-sm">
                    {processo.createdAt 
                      ? new Date(processo.createdAt).toLocaleDateString('pt-BR')
                      : '-'
                    }
                  </td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-hover)]"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[var(--surface-primary)] border-gray-200">
                          <DropdownMenuItem 
                            onClick={() => handleEdit(processo)}
                            className="text-gray-700 hover:bg-gray-100 cursor-pointer"
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(processo.id)}
                            className="text-red-500 focus:text-red-500 data-[highlighted]:text-red-500 data-[highlighted]:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              )
            })}

            {/* Mensagem quando não há resultados */}
            {paginatedProcessos.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-[var(--text-muted)]">
                  {searchTerm || filtroSla !== "todos"
                    ? "Nenhum processo encontrado"
                    : "Nenhum processo cadastrado"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-default)]">
          <span className="text-sm text-[var(--text-secondary)]">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, filteredProcessos.length)} de {filteredProcessos.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(Math.max(1, paginaAtual - 1))}
              disabled={paginaAtual === 1}
              className="text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-hover)] disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-[var(--text-secondary)]">
              Página {paginaAtual} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPage(Math.min(totalPages, paginaAtual + 1))}
              disabled={paginaAtual === totalPages}
              className="text-[var(--text-secondary)] hover:text-white hover:bg-[var(--surface-hover)] disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modal de Edição */}
      <ProcessoDetailsModal
        processo={selectedProcesso}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSave={onRefresh}
      />
    </div>
  )
}