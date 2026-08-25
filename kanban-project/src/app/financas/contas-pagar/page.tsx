// CRIAR EM: src/app/financas/contas-pagar/page.tsx

"use client"

import { useState, useEffect } from "react"
import { 
  Plus, 
  Search, 
  Download,
  MoreHorizontal,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Eye,
  Edit,
  Trash2,
  CreditCard,
  Calendar
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { useApi } from "@/src/lib/dados"

interface ContaPagar {
  id: number
  descricao: string
  fornecedor: { id: number; nome: string } | null
  categoria: { id: number; nome: string } | null
  valor: number
  valorPago: number | null
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'CANCELADO' | 'AGENDADO'
  dataEmissao: string
  dataVencimento: string
  dataPagamento: string | null
  formaPagamento: string | null
}

const statusConfig = {
  PENDENTE: { label: 'Pendente', color: 'bg-[var(--surface-secondary)] text-amber-700', icon: Clock },
  PAGO: { label: 'Pago', color: 'bg-[var(--surface-secondary)] text-green-700', icon: CheckCircle },
  VENCIDO: { label: 'Vencido', color: 'bg-[var(--surface-secondary)] text-red-700', icon: AlertTriangle },
  CANCELADO: { label: 'Cancelado', color: 'bg-gray-500/20 text-[var(--text-muted)]', icon: XCircle },
  AGENDADO: { label: 'Agendado', color: 'bg-[var(--surface-secondary)] text-[var(--text-secondary)]', icon: Calendar },
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function ContasPagarPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    descricao: "",
    valor: "",
    dataVencimento: "",
    fornecedorId: "",
    categoriaId: "",
    observacoes: "",
  })

  // Consulta em cache (src/lib/dados): o endpoint devolve a lista direto,
  // então a resposta É a lista. loading e erro derivam da camada.
  const { dados, carregando: loading, erro: erroApi, recarregar: fetchContas } = useApi<ContaPagar[]>('/api/contas-pagar')
  const contas: ContaPagar[] = dados ?? SEM_ITENS
  const erro = erroApi ? (erroApi.message || 'Não foi possível carregar as contas a pagar.') : null



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

  const filteredContas = contas.filter(conta => {
    const matchesSearch = conta.descricao.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (conta.fornecedor?.nome.toLowerCase().includes(searchTerm.toLowerCase()) ?? false)
    const matchesStatus = statusFilter === "todos" || conta.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const totais = {
    total: filteredContas.reduce((acc, c) => acc + c.valor, 0),
    pendente: filteredContas.filter(c => c.status === 'PENDENTE' || c.status === 'AGENDADO').reduce((acc, c) => acc + c.valor, 0),
    vencido: filteredContas.filter(c => c.status === 'VENCIDO').reduce((acc, c) => acc + c.valor, 0),
    pago: filteredContas.filter(c => c.status === 'PAGO').reduce((acc, c) => acc + (c.valorPago || 0), 0),
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Implementar criação de conta a pagar
    console.log("Form data:", formData)
    setIsDialogOpen(false)
    setFormData({
      descricao: "",
      valor: "",
      dataVencimento: "",
      fornecedorId: "",
      categoriaId: "",
      observacoes: "",
    })
  }

  return (
    <div className="space-y-6">
      {erro && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3 text-sm text-red-700"
        >
          {erro} Tente novamente em instantes — nenhum dado foi exibido no lugar.
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Contas a Pagar</h1>
          <p className="text-white/70">Gerencie suas despesas e pagamentos</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-red-600 hover:bg-red-700">
              <Plus className="h-4 w-4 mr-2" />
              Nova Despesa
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[var(--surface-overlay)] border-[var(--border-strong)] text-[var(--text-primary)] max-w-lg">
            <DialogHeader>
              <DialogTitle>Nova Conta a Pagar</DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                Adicione uma nova despesa ou conta a pagar
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="descricao">Descrição *</Label>
                <Input
                  id="descricao"
                  value={formData.descricao}
                  onChange={(e) => setFormData(prev => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Ex: Aluguel do escritório"
                  className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="valor">Valor *</Label>
                  <Input
                    id="valor"
                    type="number"
                    step="0.01"
                    value={formData.valor}
                    onChange={(e) => setFormData(prev => ({ ...prev, valor: e.target.value }))}
                    placeholder="0,00"
                    className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="dataVencimento">Vencimento *</Label>
                  <DatePickerField
                    value={formData.dataVencimento}
                    onChange={(value) => setFormData(prev => ({ ...prev, dataVencimento: value }))}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="observacoes">Observações</Label>
                <Textarea
                  id="observacoes"
                  value={formData.observacoes}
                  onChange={(e) => setFormData(prev => ({ ...prev, observacoes: e.target.value }))}
                  placeholder="Informações adicionais..."
                  className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                  rows={3}
                />
              </div>
              
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-red-600 hover:bg-red-700">
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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
            <p className="text-sm text-white/70">A Pagar</p>
            <p className="text-xl font-bold text-amber-700">{formatCurrency(totais.pendente)}</p>
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
            <p className="text-sm text-white/70">Pago</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totais.pago)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
          <Input
            placeholder="Buscar por descrição ou fornecedor..."
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
            <SelectItem value="AGENDADO">Agendado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="border-[var(--border-strong)] text-white hover:bg-[var(--surface-hover)]">
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
          ) : filteredContas.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--text-secondary)]">
              <CreditCard className="h-12 w-12 mb-4" />
              <p>Nenhuma conta encontrada</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left p-4 text-sm font-medium text-white/70">Descrição</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Fornecedor</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Categoria</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Valor</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Vencimento</th>
                  <th className="text-left p-4 text-sm font-medium text-white/70">Status</th>
                  <th className="text-right p-4 text-sm font-medium text-white/70">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredContas.map((conta) => {
                  const StatusIcon = statusConfig[conta.status].icon
                  
                  return (
                    <tr key={conta.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]">
                      <td className="p-4">
                        <p className="text-white font-medium">{conta.descricao}</p>
                      </td>
                      <td className="p-4 text-white/70">
                        {conta.fornecedor?.nome || '-'}
                      </td>
                      <td className="p-4 text-white/70">
                        {conta.categoria?.nome || '-'}
                      </td>
                      <td className="p-4">
                        <p className="text-white font-semibold">{formatCurrency(conta.valor)}</p>
                        {conta.valorPago && conta.valorPago > 0 && (
                          <p className="text-xs text-green-700">Pago: {formatCurrency(conta.valorPago)}</p>
                        )}
                      </td>
                      <td className="p-4 text-white/70">
                        {formatDate(conta.dataVencimento)}
                      </td>
                      <td className="p-4">
                        <Badge className={statusConfig[conta.status].color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusConfig[conta.status].label}
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
                            {(conta.status === 'PENDENTE' || conta.status === 'VENCIDO') && (
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