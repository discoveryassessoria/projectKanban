// CRIAR EM: src/components/gerenciamentoComponents/UsersTab.tsx
//
// Aba "Usuários" do Gerenciamento — REAL. Porta a lógica completa da antiga
// administrator/page.tsx (criar/editar/excluir + sistema de permissões custom
// por usuário, com override sobre o perfil). Usa as APIs e services existentes.
// Visual: tabela glass no estilo do mockup Operacional.

"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { useApi } from "@/src/lib/dados"
import { useLocalStorage } from "@/src/lib/cliente"
import { useDebounce } from "@/src/hooks/use-debounce"
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

interface Usuario { id: number; publicCode?: string | null; nome: string; email: string; tipo: string; perfilId?: number | null; perfilNome?: string | null }
interface Perfil { id: number; nome: string; descricao: string | null; cor: string | null; sistema: boolean; permissoes: Record<string, boolean> }

const SEM_PERFIS: Perfil[] = []

export default function UsersTab() {
  const { pode } = usePermissoes()

  const [searchTerm, setSearchTerm] = useState("")
  // A busca entra na CHAVE, e o debounce é o da própria camada (`keepPreviousData`
  // evita a tela piscar entre teclas). Antes eram três efeitos para a mesma coisa:
  // um na montagem, um com `setTimeout(500)` e um `eslint-disable-line` em cada.
  const buscaAplicada = useDebounce(searchTerm, 500)
  const token = useLocalStorage("authToken")
  // Sem token não se busca — era o `if (!token) { setUsuarios([]); return }`.
  const chaveUsuarios = token
    ? (buscaAplicada ? `/api/usuarios?search=${encodeURIComponent(buscaAplicada)}&all=true` : '/api/usuarios?all=true')
    : null
  const usuariosReq = useApi<{ usuarios?: Usuario[] }>(chaveUsuarios, { keepPreviousData: true })
  // O filtro de `id` definido continua: a lista da tela é de usuários persistidos.
  const usuarios = useMemo(
    () => (usuariosReq.dados?.usuarios ?? []).filter((u: Usuario) => u.id !== undefined),
    [usuariosReq.dados],
  )
  const perfisReq = useApi<{ perfis?: Perfil[] }>("/api/perfis")
  const perfis = perfisReq.dados?.perfis ?? SEM_PERFIS
  const isLoading = Boolean(chaveUsuarios) && usuariosReq.carregando
  const loadUsers = usuariosReq.recarregar
  // Erro de LEITURA vem da consulta; erro de escrita/validação continua em estado.
  const [erroLocal, setError] = useState("")
  // 401 já é tratado na camada (encerra a sessão), então aqui ele não vira texto na
  // tela — era o que o `if (err.message?.includes("401"))` fazia à mão.
  const error = erroLocal || (usuariosReq.erro && usuariosReq.erro.status !== 401 ? usuariosReq.erro.message : "")
  const [success, setSuccess] = useState("")

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null)
  const [formData, setFormData] = useState({ nome: "", email: "", senha: "", tipo: "" })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [selectedPerfilId, setSelectedPerfilId] = useState<number | null>(null)
  const [permissoesCustom, setPermissoesCustom] = useState<Record<string, boolean>>({})
  const [showPermissoes, setShowPermissoes] = useState(false)
  const [expandedModulos, setExpandedModulos] = useState<string[]>([])

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<Usuario | null>(null)

  // Permissões efetivas são DERIVAÇÃO PURA de (perfil escolhido + customizações +
  // tipo admin). Como estado escrito por efeito, a tela exibia por um render as
  // permissões da combinação ANTERIOR — no formulário de acesso, mostrar permissão
  // errada por um instante é o pior tipo de detalhe.
  const permissoesEfetivas = useMemo<Record<string, boolean>>(() => {
    const perfil = perfis.find(p => p.id === selectedPerfilId)
    const perfilPerms = perfil?.permissoes || {}
    const resultado: Record<string, boolean> = {}
    for (const c of TODAS_CHAVES) resultado[c] = false
    for (const [k, v] of Object.entries(perfilPerms)) if (k in resultado) resultado[k] = !!v
    for (const [k, v] of Object.entries(permissoesCustom)) if (k in resultado) resultado[k] = !!v
    if (formData.tipo === "admin") for (const c of TODAS_CHAVES) resultado[c] = true
    return resultado
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
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-2" style={{ backgroundColor: `${perfil?.cor || "#4e6879"}20`, color: perfil?.cor || "#4e6879" }}>{u.perfilNome}</span>
  }
  const totalOverrides = Object.keys(permissoesCustom).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Shield className="h-5 w-5" /> Usuários</h2>
          <div className="text-xs text-[var(--text-secondary)] mt-1">{usuarios.length} {usuarios.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}</div>
        </div>
        {pode("usuarios.criar") && (
          <Button onClick={handleCreate} className="gap-2 bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] text-[var(--action-primary-ink)]"><UserPlus className="h-4 w-4" /> Novo Usuário</Button>
        )}
      </div>

      {error && <Alert className="bg-[var(--surface-secondary)] border-[var(--border-default)] text-[var(--text-primary)]"><AlertDescription className="text-white">{error}</AlertDescription></Alert>}
      {success && <Alert className="border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-primary)]"><AlertDescription className="text-white">{success}</AlertDescription></Alert>}

      {/* Busca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
        <Input placeholder="Buscar por nome ou email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          className="pl-10 bg-[var(--surface-primary)] border-[var(--border-default)] text-white placeholder:text-[var(--text-secondary)]" />
      </div>

      {/* Tabela glass */}
      <div className="bg-[var(--surface-primary)] backdrop-blur-sm border border-[var(--border-default)] rounded-xl p-4 overflow-x-auto">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-[var(--text-secondary)]" /></div>
        ) : usuarios.length === 0 ? (
          <div className="text-center py-10 text-[var(--text-secondary)]">Nenhum usuário encontrado</div>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border-default)]">
                <th className="text-left font-medium py-2">Código</th>
                <th className="text-left font-medium py-2">Nome</th>
                <th className="text-left font-medium py-2">E-mail</th>
                <th className="text-left font-medium py-2">Tipo</th>
                <th className="text-right font-medium py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)]">
                  <td className="py-2.5 font-mono text-[12px] font-bold text-white/80">{u.publicCode ?? '—'}</td>
                  <td className="py-2.5 text-white">{u.nome}{getPerfilBadge(u)}</td>
                  <td className="py-2.5 text-white/70">{u.email}</td>
                  <td className="py-2.5">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                      u.tipo === "admin" ? "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)]" :
                      u.tipo === "gerente" ? "bg-[var(--surface-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)]" :
                      u.tipo === "estagiario" ? "bg-[var(--surface-secondary)] text-amber-800 border border-[var(--border-default)]" :
                      "bg-[var(--surface-secondary)] text-green-800 border border-[var(--border-default)]"}`}>
                      {userTypeLabels[u.tipo as UserType] ?? u.tipo}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <div className="flex justify-end gap-1">
                      {pode("usuarios.editar") && (
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(u)} title="Editar" className="text-white/70 hover:text-white hover:bg-[var(--surface-hover)]"><Pencil className="h-4 w-4" /></Button>
                      )}
                      {pode("usuarios.excluir") && u.tipo !== UserType.ADMIN && (
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(u)} title="Deletar" className="text-red-700 hover:text-red-700 hover:bg-[var(--surface-secondary)]"><Trash2 className="h-4 w-4" /></Button>
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
        <DialogContent className="bg-[var(--surface-primary)] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-gray-900">{isEditing ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
            <DialogDescription>{isEditing ? "Atualize as informações e permissões do usuário" : "Preencha os dados para criar um novo usuário"}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nome" className="text-gray-700">Nome *</Label>
                <Input id="nome" value={formData.nome} onChange={e => setFormData({ ...formData, nome: e.target.value })} placeholder="Nome completo" required className="bg-[var(--surface-primary)] border-gray-300" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700">Email *</Label>
                <Input id="email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="email@exemplo.com" required className="bg-[var(--surface-primary)] border-gray-300" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha" className="text-gray-700">Senha {!isEditing && "*"} {isEditing && "(em branco = manter)"}</Label>
              <Input id="senha" type="password" value={formData.senha} onChange={e => setFormData({ ...formData, senha: e.target.value })} placeholder="Senha" required={!isEditing} className="bg-[var(--surface-primary)] border-gray-300" />
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
                }} className="flex h-10 w-full rounded-md border border-gray-300 bg-[var(--surface-primary)] px-3 py-2 text-sm text-gray-900 focus:border-[var(--border-default)] focus:ring-1 focus:ring-[var(--border-strong)] focus:outline-none">
                  <option value="">Sem perfil (todas permissões desligadas)</option>
                  {perfis.map(p => <option key={p.id} value={p.id}>{p.nome}{p.descricao ? ` — ${p.descricao}` : ""}</option>)}
                </select>
                {selectedPerfilId && <p className="text-xs text-gray-500">{perfis.find(p => p.id === selectedPerfilId)?.descricao}</p>}
              </div>

              <button type="button" onClick={() => setShowPermissoes(!showPermissoes)} className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-secondary)] font-medium">
                <Lock className="h-4 w-4" />
                {showPermissoes ? "Ocultar permissões detalhadas" : "Personalizar permissões"}
                {showPermissoes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {totalOverrides > 0 && <span className="bg-[var(--surface-secondary)] text-amber-800 text-[10px] font-medium px-1.5 py-0.5 rounded-full">{totalOverrides} {totalOverrides === 1 ? "ajuste" : "ajustes"}</span>}
              </button>

              {showPermissoes && (
                <div className="space-y-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">Toggle individual sobrescreve o perfil. Indicador <span className="inline-block w-2 h-2 rounded-full bg-[var(--action-primary)] mx-0.5" /> = personalizado</p>
                    {totalOverrides > 0 && <button type="button" onClick={resetarCustom} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"><RotateCcw className="h-3 w-3" /> Resetar ajustes</button>}
                  </div>
                  {MODULOS_PERMISSOES.map(modulo => {
                    const expanded = expandedModulos.includes(modulo.modulo)
                    const todasAtivas = modulo.permissoes.every(p => permissoesEfetivas[p.chave])
                    const temOverrides = modulo.permissoes.some(p => temOverride(p.chave))
                    return (
                      <div key={modulo.modulo} className="bg-[var(--surface-primary)] rounded-lg border border-gray-200 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-gray-50" onClick={() => toggleExpandModulo(modulo.modulo)}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{modulo.icone}</span>
                            <span className="text-sm font-medium text-gray-800">{modulo.modulo}</span>
                            {temOverrides && <span className="w-2 h-2 rounded-full bg-[var(--action-primary)]" />}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch checked={todasAtivas} onCheckedChange={() => toggleModulo(modulo)} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="scale-75" />
                            {expanded ? <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />}
                          </div>
                        </div>
                        {expanded && (
                          <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                            {modulo.permissoes.map(perm => {
                              const ativa = !!permissoesEfetivas[perm.chave]
                              const override = temOverride(perm.chave)
                              return (
                                <div key={perm.chave} className={`flex items-center justify-between py-1.5 px-2 rounded ${override ? "bg-[var(--surface-secondary)]" : ""}`}>
                                  <div className="flex items-center gap-2">
                                    {override && <span className="w-1.5 h-1.5 rounded-full bg-[var(--action-primary)] flex-shrink-0" />}
                                    <span className={`text-xs ${ativa ? "text-gray-700" : "text-[var(--text-muted)]"}`}>{perm.label}</span>
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
                <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border-default)]">
                  <Shield className="h-4 w-4 text-[var(--text-secondary)] flex-shrink-0" />
                  <p className="text-xs text-[var(--text-secondary)]">Administradores têm acesso total ao sistema. Não é necessário configurar permissões.</p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting} className="bg-[var(--action-primary)] hover:bg-[var(--action-primary-hover)] text-[var(--action-primary-ink)]">
                {isSubmitting ? <><div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Salvando...</> : isEditing ? "Atualizar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-[var(--surface-primary)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-900">Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja deletar o usuário <strong>{userToDelete?.nome}</strong>? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isSubmitting} className="bg-red-700 hover:bg-red-800 text-[var(--action-primary-ink)]">{isSubmitting ? "Deletando..." : "Deletar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}