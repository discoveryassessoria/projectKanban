// CRIAR EM: src/app/financas/fornecedores/page.tsx

"use client"

import { useState, useEffect } from "react"
import { 
  Plus, 
  Search, 
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Users,
  Building,
  User,
  Phone,
  Mail
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApi } from "@/src/lib/dados"

interface Fornecedor {
  id: number
  nome: string
  nomeFantasia: string | null
  tipo: 'PF' | 'PJ'
  cpfCnpj: string | null
  telefone: string | null
  celular: string | null
  email: string | null
  cidade: string | null
  estado: string | null
  ativo: boolean
  totalContas: number
  totalPago: number
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function FornecedoresPage() {
  const [searchTerm, setSearchTerm] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    nome: "",
    nomeFantasia: "",
    tipo: "PJ" as 'PF' | 'PJ',
    cpfCnpj: "",
    telefone: "",
    celular: "",
    email: "",
    cep: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    banco: "",
    agencia: "",
    conta: "",
    tipoConta: "",
    chavePix: "",
    observacoes: "",
  })

  // Consulta em cache (src/lib/dados): o endpoint devolve a lista direto,
  // então a resposta É a lista. loading e erro derivam da camada.
  const { dados, carregando: loading, erro: erroApi, recarregar: fetchFornecedores } = useApi<Fornecedor[]>('/api/fornecedores')
  const fornecedores: Fornecedor[] = dados ?? SEM_ITENS
  const erro = erroApi ? (erroApi.message || 'Não foi possível carregar os fornecedores.') : null



  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value)
  }

  const filteredFornecedores = fornecedores.filter(fornecedor => {
    return fornecedor.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
           (fornecedor.nomeFantasia?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
           (fornecedor.cpfCnpj?.includes(searchTerm) ?? false)
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Implementar criação de fornecedor
    console.log("Form data:", formData)
    setIsDialogOpen(false)
    // Reset form
    setFormData({
      nome: "",
      nomeFantasia: "",
      tipo: "PJ",
      cpfCnpj: "",
      telefone: "",
      celular: "",
      email: "",
      cep: "",
      endereco: "",
      numero: "",
      complemento: "",
      bairro: "",
      cidade: "",
      estado: "",
      banco: "",
      agencia: "",
      conta: "",
      tipoConta: "",
      chavePix: "",
      observacoes: "",
    })
  }

  return (
    <div className="space-y-6">
      {erro && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {erro} Tente novamente em instantes — nenhum dado foi exibido no lugar.
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Fornecedores</h1>
          <p className="text-white/70">Gerencie seus fornecedores e prestadores de serviço</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)]">
              <Plus className="h-4 w-4 mr-2" />
              Novo Fornecedor
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[var(--surface-overlay)] border-[var(--border-strong)] text-[var(--text-primary)] max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Novo Fornecedor</DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                Cadastre um novo fornecedor ou prestador de serviço
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={handleSubmit}>
              <Tabs defaultValue="dados" className="w-full">
                <TabsList className="grid w-full grid-cols-3 bg-[var(--surface-primary)]">
                  <TabsTrigger value="dados">Dados Básicos</TabsTrigger>
                  <TabsTrigger value="endereco">Endereço</TabsTrigger>
                  <TabsTrigger value="bancario">Dados Bancários</TabsTrigger>
                </TabsList>
                
                <TabsContent value="dados" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo *</Label>
                      <Select 
                        value={formData.tipo} 
                        onValueChange={(v) => setFormData(prev => ({ ...prev, tipo: v as 'PF' | 'PJ' }))}
                      >
                        <SelectTrigger className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                          <SelectItem value="PF">Pessoa Física</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>{formData.tipo === 'PJ' ? 'CNPJ' : 'CPF'}</Label>
                      <Input
                        value={formData.cpfCnpj}
                        onChange={(e) => setFormData(prev => ({ ...prev, cpfCnpj: e.target.value }))}
                        placeholder={formData.tipo === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>{formData.tipo === 'PJ' ? 'Razão Social' : 'Nome Completo'} *</Label>
                    <Input
                      value={formData.nome}
                      onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
                      placeholder={formData.tipo === 'PJ' ? 'Razão Social da Empresa' : 'Nome Completo'}
                      className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      required
                    />
                  </div>
                  
                  {formData.tipo === 'PJ' && (
                    <div className="space-y-2">
                      <Label>Nome Fantasia</Label>
                      <Input
                        value={formData.nomeFantasia}
                        onChange={(e) => setFormData(prev => ({ ...prev, nomeFantasia: e.target.value }))}
                        placeholder="Nome Fantasia"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Telefone</Label>
                      <Input
                        value={formData.telefone}
                        onChange={(e) => setFormData(prev => ({ ...prev, telefone: e.target.value }))}
                        placeholder="(00) 0000-0000"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Celular</Label>
                      <Input
                        value={formData.celular}
                        onChange={(e) => setFormData(prev => ({ ...prev, celular: e.target.value }))}
                        placeholder="(00) 00000-0000"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>E-mail</Label>
                    <Input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="email@exemplo.com"
                      className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="endereco" className="space-y-4 mt-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>CEP</Label>
                      <Input
                        value={formData.cep}
                        onChange={(e) => setFormData(prev => ({ ...prev, cep: e.target.value }))}
                        placeholder="00000-000"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Endereço</Label>
                      <Input
                        value={formData.endereco}
                        onChange={(e) => setFormData(prev => ({ ...prev, endereco: e.target.value }))}
                        placeholder="Rua, Avenida..."
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Número</Label>
                      <Input
                        value={formData.numero}
                        onChange={(e) => setFormData(prev => ({ ...prev, numero: e.target.value }))}
                        placeholder="123"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Complemento</Label>
                      <Input
                        value={formData.complemento}
                        onChange={(e) => setFormData(prev => ({ ...prev, complemento: e.target.value }))}
                        placeholder="Sala 101"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Bairro</Label>
                      <Input
                        value={formData.bairro}
                        onChange={(e) => setFormData(prev => ({ ...prev, bairro: e.target.value }))}
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Cidade</Label>
                      <Input
                        value={formData.cidade}
                        onChange={(e) => setFormData(prev => ({ ...prev, cidade: e.target.value }))}
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Estado</Label>
                      <Input
                        value={formData.estado}
                        onChange={(e) => setFormData(prev => ({ ...prev, estado: e.target.value }))}
                        placeholder="SP"
                        maxLength={2}
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="bancario" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Banco</Label>
                      <Input
                        value={formData.banco}
                        onChange={(e) => setFormData(prev => ({ ...prev, banco: e.target.value }))}
                        placeholder="Nome do Banco"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo de Conta</Label>
                      <Select 
                        value={formData.tipoConta} 
                        onValueChange={(v) => setFormData(prev => ({ ...prev, tipoConta: v }))}
                      >
                        <SelectTrigger className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="corrente">Conta Corrente</SelectItem>
                          <SelectItem value="poupanca">Poupança</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Agência</Label>
                      <Input
                        value={formData.agencia}
                        onChange={(e) => setFormData(prev => ({ ...prev, agencia: e.target.value }))}
                        placeholder="0000"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Conta</Label>
                      <Input
                        value={formData.conta}
                        onChange={(e) => setFormData(prev => ({ ...prev, conta: e.target.value }))}
                        placeholder="00000-0"
                        className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Chave Pix</Label>
                    <Input
                      value={formData.chavePix}
                      onChange={(e) => setFormData(prev => ({ ...prev, chavePix: e.target.value }))}
                      placeholder="CPF, CNPJ, E-mail, Telefone ou Chave Aleatória"
                      className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Observações</Label>
                    <Textarea
                      value={formData.observacoes}
                      onChange={(e) => setFormData(prev => ({ ...prev, observacoes: e.target.value }))}
                      placeholder="Informações adicionais..."
                      className="bg-[var(--surface-primary)] border-[var(--border-strong)] text-white"
                      rows={3}
                    />
                  </div>
                </TabsContent>
              </Tabs>
              
              <DialogFooter className="mt-6">
                <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)]">
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filtros */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
          <Input
            placeholder="Buscar por nome, fantasia ou documento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-[var(--surface-primary)] border-[var(--border-strong)] text-white placeholder:text-[var(--text-secondary)]"
          />
        </div>
      </div>

      {/* Grid de fornecedores */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--border-default)]"></div>
        </div>
      ) : filteredFornecedores.length === 0 ? (
        <Card className="bg-[var(--surface-primary)] border-[var(--border-strong)]">
          <CardContent className="flex flex-col items-center justify-center h-48 text-[var(--text-secondary)]">
            <Users className="h-12 w-12 mb-4" />
            <p>Nenhum fornecedor encontrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFornecedores.map((fornecedor) => (
            <Card key={fornecedor.id} className="bg-[var(--surface-primary)] border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${fornecedor.tipo === 'PJ' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                      {fornecedor.tipo === 'PJ' ? (
                        <Building className="h-5 w-5 text-blue-700" />
                      ) : (
                        <User className="h-5 w-5 text-slate-700" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-white">{fornecedor.nomeFantasia || fornecedor.nome}</p>
                      {fornecedor.nomeFantasia && (
                        <p className="text-xs text-[var(--text-secondary)]">{fornecedor.nome}</p>
                      )}
                    </div>
                  </div>
                  
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
                      <DropdownMenuItem className="text-red-700">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                
                <div className="mt-4 space-y-2">
                  {fornecedor.cpfCnpj && (
                    <p className="text-sm text-white/70">
                      {fornecedor.tipo === 'PJ' ? 'CNPJ' : 'CPF'}: {fornecedor.cpfCnpj}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
                    {(fornecedor.telefone || fornecedor.celular) && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {fornecedor.celular || fornecedor.telefone}
                      </span>
                    )}
                    {fornecedor.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {fornecedor.email.length > 20 ? fornecedor.email.substring(0, 20) + '...' : fornecedor.email}
                      </span>
                    )}
                  </div>
                  
                  {fornecedor.cidade && fornecedor.estado && (
                    <p className="text-sm text-[var(--text-secondary)]">{fornecedor.cidade}/{fornecedor.estado}</p>
                  )}
                </div>
                
                <div className="mt-4 pt-4 border-t border-[var(--border-default)] flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{fornecedor.totalContas} contas</span>
                  <span className="text-white font-medium">{formatCurrency(fornecedor.totalPago)} pago</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}