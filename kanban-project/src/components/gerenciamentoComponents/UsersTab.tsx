// CRIAR EM: src/components/gerenciamentoComponents/UsersTab.tsx
//
// Aba "Usuários" do Gerenciamento — REAL. Porta a lógica completa da antiga
// administrator/page.tsx (criar/editar/excluir + sistema de permissões custom
// por usuário, com override sobre o perfil). Usa as APIs e services existentes.
// Visual: tabela glass no estilo do mockup Operacional.

"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Switch } from "@/components/ui/switch"
import { UserPlus, Pencil, Trash2, Search, Shield, ChevronDown, ChevronUp, Lock, RotateCcw, Loader2 } from "lucide-react"
import { UserType, userTypeLabels } from "@/src/utils/userTypes"
import { getUsers, createUser, updateUser, deleteUser } from "@/src/services/userService"
import { usePermissoes } from "@/src/hooks/use-permissoes"

// mesmo mapa de permissões da tela antiga
const MODULOS_PERMISSOES = [
  { modulo: "Tarefas", icone: "✅", permissoes: [
    { chave: "tarefas.ver", label: "Ver tarefas" }, { chave: "tarefas.criar", label: "Criar tarefas" },
    { chave: "tarefas.editar", label: "Editar tarefas" }, { chave: "tarefas.excluir", label: "Excluir tarefas" },
    { chave: "tarefas.iniciar_concluir", label: "Iniciar e concluir tarefas" },
  ]},
  { modulo: "Processos", icone: "📋", permissoes: [
    { chave: "processos.ver", label: "Ver processos" }, { chave: "processos.criar", label: "Criar processos" },
    { chave: "processos.editar", label: "Editar processos" }, { chave: "processos.editar_status", label: "Alterar status/etapa" },
    { chave: "processos.excluir", label: "Excluir processos" }, { chave: "processos.criar_coluna", label: "Criar colunas no kanban" },
    { chave: "processos.editar_coluna", label: "Editar colunas no kanban" }, { chave: "processos.excluir_coluna", label: "Excluir colunas no kanban" },
    { chave: "processos.ver_paginas", label: "Ver páginas (Protocolos/Info)" }, { chave: "processos.editar_paginas", label: "Editar páginas (Protocolos/Info)" },
  ]},
  { modulo: "Clientes / Cadastros", icone: "👤", permissoes: [
    { chave: "clientes.ver", label: "Ver contratantes e requerentes" }, { chave: "clientes.criar", label: "Cadastrar clientes" },
    { chave: "clientes.editar", label: "Editar dados cadastrais" }, { chave: "clientes.excluir", label: "Excluir clientes" },
  ]},
  { modulo: "Financeiro", icone: "💰", permissoes: [
    { chave: "financeiro.ver", label: "Ver faturas e pagamentos" }, { chave: "financeiro.fatura_criar", label: "Criar faturas" },
    { chave: "financeiro.fatura_excluir", label: "Excluir faturas" }, { chave: "financeiro.pagamento_criar", label: "Registrar pagamentos" },
    { chave: "financeiro.pagamento_editar", label: "Editar pagamentos" }, { chave: "financeiro.pagamento_excluir", label: "Excluir pagamentos" },
    { chave: "financeiro.coluna_criar", label: "Adicionar coluna na planilha" }, { chave: "financeiro.coluna_editar", label: "Editar nome de coluna" },
    { chave: "financeiro.coluna_excluir", label: "Excluir coluna da planilha" }, { chave: "financeiro.custos_editar", label: "Editar valores e reordenar planilha" },
  ]},
  { modulo: "Mensagens", icone: "💬", permissoes: [
    { chave: "mensagens.ver", label: "Ver mensagens" }, { chave: "mensagens.responder", label: "Responder mensagens" },
    { chave: "mensagens.apagar", label: "Apagar mensagens de outros" },
  ]},
  { modulo: "Eventos", icone: "📅", permissoes: [
    { chave: "eventos.ver", label: "Ver eventos" }, { chave: "eventos.criar", label: "Criar eventos" },
    { chave: "eventos.editar", label: "Editar eventos" }, { chave: "eventos.excluir", label: "Excluir eventos" },
  ]},
  { modulo: "Árvore Genealógica", icone: "🌳", permissoes: [
    { chave: "arvore.ver", label: "Ver árvore" }, { chave: "arvore.criar", label: "Criar pessoas na árvore" },
    { chave: "arvore.editar", label: "Editar pessoas na árvore" }, { chave: "arvore.excluir", label: "Excluir pessoas da árvore" },
    { chave: "arvore.criar_documento", label: "Criar documentos" }, { chave: "arvore.editar_documento", label: "Editar documentos" },
    { chave: "arvore.excluir_documento", label: "Excluir documentos" },
  ]},
  { modulo: "Administração", icone: "🛡️", permissoes: [
    { chave: "usuarios.gerenciar", label: "Ver usuários" }, { chave: "usuarios.criar", label: "Criar usuários" },
    { chave: "usuarios.editar", label: "Editar usuários" }, { chave: "usuarios.excluir", label: "Excluir usuários" },
  ]},
]
const TODAS_CHAVES = MODULOS_PERMISSOES.flatMap(m => m.permissoes.map(p => p.chave))

interface Usuario { id: number; nome: string; email: string; tipo: string; perfilId?: number | null; perfilNome?: string | null }
interface Perfil { id: number; nome: string; descricao: string | null; cor: string | null; sistema: boolean; permissoes: Record<string, boolean> }

export default function UsersTab() {
  const { pode } = usePermissoes()

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null)
  const [formData, setFormData] = useState({ nome: "", email: "", senha: "", tipo: "" })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedPerfilId, setSelectedPerfilId] = useState<number | null>(null)
  const [permissoesEfetivas, setPermissoesEfetivas] = useState<Record<string, boolean>>({})
  const [permissoesCustom, setPermissoesCustom] = useState<Record<string, boolean>>({})
  const [showPermissoes, setShowPermissoes] = useState(false)
  const [expandedModulos, setExpandedModulos] = useState<string[]>([])

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<Usuario | null>(null)

  const fetchPerfis = useCallback(async () => {
    try {
      const token = localStorage.getItem("authToken")
      const r = await fetch("/api/perfis", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (r.ok) setPerfis((await r.json()).perfis || [])
    } catch (e) { console.error(e) }
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      setIsLoading(true); setError("")
      const token = localStorage.getItem("authToken")
      if (!token) { setUsuarios([]); return }
      const users = await getUsers(searchTerm)
      setUsuarios(users.filter((u): u is Usuario => u.id !== undefined) as Usuario[])
    } catch (err: any) {
      if (err.message?.includes("autenticado") || err.message?.includes("401")) setUsuarios([])
      else setError(err.message || "Erro ao carregar usuários")
    } finally { setIsLoading(false) }
  }, [searchTerm])

  useEffect(() => { fetchPerfis() }, [fetchPerfis])
  useEffect(() => { loadUsers() }, []) // eslint-disable-line
  useEffect(() => {
    const t = setTimeout(() => { loadUsers() }, 500)
    return () => clearTimeout(t)
  }, [searchTerm]) // eslint-disable-line

  // recalcular permissões efetivas
  useEffect(() => {
    const perfil = perfis.find(p => p.id === selectedPerfilId)
    const perfilPerms = perfil?.permissoes || {}
    const resultado: Record<string, boolean> = {}
    for (const c of TODAS_CHAVES) resultado[c] = false
    for (const [k, v] of Object.entries(perfilPerms)) if (k in resultado) resultado[k] = !!v
    for (const [k, v] of Object.entries(permissoesCustom)) if (k in resultado) resultado[k] = !!v
    if (formData.tipo === "admin") for (const c of TODAS_CHAVES) resultado[c] = true
    setPermissoesEfetivas(resultado)
  }, [selectedPerfilId, permissoesCustom, perfis, formData.tipo])

  const togglePermissao = (chave: string) => {
    if (formData.tipo === "admin") return
    const perfil = perfis.find(p => p.id === selectedPerfilId)
    const valorPerfil = !!(perfil?.permissoes as Record<string, boolean>)?.[chave]
    const novoValor = !permissoesEfetivas[chave]
    if (novoValor === valorPerfil) { const n = { ...permissoesCustom }; delete n[chave]; setPermissoesCustom(n) }
    else setPermissoesCustom({ ...permissoesCustom, [chave]: novoValor })
  }
  const temOverride = (chave: string) => chave in permissoesCustom
  const resetarCustom = () => setPermissoesCustom({})
  const toggleModulo = (modulo: typeof MODULOS_PERMISSOES[0]) => {
    if (formData.tipo === "admin") return
    const todasAtivas = modulo.permissoes.every(p => permissoesEfetivas[p.chave])
    const novoValor = !todasAtivas
    const n = { ...permissoesCustom }
    for (const perm of modulo.permissoes) {
      const perfil = perfis.find(p => p.id === selectedPerfilId)
      const valorPerfil = !!(perfil?.permissoes as Record<string, boolean>)?.[perm.chave]
      if (novoValor === valorPerfil) delete n[perm.chave]; else n[perm.chave] = novoValor
    }
    setPermissoesCustom(n)
  }
  const toggleExpandModulo = (m: string) => setExpandedModulos(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  const handleCreate = () => {
    setIsEditing(false); setCurrentUser(null)
    setFormData({ nome: "", email: "", senha: "", tipo: "" })
    setSelectedPerfilId(null); setPermissoesCustom({}); setShowPermissoes(false); setExpandedModulos([])
    setError(""); setSuccess(""); setIsDialogOpen(true)
  }
  const handleEdit = async (u: Usuario) => {
    setIsEditing(true); setCurrentUser(u)
    setFormData({ nome: u.nome, email: u.email, senha: "", tipo: u.tipo })
    setShowPermissoes(false); setExpandedModulos([]); setError(""); setSuccess("")
    try {
      const token = localStorage.getItem("authToken")
      const r = await fetch(`/api/usuarios/${u.id}/permissoes`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (r.ok) { const d = await r.json(); setSelectedPerfilId(d.usuario.perfilId || null); setPermissoesCustom(d.permissoesCustom || {}) }
      else { setSelectedPerfilId(null); setPermissoesCustom({}) }
    } catch { setSelectedPerfilId(null); setPermissoesCustom({}) }
    setIsDialogOpen(true)
  }
  const handleDeleteClick = (u: Usuario) => { setUserToDelete(u); setIsDeleteDialogOpen(true); setError(""); setSuccess("") }
  const confirmDelete = async () => {
    if (!userToDelete) return
    try {
      setIsSubmitting(true); await deleteUser(userToDelete.id)
      setSuccess("Usuário deletado com sucesso!"); setIsDeleteDialogOpen(false); setUserToDelete(null); await loadUsers()
    } catch (err: any) { setError(err.message || "Erro ao deletar usuário"); setIsDeleteDialogOpen(false) }
    finally { setIsSubmitting(false) }
  }
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSuccess("")
    if (!formData.nome || !formData.email) { setError("Preencha todos os campos obrigatórios"); return }
    if (!formData.tipo) { setError("Selecione um perfil de permissões"); return }
    if (!isEditing && !formData.senha) { setError("Senha é obrigatória para novos usuários"); return }
    try {
      setIsSubmitting(true)
      if (isEditing && currentUser) {
        const dataToUpdate: any = { nome: formData.nome, email: formData.email, tipo: formData.tipo }
        if (formData.senha) dataToUpdate.senha = formData.senha
        await updateUser(currentUser.id, dataToUpdate)
        const token = localStorage.getItem("authToken")
        const temCustom = Object.keys(permissoesCustom).length > 0
        await fetch(`/api/usuarios/${currentUser.id}/permissoes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ perfilId: selectedPerfilId, permissoesCustom: formData.tipo === "admin" ? null : (temCustom ? permissoesCustom : null) }),
        })
        setSuccess("Usuário atualizado com sucesso!")
      } else {
        await createUser({ nome: formData.nome, email: formData.email, senha: formData.senha, tipo: formData.tipo })
        setSuccess("Usuário criado com sucesso!")
      }
      setIsDialogOpen(false); setFormData({ nome: "", email: "", senha: "", tipo: "" }); await loadUsers()
    } catch (err: any) { setError(err.message || "Erro ao salvar usuário") }
    finally { setIsSubmitting(false) }
  }

  const getPerfilBadge = (u: Usuario) => {
    if (u.tipo === "admin" || !u.perfilNome) return null
    const perfil = perfis.find(p => p.nome === u.perfilNome)
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-2" style={{ backgroundColor: `${perfil?.cor || "#6B7280"}20`, color: perfil?.cor || "#6B7280" }}>{u.perfilNome}</span>
  }
  const totalOverrides = Object.keys(permissoesCustom).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Shield className="h-5 w-5" /> Usuários</h2>
          <div className="text-xs text-white/60 mt-1">{usuarios.length} {usuarios.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}</div>
        </div>
        {pode("usuarios.criar") && (
          <Button onClick={handleCreate} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"><UserPlus className="h-4 w-4" /> Novo Usuário</Button>
        )}
      </div>

      {error && <Alert className="bg-red-500/20 border-red-500/50 text-white"><AlertDescription className="text-white">{error}</AlertDescription></Alert>}
      {success && <Alert className="border-green-500/50 bg-green-500/20 text-white"><AlertDescription className="text-white">{success}</AlertDescription></Alert>}

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
        <Input placeholder="Buscar por nome ou email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/50" />
      </div>

      {/* Tabela glass */}
      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 overflow-x-auto">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-white/50" /></div>
        ) : usuarios.length === 0 ? (
          <div className="text-center py-10 text-white/50">Nenhum usuário encontrado</div>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-white/40 text-xs border-b border-white/10">
                <th className="text-left font-medium py-2">Nome</th>
                <th className="text-left font-medium py-2">E-mail</th>
                <th className="text-left font-medium py-2">Tipo</th>
                <th className="text-right font-medium py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  <td className="py-2.5 text-white">{u.nome}{getPerfilBadge(u)}</td>
                  <td className="py-2.5 text-white/70">{u.email}</td>
                  <td className="py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                      u.tipo === "admin" ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
                      u.tipo === "gerente" ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
                      u.tipo === "estagiario" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                      "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"}`}>
                      {userTypeLabels[u.tipo as UserType] ?? u.tipo}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <div className="flex justify-end gap-1">
                      {pode("usuarios.editar") && (
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(u)} title="Editar" className="text-white/70 hover:text-white hover:bg-white/10"><Pencil className="h-4 w-4" /></Button>
                      )}
                      {pode("usuarios.excluir") && u.tipo !== UserType.ADMIN && (
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(u)} title="Deletar" className="text-red-400 hover:text-red-300 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL criar/editar (igual à tela antiga) */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-gray-900">{isEditing ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
            <DialogDescription>{isEditing ? "Atualize as informações e permissões do usuário" : "Preencha os dados para criar um novo usuário"}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nome" className="text-gray-700">Nome *</Label>
                <Input id="nome" value={formData.nome} onChange={e => setFormData({ ...formData, nome: e.target.value })} placeholder="Nome completo" required className="bg-white border-gray-300" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700">Email *</Label>
                <Input id="email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="email@exemplo.com" required className="bg-white border-gray-300" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha" className="text-gray-700">Senha {!isEditing && "*"} {isEditing && "(em branco = manter)"}</Label>
              <Input id="senha" type="password" value={formData.senha} onChange={e => setFormData({ ...formData, senha: e.target.value })} placeholder="Senha" required={!isEditing} className="bg-white border-gray-300" />
            </div>

            <div className="border-t border-gray-200 pt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-700 flex items-center gap-2"><Shield className="h-4 w-4" /> Perfil de Permissões</Label>
                <select value={selectedPerfilId || ""} onChange={e => {
                  const val = e.target.value ? parseInt(e.target.value) : null
                  setSelectedPerfilId(val); setPermissoesCustom({})
                  const ps = perfis.find(p => p.id === val)
                  if (ps) { const map: Record<string, string> = { Administrador: "admin", Gerente: "gerente", Assistente: "assistente", Estagiário: "estagiario" }; setFormData(prev => ({ ...prev, tipo: map[ps.nome] || "assistente" })) }
                  else setFormData(prev => ({ ...prev, tipo: "" }))
                }} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 focus:outline-none">
                  <option value="">Sem perfil (todas permissões desligadas)</option>
                  {perfis.map(p => <option key={p.id} value={p.id}>{p.nome}{p.descricao ? ` — ${p.descricao}` : ""}</option>)}
                </select>
                {selectedPerfilId && <p className="text-xs text-gray-500">{perfis.find(p => p.id === selectedPerfilId)?.descricao}</p>}
              </div>

              <button type="button" onClick={() => setShowPermissoes(!showPermissoes)} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
                <Lock className="h-4 w-4" />
                {showPermissoes ? "Ocultar permissões detalhadas" : "Personalizar permissões"}
                {showPermissoes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {totalOverrides > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">{totalOverrides} {totalOverrides === 1 ? "ajuste" : "ajustes"}</span>}
              </button>

              {showPermissoes && (
                <div className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">Toggle individual sobrescreve o perfil. Indicador <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mx-0.5" /> = personalizado</p>
                    {totalOverrides > 0 && <button type="button" onClick={resetarCustom} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"><RotateCcw className="h-3 w-3" /> Resetar ajustes</button>}
                  </div>
                  {MODULOS_PERMISSOES.map(modulo => {
                    const expanded = expandedModulos.includes(modulo.modulo)
                    const todasAtivas = modulo.permissoes.every(p => permissoesEfetivas[p.chave])
                    const temOverrides = modulo.permissoes.some(p => temOverride(p.chave))
                    return (
                      <div key={modulo.modulo} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-gray-50" onClick={() => toggleExpandModulo(modulo.modulo)}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{modulo.icone}</span>
                            <span className="text-sm font-medium text-gray-800">{modulo.modulo}</span>
                            {temOverrides && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch checked={todasAtivas} onCheckedChange={() => toggleModulo(modulo)} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="scale-75" />
                            {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                          </div>
                        </div>
                        {expanded && (
                          <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                            {modulo.permissoes.map(perm => {
                              const ativa = !!permissoesEfetivas[perm.chave]
                              const override = temOverride(perm.chave)
                              return (
                                <div key={perm.chave} className={`flex items-center justify-between py-1.5 px-2 rounded ${override ? "bg-amber-50" : ""}`}>
                                  <div className="flex items-center gap-2">
                                    {override && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
                                    <span className={`text-xs ${ativa ? "text-gray-700" : "text-gray-400"}`}>{perm.label}</span>
                                  </div>
                                  <Switch checked={ativa} onCheckedChange={() => togglePermissao(perm.chave)} className="scale-75" />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {formData.tipo === "admin" && (
              <div className="border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <Shield className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <p className="text-xs text-blue-700">Administradores têm acesso total ao sistema. Não é necessário configurar permissões.</p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white">
                {isSubmitting ? <><div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Salvando...</> : isEditing ? "Atualizar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-900">Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja deletar o usuário <strong>{userToDelete?.nome}</strong>? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700 text-white">{isSubmitting ? "Deletando..." : "Deletar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}