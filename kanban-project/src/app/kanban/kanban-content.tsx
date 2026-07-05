// ESTE ARQUIVO VAI EM: src/app/processos/kanban-content.tsx
//
// COSTURA MOTOR-NATIVE (5/jul):
// - Países vêm do /api/kanban-config (CatalogoPais ativos) — nada fixo
// - Cada país mostra os TIPOS dele (Judicial/Administrativa...); se tiver
//   mais de um, aparece um seletor; o board mostra as fases do tipo
// - Processos filtrados por país e por tipo (tipoProcessoMotorId)
// - /api/status ficou só pro modal de detalhes (legado)

"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getStoredUser, isAuthenticated } from "@/lib/auth"
import { KanbanBoard } from "@/src/components/kanban-board-novo"
import { ProcessosLista } from "@/src/components/processos-lista"
import { ContratantesTabela } from "@/src/components/contratantes-tabela"
import { PaisTabs } from "@/src/components/ui/pais-selector"
import { HeaderBar } from "@/src/components/header-bar"
import { ProcessoDetailsModal } from "@/src/components/kanban/atividade-details-modal"
import {
  type PaisKanban,
  type TipoKanban,
  type Processo,
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

  // ✅ Config do kanban (vem do Gerenciamento)
  const [paisesDisponiveis, setPaisesDisponiveis] = useState<PaisKanban[]>([])
  const [tipos, setTipos] = useState<TipoKanban[]>([])
  const [paisSelecionado, setPaisSelecionado] = useState<string | null>(null) // countryKey
  const [tipoSelecionadoId, setTipoSelecionadoId] = useState<number | null>(null)

  const [processos, setProcessos] = useState<Processo[]>([])
  const [statusList, setStatusList] = useState<Status[]>([]) // LEGADO — só pro modal
  const [contratantes, setContratantes] = useState<Contratante[]>([])
  const [requerentes, setRequerentes] = useState<Requerente[]>([])
  const [arvores, setArvores] = useState<any[]>([])

  // Parâmetros para abrir modal automaticamente
  const [initialProcessoId, setInitialProcessoId] = useState<number | null>(null)
  const [initialTab, setInitialTab] = useState<string | null>(null)
  const [initialPessoaId, setInitialPessoaId] = useState<number | null>(null)
  const [initialSidebarTab, setInitialSidebarTab] = useState<string | null>(null)
  const [initialTarefaPaiId, setInitialTarefaPaiId] = useState<number | null>(null)
  const [initialAtividadeId, setInitialAtividadeId] = useState<number | null>(null)

  // Modal de processo na aba Clientes
  const [clientesProcessoModal, setClientesProcessoModal] = useState<Processo | null>(null)
  const [isClientesProcessoModalOpen, setIsClientesProcessoModalOpen] = useState(false)
  const [clientesStatusList, setClientesStatusList] = useState<Status[]>([])

  const { pode } = usePermissoes()

  // ✅ Derivados: país/tipos/processos da seleção atual
  const paisObj = useMemo(
    () => paisesDisponiveis.find(p => p.countryKey === paisSelecionado) ?? null,
    [paisesDisponiveis, paisSelecionado]
  )
  const tiposDoPais = useMemo(
    () => tipos.filter(t => t.countryKey === paisSelecionado),
    [tipos, paisSelecionado]
  )
  const tipoSelecionado = useMemo(
    () => tiposDoPais.find(t => t.id === tipoSelecionadoId) ?? tiposDoPais[0] ?? null,
    [tiposDoPais, tipoSelecionadoId]
  )
  const processosDoTipo = useMemo(
    () => (tipoSelecionado ? processos.filter(p => p.tipoProcessoMotorId === tipoSelecionado.id) : []),
    [processos, tipoSelecionado]
  )

  // ✅ Carregar a config do kanban (países + tipos com fases) do Gerenciamento
  const carregarConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/kanban-config", {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
      })
      if (!response.ok) return
      const data = await response.json()
      const paises: PaisKanban[] = data.paises || []
      setPaisesDisponiveis(paises)
      setTipos(data.tipos || [])

      // país inicial: o da URL (se existir na lista) senão o primeiro
      const urlPais = (searchParams.get("pais") || "").toLowerCase()
      const inicial = paises.find(p => p.countryKey === urlPais)?.countryKey ?? paises[0]?.countryKey ?? null
      setPaisSelecionado(prev => prev ?? inicial)
    } catch (error) {
      console.error("Erro ao carregar config do kanban:", error)
    }
  }, [searchParams])

  // Ler parâmetros da URL para abertura automática do modal
  useEffect(() => {
    const processoId = searchParams.get("processoId")
    const tab = searchParams.get("tab")
    const pessoaId = searchParams.get("pessoaId")
    const sidebarTab = searchParams.get("sidebarTab")
    const tarefaPaiId = searchParams.get("tarefaPaiId")

    if (processoId) setInitialProcessoId(parseInt(processoId))
    if (tab) setInitialTab(tab)
    if (pessoaId) setInitialPessoaId(parseInt(pessoaId))
    if (sidebarTab) setInitialSidebarTab(sidebarTab)
    if (tarefaPaiId) setInitialTarefaPaiId(parseInt(tarefaPaiId))
    const atividadeId = searchParams.get("atividadeId")
    if (atividadeId) setInitialAtividadeId(parseInt(atividadeId))
  }, [searchParams])

  // Atualizar país quando URL mudar (depois da config carregada)
  useEffect(() => {
    const urlPais = (searchParams.get("pais") || "").toLowerCase()
    if (urlPais && paisesDisponiveis.some(p => p.countryKey === urlPais)) {
      setPaisSelecionado(urlPais)
    }
  }, [searchParams, paisesDisponiveis])

  // Ao trocar de país, seleciona o primeiro tipo dele
  useEffect(() => {
    setTipoSelecionadoId(null)
  }, [paisSelecionado])

  const handleLogout = () => {
    localStorage.removeItem("authToken")
    localStorage.removeItem("user")
    router.push("/login")
  }

  // Callback para limpar URL params depois que o modal abriu
  const handleModalOpened = useCallback(() => {
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.delete("processoId")
    newUrl.searchParams.delete("tab")
    newUrl.searchParams.delete("pessoaId")
    newUrl.searchParams.delete("sidebarTab")
    newUrl.searchParams.delete("tarefaPaiId")
    newUrl.searchParams.delete("atividadeId")
    window.history.replaceState({}, "", newUrl.toString())

    setInitialProcessoId(null)
    setInitialTab(null)
    setInitialPessoaId(null)
    setInitialSidebarTab(null)
    setInitialTarefaPaiId(null)
    setInitialAtividadeId(null)
  }, [])

  // Abrir processo a partir da aba Clientes (abre modal sem mudar de aba)
  const handleOpenProcessoFromClientes = useCallback(async (processoId: number, pais: string) => {
    try {
      // Buscar processo E status em paralelo para ser mais rápido
      const [processoResponse, statusResponse] = await Promise.all([
        fetch(`/api/processos/${processoId}`),
        fetch(`/api/status?pais=${pais}`)
      ])

      if (!processoResponse.ok) throw new Error("Erro ao buscar processo")

      const [processoData, statusData] = await Promise.all([
        processoResponse.json(),
        statusResponse.ok ? statusResponse.json() : { status: [] }
      ])

      setClientesStatusList(statusData.status || [])
      setClientesProcessoModal(processoData.processo)
      setIsClientesProcessoModalOpen(true)
    } catch (error) {
      console.error("Erro ao abrir processo:", error)
      alert("Não foi possível abrir o processo.")
    }
  }, [])

  // LEGADO — status só pro modal de detalhes
  const buscarStatus = useCallback(async (pais: string) => {
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

  // Buscar processos por país (countryKey)
  const buscarProcessos = useCallback(async (pais: string) => {
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
      carregarConfig(),
      buscarContratantes(),
      buscarRequerentes(),
      buscarArvores()
    ]).finally(() => {
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Efeito quando país muda - buscar processos (e status legado) do país
  useEffect(() => {
    if (!paisSelecionado) return
    buscarStatus(paisSelecionado)
    buscarProcessos(paisSelecionado)
  }, [paisSelecionado, buscarStatus, buscarProcessos])

  // Refresh apenas do país atual
  const handleRefresh = useCallback(() => {
    if (paisSelecionado) {
      buscarStatus(paisSelecionado)
      buscarProcessos(paisSelecionado)
    }
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
        processos={processos as any}
        arvores={arvores}
        onLogout={handleLogout}
      />

      <div className="min-h-screen relative">
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />

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
                    paises={paisesDisponiveis}
                    paisSelecionado={paisSelecionado}
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

            {/* ✅ Seletor de TIPO do país (só quando tem mais de um) */}
            {tabPrincipal === "processos" && pode('processos.ver') && tiposDoPais.length > 1 && (
              <div className="mt-3 flex items-center gap-1 border-t border-white/10 pt-3">
                {tiposDoPais.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTipoSelecionadoId(t.id)}
                    className={`
                      px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
                      ${tipoSelecionado?.id === t.id
                        ? "bg-white/20 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/10"
                      }
                    `}
                  >
                    {t.modalityLabel || t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CONTEÚDO - overflow-hidden para conter o kanban */}
          <div className="bg-white/5 border border-white/15 rounded-2xl p-4 backdrop-blur-xl shadow-lg overflow-hidden" style={{ maxWidth: '100%' }}>
            {/* Processos - Kanban */}
            {tabPrincipal === "processos" && subTab === "kanban" && (
              pode('processos.ver') ? (
                paisesDisponiveis.length === 0 ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-200">
                    Nenhum país ativo no catálogo. Cadastre em Gerenciamento → Processos de Nacionalidade → + Novo país.
                  </div>
                ) : !paisObj ? null : !tipoSelecionado ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-200">
                    {paisObj.countryLabel} ainda não tem tipo de processo cadastrado.
                    Crie em Gerenciamento → Processos de Nacionalidade.
                  </div>
                ) : (
                  <KanbanBoard
                    pais={paisObj}
                    tipo={tipoSelecionado}
                    processos={processosDoTipo}
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
                )
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
                  processos={processos as any}
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

      {/* Modal de Processo para aba Clientes */}
      <ProcessoDetailsModal
        processo={clientesProcessoModal as any}
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