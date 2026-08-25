// CRIAR EM: src/app/financas/contas-receber/page.tsx

"use client"

import { useState, useEffect } from "react"
import { 
  Plus, 
  Search, 
  Filter,
  Download,
  MoreHorizontal,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Eye,
  Edit,
  Trash2,
  Receipt
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import Link from "next/link"
import { useApi } from "@/src/lib/dados"

interface Fatura {
  id: number
  descricao: string
  processo: {
    id: number
    nome: string
  }
  valor: number
  valorPago: number | null
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'CANCELADO' | 'PARCIAL'
  dataEmissao: string
  dataVencimento: string | null
  dataPagamento: string | null
}

const statusConfig = {
  PENDENTE: { label: 'Pendente', color: 'bg-yellow-50 text-yellow-700', icon: Clock },
  PAGO: { label: 'Pago', color: 'bg-green-50 text-green-700', icon: CheckCircle },
  VENCIDO: { label: 'Vencido', color: 'bg-red-50 text-red-700', icon: AlertTriangle },
  CANCELADO: { label: 'Cancelado', color: 'bg-gray-500/20 text-[var(--text-muted)]', icon: XCircle },
  PARCIAL: { label: 'Parcial', color: 'bg-blue-50 text-blue-700', icon: Clock },
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function ContasReceberPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")

  // Consulta em cache (src/lib/dados): o endpoint devolve a lista direto,
  // então a resposta É a lista. loading e erro derivam da camada.
  const { dados, carregando: loading, erro: erroApi, recarregar: fetchFaturas } = useApi<Fatura[]>('/api/faturas')
  const faturas: Fatura[] = dados ?? SEM_ITENS



  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('pt-BR')
  }

  const filteredFaturas = faturas.filter(fatura => {
    const matchesSearch = fatura.descricao.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         fatura.processo.nome.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === "todos" || fatura.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const totais = {
    total: filteredFaturas.reduce((acc, f) => acc + f.valor, 0),
    pendente: filteredFaturas.filter(f => f.status === 'PENDENTE').reduce((acc, f) => acc + f.valor, 0),
    vencido: filteredFaturas.filter(f => f.status === 'VENCIDO').reduce((acc, f) => acc + f.valor, 0),
    pago: filteredFaturas.filter(f => f.status === 'PAGO').reduce((acc, f) => acc + f.valor, 0),
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Contas a Receber</h1>
          <p className="text-white/70">Gerencie as cobranças dos processos</p>
        </div>
        <Link href="/financas/contas-receber/nova">
          <Button className="bg-green-700 hover:bg-green-800 text-[var(--action-primary-ink)]">
            <Plus className="h-4 w-4 mr-2" />
            Nova Cobrança
          </Button>
        </Link>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-[var(--surface-primary)] border-[var(--border-strong)]">
          <CardContent className="pt-4">
            <p className="text-sm text-white/70">Total</p>
            <p className="text-xl font-bold text-white">{formatCurrency(totais.total)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[var(--surface-primary)] border-[var(--border-strong)]">
          <CardContent className="pt-4">
            <p className="text-sm text-white/70">Pendente</p>
            <p className="text-xl font-bold text-yellow-700">{formatCurrency(totais.pendente)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[var(--surface-primary)] border-[var(--border-strong)]">
          <CardContent className="pt-4">
            <p className="text-sm text-white/70">Vencido</p>
            <p className="text-xl font-bold text-red-700">{formatCurrency(totais.vencido)}</p>
          </CardContent>
        </Card>
        <Card className="bg-[var(--surface-primary)] border-[var(--border-strong)]">
          <CardContent className="pt-4">
            <p className="text-sm text-white/70">Recebido</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totais.pago)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
          <Input
            placeholder="Buscar por descrição ou processo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-[var(--surface-primary)] border-[var(--border-strong)] text-white placeholder:text-[var(--text-secondary)]"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] bg-[var(--surface-primary)] border-[var(--border-strong)] text-white">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="PENDENTE">Pendente</SelectItem>
            <SelectItem value="VENCIDO">Vencido</SelectItem>
            <SelectItem value="PAGO">Pago</SelectItem>
            <SelectItem value="PARCIAL">Parcial</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </div>

      {/* Tabela */}
      <Card className="bg-[var(--surface-primary)] border-[var(--border-strong)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--border-default)]"></div>
            </div>
          ) : filteredFaturas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--text-secondary)]">
              <Receipt className="h-12 w-12 mb-4" />
              <p>Nenhuma cobrança encontrada</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left p-4 text-sm font-medium text-white/70">Descrição</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Processo</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Valor</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Vencimento</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Status</th>
                  <th className="text-right p-4 text-sm font-medium text-white/70">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredFaturas.map((fatura) => {
                  const StatusIcon = statusConfig[fatura.status].icon
                  
                  return (
                    <tr key={fatura.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]">
                      <td className="p-4">
                        <p className="text-white font-medium">{fatura.descricao}</p>
                        <p className="text-xs text-[var(--text-secondary)]">Emitido em {formatDate(fatura.dataEmissao)}</p>
                      </td>
                      <td className="p-4">
                        <Link 
                          href={`/kanban?processo=${fatura.processo.id}`}
                          className="text-blue-700 hover:underline"
                        >
                          {fatura.processo.nome}
                        </Link>
                      </td>
                      <td className="p-4">
                        <p className="text-white font-semibold">{formatCurrency(fatura.valor)}</p>
                        {fatura.valorPago && fatura.valorPago > 0 && (
                          <p className="text-xs text-green-700">Pago: {formatCurrency(fatura.valorPago)}</p>
                        )}
                      </td>
                      <td className="p-4 text-white/70">
                        {formatDate(fatura.dataVencimento)}
                      </td>
                      <td className="p-4">
                        <Badge className={statusConfig[fatura.status].color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusConfig[fatura.status].label}
                        </Badge>
                      </td>
                      <td className="p-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-white/70 hover:text-white">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <Eye className="h-4 w-4 mr-2" />
                              Ver detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Edit className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            {fatura.status === 'PENDENTE' && (
                              <DropdownMenuItem className="text-green-700">
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Registrar pagamento
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem className="text-red-700">
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}