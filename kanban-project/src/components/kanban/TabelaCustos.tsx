"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, Trash2, Loader2, Save, DollarSign, FileText, Pencil, Check, X } from "lucide-react"

interface TipoServico {
  id: number
  nome: string
  ordem: number
}

interface Pessoa {
  id: number
  nome: string
  sobrenome: string | null
  nomeCompleto: string
  valores: Record<number, number>
  total: number
  qtdDocumentos?: number
}

interface TabelaCustosProps {
  processoId: number
}

export function TabelaCustos({ processoId }: TabelaCustosProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [servicos, setServicos] = useState<TipoServico[]>([])
  const [totaisPorServico, setTotaisPorServico] = useState<Record<number, number>>({})
  const [totalGeral, setTotalGeral] = useState(0)
  
  // Estado local para edição de valores
  const [valoresEditados, setValoresEditados] = useState<Record<string, string>>({})
  const [temAlteracoes, setTemAlteracoes] = useState(false)
  
  // Modal para adicionar serviço
  const [showAddServico, setShowAddServico] = useState(false)
  const [novoServico, setNovoServico] = useState("")
  const [addingServico, setAddingServico] = useState(false)
  
  // Edição de nome do serviço
  const [editandoServico, setEditandoServico] = useState<number | null>(null)
  const [novoNomeServico, setNovoNomeServico] = useState("")
  const [salvandoNome, setSalvandoNome] = useState(false)
  
  // Ref para evitar chamadas duplicadas
  const carregandoRef = useRef(false)

  // Carregar dados
  const carregarDados = useCallback(async () => {
    // Evitar chamadas duplicadas
    if (carregandoRef.current) return
    carregandoRef.current = true
    
    try {
      setLoading(true)
      const response = await fetch(`/api/processos/${processoId}/custos`)
      if (response.ok) {
        const data = await response.json()
        setPessoas(data.pessoas || [])
        setServicos(data.servicos || [])
        setTotaisPorServico(data.totaisPorServico || {})
        setTotalGeral(data.totalGeral || 0)
        
        // Inicializar valores editados
        const valores: Record<string, string> = {}
        data.pessoas?.forEach((p: Pessoa) => {
          data.servicos?.forEach((s: TipoServico) => {
            const key = `${p.id}-${s.id}`
            valores[key] = (p.valores[s.id] || 0).toString()
          })
        })
        setValoresEditados(valores)
        setTemAlteracoes(false)
      }
    } catch (error) {
      console.error("Erro ao carregar dados:", error)
    } finally {
      setLoading(false)
      carregandoRef.current = false
    }
  }, [processoId])

  useEffect(() => {
    carregarDados()
  }, [carregarDados])

  // Atualizar valor local
  const handleValorChange = (pessoaId: number, servicoId: number, valor: string) => {
    const valorLimpo = valor.replace(/[^0-9.,]/g, '').replace(',', '.')
    const key = `${pessoaId}-${servicoId}`
    setValoresEditados(prev => ({ ...prev, [key]: valorLimpo }))
    setTemAlteracoes(true)
  }

  // Calcular totais locais
  const calcularTotalPessoa = (pessoaId: number) => {
    return servicos.reduce((acc, s) => {
      const key = `${pessoaId}-${s.id}`
      const valor = parseFloat(valoresEditados[key] || '0') || 0
      return acc + valor
    }, 0)
  }

  const calcularTotalServico = (servicoId: number) => {
    return pessoas.reduce((acc, p) => {
      const key = `${p.id}-${servicoId}`
      const valor = parseFloat(valoresEditados[key] || '0') || 0
      return acc + valor
    }, 0)
  }

  const calcularTotalGeral = () => {
    return servicos.reduce((acc, s) => acc + calcularTotalServico(s.id), 0)
  }

  // Salvar todas as alterações de valores
  const salvarAlteracoes = async () => {
    try {
      setSaving(true)
      
      const custos = pessoas.flatMap(p => 
        servicos.map(s => ({
          pessoaId: p.id,
          tipoServicoId: s.id,
          valor: parseFloat(valoresEditados[`${p.id}-${s.id}`] || '0') || 0
        }))
      )

      const response = await fetch(`/api/processos/${processoId}/custos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custos })
      })

      if (response.ok) {
        setTemAlteracoes(false)
        await carregarDados()
      } else {
        alert("Erro ao salvar custos")
      }
    } catch (error) {
      console.error("Erro ao salvar:", error)
      alert("Erro ao salvar custos")
    } finally {
      setSaving(false)
    }
  }

  // Adicionar novo tipo de serviço
  const adicionarServico = async () => {
    if (!novoServico.trim()) return

    try {
      setAddingServico(true)
      const response = await fetch(`/api/processos/${processoId}/servicos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoServico.trim() })
      })

      if (response.ok) {
        setNovoServico("")
        setShowAddServico(false)
        await carregarDados()
      } else {
        alert("Erro ao adicionar serviço")
      }
    } catch (error) {
      console.error("Erro ao adicionar serviço:", error)
    } finally {
      setAddingServico(false)
    }
  }

  // Renomear tipo de serviço
  const iniciarEdicaoNome = (servico: TipoServico) => {
    setEditandoServico(servico.id)
    setNovoNomeServico(servico.nome)
  }

  const cancelarEdicaoNome = () => {
    setEditandoServico(null)
    setNovoNomeServico("")
  }

  const salvarNomeServico = async (servicoId: number) => {
    if (!novoNomeServico.trim()) return

    try {
      setSalvandoNome(true)
      const response = await fetch(`/api/processos/${processoId}/servicos/${servicoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoNomeServico.trim() })
      })

      if (response.ok) {
        setEditandoServico(null)
        setNovoNomeServico("")
        await carregarDados()
      } else {
        alert("Erro ao renomear serviço")
      }
    } catch (error) {
      console.error("Erro ao renomear serviço:", error)
    } finally {
      setSalvandoNome(false)
    }
  }

  // Remover tipo de serviço
  const removerServico = async (servicoId: number, nome: string) => {
    if (!confirm(`Deseja remover o serviço "${nome}"? Todos os valores vinculados serão perdidos.`)) {
      return
    }

    try {
      const response = await fetch(`/api/processos/${processoId}/servicos/${servicoId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await carregarDados()
      } else {
        alert("Erro ao remover serviço")
      }
    } catch (error) {
      console.error("Erro ao remover serviço:", error)
    }
  }

  // Formatar valor para exibição
  const formatarMoeda = (valor: number) => {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    )
  }

  // Se não há pessoas com documentos
  if (pessoas.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-600 mb-2">Nenhuma pessoa com documentos</h3>
        <p className="text-sm text-gray-400 max-w-md mx-auto">
          Adicione documentos às pessoas na aba "Árvore Genealógica" para que elas apareçam aqui na planilha de custos.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header com ações */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-gray-800">Custos por Pessoa</h3>
          <span className="text-sm text-gray-500">({pessoas.length} pessoa{pessoas.length !== 1 ? 's' : ''} com documentos)</span>
        </div>
        <div className="flex items-center gap-2">
          {temAlteracoes && (
            <button
              onClick={salvarAlteracoes}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Salvar
            </button>
          )}
          <button
            onClick={() => setShowAddServico(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition"
          >
            <Plus className="w-4 h-4" />
            Adicionar Serviço
          </button>
        </div>
      </div>

      {/* Modal adicionar serviço */}
      {showAddServico && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={novoServico}
              onChange={(e) => setNovoServico(e.target.value)}
              placeholder="Nome do serviço (ex: Procuração)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              onKeyPress={(e) => e.key === 'Enter' && adicionarServico()}
              autoFocus
            />
            <button
              onClick={adicionarServico}
              disabled={addingServico || !novoServico.trim()}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition disabled:opacity-50"
            >
              {addingServico ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar"}
            </button>
            <button
              onClick={() => {
                setShowAddServico(false)
                setNovoServico("")
              }}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabela de custos */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-4 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-100 min-w-[180px]">
                Pessoa
              </th>
              {servicos.map(servico => (
                <th key={servico.id} className="px-3 py-3 text-center font-semibold text-gray-700 min-w-[180px] whitespace-nowrap">
                  {editandoServico === servico.id ? (
                    // Modo edição
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={novoNomeServico}
                        onChange={(e) => setNovoNomeServico(e.target.value)}
                        className="w-full px-2 py-1 text-sm border border-amber-300 rounded focus:ring-2 focus:ring-amber-500"
                        onKeyPress={(e) => e.key === 'Enter' && salvarNomeServico(servico.id)}
                        autoFocus
                      />
                      <button
                        onClick={() => salvarNomeServico(servico.id)}
                        disabled={salvandoNome}
                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                        title="Salvar"
                      >
                        {salvandoNome ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={cancelarEdicaoNome}
                        className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                        title="Cancelar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    // Modo visualização
                    <div className="flex items-center justify-center gap-1 group">
                      <span title={servico.nome}>
                        {servico.nome}
                      </span>
                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => iniciarEdicaoNome(servico)}
                          className="p-1 text-gray-400 hover:text-amber-500 transition"
                          title="Renomear"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removerServico(servico.id, servico.nome)}
                          className="p-1 text-gray-400 hover:text-red-500 transition"
                          title="Remover"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </th>
              ))}
              <th className="px-4 py-3 text-right font-semibold text-gray-700 bg-amber-50 min-w-[120px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {pessoas.map((pessoa, idx) => (
              <tr 
                key={pessoa.id} 
                className={`group border-t border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-amber-50/30 transition`}
              >
                <td className={`px-4 py-2 font-medium text-gray-800 sticky left-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} group-hover:bg-amber-50/30`}>
                  {pessoa.nomeCompleto}
                </td>
                {servicos.map(servico => (
                  <td key={servico.id} className="px-2 py-2 text-center">
                    <input
                      type="text"
                      value={valoresEditados[`${pessoa.id}-${servico.id}`] || ''}
                      onChange={(e) => handleValorChange(pessoa.id, servico.id, e.target.value)}
                      placeholder="0,00"
                      className="w-full px-2 py-1 text-right text-sm border border-gray-200 rounded focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
                    />
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-semibold text-amber-700 bg-amber-50/50">
                  {formatarMoeda(calcularTotalPessoa(pessoa.id))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
              <td className="px-4 py-3 text-gray-700 sticky left-0 bg-gray-100">
                TOTAL
              </td>
              {servicos.map(servico => (
                <td key={servico.id} className="px-3 py-3 text-center text-gray-700">
                  {formatarMoeda(calcularTotalServico(servico.id))}
                </td>
              ))}
              <td className="px-4 py-3 text-right text-lg text-amber-700 bg-amber-100">
                {formatarMoeda(calcularTotalGeral())}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Resumo */}
      <div className="flex justify-end">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-4 rounded-xl shadow-lg">
          <p className="text-sm opacity-90">Total Geral do Processo</p>
          <p className="text-2xl font-bold">{formatarMoeda(calcularTotalGeral())}</p>
        </div>
      </div>
    </div>
  )
}