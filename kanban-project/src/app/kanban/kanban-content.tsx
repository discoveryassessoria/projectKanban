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
import { useApi } from "@/src/lib/dados"
import { useIsClient, useJsonLocalStorage, useLocalStorage } from "@/src/lib/cliente"
import { useRouter, useSearchParams } from "next/navigation"
import { useAmbiente } from "@/src/contexts/ambiente-context"
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
  type Contratante,
  type Requerente
} from "@/src/types/kanban"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { Shield } from "lucide-react"
import { encerrarSessao } from "@/src/lib/sessao/cliente"

interface User {
  id: number
  nome: string
  email: string
  tipo: string
}

type TabPrincipal = "processos" | "contratantes"
type SubTab = "kanban" | "lista"

/** Inteiro de um parâmetro de URL; ausente ou inválido vira `null`. */
function inteiroDaUrl(valor: string | null): number | null {
  if (!valor) return null
  const n = Number.parseInt(valor, 10)
  return Number.isNaN(n) ? null : n
}

/** Forma mínima que o HeaderBar consome das árvores. */
interface ArvoreResumo { id: number | string; nome: string; descricao?: string | null }

const SEM_PAISES: PaisKanban[] = []
const SEM_TIPOS: TipoKanban[] = []
const SEM_PROCESSOS: Processo[] = []
const SEM_CONTRATANTES: Contratante[] = []
const SEM_REQUERENTES: Requerente[] = []
const SEM_ARVORES: ArvoreResumo[] = []

export function KanbanContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Sessão e usuário pela leitura oficial do localStorage.
  const noCliente = useIsClient()
  const token = useLocalStorage("authToken")
  const user = useJsonLocalStorage<User>("user")
  const autenticado = Boolean(token && user)

  // Tabs
  const [tabPrincipal, setTabPrincipal] = useState<TabPrincipal>("processos")
  const [subTab, setSubTab] = useState<SubTab>("kanban")

  // ✅ Config do kanban (vem do Gerenciamento), pela camada oficial.
  const configReq = useApi<{ paises?: PaisKanban[]; tipos?: TipoKanban[] }>(
    autenticado ? "/api/kanban-config" : null,
  )
  const paisesDisponiveis = configReq.dados?.paises ?? SEM_PAISES
  const tipos = configReq.dados?.tipos ?? SEM_TIPOS
  // País: a escolha do usuário vence; sem escolha, o da URL (se existir na config);
  // sem URL, o primeiro disponível. Antes eram dois efeitos concorrendo pelo mesmo
  // estado — um vindo da config, outro da URL — e a ordem entre eles definia o
  // resultado.
  const [paisEscolhido, setPaisSelecionado] = useState<string | null>(null)
  const paisDaUrl = (searchParams.get("pais") || "").toLowerCase()
  const paisSelecionado =
    paisEscolhido
    ?? (paisesDisponiveis.some(p => p.countryKey === paisDaUrl) ? paisDaUrl : null)
    ?? paisesDisponiveis[0]?.countryKey
    ?? null
  // O tipo escolhido pertence ao país em que foi escolhido: trocar de país volta ao
  // primeiro tipo do novo país, que era o papel do efeito `setTipoSelecionadoId(null)`.
  const [tipoEscolhido, setTipoEscolhido] = useState<{ pais: string | null; id: number } | null>(null)
  const tipoSelecionadoId = tipoEscolhido?.pais === paisSelecionado ? tipoEscolhido.id : null
  const setTipoSelecionadoId = (id: number | null) => {
    setTipoEscolhido(id === null ? null : { pais: paisSelecionado, id })
  }

  // Processos do país selecionado: o país está na CHAVE, então trocar de país já
  // dispara a busca — era um efeito em `[paisSelecionado]`.
  // Override LOCAL da política padrão (POLITICA_PADRAO em src/lib/dados/index.ts):
  // várias pessoas mexem no mesmo Kanban ao mesmo tempo, então o quadro precisa
  // acompanhar sozinho. Só esta chamada muda — nenhuma outra tela é afetada.
  const processosReq = useApi<{ processos?: Processo[] }>(
    paisSelecionado ? `/api/processos?pais=${paisSelecionado}` : null,
    // dedupingInterval também entra: o padrão (30s) é MAIOR que o refresh de 20s,
    // e o polling do SWR passa pelo dedupe — o disparo dos 20s seria engolido e o
    // intervalo real viraria ~40s. Com 10s aqui, os 20s valem de verdade.
    { refreshInterval: 20_000, revalidateOnFocus: true, dedupingInterval: 10_000 },
  )
  const processos = processosReq.dados?.processos ?? SEM_PROCESSOS
  const contratantesReq = useApi<{ contratantes?: Contratante[] }>(autenticado ? "/api/contratantes" : null)
  const requerentesReq = useApi<{ requerentes?: Requerente[] }>(autenticado ? "/api/requerentes" : null)
  const arvoresReq = useApi<ArvoreResumo[]>(autenticado ? "/api/arvore" : null)
  const contratantes = contratantesReq.dados?.contratantes ?? SEM_CONTRATANTES
  const requerentes = requerentesReq.dados?.requerentes ?? SEM_REQUERENTES
  const arvores = Array.isArray(arvoresReq.dados) ? arvoresReq.dados : SEM_ARVORES
  const loading = !noCliente || (autenticado && configReq.carregando)

  // Parâmetros para abrir modal automaticamente. São LEITURA DA URL, não estado: copiá-los
  // para seis `useState` dentro de um efeito só adiava em um render o que a URL já dizia.
  // Depois que o modal abriu, o link já foi CONSUMIDO — um sinalizador, no lugar dos
  // seis `setInitial*(null)` que existiam para o mesmo fim. (A limpeza da barra de
  // endereços é `history.replaceState`, que de propósito não re-renderiza: por isso o
  // sinalizador é necessário, e não basta reler a URL.)
  const [linkConsumido, setLinkConsumido] = useState(false)
  const initialProcessoId = linkConsumido ? null : inteiroDaUrl(searchParams.get("processoId"))
  const initialTab = linkConsumido ? null : searchParams.get("tab")
  const initialPessoaId = linkConsumido ? null : inteiroDaUrl(searchParams.get("pessoaId"))
  const initialSidebarTab = linkConsumido ? null : searchParams.get("sidebarTab")
  const initialAtividadeId = linkConsumido ? null : inteiroDaUrl(searchParams.get("atividadeId"))
  // DEEP-LINK OPERACIONAL: a tarefa que a Central deve localizar lá dentro.
  const initialTaskId = linkConsumido ? null : inteiroDaUrl(searchParams.get("taskId"))

  // Modal de processo na aba Clientes
  const [clientesProcessoModal, setClientesProcessoModal] = useState<Processo | null>(null)
  const [isClientesProcessoModalOpen, setIsClientesProcessoModalOpen] = useState(false)

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

  // Callback para limpar URL params depois que o modal abriu
  const handleModalOpened = useCallback(() => {
    const newUrl = new URL(window.location.href)
    newUrl.searchParams.delete("processoId")
    newUrl.searchParams.delete("tab")
    newUrl.searchParams.delete("pessoaId")
    newUrl.searchParams.delete("sidebarTab")
    newUrl.searchParams.delete("atividadeId")
    newUrl.searchParams.delete("taskId")
    window.history.replaceState({}, "", newUrl.toString())

    setLinkConsumido(true)
  }, [])

  // Abrir processo a partir da aba Clientes (abre modal sem mudar de aba)
  const handleOpenProcessoFromClientes = useCallback(async (processoId: number) => {
    try {
      const processoResponse = await fetch(`/api/processos/${processoId}`)

      if (!processoResponse.ok) throw new Error("Erro ao buscar processo")

      const processoData = await processoResponse.json()

      setClientesProcessoModal(processoData.processo)
      setIsClientesProcessoModalOpen(true)
    } catch (error) {
      console.error("Erro ao abrir processo:", error)
      alert("Não foi possível abrir o processo.")
    }
  }, [])

  // A guarda de sessão continua sendo efeito, porque navegar é efeito.
  useEffect(() => {
    if (!noCliente) return
    if (!autenticado) router.push("/login")
  }, [noCliente, autenticado, router])

  // Recarregar listas depois de escrever — nome preservado nos pontos de uso.
  const buscarContratantes = () => { void contratantesReq.recarregar() }
  const buscarRequerentes = () => { void requerentesReq.recarregar() }

  // Refresh apenas do país atual
  const handleRefresh = useCallback(() => {
    void processosReq.recarregar()
    void contratantesReq.recarregar()
  }, [processosReq, contratantesReq])

  if (loading) {
    return (
      <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
        <div
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,9,11,.985) 0%, rgba(8,9,11,.975) 46%, rgba(8,9,11,.95) 60%," +
              " rgba(8,9,11,.86) 72%, rgba(8,9,11,.76) 86%, rgba(8,9,11,.88) 100%)",
          }}
        />
        <div className="min-h-screen flex items-center justify-center">
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
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,9,11,.985) 0%, rgba(8,9,11,.975) 46%, rgba(8,9,11,.95) 60%," +
            " rgba(8,9,11,.86) 72%, rgba(8,9,11,.76) 86%, rgba(8,9,11,.88) 100%)",
        }}
      />

      <HeaderBar
        title={tabPrincipal === "processos" ? "Processos" : "Clientes"}
        subtitle={tabPrincipal === "processos" ? "Gerencie seus processos de cidadania" : "Gerencie seus clientes"}
        userName={user?.nome || "Usuário"}
        userRole={user?.tipo === 'admin' ? 'Administrador' : user?.tipo || "Usuário"}
        userEmail={user?.email || ""}
        projetos={[]}
        processos={processos as any}
        arvores={arvores}
        onLogout={() => { void encerrarSessao("manual") }}
      />

      <div className="min-h-screen relative">

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
                    contratantes={contratantes}
                    requerentes={requerentes}
                    onRefresh={handleRefresh}
                    initialProcessoId={initialProcessoId}
                    initialTab={initialTab}
                    initialPessoaId={initialPessoaId}
                    initialSidebarTab={initialSidebarTab}
                    onModalOpened={handleModalOpened}
                    initialAtividadeId={initialAtividadeId}
                    initialTaskId={initialTaskId}
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
      />
    </div>
  )
}