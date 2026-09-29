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
import { SinoNotificacoes } from "@/src/components/sino-notificacoes"
import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Search, LogOut, Menu } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { ProcessoWithStatus } from "@/src/types/kanban"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { CambioMiniApp } from "@/src/components/cambio/cambio-mini-app"
import { pluralizar } from "@/src/lib/ui/pluralizar"
import { useSidebarContext } from "@/src/contexts/sidebar-context"
import { buscarGlobal } from "@/src/components/home/use-home"
import type { SearchResult } from "@/src/app/api/home/search/route"

const ROTULO_TIPO: Record<SearchResult["tipo"], string> = {
  processo: "Processo", familia: "Família", requerente: "Requerente", cliente: "Cliente",
}

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
  // Busca via API (/api/home/search) — NUNCA mais filtrar a prop local `processos`.
  // Achado real (20/09/2026, mandato "Módulo de Fases"): a Home passa `HeaderBarApp`
  // sem a prop `processos` (fica `[]` por padrão), então o filtro local buscava
  // sempre num array vazio — a busca do cabeçalho da Home nunca encontrava nada,
  // qualquer que fosse o termo. A API já cobre nome/código/requerente/contratante/
  // família com o escopo/permissão corretos; usá-la aqui corrige a Home sem
  // depender de quem chama passar a lista certa.
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const buscaSeq = useRef(0)

  const { pode } = usePermissoes()

  const router = useRouter()
  const { setMobileAberto } = useSidebarContext()

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

    if (query.trim().length < 2) {
      setShowSearchResults(false)
      setSearchResults([])
      return
    }

    const minhaSeq = ++buscaSeq.current
    buscarGlobal(query).then((resultados) => {
      // Descarta resposta de uma busca já superada por uma mais recente
      // (rede não garante ordem de chegada = ordem de disparo).
      if (minhaSeq !== buscaSeq.current) return
      setSearchResults(resultados)
      setShowSearchResults(true)
    }).catch(() => {
      if (minhaSeq !== buscaSeq.current) return
      setSearchResults([])
      setShowSearchResults(true)
    })
  }

  const handleResultadoClick = (r: SearchResult) => {
    router.push(r.href)
    setShowSearchResults(false)
    setSearchQuery("")
  }

  const totalResults = searchResults.length

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-black/40 backdrop-blur-md shadow-[var(--elev-2)]">
      {/* A faixa NÃO pode transbordar: quando ela transborda, o pai recorta e as
          ações somem sem aviso (sino, avatar, Sair). Quem cede espaço é o
          título — ele trunca; as ações nunca encolhem. */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        {/* Botão do drawer mobile — só existe fora do Kanban, e só abaixo de
            md (mesmo corte de useIsMobile). O drawer some, mas a navegação
            continua a um toque: é ele que reabre (mandato "modernização
            visual — sidebar mobile", 19/09/2026). */}
        <button
          onClick={() => setMobileAberto(true)}
          aria-label="Abrir menu de navegação"
          className="shrink-0 rounded-lg p-2 text-white transition hover:bg-[var(--surface-hover)] md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
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
          <CambioMiniApp />

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
                    <p className="text-sm text-gray-600">Nenhum resultado encontrado</p>
                    <p className="text-xs mt-1 text-[var(--text-muted)]">Tente buscar por outro termo</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    <div className="px-3 py-2 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 font-medium">
                      Resultados
                    </div>
                    {searchResults.map(r => (
                      <button
                        key={`${r.tipo}-${r.id}`}
                        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                        onClick={() => handleResultadoClick(r)}
                      >
                        <span className="text-lg flex-shrink-0" aria-hidden="true">
                          {r.tipo === "processo" ? "📁" : r.tipo === "familia" ? "👪" : r.tipo === "requerente" ? "👤" : "🏢"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate font-medium">{r.label}</p>
                          <p className="text-[10px] text-[var(--text-muted)] truncate">{r.sub ?? ROTULO_TIPO[r.tipo]}</p>
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

          {pode('tarefas.ver') && <SinoNotificacoes />}

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
