// CRIAR EM: src/app/financas/fluxo-caixa/page.tsx

"use client"

import { useState, useEffect } from "react"
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar,
  Filter,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ChevronLeft,
  ChevronRight
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Transacao {
  id: number
  tipo: 'ENTRADA' | 'SAIDA'
  descricao: string
  valor: number
  data: string
  categoria: { id: number; nome: string } | null
  contaBancaria: { id: number; nome: string }
}

interface ResumoFluxo {
  saldoAnterior: number
  entradas: number
  saidas: number
  saldoAtual: number
}

export default function FluxoCaixaPage() {
  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [resumo, setResumo] = useState<ResumoFluxo>({
    saldoAnterior: 0,
    entradas: 0,
    saidas: 0,
    saldoAtual: 0
  })
  const [loading, setLoading] = useState(true)
  const [mesAtual, setMesAtual] = useState(new Date())
  const [filtroTipo, setFiltroTipo] = useState<string>("todos")

  useEffect(() => {
    fetchDados()
  }, [mesAtual])

  const fetchDados = async () => {
    try {
      // TODO: Implementar API
      // Por enquanto, dados de exemplo
      setResumo({
        saldoAnterior: 65000,
        entradas: 32000,
        saidas: 18000,
        saldoAtual: 79000
      })

      setTransacoes([
        {
          id: 1,
          tipo: 'ENTRADA',
          descricao: 'Recebimento - Processo Silva',
          valor: 5000,
          data: '2026-01-03',
          categoria: { id: 1, nome: 'Serviços' },
          contaBancaria: { id: 1, nome: 'Conta Principal' }
        },
        {
          id: 2,
          tipo: 'SAIDA',
          descricao: 'Pagamento - Internet Vivo',
          valor: 450,
          data: '2026-01-03',
          categoria: { id: 2, nome: 'Telecomunicações' },
          contaBancaria: { id: 1, nome: 'Conta Principal' }
        },
        {
          id: 3,
          tipo: 'ENTRADA',
          descricao: 'Recebimento - Processo Oliveira',
          valor: 2500,
          data: '2026-01-02',
          categoria: { id: 1, nome: 'Serviços' },
          contaBancaria: { id: 1, nome: 'Conta Principal' }
        },
        {
          id: 4,
          tipo: 'SAIDA',
          descricao: 'Pagamento - Material escritório',
          valor: 350,
          data: '2026-01-02',
          categoria: { id: 3, nome: 'Material' },
          contaBancaria: { id: 1, nome: 'Conta Principal' }
        },
        {
          id: 5,
          tipo: 'ENTRADA',
          descricao: 'Recebimento - Processo Ferreira',
          valor: 8000,
          data: '2026-01-01',
          categoria: { id: 1, nome: 'Serviços' },
          contaBancaria: { id: 1, nome: 'Conta Principal' }
        },
      ])
    } catch (error) {
      console.error("Erro ao carregar dados:", error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR')
  }

  const formatMesAno = (date: Date) => {
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  }

  const navegarMes = (direcao: number) => {
    const novaData = new Date(mesAtual)
    novaData.setMonth(novaData.getMonth() + direcao)
    setMesAtual(novaData)
  }

  const filteredTransacoes = transacoes.filter(t => {
    if (filtroTipo === "todos") return true
    return t.tipo === filtroTipo
  })

  // Agrupar por data
  const transacoesPorData = filteredTransacoes.reduce((acc, transacao) => {
    const data = transacao.data
    if (!acc[data]) {
      acc[data] = []
    }
    acc[data].push(transacao)
    return acc
  }, {} as Record<string, Transacao[]>)

  const datasOrdenadas = Object.keys(transacoesPorData).sort((a, b) => 
    new Date(b).getTime() - new Date(a).getTime()
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Fluxo de Caixa</h1>
          <p className="text-white/70">Movimentações financeiras</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => navegarMes(-1)}
            className="border-white/20 text-white hover:bg-white/10"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-4 py-2 bg-white/10 rounded-lg border border-white/20 min-w-[180px] text-center">
            <span className="text-white capitalize">{formatMesAno(mesAtual)}</span>
          </div>
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => navegarMes(1)}
            className="border-white/20 text-white hover:bg-white/10"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white/10 border-white/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white/70">Saldo Anterior</p>
              <DollarSign className="h-4 w-4 text-white/50" />
            </div>
            <p className="text-xl font-bold text-white mt-1">{formatCurrency(resumo.saldoAnterior)}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-white/10 border-white/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white/70">Entradas</p>
              <ArrowUpRight className="h-4 w-4 text-green-400" />
            </div>
            <p className="text-xl font-bold text-green-400 mt-1">+ {formatCurrency(resumo.entradas)}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-white/10 border-white/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white/70">Saídas</p>
              <ArrowDownRight className="h-4 w-4 text-red-400" />
            </div>
            <p className="text-xl font-bold text-red-400 mt-1">- {formatCurrency(resumo.saidas)}</p>
          </CardContent>
        </Card>
        
        <Card className="bg-white/10 border-white/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white/70">Saldo Atual</p>
              {resumo.saldoAtual >= resumo.saldoAnterior ? (
                <TrendingUp className="h-4 w-4 text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-400" />
              )}
            </div>
            <p className={`text-xl font-bold mt-1 ${resumo.saldoAtual >= resumo.saldoAnterior ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(resumo.saldoAtual)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-4">
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="w-[180px] bg-white/10 border-white/20 text-white">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas</SelectItem>
            <SelectItem value="ENTRADA">Entradas</SelectItem>
            <SelectItem value="SAIDA">Saídas</SelectItem>
          </SelectContent>
        </Select>
        
        <Button variant="outline" className="border-white/20 text-white hover:bg-white/10 ml-auto">
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </div>

      {/* Lista de transações agrupadas por data */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        ) : datasOrdenadas.length === 0 ? (
          <Card className="bg-white/10 border-white/20">
            <CardContent className="flex flex-col items-center justify-center h-48 text-white/50">
              <DollarSign className="h-12 w-12 mb-4" />
              <p>Nenhuma transação no período</p>
            </CardContent>
          </Card>
        ) : (
          datasOrdenadas.map((data) => {
            const transacoesDoDia = transacoesPorData[data]
            const totalEntradas = transacoesDoDia.filter(t => t.tipo === 'ENTRADA').reduce((acc, t) => acc + t.valor, 0)
            const totalSaidas = transacoesDoDia.filter(t => t.tipo === 'SAIDA').reduce((acc, t) => acc + t.valor, 0)
            
            return (
              <Card key={data} className="bg-white/10 border-white/20">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white text-sm font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-white/50" />
                      {formatDate(data)}
                    </CardTitle>
                    <div className="flex gap-4 text-sm">
                      {totalEntradas > 0 && (
                        <span className="text-green-400">+ {formatCurrency(totalEntradas)}</span>
                      )}
                      {totalSaidas > 0 && (
                        <span className="text-red-400">- {formatCurrency(totalSaidas)}</span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {transacoesDoDia.map((transacao) => (
                      <div 
                        key={transacao.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {transacao.tipo === 'ENTRADA' ? (
                            <div className="p-2 rounded-full bg-green-500/20">
                              <ArrowUpRight className="h-4 w-4 text-green-400" />
                            </div>
                          ) : (
                            <div className="p-2 rounded-full bg-red-500/20">
                              <ArrowDownRight className="h-4 w-4 text-red-400" />
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-white">{transacao.descricao}</p>
                            <div className="flex items-center gap-2 text-xs text-white/50">
                              {transacao.categoria && (
                                <Badge variant="outline" className="text-xs border-white/20 text-white/70">
                                  {transacao.categoria.nome}
                                </Badge>
                              )}
                              <span>{transacao.contaBancaria.nome}</span>
                            </div>
                          </div>
                        </div>
                        <p className={`font-semibold ${transacao.tipo === 'ENTRADA' ? 'text-green-400' : 'text-red-400'}`}>
                          {transacao.tipo === 'ENTRADA' ? '+' : '-'} {formatCurrency(transacao.valor)}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}