// CRIAR EM: src/app/financas/page.tsx

"use client"

import { useState, useEffect } from "react"
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Receipt, 
  CreditCard,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  PiggyBank
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

interface ResumoFinanceiro {
  totalReceber: number
  totalReceberVencido: number
  totalPagar: number
  totalPagarVencido: number
  saldoContas: number
  entradasMes: number
  saidasMes: number
  saldoMes: number
}

interface ContaVencendo {
  id: number
  descricao: string
  valor: number
  dataVencimento: string
  tipo: 'receber' | 'pagar'
}

export default function FinancasDashboard() {
  const [resumo, setResumo] = useState<ResumoFinanceiro>({
    totalReceber: 0,
    totalReceberVencido: 0,
    totalPagar: 0,
    totalPagarVencido: 0,
    saldoContas: 0,
    entradasMes: 0,
    saidasMes: 0,
    saldoMes: 0,
  })
  const [contasVencendo, setContasVencendo] = useState<ContaVencendo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDados()
  }, [])

  const fetchDados = async () => {
    try {
      // Por enquanto, dados de exemplo
      // TODO: Implementar API
      setResumo({
        totalReceber: 45000,
        totalReceberVencido: 5000,
        totalPagar: 12000,
        totalPagarVencido: 2000,
        saldoContas: 78500,
        entradasMes: 32000,
        saidasMes: 18000,
        saldoMes: 14000,
      })

      setContasVencendo([
        { id: 1, descricao: "Processo Silva - Parcela 2/6", valor: 2500, dataVencimento: "2026-01-05", tipo: 'receber' },
        { id: 2, descricao: "Aluguel escritório", valor: 3500, dataVencimento: "2026-01-10", tipo: 'pagar' },
        { id: 3, descricao: "Processo Oliveira - Entrada", valor: 5000, dataVencimento: "2026-01-08", tipo: 'receber' },
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard Financeiro</h1>
          <p className="text-white/70">Visão geral das finanças da empresa</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <Calendar className="h-4 w-4 mr-2" />
            Janeiro 2026
          </Button>
        </div>
      </div>

      {/* Cards principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Saldo em Contas */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-white/70">Saldo em Contas</CardTitle>
            <PiggyBank className="h-4 w-4 text-white/50" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{formatCurrency(resumo.saldoContas)}</div>
            <p className="text-xs text-white/50 mt-1">Total disponível</p>
          </CardContent>
        </Card>

        {/* A Receber */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-white/70">A Receber</CardTitle>
            <Receipt className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">{formatCurrency(resumo.totalReceber)}</div>
            {resumo.totalReceberVencido > 0 && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {formatCurrency(resumo.totalReceberVencido)} vencido
              </p>
            )}
          </CardContent>
        </Card>

        {/* A Pagar */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-white/70">A Pagar</CardTitle>
            <CreditCard className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-400">{formatCurrency(resumo.totalPagar)}</div>
            {resumo.totalPagarVencido > 0 && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {formatCurrency(resumo.totalPagarVencido)} vencido
              </p>
            )}
          </CardContent>
        </Card>

        {/* Saldo do Mês */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-white/70">Saldo do Mês</CardTitle>
            {resumo.saldoMes >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-400" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${resumo.saldoMes >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(resumo.saldoMes)}
            </div>
            <div className="flex gap-4 mt-1">
              <span className="text-xs text-green-400 flex items-center gap-0.5">
                <ArrowUpRight className="h-3 w-3" />
                {formatCurrency(resumo.entradasMes)}
              </span>
              <span className="text-xs text-red-400 flex items-center gap-0.5">
                <ArrowDownRight className="h-3 w-3" />
                {formatCurrency(resumo.saidasMes)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Seção inferior */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contas Vencendo */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              Próximos Vencimentos
            </CardTitle>
            <CardDescription className="text-white/50">
              Contas a vencer nos próximos 7 dias
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {contasVencendo.map((conta) => (
                <div 
                  key={conta.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {conta.tipo === 'receber' ? (
                      <div className="p-2 rounded-full bg-green-500/20">
                        <ArrowUpRight className="h-4 w-4 text-green-400" />
                      </div>
                    ) : (
                      <div className="p-2 rounded-full bg-red-500/20">
                        <ArrowDownRight className="h-4 w-4 text-red-400" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">{conta.descricao}</p>
                      <p className="text-xs text-white/50">Vence em {formatDate(conta.dataVencimento)}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${conta.tipo === 'receber' ? 'text-green-400' : 'text-red-400'}`}>
                      {conta.tipo === 'receber' ? '+' : '-'} {formatCurrency(conta.valor)}
                    </p>
                  </div>
                </div>
              ))}
              
              {contasVencendo.length === 0 && (
                <p className="text-center text-white/50 py-4">Nenhuma conta vencendo</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Ações Rápidas */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white">Ações Rápidas</CardTitle>
            <CardDescription className="text-white/50">
              Acesse as principais funções
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/financas/contas-receber/nova">
                <Button 
                  variant="outline" 
                  className="w-full h-20 flex-col gap-2 border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500/50"
                >
                  <Receipt className="h-5 w-5" />
                  <span className="text-xs">Nova Cobrança</span>
                </Button>
              </Link>
              
              <Link href="/financas/contas-pagar/nova">
                <Button 
                  variant="outline" 
                  className="w-full h-20 flex-col gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                >
                  <CreditCard className="h-5 w-5" />
                  <span className="text-xs">Nova Despesa</span>
                </Button>
              </Link>
              
              <Link href="/financas/fluxo-caixa">
                <Button 
                  variant="outline" 
                  className="w-full h-20 flex-col gap-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/50"
                >
                  <DollarSign className="h-5 w-5" />
                  <span className="text-xs">Fluxo de Caixa</span>
                </Button>
              </Link>
              
              <Link href="/financas/relatorios">
                <Button 
                  variant="outline" 
                  className="w-full h-20 flex-col gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/50"
                >
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-xs">Relatórios</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}