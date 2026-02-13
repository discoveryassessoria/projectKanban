// ESTE ARQUIVO VAI EM: src/app/processos/kanban-content.tsx

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { KanbanBoard } from "@/src/components/kanban-board-novo"
import { ProcessosLista } from "@/src/components/processos-lista"
import { ContratantesTabela } from "@/src/components/contratantes-tabela"
import { PaisTabs } from "@/src/components/ui/pais-selector"
import { HeaderBar } from "@/src/components/header-bar"
import { ProcessoDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import { 
  Pais, 
  type ProcessoWithStatus, 
  type Status,
  type Contratante, 
  type Requerente 
} from "@/src/types/kanban"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { Shield } from "lucide-react"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

type TabPrincipal = "processos" | "contratantes"
type SubTab = "kanban" | "lista"

export function KanbanContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Tabs
  const [tabPrincipal, setTabPrincipal] = useState<TabPrincipal>("processos")
  const [subTab, setSubTab] = useState<SubTab>("kanban")

  // Ler país da URL ou usar Portugal como padrão
  const paisDaUrl = searchParams.get("pais") as Pais | null
  const paisInicial = paisDaUrl && Object.values(Pais).includes(paisDaUrl) ? paisDaUrl : Pais.PORTUGAL
  const [paisSelecionado, setPaisSelecionado] = useState<Pais>(paisInicial)

  const [processos, setProcessos] = useState<ProcessoWithStatus[]>([])
  const [statusList, setStatusList] = useState<Status[]>([])
  const [contratantes, setContratantes] = useState<Contratante[]>([])
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  // NOVO: Parâmetros para abrir modal automaticamente
  const [initialProcessoId, setInitialProcessoId] = useState<number | null>(null)
  const [initialTab, setInitialTab] = useState<string | null>(null)
  const [initialPessoaId, setInitialPessoaId] = useState<number | null>(null)
  const [initialSidebarTab, setInitialSidebarTab] = useState<string | null>(null)
  const [initialTarefaPaiId, setInitialTarefaPaiId] = useState<number | null>(null)
  const [initialAtividadeId, setInitialAtividadeId] = useState<number | null>(null)

  // ✅ NOVO: Estados para modal de processo na aba Clientes
  const [clientesProcessoModal, setClientesProcessoModal] = useState<ProcessoWithStatus | null>(null)
  const [isClientesProcessoModalOpen, setIsClientesProcessoModalOpen] = useState(false)
  const [clientesStatusList, setClientesStatusList] = useState<Status[]>([])

  const { pode } = usePermissoes()

  // Ler parâmetros da URL para abertura automática do modal
  useEffect(() => {
    const processoId = searchParams.get("processoId")
    const tab = searchParams.get("tab")
    const pessoaId = searchParams.get("pessoaId")
    const urlPais = searchParams.get("pais") as Pais | null
    const sidebarTab = searchParams.get("sidebarTab")
    const tarefaPaiId = searchParams.get("tarefaPaiId")

    if (processoId) {
      setInitialProcessoId(parseInt(processoId))
    }
    if (tab) {
      setInitialTab(tab)
    }
    if (pessoaId) {
      setInitialPessoaId(parseInt(pessoaId))
    }
    if (sidebarTab) {
      setInitialSidebarTab(sidebarTab)
    }
    // Se veio um país na URL, usar ele
    if (urlPais && Object.values(Pais).includes(urlPais)) {
      setPaisSelecionado(urlPais)
    }
    if (tarefaPaiId) {
      setInitialTarefaPaiId(parseInt(tarefaPaiId))
    }
    const atividadeId = searchParams.get("atividadeId")
    if (atividadeId) {
      setInitialAtividadeId(parseInt(atividadeId))
    }
  }, [searchParams])

  // Atualizar país quando URL mudar
  useEffect(() => {
    if (paisDaUrl && Object.values(Pais).includes(paisDaUrl)) {
      setPaisSelecionado(paisDaUrl)
    }
  }, [paisDaUrl])

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Callback para limpar URL params depois que o modal abriu
  const handleModalOpened = useCallback(() => {
    // Limpar os parâmetros da URL sem recarregar a página
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.delete("processoId")
    newUrl.searchParams.delete("tab")
    newUrl.searchParams.delete("pessoaId")
    newUrl.searchParams.delete("sidebarTab")
    newUrl.searchParams.delete("atividadeId")
    newUrl.searchParams.delete("atividadeId")
    window.history.replaceState({}, "", newUrl.toString())
    
    // Limpar estados
    setInitialProcessoId(null)
    setInitialTab(null)
    setInitialPessoaId(null)
    setInitialSidebarTab(null)
    setInitialAtividadeId(null)
    setInitialAtividadeId(null)
  }, [])

  // ✅ NOVO: Callback para abrir processo a partir da aba Clientes (abre modal sem mudar de aba)
  const handleOpenProcessoFromClientes = useCallback(async (processoId: number, pais: string) => {
    try {
      const paisNormalizado = pais?.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      
      // Buscar processo E status em paralelo para ser mais rápido
      const [processoResponse, statusResponse] = await Promise.all([
        fetch(`/api/processos/${processoId}`),
        fetch(`/api/status?pais=${paisNormalizado}`)
      ])
      
      if (!processoResponse.ok) throw new Error("Erro ao buscar processo")
      
      const [processoData, statusData] = await Promise.all([
        processoResponse.json(),
        statusResponse.ok ? statusResponse.json() : { status: [] }
      ])
      
      // Abrir o modal com o processo
      setClientesStatusList(statusData.status || [])
      setClientesProcessoModal(processoData.processo)
      setIsClientesProcessoModalOpen(true)
    } catch (error) {
      console.error("Erro ao abrir processo:", error)
      alert("Não foi possível abrir o processo.")
    }
  }, [])

  // Buscar status por país
  const buscarStatus = useCallback(async (pais: Pais) => {
    try {
      const response = await fetch(`/api/status?pais=${pais}`)
      if (response.ok) {
        const data = await response.json()
        setStatusList(data.status || [])
      }
    } catch (error) {
      console.error("Erro ao buscar status:", error)
    }
  }, [])

  // Buscar processos por país
  const buscarProcessos = useCallback(async (pais: Pais) => {
    try {
      const response = await fetch(`/api/processos?pais=${pais}`)
      if (response.ok) {
        const data = await response.json()
        setProcessos(data.processos || [])
      }
    } catch (error) {
      console.error("Erro ao buscar processos:", error)
    }
  }, [])

  const buscarContratantes = async () => {
    try {
      const response = await fetch("/api/contratantes")
      if (response.ok) {
        const { contratantes } = await response.json()
        setContratantes(contratantes || [])
      }
    } catch (error) {
      console.error("Erro ao buscar contratantes:", error)
    }
  }

  const buscarRequerentes = async () => {
    try {
      const response = await fetch("/api/requerentes")
      if (response.ok) {
        const { requerentes } = await response.json()
        setRequerentes(requerentes || [])
      }
    } catch (error) {
      console.error("Erro ao buscar requerentes:", error)
    }
  }

  const buscarArvores = async () => {
    try {
      const response = await fetch("/api/arvore")
      if (response.ok) {
        const data = await response.json()
        setArvores(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error("Erro ao buscar árvores:", error)
    }
  }

  // Efeito inicial - autenticação e dados globais
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login")
      return
    }

    const userData = getStoredUser()
    if (!userData) {
      router.push("/login")
      return
    }

    setUser(userData)

    // Buscar dados globais (não dependem do país)
    Promise.all([
      buscarContratantes(),
      buscarRequerentes(),
      buscarArvores()
    ]).finally(() => {
      setLoading(false)
    })
  }, [router])

  // Efeito quando país muda - buscar status e processos do país
  useEffect(() => {
    buscarStatus(paisSelecionado)
    buscarProcessos(paisSelecionado)
  }, [paisSelecionado, buscarStatus, buscarProcessos])

  // Refresh apenas do país atual
  const handleRefresh = useCallback(() => {
    buscarStatus(paisSelecionado)
    buscarProcessos(paisSelecionado)
    buscarContratantes()
  }, [paisSelecionado, buscarStatus, buscarProcessos])

  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-white/70">Carregando...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      
      <HeaderBar
        title={tabPrincipal === "processos" ? "Processos" : "Clientes"}
        subtitle={tabPrincipal === "processos" ? "Gerencie seus processos de cidadania" : "Gerencie seus clientes"}
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === 'admin' ? 'Administrador' : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        projetos={[]}
        processos={processos}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        
        {/* ✅ CORREÇÃO: overflow-x-hidden no main */}
        <main className="relative px-6 py-6 overflow-hidden">
          {/* TABS PRINCIPAIS */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg mb-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              {/* Tabs Processos / Clientes */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTabPrincipal("processos")}
                  className={`
                    px-4 py-2 rounded-lg font-medium transition-all duration-200
                    ${tabPrincipal === "processos"
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }
                  `}
                >
                  Processos
                </button>
                {pode('clientes.ver') && (
                <button
                  onClick={() => setTabPrincipal("contratantes")}
                  className={`
                    px-4 py-2 rounded-lg font-medium transition-all duration-200
                    ${tabPrincipal === "contratantes"
                      ? "bg-indigo-600 text-white shadow-lg"
                      : "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
                    }
                  `}
                >
                  Clientes
                </button>
                )}
              </div>

              {/* Sub-tabs Kanban / Lista (só aparece em Processos) */}
              {tabPrincipal === "processos" && pode('processos.ver') && (
                <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                  <button
                    onClick={() => setSubTab("kanban")}
                    className={`
                      px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
                      ${subTab === "kanban"
                        ? "bg-white/20 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                      }
                    `}
                  >
                    Kanban
                  </button>
                  <button
                    onClick={() => setSubTab("lista")}
                    className={`
                      px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
                      ${subTab === "lista"
                        ? "bg-white/20 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                      }
                    `}
                  >
                    Lista
                  </button>
                </div>
              )}

              {/* Contador + Países (só em Processos) */}
              {tabPrincipal === "processos" && pode('processos.ver') && (
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center px-4 py-2 bg-white/10 rounded-lg">
                    <span className="text-2xl font-bold text-white">
                      {processos.length}
                    </span>
                    <span className="text-xs text-white/60">processo(s)</span>
                  </div>
                  <PaisTabs
                    selectedPais={paisSelecionado}
                    onSelect={setPaisSelecionado}
                  />
                </div>
              )}

              {/* Contador Clientes */}
              {tabPrincipal === "contratantes" && (
                <div className="flex flex-col items-center px-4 py-2 bg-white/10 rounded-lg">
                  <span className="text-2xl font-bold text-white">
                    {contratantes.length + requerentes.length}
                  </span>
                  <span className="text-xs text-white/60">cliente(s)</span>
                </div>
              )}
            </div>
          </div>

          {/* CONTEÚDO - overflow-hidden para conter o kanban */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg overflow-hidden" style={{ maxWidth: '100%' }}>
            {/* Processos - Kanban */}
            {tabPrincipal === "processos" && subTab === "kanban" && (
              pode('processos.ver') ? (
              <KanbanBoard 
                pais={paisSelecionado}
                processos={processos}
                statusList={statusList}
                contratantes={contratantes}
                requerentes={requerentes}
                onRefresh={handleRefresh}
                initialProcessoId={initialProcessoId}
                initialTab={initialTab}
                initialPessoaId={initialPessoaId}
                initialSidebarTab={initialSidebarTab}
                onModalOpened={handleModalOpened}
                initialTarefaPaiId={initialTarefaPaiId}
                initialAtividadeId={initialAtividadeId}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-white/60">
                <Shield className="h-12 w-12 mb-4 text-white/30" />
                <p className="text-lg font-medium">Sem permissão para visualizar processos</p>
                <p className="text-sm mt-1">Solicite acesso ao administrador</p>
              </div>
            )
          )}

          {/* Processos - Lista */}
          {tabPrincipal === "processos" && subTab === "lista" && (
            pode('processos.ver') ? (
              <ProcessosLista
                processos={processos}
                statusList={statusList}
                contratantes={contratantes}
                onRefresh={handleRefresh}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-white/60">
                <Shield className="h-12 w-12 mb-4 text-white/30" />
                <p className="text-lg font-medium">Sem permissão para visualizar processos</p>
                <p className="text-sm mt-1">Solicite acesso ao administrador</p>
              </div>
            )
          )}

            {/* Clientes - Tabela */}
            {tabPrincipal === "contratantes" && (
              <ContratantesTabela
                contratantes={[
                  ...contratantes.map(c => ({ ...c, tipo: "contratante" })),
                  ...requerentes.map(r => ({ ...r, tipo: "requerente" }))
                ] as any}
                onRefresh={() => {
                  buscarContratantes()
                  buscarRequerentes()
                }}
                onOpenProcesso={handleOpenProcessoFromClientes}
              />
            )}
          </div>
        </main>
      </div>

      {/* ✅ Modal de Processo para aba Clientes */}
      <ProcessoDetailsModal
        processo={clientesProcessoModal}
        isOpen={isClientesProcessoModalOpen}
        onClose={() => {
          setIsClientesProcessoModalOpen(false)
          setClientesProcessoModal(null)
        }}
        onSave={() => {
          buscarContratantes()
          buscarRequerentes()
        }}
        statusList={clientesStatusList}
      />
    </div>
  )
}