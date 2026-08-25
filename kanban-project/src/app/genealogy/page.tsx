// ESTE ARQUIVO VAI EM: src/app/genealogy/page.tsx

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { 
  Search, 
  User, 
  Users, 
  FileText, 
  MapPin, 
  TreePine,
  Clock,
  Filter,
  X,
  ChevronDown,
  ChevronUp
} from "lucide-react"
import { HeaderBar } from "@/src/components/header-bar"
import { encerrarSessao } from "@/src/lib/sessao/cliente"
import { gravarLocal, useIsClient, useJsonLocalStorage, useLocalStorage } from "@/src/lib/cliente"
import { useApi } from "@/src/lib/dados"
import type { ProcessoWithStatus } from "@/src/types/kanban"

interface Usuario {
  id: number
  nome: string
  email: string
  tipo: string
}

interface Arvore {
  id: number
  nome: string
  descricao?: string
  pessoas: any[]
}

interface PessoaResultado {
  id: number
  nome: string
  sobrenome: string | null
  sexo: string | null
  data_nasc: string | null
  data_obito: string | null
  local_nasc: string | null
  estado_nasc: string | null
  pais_nasc: string | null
  nacionalidade: string | null
  vivo: boolean | null
  arvoreId: number
  arvoreNome?: string
  // NOVO: Dados do processo vinculado
  processoId?: number | null
  processoNome?: string | null
  processoPais?: string | null
  _count?: {
    documentos: number
  }
}

interface DocumentoResultado {
  id: number
  tipo: string
  status: string
  descricao: string | null
  pessoaId: number | null
  pessoaNome?: string
  pessoaSobrenome?: string
  arvoreId?: number
  arvoreNome?: string
  // NOVO: Dados do processo vinculado
  processoId?: number | null
  processoNome?: string | null
  processoPais?: string | null
}

interface Estatisticas {
  totalPessoas: number
  totalDocumentos: number
  totalArvores: number
}

export default function GenealogyPage() {
  const router = useRouter()
  // Sessão e usuário derivados da leitura oficial — sem copiar para o estado.
  const noCliente = useIsClient()
  const token = useLocalStorage("authToken")
  const usuario = useJsonLocalStorage<Usuario>("user")
  
  const [activeTab, setActiveTab] = useState<'pessoa' | 'documento'>('pessoa')
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  const [nome, setNome] = useState("")
  const [sobrenome, setSobrenome] = useState("")
  const [localNascimento, setLocalNascimento] = useState("")
  const [anoNascimento, setAnoNascimento] = useState("")
  const [anoFalecimento, setAnoFalecimento] = useState("")
  const [nacionalidade, setNacionalidade] = useState("")
  const [sexo, setSexo] = useState("")
  
  const [tipoDocumento, setTipoDocumento] = useState("")
  const [statusDocumento, setStatusDocumento] = useState("")
  const [pessoaDocumento, setPessoaDocumento] = useState("")
  
  const [resultadosPessoas, setResultadosPessoas] = useState<PessoaResultado[]>([])
  const [resultadosDocumentos, setResultadosDocumentos] = useState<DocumentoResultado[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  
  // As três leituras de apoio da tela, pela camada oficial. Eram sequenciais
  // dentro de um `fetchData` — agora são paralelas por construção, cada uma com o
  // seu cache. Os `|| []` e o `Array.isArray` continuam: resposta inesperada de
  // qualquer uma delas não pode derrubar a tela de busca.
  const autenticado = Boolean(token && usuario)
  const estat = useApi<Estatisticas>(autenticado ? "/api/genealogy/estatisticas" : null)
  const arvoresReq = useApi<Arvore[]>(autenticado ? "/api/arvore" : null)
  const processosReq = useApi<{ processos?: ProcessoWithStatus[] }>(autenticado ? "/api/processos" : null)
  const estatisticas = estat.dados ?? { totalPessoas: 0, totalDocumentos: 0, totalArvores: 0 }
  const arvores = Array.isArray(arvoresReq.dados) ? arvoresReq.dados : []
  const processos = processosReq.dados?.processos ?? []
  const isLoading = !noCliente || (autenticado && (estat.carregando || arvoresReq.carregando || processosReq.carregando))

  // Pesquisas recentes vivem no localStorage: a leitura é a abstração oficial (que
  // já cobre hidratação e JSON corrompido) e a escrita passa por `gravarLocal`,
  // que avisa a própria aba — antes o valor era lido dentro do `fetchData`.
  const recentesSalvas = useJsonLocalStorage<string[]>('pesquisasRecentes')
  const pesquisasRecentes = Array.isArray(recentesSalvas) ? recentesSalvas : []

  // Navegar é efeito. Guardar o usuário em estado não era.
  useEffect(() => {
    if (!noCliente) return
    if (!token || !usuario) router.push("/login")
  }, [noCliente, token, usuario, router])


  const handleLogout = () => { void encerrarSessao("manual") }
  
  const savePesquisaRecente = (termo: string) => {
    if (!termo.trim()) return
    const novas = [termo, ...pesquisasRecentes.filter(p => p !== termo)].slice(0, 5)
    // Uma escrita só: `gravarLocal` persiste E notifica os leitores desta aba, então
    // a lista na tela se atualiza sem um estado paralelo ao localStorage.
    gravarLocal('pesquisasRecentes', novas)
  }
  
  const pesquisarPessoas = async () => {
    setLoading(true)
    setSearched(true)
    
    const termo = `${nome} ${sobrenome}`.trim()
    if (termo) savePesquisaRecente(termo)
    
    try {
      const params = new URLSearchParams()
      if (nome) params.append('nome', nome)
      if (sobrenome) params.append('sobrenome', sobrenome)
      if (localNascimento) params.append('local', localNascimento)
      if (anoNascimento) params.append('anoNasc', anoNascimento)
      if (anoFalecimento) params.append('anoObito', anoFalecimento)
      if (nacionalidade) params.append('nacionalidade', nacionalidade)
      if (sexo) params.append('sexo', sexo)
      
      const response = await fetch(`/api/genealogy/pesquisar/pessoas?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setResultadosPessoas(data)
      }
    } catch (error) {
      console.error("Erro na pesquisa:", error)
    } finally {
      setLoading(false)
    }
  }
  
  const pesquisarDocumentos = async () => {
    setLoading(true)
    setSearched(true)
    
    try {
      const params = new URLSearchParams()
      if (tipoDocumento) params.append('tipo', tipoDocumento)
      if (statusDocumento) params.append('status', statusDocumento)
      if (pessoaDocumento) params.append('pessoa', pessoaDocumento)
      
      const response = await fetch(`/api/genealogy/pesquisar/documentos?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setResultadosDocumentos(data)
      }
    } catch (error) {
      console.error("Erro na pesquisa:", error)
    } finally {
      setLoading(false)
    }
  }
  
  const handlePesquisar = () => {
    if (activeTab === 'pessoa') {
      pesquisarPessoas()
    } else {
      pesquisarDocumentos()
    }
  }
  
  const limparPesquisa = () => {
    setNome("")
    setSobrenome("")
    setLocalNascimento("")
    setAnoNascimento("")
    setAnoFalecimento("")
    setNacionalidade("")
    setSexo("")
    setTipoDocumento("")
    setStatusDocumento("")
    setPessoaDocumento("")
    setResultadosPessoas([])
    setResultadosDocumentos([])
    setSearched(false)
  }
  
  const abrirPessoa = (pessoa: PessoaResultado) => {
    if (pessoa.processoId) {
      // Navegar para /kanban com parâmetros para abrir o modal na aba Árvore Genealógica
      const params = new URLSearchParams()
      params.append('processoId', pessoa.processoId.toString())
      params.append('tab', 'arvore')
      params.append('pessoaId', pessoa.id.toString())
      if (pessoa.processoPais) {
        params.append('pais', pessoa.processoPais)
      }
      router.push(`/kanban?${params.toString()}`)
    } else {
      // Fallback se não tiver processo vinculado
      alert('Esta pessoa não está vinculada a nenhum processo.')
    }
  }
  
  const abrirDocumento = (doc: DocumentoResultado) => {
    if (doc.processoId) {
      // Navegar para /kanban com parâmetros para abrir o modal na aba Árvore Genealógica
      const params = new URLSearchParams()
      params.append('processoId', doc.processoId.toString())
      params.append('tab', 'arvore')
      if (doc.pessoaId) {
        params.append('pessoaId', doc.pessoaId.toString())
      }
      if (doc.processoPais) {
        params.append('pais', doc.processoPais)
      }
      // NOVO: Abrir na aba Documentos da sidebar
      params.append('sidebarTab', 'documentos')
      router.push(`/kanban?${params.toString()}`)
    } else {
      // Fallback se não tiver processo vinculado
      alert('Este documento não está vinculado a nenhum processo.')
    }
  }
  
  const formatarData = (data: string | null) => {
    if (!data) return ""
    const d = new Date(data)
    return d.getUTCFullYear().toString()
  }
  
  const formatarLocal = (pessoa: PessoaResultado) => {
    const partes = [pessoa.local_nasc, pessoa.estado_nasc, pessoa.pais_nasc].filter(Boolean)
    return partes.join(", ")
  }

  if (isLoading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            background:
              "var(--landscape-veil)",
          }}
        />
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-[var(--border-default)] border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando pesquisa genealógica...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!usuario) return null

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "var(--landscape-veil)",
        }}
      />

      <HeaderBar
        title="Pesquisa Genealógica"
        subtitle="Encontre pessoas e documentos em todas as árvores"
        userName={usuario.nome}
        userRole={usuario.tipo === 'admin' ? 'Administrador' : usuario.tipo}
        userEmail={usuario.email}
        projetos={[]}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        
        <main className="relative px-6 py-6 space-y-6">
          {/* Hero Section */}
          <section className="py-4">
            <div className="grid lg:grid-cols-2 gap-8 items-start">
              {/* Texto + Estatísticas */}
              <div className="text-white">
                <h1 className="text-3xl lg:text-4xl font-bold mb-4 leading-tight">
                  Pesquise em todas as suas árvores genealógicas
                </h1>
                <p className="text-lg text-white/70 mb-6 leading-relaxed">
                  Encontre pessoas, documentos e conexões familiares. 
                  Descubra sua história e veja como tudo se conecta.
                </p>
                
                {/* Estatísticas em cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl px-4 py-3 border border-[var(--border-strong)]">
                    <p className="text-2xl font-bold">{estatisticas.totalPessoas}</p>
                    <p className="text-white/50 text-xs">{estatisticas.totalPessoas === 1 ? 'Pessoa' : 'Pessoas'}</p>
                  </div>
                  <div className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl px-4 py-3 border border-[var(--border-strong)]">
                    <p className="text-2xl font-bold">{estatisticas.totalDocumentos}</p>
                    <p className="text-white/50 text-xs">{estatisticas.totalDocumentos === 1 ? 'Documento' : 'Documentos'}</p>
                  </div>
                  <div className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl px-4 py-3 border border-[var(--border-strong)]">
                    <p className="text-2xl font-bold">{estatisticas.totalArvores}</p>
                    <p className="text-white/50 text-xs">{estatisticas.totalArvores === 1 ? 'Árvore' : 'Árvores'}</p>
                  </div>
                </div>
              </div>
              
              {/* Card de Pesquisa - ESTILO GLASSMORPHISM */}
              <div className="bg-[var(--surface-primary)] backdrop-blur-md rounded-xl border border-[var(--border-strong)] overflow-hidden">
                {/* Tabs - AGORA SEM FUNDO VERDE */}
                <div className="flex border-b border-[var(--border-strong)]">
                  <button
                    onClick={() => setActiveTab('pessoa')}
                    className={`flex-1 py-3 px-4 text-sm font-medium transition ${
                      activeTab === 'pessoa' 
                        ? 'text-white border-b-2 border-[var(--border-default)]' 
                        : 'text-white/50 hover:text-white/70'
                    }`}
                  >
                    <User className="h-4 w-4 inline mr-2" />
                    Procurar por pessoa
                  </button>
                  <button
                    onClick={() => setActiveTab('documento')}
                    className={`flex-1 py-3 px-4 text-sm font-medium transition ${
                      activeTab === 'documento' 
                        ? 'text-white border-b-2 border-[var(--border-default)]' 
                        : 'text-white/50 hover:text-white/70'
                    }`}
                  >
                    <FileText className="h-4 w-4 inline mr-2" />
                    Procurar por documento
                  </button>
                </div>
                
                {/* Form - Pessoa */}
                {activeTab === 'pessoa' && (
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-white/50 mb-1">Nome</label>
                        <input
                          type="text"
                          value={nome}
                          onChange={(e) => setNome(e.target.value)}
                          placeholder="Nome"
                          className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-white/50 mb-1">Sobrenome</label>
                        <input
                          type="text"
                          value={sobrenome}
                          onChange={(e) => setSobrenome(e.target.value)}
                          placeholder="Sobrenome"
                          className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-white/50 mb-1">Local de nascimento</label>
                        <input
                          type="text"
                          value={localNascimento}
                          onChange={(e) => setLocalNascimento(e.target.value)}
                          placeholder="Cidade, estado ou país"
                          className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-white/50 mb-1">Ano de nascimento</label>
                        <input
                          type="text"
                          value={anoNascimento}
                          onChange={(e) => setAnoNascimento(e.target.value)}
                          placeholder="Ex: 1950"
                          className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                        />
                      </div>
                    </div>
                    
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="flex items-center gap-1 text-white/70 text-xs font-medium mb-3 hover:text-white"
                    >
                      <Filter className="h-3 w-3" />
                      {showAdvanced ? 'Menos opções' : 'Mais opções'}
                      {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    
                    {showAdvanced && (
                      <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-[var(--surface-primary)] rounded-lg border border-[var(--border-default)]">
                        <div>
                          <label className="block text-xs text-white/50 mb-1">Ano falecimento</label>
                          <input
                            type="text"
                            value={anoFalecimento}
                            onChange={(e) => setAnoFalecimento(e.target.value)}
                            placeholder="Ex: 2020"
                            className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 mb-1">Nacionalidade</label>
                          <input
                            type="text"
                            value={nacionalidade}
                            onChange={(e) => setNacionalidade(e.target.value)}
                            placeholder="Ex: Italiano"
                            className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-white/50 mb-1">Sexo</label>
                          <select
                            value={sexo}
                            onChange={(e) => setSexo(e.target.value)}
                            className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white text-sm"
                          >
                            <option value="" className="bg-gray-800">Todos</option>
                            <option value="Masculino" className="bg-gray-800">Masculino</option>
                            <option value="Feminino" className="bg-gray-800">Feminino</option>
                          </select>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex gap-2">
                      <button
                        onClick={handlePesquisar}
                        disabled={loading}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-[#fff] py-2.5 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                      >
                        <Search className="h-4 w-4" />
                        {loading ? 'Pesquisando...' : 'PESQUISAR'}
                      </button>
                      {searched && (
                        <button
                          onClick={limparPesquisa}
                          className="px-3 py-2.5 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--surface-hover)] transition"
                        >
                          <X className="h-4 w-4 text-white/70" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Form - Documento */}
                {activeTab === 'documento' && (
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-white/50 mb-1">Tipo de documento</label>
                        <select
                          value={tipoDocumento}
                          onChange={(e) => setTipoDocumento(e.target.value)}
                          className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white text-sm"
                        >
                          <option value="" className="bg-gray-800">Todos os tipos</option>
                          <option value="CERTIDAO_NASCIMENTO_INTEIRO_TEOR" className="bg-gray-800">Certidão de Nascimento</option>
                          <option value="CERTIDAO_CASAMENTO_INTEIRO_TEOR" className="bg-gray-800">Certidão de Casamento</option>
                          <option value="CERTIDAO_OBITO_INTEIRO_TEOR" className="bg-gray-800">Certidão de Óbito</option>
                          <option value="CERTIDAO_BATISMO" className="bg-gray-800">Certidão de Batismo</option>
                          <option value="CNN" className="bg-gray-800">CNN</option>
                          <option value="RG" className="bg-gray-800">RG</option>
                          <option value="CPF" className="bg-gray-800">CPF</option>
                          <option value="PASSAPORTE" className="bg-gray-800">Passaporte</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-white/50 mb-1">Status</label>
                        <select
                          value={statusDocumento}
                          onChange={(e) => setStatusDocumento(e.target.value)}
                          className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white text-sm"
                        >
                          <option value="" className="bg-gray-800">Todos os status</option>
                          <option value="PENDENTE" className="bg-gray-800">Pendente</option>
                          <option value="SOLICITADO" className="bg-gray-800">Solicitado</option>
                          <option value="RECEBIDO" className="bg-gray-800">Recebido</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="mb-3">
                      <label className="block text-xs text-white/50 mb-1">Nome da pessoa</label>
                      <input
                        type="text"
                        value={pessoaDocumento}
                        onChange={(e) => setPessoaDocumento(e.target.value)}
                        placeholder="Buscar por nome da pessoa"
                        className="w-full px-3 py-2 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg focus:ring-2 focus:ring-white/50 focus:border-transparent outline-none text-white placeholder-white/40 text-sm"
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={handlePesquisar}
                        disabled={loading}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-[#fff] py-2.5 px-4 rounded-lg font-medium transition flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                      >
                        <Search className="h-4 w-4" />
                        {loading ? 'Pesquisando...' : 'PESQUISAR'}
                      </button>
                      {searched && (
                        <button
                          onClick={limparPesquisa}
                          className="px-3 py-2.5 bg-[var(--surface-primary)] border border-[var(--border-strong)] rounded-lg hover:bg-[var(--surface-hover)] transition"
                        >
                          <X className="h-4 w-4 text-white/70" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
          
          {/* Resultados */}
          {searched && (
            <section className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl border border-[var(--border-strong)] p-6">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin h-10 w-10 border-4 border-[var(--border-default)] border-t-transparent rounded-full" />
                </div>
              ) : (
                <>
                  {activeTab === 'pessoa' && (
                    <>
                      <h2 className="text-lg font-semibold text-white mb-4">
                        {resultadosPessoas.length} {resultadosPessoas.length === 1 ? 'resultado encontrado' : 'resultados encontrados'}
                      </h2>
                      
                      {resultadosPessoas.length === 0 ? (
                        <div className="text-center py-12">
                          <User className="h-12 w-12 text-white/30 mx-auto mb-3" />
                          <p className="text-white/70">Nenhuma pessoa encontrada com esses critérios.</p>
                          <p className="text-white/40 text-sm mt-1">Tente ajustar os filtros de pesquisa.</p>
                        </div>
                      ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {resultadosPessoas.map((pessoa) => (
                            <div
                              key={pessoa.id}
                              onClick={() => abrirPessoa(pessoa)}
                              className="bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-xl p-4 hover:bg-[var(--surface-hover)] transition cursor-pointer group"
                            >
                              <div className="flex items-start gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                                  pessoa.sexo?.toLowerCase() === 'masculino' ? 'bg-blue-500' : 
                                  pessoa.sexo?.toLowerCase() === 'feminino' ? 'bg-pink-500' : 'bg-gray-400'
                                }`}>
                                  {pessoa.nome?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-white group-hover:text-white/80 transition truncate text-sm">
                                    {pessoa.nome} {pessoa.sobrenome}
                                  </h3>
                                  
                                  <p className="text-xs text-white/50">
                                    {formatarData(pessoa.data_nasc)}
                                    {pessoa.data_nasc && (pessoa.data_obito || pessoa.vivo === false) && ' – '}
                                    {pessoa.data_obito ? formatarData(pessoa.data_obito) : (pessoa.vivo === false ? '?' : '')}
                                    {pessoa.vivo && ' (vivo)'}
                                  </p>
                                  
                                  {formatarLocal(pessoa) && (
                                    <p className="text-xs text-white/40 flex items-center gap-1 mt-1 truncate">
                                      <MapPin className="h-3 w-3 flex-shrink-0" />
                                      {formatarLocal(pessoa)}
                                    </p>
                                  )}
                                  
                                  {pessoa.arvoreNome && (
                                    <p className="text-xs text-white/60 mt-1 flex items-center gap-1">
                                      <TreePine className="h-3 w-3" />
                                      {pessoa.arvoreNome}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  
                  {activeTab === 'documento' && (
                    <>
                      <h2 className="text-lg font-semibold text-white mb-4">
                        {resultadosDocumentos.length} {resultadosDocumentos.length === 1 ? 'documento encontrado' : 'documentos encontrados'}
                      </h2>
                      
                      {resultadosDocumentos.length === 0 ? (
                        <div className="text-center py-12">
                          <FileText className="h-12 w-12 text-white/30 mx-auto mb-3" />
                          <p className="text-white/70">Nenhum documento encontrado com esses critérios.</p>
                          <p className="text-white/40 text-sm mt-1">Tente ajustar os filtros de pesquisa.</p>
                        </div>
                      ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {resultadosDocumentos.map((doc) => (
                            <div
                              key={doc.id}
                              onClick={() => abrirDocumento(doc)}
                              className="bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-xl p-4 hover:bg-[var(--surface-hover)] transition cursor-pointer group"
                            >
                              <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-lg bg-[var(--surface-primary)] flex items-center justify-center">
                                  <FileText className="h-5 w-5 text-white/70" />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-white group-hover:text-white/80 transition truncate text-sm">
                                    {doc.tipo.replace(/_/g, ' ')}
                                  </h3>
                                  
                                  <span className={`inline-block text-xs px-2 py-0.5 rounded mt-1 ${
                                    doc.status === 'RECEBIDO' ? 'bg-green-500/20 text-green-400' :
                                    doc.status === 'SOLICITADO' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-[var(--surface-primary)] text-white/50'
                                  }`}>
                                    {doc.status}
                                  </span>
                                  
                                  {doc.pessoaNome && (
                                    <p className="text-xs text-white/50 mt-1 flex items-center gap-1">
                                      <User className="h-3 w-3" />
                                      {doc.pessoaNome} {doc.pessoaSobrenome}
                                    </p>
                                  )}
                                  
                                  {doc.arvoreNome && (
                                    <p className="text-xs text-white/60 mt-1 flex items-center gap-1">
                                      <TreePine className="h-3 w-3" />
                                      {doc.arvoreNome}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          )}
          
          {/* Pesquisas Recentes */}
          {!searched && pesquisasRecentes.length > 0 && (
            <section className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl border border-[var(--border-default)] p-5">
              <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-white/50" />
                Pesquisas recentes
              </h3>
              <div className="flex flex-wrap gap-2">
                {pesquisasRecentes.map((termo, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const partes = termo.split(' ')
                      setNome(partes[0] || '')
                      setSobrenome(partes.slice(1).join(' ') || '')
                      setActiveTab('pessoa')
                    }}
                    className="px-3 py-1.5 bg-[var(--surface-primary)] hover:bg-[var(--surface-hover)] text-white rounded-full text-xs transition border border-[var(--border-default)]"
                  >
                    {termo}
                  </button>
                ))}
              </div>
            </section>
          )}
          
          {/* Info Cards */}
          {!searched && (
            <section className="grid md:grid-cols-3 gap-4">
              <div className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl border border-[var(--border-default)] p-5 text-center">
                <div className="w-12 h-12 bg-[var(--surface-primary)] rounded-full flex items-center justify-center mx-auto mb-3">
                  <User className="h-6 w-6 text-white/70" />
                </div>
                <h3 className="font-medium text-white mb-1 text-sm">Encontre pessoas</h3>
                <p className="text-white/50 text-xs">
                  Pesquise por nome, local de nascimento ou ano.
                </p>
              </div>
              
              <div className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl border border-[var(--border-default)] p-5 text-center">
                <div className="w-12 h-12 bg-[var(--surface-primary)] rounded-full flex items-center justify-center mx-auto mb-3">
                  <FileText className="h-6 w-6 text-white/70" />
                </div>
                <h3 className="font-medium text-white mb-1 text-sm">Gerencie documentos</h3>
                <p className="text-white/50 text-xs">
                  Localize certidões e acompanhe o status.
                </p>
              </div>
              
              <div className="bg-[var(--surface-primary)] backdrop-blur-sm rounded-xl border border-[var(--border-default)] p-5 text-center">
                <div className="w-12 h-12 bg-[var(--surface-primary)] rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="h-6 w-6 text-white/70" />
                </div>
                <h3 className="font-medium text-white mb-1 text-sm">Descubra conexões</h3>
                <p className="text-white/50 text-xs">
                  Veja como as pessoas se conectam.
                </p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}