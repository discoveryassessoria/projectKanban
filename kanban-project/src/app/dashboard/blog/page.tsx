// ========================================
// CRIAR ARQUIVO: app/(dashboard)/blog/page.tsx
// ========================================

'use client'

import { useState, useEffect } from 'react'
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Eye, 
  EyeOff, 
  Star,
  StarOff,
  Search,
  Clock,
  ExternalLink,
  Image as ImageIcon
} from 'lucide-react'

interface BlogPost {
  id: number
  titulo: string
  slug: string
  resumo: string
  conteudo?: string
  imagemUrl?: string
  imagemAlt?: string
  categoria: string
  tempoLeitura: number
  status: 'RASCUNHO' | 'PUBLICADO' | 'ARQUIVADO'
  destaque: boolean
  dataPublicacao?: string
  createdAt: string
}

const CATEGORIAS = [
  'Cidadania Italiana',
  'Cidadania Portuguesa', 
  'Cidadania Espanhola',
  'Cidadania Alemã',
  'Visto Americano',
  'Visto Canadense',
  'Dicas e Orientações',
  'Notícias',
]

export default function BlogAdminPage() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterCategoria, setFilterCategoria] = useState('')
  const [saving, setSaving] = useState(false)
  
  // Form state
  const [form, setForm] = useState({
    titulo: '',
    slug: '',
    resumo: '',
    conteudo: '',
    imagemUrl: '',
    imagemAlt: '',
    categoria: 'Cidadania Italiana',
    tempoLeitura: 5,
    status: 'RASCUNHO' as const,
    destaque: false,
    dataPublicacao: '',
  })

  useEffect(() => {
    fetchPosts()
  }, [])

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/admin/blog')
      const data = await res.json()
      setPosts(data)
    } catch (error) {
      console.error('Erro ao buscar posts:', error)
    } finally {
      setLoading(false)
    }
  }

  const generateSlug = (titulo: string) => {
    return titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const handleTituloChange = (titulo: string) => {
    setForm({
      ...form,
      titulo,
      slug: editingPost ? form.slug : generateSlug(titulo)
    })
  }

  const openNewPost = () => {
    setEditingPost(null)
    setForm({
      titulo: '',
      slug: '',
      resumo: '',
      conteudo: '',
      imagemUrl: '',
      imagemAlt: '',
      categoria: 'Cidadania Italiana',
      tempoLeitura: 5,
      status: 'RASCUNHO',
      destaque: false,
      dataPublicacao: '',
    })
    setShowModal(true)
  }

  const openEditPost = (post: BlogPost) => {
    setEditingPost(post)
    setForm({
      titulo: post.titulo,
      slug: post.slug,
      resumo: post.resumo,
      conteudo: post.conteudo || '',
      imagemUrl: post.imagemUrl || '',
      imagemAlt: post.imagemAlt || '',
      categoria: post.categoria,
      tempoLeitura: post.tempoLeitura,
      status: post.status,
      destaque: post.destaque,
      dataPublicacao: post.dataPublicacao ? post.dataPublicacao.split('T')[0] : '',
    })
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    
    try {
      const url = editingPost 
        ? `/api/admin/blog/${editingPost.id}`
        : '/api/admin/blog'
      
      const method = editingPost ? 'PUT' : 'POST'
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          dataPublicacao: form.dataPublicacao ? new Date(form.dataPublicacao).toISOString() : null
        })
      })
      
      if (res.ok) {
        fetchPosts()
        setShowModal(false)
      } else {
        const error = await res.json()
        alert(error.error || 'Erro ao salvar post')
      }
    } catch (error) {
      console.error('Erro ao salvar post:', error)
      alert('Erro ao salvar post')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (post: BlogPost) => {
    const newStatus = post.status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO'
    
    try {
      await fetch(`/api/admin/blog/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...post, 
          status: newStatus,
          dataPublicacao: newStatus === 'PUBLICADO' && !post.dataPublicacao 
            ? new Date().toISOString() 
            : post.dataPublicacao
        })
      })
      fetchPosts()
    } catch (error) {
      console.error('Erro ao atualizar post:', error)
    }
  }

  const toggleDestaque = async (post: BlogPost) => {
    try {
      await fetch(`/api/admin/blog/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, destaque: !post.destaque })
      })
      fetchPosts()
    } catch (error) {
      console.error('Erro ao atualizar post:', error)
    }
  }

  const deletePost = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir este post?')) return
    
    try {
      await fetch(`/api/admin/blog/${id}`, { method: 'DELETE' })
      fetchPosts()
    } catch (error) {
      console.error('Erro ao excluir post:', error)
    }
  }

  const filteredPosts = posts.filter(post => {
    const matchSearch = post.titulo.toLowerCase().includes(searchTerm.toLowerCase())
    const matchCategoria = !filterCategoria || post.categoria === filterCategoria
    return matchSearch && matchCategoria
  })

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('pt-BR')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PUBLICADO': return 'bg-green-100 text-green-800'
      case 'RASCUNHO': return 'bg-gray-100 text-gray-800'
      case 'ARQUIVADO': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'PUBLICADO': return 'Publicado'
      case 'RASCUNHO': return 'Rascunho'
      case 'ARQUIVADO': return 'Arquivado'
      default: return status
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Blog</h1>
          <p className="text-gray-600">Gerencie os posts do site</p>
        </div>
        <button
          onClick={openNewPost}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg transition-colors font-medium"
        >
          <Plus className="w-5 h-5" />
          Novo Post
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar posts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
        </div>
        <select
          value={filterCategoria}
          onChange={(e) => setFilterCategoria(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
        >
          <option value="">Todas as categorias</option>
          {CATEGORIAS.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Lista de Posts */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Post</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Categoria</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">Data</th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredPosts.map(post => (
                <tr key={post.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {post.imagemUrl ? (
                        <img 
                          src={post.imagemUrl} 
                          alt={post.imagemAlt || post.titulo}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                          <ImageIcon className="w-6 h-6 text-gray-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate max-w-xs">{post.titulo}</p>
                        <p className="text-sm text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {post.tempoLeitura} min de leitura
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                      {post.categoria}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(post.status)}`}>
                        {getStatusLabel(post.status)}
                      </span>
                      {post.destaque && (
                        <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {post.dataPublicacao ? formatDate(post.dataPublicacao) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleDestaque(post)}
                        className={`p-2 rounded-lg transition-colors ${
                          post.destaque 
                            ? 'text-amber-500 hover:bg-amber-50' 
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={post.destaque ? 'Remover destaque' : 'Destacar'}
                      >
                        {post.destaque ? <Star className="w-5 h-5 fill-current" /> : <StarOff className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => toggleStatus(post)}
                        className={`p-2 rounded-lg transition-colors ${
                          post.status === 'PUBLICADO'
                            ? 'text-green-500 hover:bg-green-50' 
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={post.status === 'PUBLICADO' ? 'Despublicar' : 'Publicar'}
                      >
                        {post.status === 'PUBLICADO' ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => openEditPost(post)}
                        className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => deletePost(post.id)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredPosts.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="mb-2">Nenhum post encontrado</p>
            <button
              onClick={openNewPost}
              className="text-amber-500 hover:text-amber-600 font-medium"
            >
              Criar primeiro post
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-6 border-b border-gray-200 z-10">
              <h2 className="text-xl font-bold text-gray-900">
                {editingPost ? 'Editar Post' : 'Novo Post'}
              </h2>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Título */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Título *
                </label>
                <input
                  type="text"
                  required
                  value={form.titulo}
                  onChange={(e) => handleTituloChange(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="Ex: Novas regras para cidadania italiana em 2026"
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Slug (URL)
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-gray-50"
                  placeholder="novas-regras-cidadania-italiana-2026"
                />
                <p className="text-xs text-gray-500 mt-1">URL amigável gerada automaticamente</p>
              </div>

              {/* Resumo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Resumo * <span className="font-normal text-gray-500">(aparece no card)</span>
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={500}
                  value={form.resumo}
                  onChange={(e) => setForm({ ...form, resumo: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                  placeholder="Breve descrição do post que aparecerá no card..."
                />
                <p className="text-xs text-gray-500 mt-1">{form.resumo.length}/500 caracteres</p>
              </div>

              {/* Imagem */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL da Imagem
                </label>
                <input
                  type="url"
                  value={form.imagemUrl}
                  onChange={(e) => setForm({ ...form, imagemUrl: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="https://images.unsplash.com/..."
                />
                <p className="text-xs text-gray-500 mt-1">Use imagens do Unsplash ou Pexels (gratuitas)</p>
                {form.imagemUrl && (
                  <div className="mt-2">
                    <img 
                      src={form.imagemUrl} 
                      alt="Preview" 
                      className="w-full h-40 object-cover rounded-lg"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  </div>
                )}
              </div>

              {/* Categoria e Tempo */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Categoria *
                  </label>
                  <select
                    required
                    value={form.categoria}
                    onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  >
                    {CATEGORIAS.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tempo de Leitura (min)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={form.tempoLeitura}
                    onChange={(e) => setForm({ ...form, tempoLeitura: parseInt(e.target.value) || 5 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Data e Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Data de Publicação
                  </label>
                  <input
                    type="date"
                    value={form.dataPublicacao}
                    onChange={(e) => setForm({ ...form, dataPublicacao: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  >
                    <option value="RASCUNHO">Rascunho</option>
                    <option value="PUBLICADO">Publicado</option>
                    <option value="ARQUIVADO">Arquivado</option>
                  </select>
                </div>
              </div>

              {/* Destaque */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="destaque"
                  checked={form.destaque}
                  onChange={(e) => setForm({ ...form, destaque: e.target.checked })}
                  className="w-4 h-4 text-amber-500 border-gray-300 rounded focus:ring-amber-500"
                />
                <label htmlFor="destaque" className="text-sm text-gray-700 cursor-pointer">
                  Destacar este post (aparece primeiro na lista)
                </label>
              </div>

              {/* Botões */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    editingPost ? 'Salvar' : 'Criar Post'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}