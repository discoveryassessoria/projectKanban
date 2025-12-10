"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useRef } from "react"
import {
  Home,
  Inbox,
  Calendar,
  Search,
  Settings,
  Shield,
  Menu,
} from "lucide-react"
import { useSidebarContext } from "@/src/contexts/sidebar-context"

const menuItems = [
  {
    title: "Painel Principal",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Kanban",
    url: "/kanban",
    icon: Inbox,
  },
  {
    title: "Atividades e Projetos",
    url: "/activities",
    icon: Calendar,
  },
  {
    title: "Árvore Genealógica",
    url: "/genealogy",
    icon: Search,
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
  },
]

const adminMenuItems = [
  {
    title: "Gerenciar Usuários",
    url: "/administrator",
    icon: Shield,
  },
]

interface BitrixSidebarProps {
  isAdmin?: boolean
}

export function BitrixSidebar({ isAdmin = false }: BitrixSidebarProps) {
  const { isCollapsed, setIsCollapsed } = useSidebarContext()
  const [isHovered, setIsHovered] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pathname = usePathname()

  // Sidebar expande se NÃO está colapsada OU se está em hover
  const isExpanded = !isCollapsed || isHovered

  const handleMouseEnter = () => {
    if (isCollapsed) {
      // Delay de 200ms antes de expandir
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(true)
      }, 200)
    }
  }

  const handleMouseLeave = () => {
    // Cancela o timeout se o mouse sair antes do delay
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsHovered(false)
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
      <div className="py-3 px-3 flex items-center">
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
          <Menu className="h-5 w-5 text-white" />
        </button>

        {isExpanded && (
          <span className="font-semibold text-sm text-white ml-2 leading-none whitespace-nowrap">
            {isHovered ? "Expandir menu" : "Grupo Discovery"}
          </span>
        )}
      </div>

      {/* Linha divisória */}
      <div className="px-4">
        <div className="border-b border-white" />
      </div>

      {/* Menu de Navegação */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-4">
        {/* Seção Navegação */}
        <div>
          {isExpanded && (
            <div className="text-[11px] uppercase tracking-wide text-white font-medium px-2 mb-2 whitespace-nowrap">
              Navegação
            </div>
          )}
          <nav className="space-y-1">
            {menuItems.map((item) => {
              const isActive = pathname === item.url
              const Icon = item.icon

              return (
                <Link
                  key={item.url}
                  href={item.url}
                  className={`
                    flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors
                    hover:bg-white/10
                    ${isActive ? "bg-white/15 text-white" : "text-white"}
                    ${!isExpanded ? "justify-center" : ""}
                  `}
                  title={!isExpanded ? item.title : undefined}
                >
                  <Icon className="h-4 w-4 flex-shrink-0 text-white" />
                  {isExpanded && (
                    <span className="whitespace-nowrap leading-none">{item.title}</span>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Seção Administração */}
        {isAdmin && (
          <div>
            {isExpanded && (
              <div className="text-[11px] uppercase tracking-wide text-white font-medium px-2 mb-2 whitespace-nowrap">
                Administração
              </div>
            )}
            <nav className="space-y-1">
              {adminMenuItems.map((item) => {
                const isActive = pathname === item.url
                const Icon = item.icon

                return (
                  <Link
                    key={item.url}
                    href={item.url}
                    className={`
                      flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors
                      hover:bg-white/10
                      ${isActive ? "bg-white/15 text-white" : "text-white"}
                      ${!isExpanded ? "justify-center" : ""}
                    `}
                    title={!isExpanded ? item.title : undefined}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-white" />
                    {isExpanded && (
                      <span className="whitespace-nowrap leading-none">{item.title}</span>
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