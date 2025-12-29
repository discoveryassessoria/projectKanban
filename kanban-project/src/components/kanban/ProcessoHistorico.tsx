// src/components/kanban/ProcessoHistorico.tsx

"use client"

import { useState, useEffect } from "react"
import { 
  Clock,
  Plus,
  Edit,
  Trash2,
  CheckCircle,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  User,
  Briefcase,
  FileText,
  Users,
  GitBranch,
  Calendar,
  ChevronDown,
  ChevronRight,
  Filter
} from "lucide-react"

interface LogItem {
  id: number
  acao: string
  entidade: string
  entidadeId: number | null
  descricao: string
  detalhes: Record<string, any> | null
  criadoEm: string
  usuario: {
    id: number
    nome: string
  } | null
}

interface ProcessoHistoricoProps {
  processoId: number
  onUpdate?: () => void
}

// Ícones por tipo de ação
const iconesPorAcao: Record<string, React.ReactNode> = {
  CRIAR: <Plus className="h-4 w-4" />,
  ATUALIZAR: <Edit className="h-4 w-4" />,
  EXCLUIR: <Trash2 className="h-4 w-4" />,
  CONCLUIR: <CheckCircle className="h-4 w-4" />,
  REABRIR: <RefreshCw className="h-4 w-4" />,
  AVANCAR: <ArrowRight className="h-4 w-4" />,
  RETROCEDER: <ArrowLeft className="h-4 w-4" />,
  MOVER: <ArrowRight className="h-4 w-4" />,
}

// Cores por tipo de ação
const coresPorAcao: Record<string, { bg: string; text: string; border: string }> = {
  CRIAR: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
  ATUALIZAR: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  EXCLUIR: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
  CONCLUIR: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
  REABRIR: { bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-200' },
  AVANCAR: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
  RETROCEDER: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
  MOVER: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
}

// Ícones por entidade
const iconesPorEntidade: Record<string, React.ReactNode> = {
  PROCESSO: <Briefcase className="h-3.5 w-3.5" />,
  TAREFA: <CheckCircle className="h-3.5 w-3.5" />,
  CONTRATANTE: <Users className="h-3.5 w-3.5" />,
  REQUERENTE: <User className="h-3.5 w-3.5" />,
  DOCUMENTO: <FileText className="h-3.5 w-3.5" />,
  PESSOA: <GitBranch className="h-3.5 w-3.5" />,
  PROTOCOLO: <FileText className="h-3.5 w-3.5" />,
}

// Labels de entidade em português
const labelEntidade: Record<string, string> = {
  PROCESSO: 'Processo',
  TAREFA: 'Tarefa',
  CONTRATANTE: 'Contratante',
  REQUERENTE: 'Requerente',
  DOCUMENTO: 'Documento',
  PESSOA: 'Pessoa',
  PROTOCOLO: 'Protocolo',
}

export function ProcessoHistorico({ processoId, onUpdate }: ProcessoHistoricoProps) {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const [filtroEntidade, setFiltroEntidade] = useState<string | null>(null)

  useEffect(() => {
    const carregarLogs = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/processos/${processoId}/logs?limite=100`)
        if (response.ok) {
          const data = await response.json()
          setLogs(data.logs || [])
        }
      } catch (error) {
        console.error('Erro ao carregar histórico:', error)
      } finally {
        setLoading(false)
      }
    }

    carregarLogs()
  }, [processoId])

  const formatarData = (dataStr: string) => {
    const data = new Date(dataStr)
    return data.toLocaleDateString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatarDataRelativa = (dataStr: string) => {
    const data = new Date(dataStr)
    const agora = new Date()
    const diffMs = agora.getTime() - data.getTime()
    const diffMinutos = Math.floor(diffMs / 60000)
    const diffHoras = Math.floor(diffMs / 3600000)
    const diffDias = Math.floor(diffMs / 86400000)

    if (diffMinutos < 1) return 'Agora mesmo'
    if (diffMinutos < 60) return `${diffMinutos} min atrás`
    if (diffHoras < 24) return `${diffHoras}h atrás`
    if (diffDias < 7) return `${diffDias} dia${diffDias > 1 ? 's' : ''} atrás`
    
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  }

  // Agrupar logs por data
  const logsAgrupados = logs
    .filter(log => !filtroEntidade || log.entidade === filtroEntidade)
    .reduce((acc, log) => {
      const data = new Date(log.criadoEm).toLocaleDateString('pt-BR')
      if (!acc[data]) {
        acc[data] = []
      }
      acc[data].push(log)
      return acc
    }, {} as Record<string, LogItem[]>)

  // Entidades únicas para filtro
  const entidadesDisponiveis = [...new Set(logs.map(l => l.entidade))]

  const logsFiltrados = logs.filter(log => !filtroEntidade || log.entidade === filtroEntidade)

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-100 rounded-lg">
            <Clock className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Histórico de Alterações</h3>
            <p className="text-sm text-gray-500">
              {logsFiltrados.length} {logsFiltrados.length === 1 ? 'registro' : 'registros'}
            </p>
          </div>
        </div>

        {/* Filtro por entidade */}
        {entidadesDisponiveis.length > 1 && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filtroEntidade || ''}
              onChange={(e) => setFiltroEntidade(e.target.value || null)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos</option>
              {entidadesDisponiveis.map(ent => (
                <option key={ent} value={ent}>{labelEntidade[ent] || ent}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Lista de logs */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="animate-spin h-8 w-8 border-2 border-gray-200 border-t-blue-500 rounded-full mb-3" />
            <p className="text-gray-500 text-sm">Carregando histórico...</p>
          </div>
        ) : logsFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="p-4 bg-gray-100 rounded-full mb-4">
              <Clock className="h-10 w-10 text-gray-300" />
            </div>
            <h4 className="text-gray-700 font-medium mb-1">Nenhum registro encontrado</h4>
            <p className="text-gray-500 text-sm max-w-xs">
              {filtroEntidade 
                ? `Não há registros de ${labelEntidade[filtroEntidade] || filtroEntidade}`
                : 'As alterações deste processo aparecerão aqui'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(logsAgrupados).map(([data, logsData]) => (
              <div key={data}>
                {/* Data como separador */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
                    <Calendar className="h-4 w-4" />
                    {data}
                  </div>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Logs do dia */}
                <div className="space-y-3">
                  {logsData.map((log) => {
                    const cores = coresPorAcao[log.acao] || { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' }
                    const isExpanded = expandedLog === log.id
                    const temDetalhes = log.detalhes && Object.keys(log.detalhes).length > 0

                    return (
                      <div
                        key={log.id}
                        className={`
                          bg-white rounded-xl border ${cores.border} 
                          shadow-sm hover:shadow-md transition-shadow
                        `}
                      >
                        <div 
                          className={`
                            flex items-start gap-4 p-4
                            ${temDetalhes ? 'cursor-pointer' : ''}
                          `}
                          onClick={() => temDetalhes && setExpandedLog(isExpanded ? null : log.id)}
                        >
                          {/* Ícone da ação */}
                          <div className={`
                            p-2.5 rounded-lg ${cores.bg} ${cores.text}
                            flex-shrink-0
                          `}>
                            {iconesPorAcao[log.acao] || <Edit className="h-4 w-4" />}
                          </div>

                          {/* Conteúdo */}
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-900 leading-relaxed">
                              {log.descricao}
                            </p>
                            
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {/* Entidade */}
                              <span className={`
                                inline-flex items-center gap-1.5 px-2 py-0.5 
                                rounded-full text-xs font-medium
                                ${cores.bg} ${cores.text}
                              `}>
                                {iconesPorEntidade[log.entidade] || <FileText className="h-3 w-3" />}
                                {labelEntidade[log.entidade] || log.entidade}
                              </span>
                              
                              {/* Usuário */}
                              {log.usuario && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                                  <User className="h-3 w-3" />
                                  {log.usuario.nome}
                                </span>
                              )}
                              
                              {/* Hora */}
                              <span className="text-xs text-gray-400 ml-auto">
                                {formatarDataRelativa(log.criadoEm)}
                              </span>

                              {/* Indicador de expansão */}
                              {temDetalhes && (
                                <button className="text-gray-400 hover:text-gray-600">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Detalhes expandidos */}
                        {isExpanded && temDetalhes && (
                          <div className="px-4 pb-4 pt-0">
                            <div className="ml-14 p-3 bg-gray-50 rounded-lg text-sm">
                              <p className="text-xs text-gray-500 uppercase font-medium mb-2">Detalhes</p>
                              <pre className="text-gray-700 whitespace-pre-wrap font-mono text-xs">
                                {JSON.stringify(log.detalhes, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}