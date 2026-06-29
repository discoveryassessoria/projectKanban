'use client'

// src/components/gerenciamentoComponents/RolesTab.tsx
// Fatia 3 — PERFIS (real)
// Lista, cria, edita, duplica e exclui perfis de permissão.
// Backend: GET/POST /api/perfis e PUT/DELETE /api/perfis/[id]
//   GET  -> { perfis: [...] }   (cada perfil traz _count.usuarios)
//   POST -> { perfil }          body { nome, descricao, cor, permissoes }
//   PUT  -> { perfil }          mesmo body
//   DELETE -> { ok: true }
// As chaves de permissão vêm da MESMA fonte que a API valida (@/src/lib/permissoes),
// então a matriz nunca diverge do que o servidor aceita.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { PERMISSOES, MODULOS_PERMISSOES } from '@/src/lib/permissoes'

type MapaPermissoes = Record<string, boolean>

type Perfil = {
  id: number
  nome: string
  descricao: string | null
  cor: string | null
  sistema: boolean
  permissoes: MapaPermissoes
  _count?: { usuarios: number }
}

const TODAS_CHAVES = Object.keys(PERMISSOES) as string[]
const TOTAL_PERMISSOES = TODAS_CHAVES.length

const CORES = [
  '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6',
  '#10B981', '#EC4899', '#14B8A6', '#6366F1',
]

// Constrói um mapa completo (todas as chaves) a partir de um parcial
function mapaCompleto(base?: MapaPermissoes | null): MapaPermissoes {
  const m: MapaPermissoes = {}
  for (const k of TODAS_CHAVES) m[k] = !!base?.[k]
  return m
}

function contarAtivas(perm?: MapaPermissoes | null): number {
  if (!perm) return 0
  return TODAS_CHAVES.reduce((n, k) => (perm[k] ? n + 1 : n), 0)
}

// fetch que já trata erro e devolve a mensagem do servidor (ex.: "Permissões inválidas")
// Auth igual ao UsersTab: token em localStorage('authToken') no header Authorization.
async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

export default function RolesTab() {
  const [perfis, setPerfis] = useState<Perfil[]>([])
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // modal
  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Perfil | null>(null) // null = criar
  const [somenteLeitura, setSomenteLeitura] = useState(false)
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [cor, setCor] = useState(CORES[2])
  const [permissoes, setPermissoes] = useState<MapaPermissoes>(mapaCompleto())
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErroLista(null)
    try {
      const data = await jsonFetch('/api/perfis', { cache: 'no-store' })
      setPerfis((data as any).perfis || [])
    } catch (e: any) {
      setErroLista(e.message || 'Não foi possível carregar os perfis.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const perfisFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return perfis
    return perfis.filter(
      (p) =>
        p.nome.toLowerCase().includes(q) ||
        (p.descricao || '').toLowerCase().includes(q)
    )
  }, [perfis, busca])

  function abrirNovo() {
    setEditando(null)
    setSomenteLeitura(false)
    setNome('')
    setDescricao('')
    setCor(CORES[2])
    setPermissoes(mapaCompleto())
    setErroModal(null)
    setModalAberto(true)
  }

  function abrirEditar(p: Perfil) {
    setEditando(p)
    setSomenteLeitura(p.sistema) // perfis do sistema: só leitura
    setNome(p.nome)
    setDescricao(p.descricao || '')
    setCor(p.cor || CORES[2])
    setPermissoes(mapaCompleto(p.permissoes))
    setErroModal(null)
    setModalAberto(true)
  }

  function abrirDuplicar(p: Perfil) {
    setEditando(null) // duplicar cria um novo (POST)
    setSomenteLeitura(false)
    setNome(`${p.nome} (cópia)`)
    setDescricao(p.descricao || '')
    setCor(p.cor || CORES[2])
    setPermissoes(mapaCompleto(p.permissoes))
    setErroModal(null)
    setModalAberto(true)
  }

  function togglePerm(chave: string) {
    if (somenteLeitura) return
    setPermissoes((prev) => ({ ...prev, [chave]: !prev[chave] }))
  }

  function setModulo(chaves: readonly string[], valor: boolean) {
    if (somenteLeitura) return
    setPermissoes((prev) => {
      const novo = { ...prev }
      for (const k of chaves) novo[k] = valor
      return novo
    })
  }

  function setTodas(valor: boolean) {
    if (somenteLeitura) return
    setPermissoes(() => {
      const novo: MapaPermissoes = {}
      for (const k of TODAS_CHAVES) novo[k] = valor
      return novo
    })
  }

  async function salvar() {
    if (somenteLeitura) return
    if (!nome.trim()) {
      setErroModal('Dê um nome ao perfil.')
      return
    }
    setSalvando(true)
    setErroModal(null)
    try {
      const body = JSON.stringify({
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        cor,
        permissoes,
      })
      if (editando) {
        await jsonFetch(`/api/perfis/${editando.id}`, { method: 'PUT', body })
      } else {
        await jsonFetch('/api/perfis', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(p: Perfil) {
    if (p.sistema) return
    const usuarios = p._count?.usuarios || 0
    const aviso =
      usuarios > 0
        ? `O perfil "${p.nome}" tem ${usuarios} usuário(s) vinculado(s). O servidor vai bloquear a exclusão. Continuar mesmo assim?`
        : `Excluir o perfil "${p.nome}"? Esta ação não pode ser desfeita.`
    if (!confirm(aviso)) return
    try {
      await jsonFetch(`/api/perfis/${p.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  const ativasNoForm = contarAtivas(permissoes)

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Perfis de permissão</h2>
          <p className="text-sm text-white/50">
            Defina o que cada perfil pode ver e fazer no sistema.
          </p>
        </div>
        <button
          onClick={abrirNovo}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          + Novo perfil
        </button>
      </div>

      {/* Busca */}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar perfil..."
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {/* Estados */}
      {loading && (
        <div className="py-12 text-center text-sm text-white/40">Carregando perfis...</div>
      )}

      {!loading && erroLista && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {erroLista}
          <button onClick={carregar} className="ml-3 underline hover:text-white">
            Tentar de novo
          </button>
        </div>
      )}

      {!loading && !erroLista && perfisFiltrados.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 py-12 text-center text-sm text-white/40 backdrop-blur">
          {busca ? 'Nenhum perfil encontrado.' : 'Nenhum perfil cadastrado ainda. Crie o primeiro.'}
        </div>
      )}

      {/* Grade de perfis */}
      {!loading && !erroLista && perfisFiltrados.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {perfisFiltrados.map((p) => {
            const ativas = contarAtivas(p.permissoes)
            const usuarios = p._count?.usuarios || 0
            return (
              <div
                key={p.id}
                className="flex flex-col rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur transition hover:border-white/20"
              >
                <div className="mb-2 flex items-start gap-3">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: p.cor || '#64748b' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium text-white">{p.nome}</h3>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          p.sistema
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-blue-500/15 text-blue-300'
                        }`}
                      >
                        {p.sistema ? 'Sistema' : 'Personalizado'}
                      </span>
                    </div>
                    <p className="truncate text-xs text-white/50">
                      {p.descricao || 'Sem descrição'}
                    </p>
                  </div>
                </div>

                <div className="mb-4 flex items-center gap-4 text-xs text-white/50">
                  <span>
                    <strong className="text-white/80">{ativas}</strong>/{TOTAL_PERMISSOES} permissões
                  </span>
                  <span>
                    <strong className="text-white/80">{usuarios}</strong> usuário{usuarios === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-auto flex items-center gap-2 text-xs">
                  <button
                    onClick={() => abrirEditar(p)}
                    className="rounded-md border border-white/10 px-2.5 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    {p.sistema ? 'Ver' : 'Editar'}
                  </button>
                  <button
                    onClick={() => abrirDuplicar(p)}
                    className="rounded-md border border-white/10 px-2.5 py-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    Duplicar
                  </button>
                  {!p.sistema && (
                    <button
                      onClick={() => excluir(p)}
                      className="ml-auto rounded-md border border-red-500/20 px-2.5 py-1.5 text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200"
                    >
                      Excluir
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            {/* topo do modal */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">
                {editando ? (somenteLeitura ? 'Perfil do sistema' : 'Editar perfil') : 'Novo perfil'}
              </h3>
              <button
                onClick={() => setModalAberto(false)}
                className="text-white/40 transition hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* corpo rolável */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {somenteLeitura && (
                <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                  Perfis do sistema não podem ser editados. Use <strong>Duplicar</strong> para criar uma versão editável.
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Nome</label>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    disabled={somenteLeitura}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/20 disabled:opacity-60"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Descrição</label>
                  <input
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    disabled={somenteLeitura}
                    placeholder="Para que serve este perfil"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20 disabled:opacity-60"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Cor</label>
                  <div className="flex items-center gap-2">
                    {CORES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => !somenteLeitura && setCor(c)}
                        className={`h-7 w-7 rounded-full transition ${
                          cor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={cor}
                      onChange={(e) => setCor(e.target.value)}
                      disabled={somenteLeitura}
                      className="h-7 w-10 cursor-pointer rounded bg-transparent disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>

              {/* Matriz de permissões */}
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-white">
                    Permissões{' '}
                    <span className="text-white/40">
                      ({ativasNoForm}/{TOTAL_PERMISSOES})
                    </span>
                  </span>
                  {!somenteLeitura && (
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setTodas(true)} className="text-white/50 hover:text-white">
                        Marcar tudo
                      </button>
                      <span className="text-white/20">·</span>
                      <button onClick={() => setTodas(false)} className="text-white/50 hover:text-white">
                        Limpar
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {MODULOS_PERMISSOES.map((mod) => {
                    const chaves = mod.permissoes as readonly string[]
                    const todasOn = chaves.every((k) => permissoes[k])
                    return (
                      <div
                        key={mod.modulo}
                        className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-white/90">
                            <span className="mr-1.5">{mod.icone}</span>
                            {mod.modulo}
                          </span>
                          {!somenteLeitura && (
                            <button
                              onClick={() => setModulo(chaves, !todasOn)}
                              className="text-[11px] text-white/40 hover:text-white"
                            >
                              {todasOn ? 'Desmarcar módulo' : 'Marcar módulo'}
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {chaves.map((k) => {
                            const label = (PERMISSOES as Record<string, string>)[k] || k
                            return (
                              <label
                                key={k}
                                className={`flex items-center gap-2 rounded px-2 py-1 text-xs ${
                                  somenteLeitura ? 'cursor-default' : 'cursor-pointer hover:bg-white/5'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={!!permissoes[k]}
                                  onChange={() => togglePerm(k)}
                                  disabled={somenteLeitura}
                                  className="h-3.5 w-3.5 accent-blue-500"
                                />
                                <span className="text-white/70">{label}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {erroModal && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {erroModal}
                </div>
              )}
            </div>

            {/* rodapé */}
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button
                onClick={() => setModalAberto(false)}
                className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white"
              >
                {somenteLeitura ? 'Fechar' : 'Cancelar'}
              </button>
              {!somenteLeitura && (
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}