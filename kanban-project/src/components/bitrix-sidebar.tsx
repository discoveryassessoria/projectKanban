"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useRef } from "react"
// Remove House do import do lucide-react
import {
  LayoutGrid,
  SquareCheck,
  Users,
  Zap,
  Settings,
  ShieldCheck,
  Menu,
} from "lucide-react"

// Adiciona o import do ícone customizado
import { HouseIcon } from "@/src/components/icons/house-icon"
import { useSidebarContext } from "@/src/contexts/sidebar-context"

const menuItems = [
  {
    title: "Página Inicial",
    url: "/dashboard",
    icon: null,
    textOffset: "",
  },
  {
    title: "Processos",
    url: "/kanban",
    icon: LayoutGrid,
    textOffset: "",
  },
  {
    title: "Tarefas e Projetos",
    url: "/activities",
    icon: SquareCheck,
    textOffset: "",
  },
  {
    title: "Árvore Genealógica",
    url: "/genealogy",
    icon: Users,
    textOffset: "-translate-y-[1px]",
  },
  {
  title: "Automação",
  url: "/automation",
  icon: Zap,
  textOffset: "-translate-y-[1.3px]",
},
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
    textOffset: "",
  },
]

const adminMenuItems = [
  {
    title: "Gerenciar Usuários",
    url: "/administrator",
    icon: ShieldCheck,
    textOffset: "-translate-y-[1px]",
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
      return "h-5 w-5 flex-shrink-0 fill-white stroke-black/40 stroke-[1.5]"
    }
    return "h-5 w-5 flex-shrink-0 text-white"
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
            {menuItems.map((item) => {
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
      {item.icon === null ? (
        <HouseIcon className="h-5 w-5 flex-shrink-0 text-white" filled={isActive} />
      ) : (
        <item.icon className={getIconClasses(isActive)} />
      )}
      {isExpanded && (
        <span className={`whitespace-nowrap leading-none ${item.textOffset}`}>{item.title}</span>
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
              <div className="text-xs uppercase tracking-wide text-white/70 font-medium px-3 mb-3 whitespace-nowrap">
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
                      flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors
                      hover:bg-white/10
                      ${isActive ? "bg-white/15 text-white" : "text-white/90"}
                      ${!isExpanded ? "justify-center" : ""}
                    `}
                    title={!isExpanded ? item.title : undefined}
                  >
                    <Icon className={getIconClasses(isActive)} />
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