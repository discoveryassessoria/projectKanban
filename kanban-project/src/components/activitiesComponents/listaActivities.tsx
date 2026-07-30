"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useActivities, useStatuses, useContratantes, useRequerentes, invalidateActivities } from "@/src/hooks/useActivitiesData"
import type { Atividade, Status, Usuario } from "@/src/hooks/useActivitiesData"
import { TarefaDetailModal } from "@/src/components/kanban/TarefaDetailModal"
import { useUsers } from "@/src/hooks/useActivitiesData"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { BandeiraPais } from "@/src/components/ui/bandeira-pais"
import { FileText, ListTodo, Play, Clock, CheckCircle2 } from "lucide-react"
import {
  KpiCard, StatusBadge, FilterChip, ActionMenu, type Tone,
} from "@/src/components/financeiroComponents/ui/kit"

// Mapeamento de países para exibição
const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal',
  ESPANHA: 'Espanha',
  ALEMANHA: 'Alemanha',
  ITALIA: 'Itália'
}

// Status derivado (fiel ao oficial): 4 estados a partir de concluida + datas.
function statusDerivado(a: Atividade): { label: string; tone: Tone } {
  if (a.concluida) return { label: "Concluída", tone: "success" }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const prazo = a.data_termino ? new Date(a.data_termino) : null
  const inicio = a.data_inicio ? new Date(a.data_inicio) : null
  if (prazo && prazo < hoje) return { label: "Atrasada", tone: "danger" }
  if (inicio && inicio <= hoje) return { label: "Em andamento", tone: "warning" }
  return { label: "Pendente", tone: "neutral" }
}

interface UserAtv {
  usuario: Usuario
}

interface ListaActivitiesProps {
  filters?: any
}

export default function ListaActivities({ filters }: ListaActivitiesProps) {
  const router = useRouter()
  
  // Usar hooks de cache para buscar dados
  const { activities = [], isLoading, error, mutate } = useActivities(filters)
  const { statuses = [] } = useStatuses()
  const { contratantes = [] } = useContratantes()
  const { requerentes = [] } = useRequerentes()
  
  const [selectedItems, setSelectedItems] = useState<number[]>([])
  const [selectedAction, setSelectedAction] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<string>('')
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [selectedAtividade, setSelectedAtividade] = useState<Atividade | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  // Tarefa Transversal: filtro por tipo (NORMAL | TRANSVERSAL).
  const [filtroTipo, setFiltroTipo] = useState<"TODAS" | "NORMAL" | "TRANSVERSAL">("TODAS")

  const { users = [] } = useUsers()

  const { pode } = usePermissoes()

  // Garantir que atividades é sempre um array
  const atividadesTodas = useMemo(() => (Array.isArray(activities) ? activities : []), [activities])
  const atividades = filtroTipo === "TODAS" ? atividadesTodas : atividadesTodas.filter((a: Atividade) => (a.tipo ?? "NORMAL") === filtroTipo)
  
  // Status para tarefas (Pendente/Concluída)
  const statusTarefas = [
    { id: -2, nome: 'Pendente' },
    { id: -1, nome: 'Concluída' }
  ]

  // Cards-resumo inferiores (fiel ao oficial) — contagem por status derivado.
  const resumoCards = useMemo(() => {
    const c = (label: string) => atividadesTodas.filter((a: Atividade) => statusDerivado(a).label === label).length
    return { total: atividadesTodas.length, emAndamento: c("Em andamento"), pendentes: c("Pendente"), concluidas: c("Concluída") }
  }, [atividadesTodas])
  const pct = (n: number) => (resumoCards.total ? Math.round((n / resumoCards.total) * 100) : 0)

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Sem prazo'
    
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDateOnly = (dateString: string | null) => {
    if (!dateString) return 'Data inválida'
    
    try {
      let date: Date
      
      if (typeof dateString === 'string') {
        date = new Date(dateString)
      } else {
        date = new Date(String(dateString))
      }
      
      if (isNaN(date.getTime())) {
        return 'Data inválida'
      }
      
      const formatted = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo'
      }).format(date)
      
      return formatted
    } catch (error) {
      return 'Data inválida'
    }
  }

  const toggleSelectAll = () => {
    if (selectedItems.length === atividades.length) {
      setSelectedItems([])
    } else {
      setSelectedItems(atividades.map((a: Atividade) => a.id))
    }
  }

  const toggleSelectItem = (id: number) => {
    setSelectedItems(prev => 
      prev.includes(id) 
        ? prev.filter(item => item !== id)
        : [...prev, id]
    )
  }

  const handleBulkDelete = async () => {
    if (selectedItems.length === 0) {
      alert('Nenhuma atividade selecionada')
      return
    }
    
    if (!confirm(`Tem certeza que deseja excluir ${selectedItems.length} atividade(s)?`)) {
      return
    }

    setIsActionLoading(true)
    try {
      const results = []
      for (const id of selectedItems) {
        try {
          const response = await fetch(`/api/tarefas/${id}`, { 
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
          })
          
          if (!response.ok) {
            // 404 = já foi deletada (cascade de tarefa pai) - considerar sucesso
            if (response.status === 404) {
              results.push({ id, success: true })
              continue
            }
            const errorText = await response.text()
            throw new Error(`Erro ${response.status}: ${errorText}`)
          }
          
          results.push({ id, success: true })
        } catch (error) {
          results.push({ id, success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' })
        }
      }
      
      const successfulDeletes = results.filter(r => r.success).map(r => r.id)
      const failedDeletes = results.filter(r => !r.success)
      
      if (failedDeletes.length > 0) {
        alert(`Erro ao excluir ${failedDeletes.length} atividade(s).`)
      }
      
      if (successfulDeletes.length > 0) {
        mutate(
          atividades.filter((atividade: Atividade) => !successfulDeletes.includes(atividade.id)),
          { revalidate: false }
        )
        setTimeout(() => mutate(), 100)
      }
      
      setSelectedItems([])
      setSelectedAction('')
      
      if (successfulDeletes.length === selectedItems.length) {
        alert('Todas as atividades foram excluídas com sucesso!')
      }
    } catch (error) {
      alert('Erro ao excluir atividades: ' + (error instanceof Error ? error.message : 'Erro desconhecido'))
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleBulkStatusUpdate = async () => {
    if (selectedItems.length === 0 || !selectedStatus) return

    setIsActionLoading(true)
    try {
      // Para tarefas, atualizar o campo concluida
      const concluida = selectedStatus === '-1' // -1 = Concluída
      
      const updatePromises = selectedItems.map(id => 
        fetch(`/api/tarefas/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
          body: JSON.stringify({ concluida })
        })
      )
      
      await Promise.all(updatePromises)
      
      // Revalidar dados
      setTimeout(() => mutate(), 100)
      
      setSelectedItems([])
      setSelectedAction('')
      setSelectedStatus('')
    } catch (error) {
      console.error('Erro ao atualizar status:', error)
      alert('Erro ao atualizar status das atividades')
    } finally {
      setIsActionLoading(false)
    }
  }

  const applyAction = () => {
    if (selectedAction === 'delete') {
      handleBulkDelete()
    } else if (selectedAction === 'status' && selectedStatus) {
      handleBulkStatusUpdate()
    }
  }

  const handleAtividadeClick = async (atividade: Atividade) => {
    if (atividade.processo?.id) {
      const pais = atividade.processo.pais || atividade.pais || 'PORTUGAL'
      router.push(`/kanban?processoId=${atividade.processo.id}&tab=tarefas&pais=${pais}&atividadeId=${atividade.id}`)
    } else if (atividade.tarefaPai?.id) {
      // Subtarefa sem processo — abrir modal da tarefa pai
      try {
        const response = await fetch(`/api/tarefas/${atividade.tarefaPai.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        })
        if (response.ok) {
          const data = await response.json()
          const pai = data.tarefa
          setSelectedAtividade({
            ...atividade,
            id: pai.id,
            nome: pai.titulo,
            descricao: pai.descricao,
            concluida: pai.concluida,
            prioridade: pai.prioridade,
            data_termino: pai.dataPrazo,
            data_criacao: pai.createdAt,
            responsavel: pai.responsavel,
            observacoes: pai.observacoes,
            tarefaPai: undefined,
          } as any)
          setIsDetailsModalOpen(true)
        }
      } catch (error) {
        console.error('Erro ao buscar tarefa pai:', error)
      }
    } else {
      setSelectedAtividade(atividade)
      setIsDetailsModalOpen(true)
    }
  }

  const handleAtividadeSave = () => {
    mutate()
    setIsDetailsModalOpen(false)
  }

  // Função para obter cor do status
  const getStatusBadgeClass = (statusNome: string | undefined) => {
    const nome = statusNome?.toLowerCase() || ''
    
    if (nome === 'concluída' || nome === 'concluida' || nome === 'concluído' || nome === 'concluido') {
      return "bg-green-500/20 text-green-300 hover:bg-green-500/30 border-green-500/30"
    }
    if (nome === 'pendente') {
      return "bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30 border-yellow-500/30"
    }
    if (nome === 'em andamento') {
      return "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border-blue-500/30"
    }
    return "bg-gray-500/20 text-gray-300 border-gray-500/30"
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
        <div className="px-4 py-3 border-b border-white/10">
          <div className="grid gap-4 items-center" style={{ gridTemplateColumns: '28px 2.5fr 0.8fr 1.2fr 0.7fr 0.7fr 0.6fr 0.4fr 0.6fr' }}>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className="h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
            <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
          </div>
        </div>
        
        <div className="divide-y divide-white/10">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="px-4 py-3">
              <div className="grid gap-4 items-center" style={{ gridTemplateColumns: '28px 2.5fr 0.8fr 1.2fr 0.7fr 0.7fr 0.6fr 0.4fr 0.6fr' }}>
                <div className=" h-4 w-4 bg-white/10 rounded animate-pulse"></div>
                <div className="space-y-2">
                  <div className="h-4 bg-white/10 rounded animate-pulse"></div>
                  <div className="h-3 bg-white/10 rounded animate-pulse w-3/4"></div>
                </div>
                <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
                <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
                <div className=" h-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className=" h-6 w-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className=" h-6 w-6 bg-white/10 rounded-full animate-pulse"></div>
                <div className=" h-4 bg-white/10 rounded animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error state - mostrar mensagem amigável ao invés de erro técnico
  if (error) {
    return (
      <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
        <div className="p-6">
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <div className="w-16 h-16 mb-4 rounded-full bg-white/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-white/70 mb-2">Nenhuma atividade disponível</p>
            <p className="text-sm text-white/50">Crie uma nova atividade para começar</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10">
      {/* Filtro por tipo (Normais | Transversais) */}
      <div className="px-4 pt-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wide">Tipo:</span>
        {([["TODAS", "Todas"], ["NORMAL", "Normais"], ["TRANSVERSAL", "Transversais"]] as const).map(([val, label]) => (
          <FilterChip key={val} gold active={filtroTipo === val} onClick={() => setFiltroTipo(val)}>{label}</FilterChip>
        ))}
        {filtroTipo === "TRANSVERSAL" && <span className="text-[11px] text-white/40 ml-1">{atividades.length} transversal(is)</span>}
      </div>
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="grid gap-4 items-center text-sm font-medium text-white/60" style={{ gridTemplateColumns: '28px 2.3fr 0.8fr 1fr 0.7fr 0.7fr 0.95fr 0.5fr 0.7fr 0.4fr' }}>
          <div className="">
            {(pode('tarefas.excluir') || pode('tarefas.editar')) && (
              <input
                type="checkbox"
                checked={selectedItems.length === atividades.length && atividades.length > 0}
                onChange={toggleSelectAll}
                className="rounded border-white/30 bg-transparent"
              />
            )}
          </div>
          <div className="">Nome</div>
          <div className="">Processo</div>
          <div className="">Vinculado a</div>
          <div className="">Data de início</div>
          <div className="">Prazo final</div>
          <div className="">Status</div>
          <div className="">Responsável</div>
          <div className="">País</div>
          <div className="text-right">Ações</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-white/10">
        {atividades.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-white/70 mb-2">Nenhuma atividade encontrada</p>
            <p className="text-sm text-white/50">Crie uma nova atividade clicando no botão acima</p>
          </div>
        ) : (
          atividades.map((atividade: Atividade) => {
            const st = statusDerivado(atividade)
            const iconColor = st.tone === "success" ? "var(--success)" : st.tone === "danger" ? "var(--danger)" : st.tone === "warning" ? "var(--warning)" : "var(--text-muted)"
            return (
            <div
              key={atividade.id}
              className="px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer"
              onClick={() => handleAtividadeClick(atividade)}
            >
              <div className="grid gap-4 items-center text-white/80" style={{ gridTemplateColumns: '28px 2.3fr 0.8fr 1fr 0.7fr 0.7fr 0.95fr 0.5fr 0.7fr 0.4fr' }}>
                <div className="">
                  {(pode('tarefas.excluir') || pode('tarefas.editar')) && (
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(atividade.id)}
                      onChange={() => toggleSelectItem(atividade.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-white/30 bg-transparent"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="grid place-items-center h-8 w-8 rounded-md border shrink-0" style={{ background: "var(--surface-secondary)", borderColor: "var(--border-default)", color: iconColor }}>
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-medium text-sm text-white flex items-center gap-2">
                      {atividade.nome || 'Sem título'}
                      {atividade.tipo === "TRANSVERSAL" && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" }} title={`Ação antecipada de ${atividade.faseReferenciaCode ?? "outra fase"}`}>
                          ⇄ Transversal{atividade.faseReferenciaCode ? ` · ${atividade.faseReferenciaCode}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/50 truncate">
                      {atividade.observacoes || atividade.descricao || ''}
                    </div>
                  </div>
                </div>

                <div className="">
                  <div className="text-sm text-white/70 truncate">
                    {atividade.processo?.nome || '-'}
                  </div>
                </div>

                <div className="">
                  <div className="text-sm text-white/70 truncate">
                    {atividade.tarefaPai?.titulo || '-'}
                  </div>
                </div>

                <div className="">
                  <div className="text-sm text-white/70">
                    {atividade.data_inicio ? formatDateOnly(atividade.data_inicio) : '-'}
                  </div>
                </div>

                <div className="">
                  <div className="text-sm text-white/70">
                    {atividade.data_termino ? formatDateOnly(atividade.data_termino) : 'Sem prazo'}
                  </div>
                </div>

                <div className="">
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                </div>

                <div className="">
                  <div className="flex items-center">
                    <Avatar className="h-6 w-6 border border-white/20">
                      <AvatarFallback className="text-xs bg-white/10 text-white">
                        {atividade.responsavel?.nome?.slice(0, 2).toUpperCase() || 'NA'}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>

                <div className="">
                  {atividade.pais
                    ? <span className="inline-flex items-center gap-1.5 text-sm text-white/70"><BandeiraPais pais={atividade.pais as any} size="sm" /> {PAIS_LABELS[atividade.pais] || atividade.pais}</span>
                    : <span className="text-sm text-white/40">-</span>}
                </div>

                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <ActionMenu onClick={() => handleAtividadeClick(atividade)} />
                </div>
              </div>
            </div>
          )})
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center justify-between text-sm text-white/60">
          <div className="flex items-center space-x-4">
            <span>Selecionado: {selectedItems.length} / {atividades.length}</span>
            <span>Total mostrando: {atividades.length}</span>
            {selectedItems.length > 0 && (pode('tarefas.excluir') || pode('tarefas.editar')) && (
              <div className="flex items-center space-x-2">
                <Select value={selectedAction} onValueChange={setSelectedAction}>
                  <SelectTrigger className="w-40 bg-white/10 border-white/20 text-white [&_svg]:!text-white/60" style={{ color: selectedAction ? 'white' : 'rgba(255,255,255,0.6)' }}>
                    <SelectValue placeholder="Selecionar ação" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200 text-gray-900">
                    {pode('tarefas.excluir') && <SelectItem value="delete">Excluir</SelectItem>}
                    {pode('tarefas.editar') && <SelectItem value="status">Marcar como...</SelectItem>}
                  </SelectContent>
                </Select>
                
                {selectedAction === 'status' && (
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="w-32 bg-white/10 border-white/20 text-white [&_svg]:!text-white/60" style={{ color: selectedStatus ? 'white' : 'rgba(255,255,255,0.6)' }}>
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200 text-gray-900">
                      {statusTarefas.map((status) => (
                        <SelectItem key={status.id} value={status.id.toString()}>
                          {status.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={applyAction}
                  disabled={isActionLoading || (!selectedAction || (selectedAction === 'status' && !selectedStatus))}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/10"
                >
                  {isActionLoading ? 'Aplicando...' : 'Aplicar'}
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>Páginas: 1</span>
            <span className="inline-flex items-center gap-1 rounded-md border border-white/15 px-3 py-1.5 text-white/60">20 por página <span className="text-white/40">▾</span></span>
          </div>
        </div>
      </div>
    </div>

    {/* CARDS INFERIORES (fiel ao oficial) — valor branco, cor só no ícone */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      <KpiCard iconVariant="subtle" icon={<ListTodo className="h-4 w-4" />} label="Total de atividades" value={resumoCards.total} sub="atividades cadastradas" />
      <KpiCard iconVariant="subtle" iconTone="info" icon={<Play className="h-4 w-4" />} label="Em andamento" value={resumoCards.emAndamento} sub={`${pct(resumoCards.emAndamento)}% do total`} />
      <KpiCard iconVariant="subtle" iconTone="warning" icon={<Clock className="h-4 w-4" />} label="Pendentes" value={resumoCards.pendentes} sub={`${pct(resumoCards.pendentes)}% do total`} />
      <KpiCard iconVariant="subtle" iconTone="success" icon={<CheckCircle2 className="h-4 w-4" />} label="Concluídas" value={resumoCards.concluidas} sub={`${pct(resumoCards.concluidas)}% do total`} />
    </div>

      {/* ✅ NOVO: Modal específico para tarefas */}
      {isDetailsModalOpen && selectedAtividade && (
        <TarefaDetailModal
          tarefa={{
            id: selectedAtividade.id,
            titulo: selectedAtividade.nome,
            descricao: selectedAtividade.descricao || undefined,
            concluida: selectedAtividade.concluida || false,
            prioridade: selectedAtividade.prioridade || 'MEDIA',
            dataPrazo: selectedAtividade.data_termino || undefined,
            responsavel: selectedAtividade.responsavel?.id ? selectedAtividade.responsavel as any : undefined,
            responsavelId: selectedAtividade.responsavel?.id,
            createdAt: selectedAtividade.data_criacao,
            observacoes: selectedAtividade.observacoes || undefined,
            subtarefas: [],
          }}
          onClose={() => setIsDetailsModalOpen(false)}
          onUpdate={() => { mutate() }}
          usuarios={users.map((u: any) => ({ id: u.id, nome: u.nome, email: u.email, publicCode: u.publicCode }))}
        />
      )}
    </>
  )
}