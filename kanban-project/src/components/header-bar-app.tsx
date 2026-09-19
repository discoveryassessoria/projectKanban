"use client"

// src/components/header-bar-app.tsx
//
// CABEÇALHO DAS TELAS DO APLICATIVO — fork deliberado de `header-bar.tsx`
// (mandato "modernização visual", 19/09/2026), usado por TODAS as telas
// exceto o Kanban.
//
// POR QUE UM FORK, E NÃO UM AJUSTE NO ARQUIVO ORIGINAL: o Kanban importa
// `HeaderBar` diretamente (sem layout intermediário) — qualquer edição no
// arquivo original mudaria a aparência do Kanban também, o que está
// explicitamente proibido neste mandato. O comportamento e os dados (câmbio,
// notificações, busca, sessão) são os MESMOS; só o layout do título mudou.
//
// O QUE MUDOU EM RELAÇÃO AO ORIGINAL:
//   1. Título sem o prefixo redundante "Grupo Discovery ·" — a barra lateral
//      já mostra "Grupo Discovery" fixo; repetir no cabeçalho era o "título
//      repetido" e o que fazia "Grupo Discovery · Processos" truncar para
//      "Grupo Discovey · Pro..." em telas de até 1440px com câmbio+busca+
//      notificações+usuário+sair ocupando o resto da largura.
//   2. Espaçamentos um pouco mais compactos entre os blocos da direita, para
//      sobrar mais largura ao título sem esconder nenhum controle.
//   3. Nome acessível no sino (antes: botão de ícone sem `aria-label`).
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Search, Bell, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { ProcessoWithStatus } from "@/src/types/kanban"
import { formatDateBR } from "@/src/lib/date-utils"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { CambioMini } from "@/src/components/cambio/cambio-mini"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { pluralizar } from "@/src/lib/ui/pluralizar"
import useSWR from 'swr'

interface HeaderBarAppProps {
  title: string
  subtitle: string
  userName?: string
  userRole?: string
  userEmail?: string
  projetos?: Array<{
    id: number | string
    nome: string
    descricao?: string | null
  }>
  processos?: ProcessoWithStatus[]
  arvores?: Array<{
    id: number | string
    nome: string
    descricao?: string | null
    pessoas?: any[]
  }>
  onLogout?: () => void
  /** Esconde a busca por processos da barra (telas que já têm busca global própria). */
  ocultarBusca?: boolean
}

interface TarefaNotificacao {
  id: number
  titulo: string
  dataPrazo: string | null
  processoId: number | null
  processoNome: string
  pais: string | null
}

interface SaudeCriticaNotificacao {
  descricao: string
  criticos: number
  erros: number
  desde: string
  link: string
}

interface AcontecimentoNotificacao {
  id: number
  tipo: string
  titulo: string
  mensagem: string | null
  link: string | null
  criadoEm: string
}

function BlocoNotificacoes({
  chave, titulo, tarefas, corBorda, corTexto, corPonto, subtitulo, onClickTarefa,
}: {
  chave: string
  titulo: string
  tarefas: TarefaNotificacao[]
  corBorda: string
  corTexto: string
  corPonto: string
  subtitulo: (t: TarefaNotificacao) => string
  onClickTarefa: (t: TarefaNotificacao) => void
}) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const grupos = useMemo(() => {
    const mapa = new Map<string, TarefaNotificacao[]>()
    for (const t of tarefas) {
      const chaveGrupo = t.processoNome || "Sem processo"
      const arr = mapa.get(chaveGrupo) ?? []
      arr.push(t)
      mapa.set(chaveGrupo, arr)
    }
    return [...mapa.entries()]
  }, [tarefas])

  if (tarefas.length === 0) return null

  const alternar = (key: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div>
      <div className={`px-3 py-2 bg-[var(--surface-secondary)] text-[10px] uppercase tracking-wide ${corTexto} font-medium flex items-center gap-1 sticky top-0`}>
        <span className={`h-2 w-2 rounded-full ${corPonto}`}></span>
        {titulo} ({tarefas.length})
      </div>
      {grupos.map(([processoNome, itens]) => {
        const key = `${chave}-${processoNome}`
        const temGrupo = itens.length > 1
        const aberto = !temGrupo || expandidos.has(key)
        return (
          <div key={key}>
            {temGrupo && (
              <button
                className={`w-full text-left px-3 py-2 border-l-4 ${corBorda} hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer flex items-center justify-between gap-2`}
                onClick={() => alternar(key)}
              >
                <span className="text-sm text-gray-800 font-medium truncate">{processoNome}</span>
                <span className="text-[10px] text-gray-500 flex-none">{itens.length} {aberto ? "▲" : "▼"}</span>
              </button>
            )}
            {aberto && itens.map((t) => (
              <button
                key={t.id}
                className={`w-full text-left px-3 py-2 ${temGrupo ? "pl-6" : ""} border-l-4 ${corBorda} hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer`}
                onClick={() => onClickTarefa(t)}
              >
                <p className="text-sm text-gray-800 truncate font-medium">{t.titulo}</p>
                {!temGrupo && <p className="text-[10px] text-gray-500">{t.processoNome}</p>}
                <p className={`text-[10px] font-medium ${corTexto}`}>{subtitulo(t)}</p>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function HeaderBarApp({
  title,
  subtitle,
  userName = "Usuário",
  userRole = "Usuário",
  userEmail = "",
  projetos = [],
  processos = [],
  arvores = [],
  onLogout,
  ocultarBusca = false,
}: HeaderBarAppProps) {
  const [currentTime, setCurrentTime] = useState<string>("")
  const [currentDate, setCurrentDate] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState("")
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [searchResults, setSearchResults] = useState<{
    processos: ProcessoWithStatus[]
  }>({ processos: [] })

  const { pode } = usePermissoes()

  const router = useRouter()
  const notificacoesRef = useRef<HTMLDivElement>(null)

  const notificacoesFetcher = async (url: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
    if (!token) throw new Error('Sem token')
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  const { data: notificacoesData } = useSWR(
    '/api/notificacoes',
    notificacoesFetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
      dedupingInterval: 10000,
      errorRetryCount: 2
    }
  )

  const notificacoes = {
    vencidas: (notificacoesData?.vencidas || []) as TarefaNotificacao[],
    hoje: (notificacoesData?.hoje || []) as TarefaNotificacao[],
    proximos3Dias: (notificacoesData?.proximos3Dias || []) as TarefaNotificacao[],
    novas: (notificacoesData?.novas || []) as TarefaNotificacao[],
    saudeCritica: (notificacoesData?.saudeCritica ?? null) as SaudeCriticaNotificacao | null,
    acontecimentos: (notificacoesData?.acontecimentos || []) as AcontecimentoNotificacao[],
  }
  const totalNotificacoes = notificacoesData?.total || 0

  const handleAcontecimentoClick = (a: AcontecimentoNotificacao) => {
    setShowNotifications(false)
    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
    if (token) {
      fetch(`/api/notificacoes/${a.id}/lida`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        .catch(() => {})
    }
    if (a.link) router.push(a.link)
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notificacoesRef.current && !notificacoesRef.current.contains(event.target as Node)) {
        setShowNotifications(false)
      }
    }
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showNotifications])

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date()
      const time = now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
      const date = now.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
      const capitalizedDate = date.charAt(0).toUpperCase() + date.slice(1)
      setCurrentTime(time)
      setCurrentDate(capitalizedDate)
    }

    updateDateTime()
    const interval = setInterval(updateDateTime, 1000)
    return () => clearInterval(interval)
  }, [])

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)

    if (query.trim() === "") {
      setShowSearchResults(false)
      setSearchResults({ processos: [] })
      return
    }

    const queryLower = query.toLowerCase()

    const processosFiltrados = processos.filter(p =>
      p.nome.toLowerCase().includes(queryLower) ||
      p.descricao?.toLowerCase().includes(queryLower) ||
      p.contratantes?.some(c => c.publicCode?.toLowerCase().includes(queryLower) || c.nome?.toLowerCase().includes(queryLower))
    )

    setSearchResults({
      processos: processosFiltrados.slice(0, 5)
    })

    setShowSearchResults(true)
  }

  const handleProcessoClick = (processo: ProcessoWithStatus) => {
    const url = `/kanban?pais=${processo.pais}&processoId=${processo.id}`
    router.push(url)
    setShowSearchResults(false)
    setSearchQuery("")
  }

  const handleTarefaClick = (tarefa: TarefaNotificacao) => {
    if (tarefa.processoId) {
      router.push(urlOperacionalDaTarefa({ taskId: tarefa.id, processoId: tarefa.processoId }))
    } else {
      router.push('/operacao')
    }
    setShowNotifications(false)
  }

  const totalResults = searchResults.processos.length

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-black/40 backdrop-blur-md shadow-[var(--elev-2)]">
      {/* A faixa NÃO pode transbordar: quando ela transborda, o pai recorta e as
          ações somem sem aviso (sino, avatar, Sair). Quem cede espaço é o
          título — ele trunca; as ações nunca encolhem. */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        {/* Lado esquerdo - Título e Subtítulo. Sem prefixo "Grupo Discovery ·":
            a barra lateral já mostra a marca; repeti-la aqui era o que
            sobrava espaço demais ao título e o fazia truncar cedo. */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold leading-tight text-white">
            {title}
          </h1>
          <p className="truncate text-xs text-white/70">
            {subtitle}
          </p>
        </div>

        {/* Lado direito - Ações */}
        <div className="flex shrink-0 items-center gap-2 xl:gap-3">
          <CambioMini />

          <div className="hidden lg:flex flex-col items-end">
            <span className="text-sm font-medium text-white">{currentTime}</span>
            <span className="text-[11px] text-[var(--text-secondary)]">{currentDate}</span>
          </div>

          <div className="hidden lg:block h-8 w-px bg-[var(--surface-secondary)]" />

          {!ocultarBusca && pode('processos.ver') && <div className="relative hidden md:block">
            <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-[var(--border-strong)]">
              <Search className="h-4 w-4 text-white/70" aria-hidden="true" />
              <label className="sr-only" htmlFor="busca-processos-header">Pesquisar processos</label>
              <input
                id="busca-processos-header"
                className="bg-transparent text-xs outline-none placeholder:text-[var(--text-secondary)] w-24 xl:w-36 text-white"
                placeholder="Pesquisar processos..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchQuery && setShowSearchResults(true)}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              />
            </div>

            {showSearchResults && (
              <div className="absolute top-full mt-2 left-0 right-0 w-80 bg-[var(--surface-primary)] border border-gray-200 rounded-xl shadow-[var(--elev-3)] overflow-hidden z-50">
                {totalResults === 0 ? (
                  <div className="px-4 py-6 text-center text-[var(--text-muted)]">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-gray-600">Nenhum processo encontrado</p>
                    <p className="text-xs mt-1 text-[var(--text-muted)]">Tente buscar por outro termo</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                      Processos
                    </div>
                    {searchResults.processos.map(processo => (
                      <button
                        key={`processo-${processo.id}`}
                        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                        onClick={() => handleProcessoClick(processo)}
                      >
                        <span className="text-lg flex-shrink-0">
                          {(processo as { paisFlag?: string | null }).paisFlag ?? "🏳️"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate font-medium">{processo.nome}</p>
                          <p className="text-[10px] text-[var(--text-muted)] truncate">
                            {processo.contratantes?.[0] ? (processo.contratantes[0].publicCode ? processo.contratantes[0].publicCode + ' — ' : '') + processo.contratantes[0].nome : "Sem contratante"}
                          </p>
                        </div>
                        <span className="text-[10px] text-[var(--text-secondary)] flex-shrink-0">
                          Clique para abrir →
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>}

          {pode('tarefas.ver') && <div className="relative hidden md:block" ref={notificacoesRef}>
            <button
              className="relative inline-flex items-center justify-center rounded-full p-2 border border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={totalNotificacoes > 0 ? pluralizar(totalNotificacoes, "notificação pendente", "notificações pendentes") : "Notificações"}
              aria-expanded={showNotifications}
            >
              <Bell className="h-4 w-4 text-white" aria-hidden="true" />
              {totalNotificacoes > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-600 border-2 border-[var(--border-default)] text-[10px] font-bold flex items-center justify-center" aria-hidden="true">
                  {totalNotificacoes > 9 ? '9+' : totalNotificacoes}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute top-full mt-2 right-0 w-80 bg-[var(--surface-primary)] border border-gray-200 rounded-xl shadow-[var(--elev-3)] overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="font-semibold text-gray-800 text-sm">Notificações</h3>
                  <p className="text-xs text-gray-500">{pluralizar(totalNotificacoes, "pendente")}</p>
                </div>

                {totalNotificacoes === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="h-10 w-10 mx-auto mb-2 text-[var(--text-muted)]" />
                    <p className="text-sm text-gray-500">Nenhuma notificação</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">Você está em dia!</p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto">
                    {notificacoes.saudeCritica && (
                      <div>
                        <div className="px-3 py-2 bg-[var(--surface-secondary)] text-[10px] uppercase tracking-wide text-red-600 font-medium flex items-center gap-1 sticky top-0">
                          <span className="h-2 w-2 rounded-full bg-red-600"></span>
                          Saúde do Sistema
                        </div>
                        <button
                          className="w-full text-left px-3 py-2 border-l-4 border-red-500 hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                          onClick={() => { setShowNotifications(false); router.push(notificacoes.saudeCritica!.link) }}
                        >
                          <p className="text-sm font-medium text-red-700">{notificacoes.saudeCritica.descricao}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {notificacoes.saudeCritica.criticos > 0 ? `${notificacoes.saudeCritica.criticos} crítico(s)` : ''}
                            {notificacoes.saudeCritica.criticos > 0 && notificacoes.saudeCritica.erros > 0 ? ' · ' : ''}
                            {notificacoes.saudeCritica.erros > 0 ? `${notificacoes.saudeCritica.erros} erro(s)` : ''}
                            {' — toque para abrir o diagnóstico'}
                          </p>
                        </button>
                      </div>
                    )}
                    {notificacoes.acontecimentos.length > 0 && (
                      <div>
                        <div className="px-3 py-2 bg-[var(--surface-secondary)] text-[10px] uppercase tracking-wide text-[var(--text-secondary)] font-medium flex items-center gap-1 sticky top-0">
                          <span className="h-2 w-2 rounded-full bg-[var(--action-primary)]"></span>
                          Atenção operacional
                        </div>
                        {notificacoes.acontecimentos.map((a) => (
                          <button
                            key={a.id}
                            className="w-full text-left px-3 py-2 border-l-4 border-[var(--action-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer block"
                            onClick={() => handleAcontecimentoClick(a)}
                          >
                            <p className="text-sm font-medium text-[var(--text-primary)]">{a.titulo}</p>
                            {a.mensagem && (
                              <p className="text-xs text-[var(--text-muted)] mt-0.5">{a.mensagem}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    <BlocoNotificacoes
                      chave="vencida" titulo="Tarefas Vencidas" tarefas={notificacoes.vencidas}
                      corBorda="border-red-500" corTexto="text-red-600" corPonto="bg-red-600"
                      subtitulo={(t) => `Venceu em ${formatDateBR(t.dataPrazo)}`}
                      onClickTarefa={handleTarefaClick}
                    />
                    <BlocoNotificacoes
                      chave="hoje" titulo="Vencem hoje" tarefas={notificacoes.hoje}
                      corBorda="border-amber-500" corTexto="text-amber-600" corPonto="bg-[var(--action-primary)]"
                      subtitulo={() => "Vence hoje!"}
                      onClickTarefa={handleTarefaClick}
                    />
                    <BlocoNotificacoes
                      chave="proximos" titulo="Próximos 3 dias" tarefas={notificacoes.proximos3Dias}
                      corBorda="border-amber-500" corTexto="text-amber-600" corPonto="bg-[var(--action-primary)]"
                      subtitulo={(t) => `Vence em ${formatDateBR(t.dataPrazo)}`}
                      onClickTarefa={handleTarefaClick}
                    />
                    <BlocoNotificacoes
                      chave="nova" titulo="Novas tarefas" tarefas={notificacoes.novas}
                      corBorda="border-[var(--border-default)]" corTexto="text-[var(--text-secondary)]" corPonto="bg-[var(--surface-secondary)]"
                      subtitulo={() => "Nova tarefa"}
                      onClickTarefa={handleTarefaClick}
                    />
                  </div>
                )}
              </div>
            )}
          </div>}

          <div className="flex items-center gap-2">
            <Avatar className="h-9 w-9 border border-[var(--border-strong)]">
              <AvatarFallback className="bg-transparent text-xs font-medium text-white">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block">
              <p className="text-xs font-medium leading-tight text-white">
                {userName}
              </p>
              <p className="text-[11px] text-white/70 leading-tight">
                {userRole === 'admin' ? 'Administrador' : userRole === 'gerente' ? 'Gerente' : userRole === 'assistente' ? 'Assistente' : userRole === 'estagiario' ? 'Estagiário' : userRole}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            aria-label="Sair da sessão"
            className="border-[var(--border-strong)] text-xs bg-transparent hover:bg-[var(--surface-secondary)] hover:border-[var(--border-default)] text-[var(--text-primary)] hover:text-red-700 flex items-center justify-center gap-1.5"
          >
            <LogOut className="h-3 w-3" aria-hidden="true" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}
