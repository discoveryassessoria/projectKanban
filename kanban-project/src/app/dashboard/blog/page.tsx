"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HeaderBar } from "@/src/components/header-bar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Eye, 
  EyeOff, 
  Star,
  StarOff,
  Search,
  Calendar,
  Clock,
  X,
  Check,
  FileText,
  Filter,
  Image as ImageIcon,
  Tag
} from 'lucide-react'

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

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
  status: string
  destaque: boolean
  dataPublicacao?: string
  createdAt: string
}

const categorias = [
  'Cidadania Italiana',
  'Cidadania Portuguesa', 
  'Cidadania Espanhola',
  'Documentação',
  'Dicas de Viagem',
  'Notícias',
  'Geral'
]

export default function BlogAdminPage() {
  const router = useRouter()
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  
  // Modal/Form states
  const [showForm, setShowForm] = useState(false)
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null)
  const [formData, setFormData] = useState({
    titulo: '',
    resumo: '',
    conteudo: '',
    imagemUrl: '',
    imagemAlt: '',
    categoria: 'Geral',
    tempoLeitura: 5,
    status: 'RASCUNHO',
    destaque: false,
    dataPublicacao: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem("authToken")
    const userData = localStorage.getItem("user")

    if (!token || !userData) {
      router.push('/login')
      return
    }

    try {
      const user = JSON.parse(userData)
      setUsuario(user)
      fetchPosts()
    } catch (error) {
      console.error("Erro ao carregar dados do usuário:", error)
      router.push('/login')
    }
  }, [router])

  const fetchPosts = async () => {
    try {
      const response = await fetch('/api/admin/blog')
      const data = await response.json()
      setPosts(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Erro ao buscar posts:', error)
      setPosts([])
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const url = editingPost 
        ? `/api/admin/blog/${editingPost.id}`
        : '/api/admin/blog'
      
      const response = await fetch(url, {
        method: editingPost ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Erro ao salvar')
      }

      await fetchPosts()
      resetForm()
    } catch (error: any) {
      alert(error.message || 'Erro ao salvar post')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir este post?')) return

    try {
      await fetch(`/api/admin/blog/${id}`, { method: 'DELETE' })
      await fetchPosts()
    } catch (error) {
      alert('Erro ao excluir post')
    }
  }

  const togglePublish = async (post: BlogPost) => {
    const newStatus = post.status === 'PUBLICADO' ? 'RASCUNHO' : 'PUBLICADO'
    
    try {
      await fetch(`/api/admin/blog/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...post, 
          status: newStatus,
          dataPublicacao: newStatus === 'PUBLICADO' ? new Date().toISOString() : post.dataPublicacao
        })
      })
      await fetchPosts()
    } catch (error) {
      alert('Erro ao alterar status')
    }
  }

  const toggleDestaque = async (post: BlogPost) => {
    try {
      await fetch(`/api/admin/blog/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, destaque: !post.destaque })
      })
      await fetchPosts()
    } catch (error) {
      alert('Erro ao alterar destaque')
    }
  }

  const editPost = (post: BlogPost) => {
    setEditingPost(post)
    setFormData({
      titulo: post.titulo,
      resumo: post.resumo,
      conteudo: post.conteudo || '',
      imagemUrl: post.imagemUrl || '',
      imagemAlt: post.imagemAlt || '',
      categoria: post.categoria,
      tempoLeitura: post.tempoLeitura,
      status: post.status,
      destaque: post.destaque,
      dataPublicacao: post.dataPublicacao ? post.dataPublicacao.split('T')[0] : ''
    })
    setShowForm(true)
  }

  const resetForm = () => {
    setShowForm(false)
    setEditingPost(null)
    setFormData({
      titulo: '',
      resumo: '',
      conteudo: '',
      imagemUrl: '',
      imagemAlt: '',
      categoria: 'Geral',
      tempoLeitura: 5,
      status: 'RASCUNHO',
      destaque: false,
      dataPublicacao: ''
    })
  }

  // Filtros
  const filteredPosts = (posts || []).filter(post => {
    const matchStatus = filtroStatus === 'todos' || post.status === filtroStatus
    const matchBusca = post.titulo.toLowerCase().includes(busca.toLowerCase()) ||
                       post.resumo.toLowerCase().includes(busca.toLowerCase())
    return matchStatus && matchBusca
  })

  // Métricas
  const totalPosts = posts.length
  const publicados = posts.filter(p => p.status === 'PUBLICADO').length
  const rascunhos = posts.filter(p => p.status === 'RASCUNHO').length
  const destaques = posts.filter(p => p.destaque).length

  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando posts...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!usuario) return null

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      {/* Background com imagem */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />

      {/* HeaderBar igual às outras páginas */}
      <HeaderBar
        title="Blog"
        subtitle="Gerencie os posts do blog da landing page"
        userName={usuario.nome}
        userRole={usuario.tipo === 'admin' ? 'Administrador' : usuario.tipo}
        userEmail={usuario.email}
        onLogout={handleLogout}
      />

      {/* Conteúdo */}
      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        
        <main className="relative px-6 py-6 space-y-6">
          {/* Título e Botão */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold flex items-center gap-3">
                <FileText className="w-8 h-8 text-amber-400" />
                Blog
              </h2>
              <p className="text-sm text-white/70 mt-1">Gerencie os posts do blog da landing page</p>
            </div>
            <Button 
              onClick={() => setShowForm(true)}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo Post
            </Button>
          </div>

          {/* Cards de Métricas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total de Posts', value: totalPosts, cor: 'bg-blue-500' },
              { label: 'Publicados', value: publicados, cor: 'bg-green-500' },
              { label: 'Rascunhos', value: rascunhos, cor: 'bg-yellow-500' },
              { label: 'Em Destaque', value: destaques, cor: 'bg-purple-500' },
            ].map((metric, idx) => (
              <Card key={idx} className="bg-white/10 backdrop-blur-sm border border-white/20 text-white">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-white/60 font-medium">{metric.label}</p>
                      <p className="text-3xl font-bold mt-2">{metric.value}</p>
                    </div>
                    <div className={`p-2.5 rounded-xl ${metric.cor}`}>
                      <FileText className="h-5 w-5 text-white" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filtros */}
          <Card className="bg-white/10 backdrop-blur-sm border border-white/20">
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-4 items-center">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
                    <Input
                      placeholder="Buscar posts..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-white/50"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={filtroStatus === 'todos' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroStatus('todos')}
                    className={filtroStatus === 'todos' ? 'bg-amber-500 text-black' : 'border-white/30 text-white/70 bg-transparent hover:bg-white/10'}
                  >
                    Todos
                  </Button>
                  <Button
                    variant={filtroStatus === 'PUBLICADO' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroStatus('PUBLICADO')}
                    className={filtroStatus === 'PUBLICADO' ? 'bg-green-500 text-white' : 'border-white/30 text-white/70 bg-transparent hover:bg-white/10'}
                  >
                    Publicados
                  </Button>
                  <Button
                    variant={filtroStatus === 'RASCUNHO' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFiltroStatus('RASCUNHO')}
                    className={filtroStatus === 'RASCUNHO' ? 'bg-yellow-500 text-black' : 'border-white/30 text-white/70 bg-transparent hover:bg-white/10'}
                  >
                    Rascunhos
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Lista de Posts */}
          {filteredPosts.length === 0 ? (
            <Card className="bg-white/10 backdrop-blur-sm border border-white/20">
              <CardContent className="p-12 text-center">
                <FileText className="w-16 h-16 text-white/30 mx-auto mb-4" />
                <p className="text-white/70 text-lg">Nenhum post encontrado</p>
                <p className="text-white/50 text-sm mt-1">Clique em "Novo Post" para criar seu primeiro post</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredPosts.map((post) => (
                <Card key={post.id} className="bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/15 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      {/* Imagem */}
                      <div className="w-32 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-white/10">
                        {post.imagemUrl ? (
                          <img 
                            src={post.imagemUrl} 
                            alt={post.imagemAlt || post.titulo}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-white/30" />
                          </div>
                        )}
                      </div>

                      {/* Conteúdo */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-white font-semibold text-lg truncate">{post.titulo}</h3>
                            <p className="text-white/60 text-sm line-clamp-2 mt-1">{post.resumo}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Status Badge */}
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              post.status === 'PUBLICADO' 
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : post.status === 'ARQUIVADO'
                                ? 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                            }`}>
                              {post.status}
                            </span>
                            {post.destaque && (
                              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                            )}
                          </div>
                        </div>

                        {/* Meta info */}
                        <div className="flex items-center gap-4 mt-3 text-xs text-white/50">
                          <span className="flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            {post.categoria}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {post.tempoLeitura} min de leitura
                          </span>
                          {post.dataPublicacao && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(post.dataPublicacao).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-2 mt-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => togglePublish(post)}
                            className="text-white/60 hover:text-white hover:bg-white/10"
                          >
                            {post.status === 'PUBLICADO' ? (
                              <><EyeOff className="w-4 h-4 mr-1" /> Despublicar</>
                            ) : (
                              <><Eye className="w-4 h-4 mr-1" /> Publicar</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleDestaque(post)}
                            className="text-white/60 hover:text-amber-400 hover:bg-white/10"
                          >
                            {post.destaque ? (
                              <><StarOff className="w-4 h-4 mr-1" /> Remover Destaque</>
                            ) : (
                              <><Star className="w-4 h-4 mr-1" /> Destacar</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => editPost(post)}
                            className="text-white/60 hover:text-blue-400 hover:bg-white/10"
                          >
                            <Pencil className="w-4 h-4 mr-1" /> Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(post.id)}
                            className="text-white/60 hover:text-red-400 hover:bg-white/10"
                          >
                            <Trash2 className="w-4 h-4 mr-1" /> Excluir
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Modal de Formulário */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={resetForm} />
          <Card className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-900 border-white/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">
                  {editingPost ? 'Editar Post' : 'Novo Post'}
                </h2>
                <Button variant="ghost" size="sm" onClick={resetForm} className="text-white/60 hover:text-white">
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm text-white/70 mb-1 block">Título *</label>
                  <Input
                    value={formData.titulo}
                    onChange={(e) => setFormData({...formData, titulo: e.target.value})}
                    placeholder="Digite o título do post"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/50"
                    required
                  />
                </div>

                <div>
                  <label className="text-sm text-white/70 mb-1 block">Resumo *</label>
                  <textarea
                    value={formData.resumo}
                    onChange={(e) => setFormData({...formData, resumo: e.target.value})}
                    placeholder="Digite um resumo do post (aparece no card)"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-md text-white placeholder:text-white/50 resize-none h-20"
                    required
                  />
                </div>

                <div>
                  <label className="text-sm text-white/70 mb-1 block">Conteúdo</label>
                  <textarea
                    value={formData.conteudo}
                    onChange={(e) => setFormData({...formData, conteudo: e.target.value})}
                    placeholder="Conteúdo completo do post (opcional)"
                    className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-md text-white placeholder:text-white/50 resize-none h-32"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">URL da Imagem</label>
                    <Input
                      value={formData.imagemUrl}
                      onChange={(e) => setFormData({...formData, imagemUrl: e.target.value})}
                      placeholder="https://..."
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">Alt da Imagem</label>
                    <Input
                      value={formData.imagemAlt}
                      onChange={(e) => setFormData({...formData, imagemAlt: e.target.value})}
                      placeholder="Descrição da imagem"
                      className="bg-white/10 border-white/20 text-white placeholder:text-white/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">Categoria *</label>
                    <select
                      value={formData.categoria}
                      onChange={(e) => setFormData({...formData, categoria: e.target.value})}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-md text-white"
                      required
                    >
                      {categorias.map(cat => (
                        <option key={cat} value={cat} className="bg-gray-900">{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">Tempo de Leitura (min)</label>
                    <Input
                      type="number"
                      value={formData.tempoLeitura}
                      onChange={(e) => setFormData({...formData, tempoLeitura: parseInt(e.target.value) || 5})}
                      min={1}
                      className="bg-white/10 border-white/20 text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value})}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-md text-white"
                    >
                      <option value="RASCUNHO" className="bg-gray-900">Rascunho</option>
                      <option value="PUBLICADO" className="bg-gray-900">Publicado</option>
                      <option value="ARQUIVADO" className="bg-gray-900">Arquivado</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-white/70 mb-1 block">Data de Publicação</label>
                    <Input
                      type="date"
                      value={formData.dataPublicacao}
                      onChange={(e) => setFormData({...formData, dataPublicacao: e.target.value})}
                      className="bg-white/10 border-white/20 text-white"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="destaque"
                    checked={formData.destaque}
                    onChange={(e) => setFormData({...formData, destaque: e.target.checked})}
                    className="rounded border-white/30"
                  />
                  <label htmlFor="destaque" className="text-sm text-white/70">
                    Marcar como destaque (aparece primeiro)
                  </label>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    className="flex-1 border-white/30 text-white/70 bg-transparent hover:bg-white/10"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  >
                    {saving ? 'Salvando...' : (
                      <><Check className="w-4 h-4 mr-2" /> {editingPost ? 'Atualizar' : 'Criar Post'}</>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}