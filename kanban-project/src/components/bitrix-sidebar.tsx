"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useRef, useEffect, useCallback } from "react"
import {
  Menu,
  MessageCircle,
} from "lucide-react"

import { HouseIcon } from "@/src/components/icons/house-icon"
import { GridIcon } from "@/src/components/icons/grid-icon"
import { CheckIcon } from "@/src/components/icons/check-icon"
import { TreeIcon } from "@/src/components/icons/tree-icon"
import { SettingsIcon } from "@/src/components/icons/settings-icon"
import { ShieldIcon } from "@/src/components/icons/shield-icon"
import { useSidebarContext } from "@/src/contexts/sidebar-context"
import { CalendarIcon } from "@/src/components/icons/calendar-icon"
import { DollarIcon } from "@/src/components/icons/dollar-icon"
import { usePermissoes } from "@/src/hooks/use-permissoes"

const menuItems = [
  {
    title: "Página Inicial",
    url: "/dashboard",
    icon: HouseIcon,
    textOffset: "translate-y-[0.2px]",
    iconOffset: "",
  },
  {
    title: "Processos",
    url: "/kanban",
    icon: GridIcon,
    textOffset: "-translate-y-[0.2px]",
    iconOffset: "",
    permissao: "processos.ver",
  },
  {
    title: "Tarefas e Projetos",
    url: "/activities",
    icon: CheckIcon,
    textOffset: "",
    iconOffset: "translate-y-[0.5px]",
    permissao: "tarefas.ver",
  },
  {
    title: "Eventos",
    url: "/events",
    icon: CalendarIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "eventos.ver",
  },
  {
    title: "Mensagens",
    url: "/mensagens",
    icon: ({ className, filled }: any) => <MessageCircle className={className} fill={filled ? "currentColor" : "none"} />,
    textOffset: "",
    iconOffset: "",
    badge: "mensagens",
    permissao: "mensagens.ver",
  },
  {
    title: "Árvore Genealógica",
    url: "/genealogy",
    icon: TreeIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "processos.ver",
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: SettingsIcon,
    textOffset: "",
    iconOffset: "",
  },
]

const adminMenuItems = [
  {
    title: "Financeiro",
    url: "/financeiro",
    icon: DollarIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "financeiro.ver",
  },
  {
    title: "Gerenciar Usuários",
    url: "/administrator",
    icon: ShieldIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "usuarios.gerenciar",
  },
]

export function BitrixSidebar() {
  const { pode, carregando } = usePermissoes()
  const { isCollapsed, setIsCollapsed } = useSidebarContext()
  const [isHovered, setIsHovered] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pathname = usePathname()

  // =====================================================
  // 🔴 Badge de mensagens não lidas
  // =====================================================
  const [mensagensNaoLidas, setMensagensNaoLidas] = useState(0)

  const fetchMensagensNaoLidas = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
      const response = await fetch('/api/admin/mensagens/nao-lidas', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (!response.ok) return
      const data = await response.json()
      setMensagensNaoLidas(data.totalNaoLidas || 0)
    } catch (error) {
      // Silencioso - não bloqueia a UI
    }
  }, [])

  useEffect(() => {
    fetchMensagensNaoLidas()
    // Polling a cada 30 segundos (mesmo intervalo das notificações do header)
    const interval = setInterval(fetchMensagensNaoLidas, 30000)
    return () => clearInterval(interval)
  }, [fetchMensagensNaoLidas])
  // =====================================================

  const isExpanded = !isCollapsed || isHovered

  const handleMouseEnter = () => {
    if (isCollapsed) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(true)
      }, 200)
    }
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsHovered(false)
  }

  const getIconClasses = (isActive: boolean) => {
    if (isActive) {
      return "h-5 w-5 flex-shrink-0 fill-white text-white"
    }
    return "h-5 w-5 flex-shrink-0 text-white"
  }

  // Função para renderizar o ícone corretamente
  const renderIcon = (Icon: typeof HouseIcon | typeof GridIcon | typeof CheckIcon | typeof TreeIcon | typeof SettingsIcon | typeof ShieldIcon | typeof CalendarIcon | typeof DollarIcon, isActive: boolean, iconOffset: string = "") => {
  // Todos os ícones são customizados agora, passa a prop filled
    return <Icon className={`h-5 w-5 flex-shrink-0 text-white ${iconOffset}`} filled={isActive} />
  }

  // Função para obter o valor do badge de um item
  const getBadgeCount = (badgeKey?: string): number => {
    if (badgeKey === 'mensagens') return mensagensNaoLidas
    return 0
  }

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        ${isExpanded ? "w-64" : "w-16"} 
        bg-black/40 backdrop-blur-md text-white 
        border-r border-white/10 shadow-xl
        transition-[width] duration-300 ease-in-out
        flex flex-col h-screen fixed left-0 top-0 z-50
        overflow-hidden
      `}
    >
      {/* Header com botão toggle */}
      <div className="py-4 px-3 flex items-center">
        <button
          onClick={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current)
              hoverTimeoutRef.current = null
            }
            setIsCollapsed(!isCollapsed)
            setIsHovered(false)
          }}
          className="hover:bg-white/10 rounded-lg p-2 transition-colors flex items-center justify-center flex-shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-6 w-6 text-white" />
        </button>

        {isExpanded && (
          <span className="font-semibold text-base text-white ml-1 leading-none whitespace-nowrap">
            {isHovered ? "Expandir menu" : "Grupo Discovery"}
          </span>
        )}
      </div>

      {/* Linha divisória */}
      <div className="px-4">
        <div className="border-b border-white/20" />
      </div>

      {/* Menu de Navegação */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 px-2 space-y-5">
        {/* Seção Navegação */}
        <div>
          {isExpanded && (
            <div className="text-xs uppercase tracking-wide text-white/70 font-medium px-3 mb-3 whitespace-nowrap">
              Navegação
            </div>
          )}
          <nav className="space-y-1">
            {menuItems.filter((item) => !item.permissao || pode(item.permissao)).map((item) => {
              const isActive = pathname === item.url
              const badgeCount = getBadgeCount((item as any).badge)

              return (
                <Link
                  key={item.url}
                  href={item.url}
                  className={`
                    flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors
                    hover:bg-white/10 relative
                    ${isActive ? "bg-white/15 text-white" : "text-white/90"}
                    ${!isExpanded ? "justify-center" : ""}
                  `}
                  title={!isExpanded ? item.title : undefined}
                >
                  {/* Ícone com badge quando sidebar colapsada */}
                  <span className="relative flex-shrink-0">
                    {renderIcon(item.icon, isActive, item.iconOffset)}
                    {badgeCount > 0 && !isExpanded && (
                      <span className="absolute -top-2 -right-2 h-4 w-4 rounded-full bg-red-500 text-[9px] font-bold flex items-center justify-center leading-none">
                        {badgeCount > 9 ? '9+' : badgeCount}
                      </span>
                    )}
                  </span>

                  {isExpanded && (
                    <>
                      <span className={`whitespace-nowrap leading-none ${item.textOffset}`}>{item.title}</span>
                      {/* Badge quando sidebar expandida - à direita */}
                      {badgeCount > 0 && (
                        <span className="ml-auto h-5 min-w-[20px] px-1 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center leading-none">
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Seção Administração */}
        {adminMenuItems.filter((item) => !item.permissao || pode(item.permissao)).length > 0 && (
          <div>
            {isExpanded && (
              <div className="text-xs uppercase tracking-wide text-white/70 font-medium px-3 mb-3 whitespace-nowrap">
                Administração
              </div>
            )}
            <nav className="space-y-1">
              {adminMenuItems.filter((item) => !item.permissao || pode(item.permissao)).map((item) => {
                const isActive = pathname === item.url

                return (
                  <Link
                    key={item.url}
                    href={item.url}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors
                      hover:bg-white/10
                      ${isActive ? "bg-white/15 text-white" : "text-white/90"}
                      ${!isExpanded ? "justify-center" : ""}
                    `}
                    title={!isExpanded ? item.title : undefined}
                  >
                    {renderIcon(item.icon, isActive, item.iconOffset)}
                    {isExpanded && (
                      <span className={`whitespace-nowrap leading-none ${item.textOffset}`}>{item.title}</span>
                    )}
                  </Link>
                )
              })}
            </nav>
          </div>
        )}
      </div>
    </aside>
  )
}