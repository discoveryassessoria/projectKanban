"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useRef, useEffect, useCallback } from "react"
import {
  Menu,
} from "lucide-react"

import { HouseIcon } from "@/src/components/icons/house-icon"
import { GridIcon } from "@/src/components/icons/grid-icon"
import { BoardIcon } from "@/src/components/icons/board-icon"
import { CheckIcon } from "@/src/components/icons/check-icon"
import { TreeIcon } from "@/src/components/icons/tree-icon"
import { ShieldIcon } from "@/src/components/icons/shield-icon"
import { useSidebarContext } from "@/src/contexts/sidebar-context"
import { CalendarIcon } from "@/src/components/icons/calendar-icon"
import { DollarIcon } from "@/src/components/icons/dollar-icon"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { ManagementIcon } from "@/src/components/icons/management-icon"
import { ScrollIcon } from "@/src/components/icons/scroll-icon"
import { ReportIcon } from "@/src/components/icons/report-icon"

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
  },
  {
    // OPERAÇÃO — a superfície de QUEM EXECUTA: o que ainda não tem dono e o que
    // é meu. É a tela do dia de trabalho.
    title: "Operação",
    url: "/operacao",
    icon: CheckIcon,
    textOffset: "",
    iconOffset: "translate-y-[0.5px]",
    permissao: "tarefas.ver",
  },
  {
    // TAREFAS E PROJETOS — a MESMA Tarefa canônica, vista por quem responde
    // pela operação inteira. Entra logo depois de Operação porque é a mesma
    // matéria com outro alcance: lá se executa, aqui se enxerga e se distribui.
    // `tarefas.editar` sozinho não prova gestão — também autoriza editar a
    // PRÓPRIA tarefa —, então esta aba exige admin.
    title: "Tarefas e Projetos",
    url: "/tarefas",
    icon: BoardIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "tarefas.editar",
    soAdmin: true,
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
    title: "Árvore Genealógica",
    url: "/genealogy",
    icon: TreeIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "arvore.ver",
  },
  {
    // Superfície operacional do Motor Registral: revisar o que as certidões
    // dizem, decidir divergências e acompanhar a linha de cidadania. Entra logo
    // depois da Árvore porque é a continuação natural do trabalho dela.
    title: "Revisão Registral",
    url: "/registral",
    icon: ScrollIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "registral.ver_evidencias",
  },
  {
    // RELATÓRIO É LEITURA DA OPERAÇÃO, não configuração. Nasceu dentro do
    // Gerenciamento e estava no lugar errado: quem tira um relatório de
    // protocolo é quem protocola, e essa pessoa pode não ter (nem precisar de)
    // `usuarios.gerenciar`. Aqui o conteúdo é organizado por FLUXO.
    title: "Relatórios",
    url: "/relatorios",
    icon: ReportIcon,
    textOffset: "",
    iconOffset: "",
    // Permissão PRÓPRIA. Antes era `processos.ver_paginas`, emprestada: tirar o
    // relatório de alguém tirava junto as páginas do processo.
    permissao: "relatorios.ver",
  },
]

const adminMenuItems = [
  {
    // Financeiro geral da empresa — visão consolidada de todos os processos.
    title: "Financeiro",
    url: "/financeiro",
    icon: DollarIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "financeiro.ver",
  },
  {
    title: "Gerenciamento",
    url: "/administrator",
    icon: ManagementIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "usuarios.gerenciar",
  },
]

export function BitrixSidebar() {
  const { pode, isAdmin, carregando } = usePermissoes()
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
    // Regra global do item ativo (§11): superfície azul sólida, tinta e glifo
    // BRANCOS de verdade — `text-white` é o pigmento do vidro (tinta escura),
    // não o branco real, que mora em --text-inverse.
    if (isActive) {
      return "h-5 w-5 flex-shrink-0 fill-[var(--text-inverse)] text-[var(--text-inverse)]"
    }
    return "h-5 w-5 flex-shrink-0 text-white"
  }

  // Função para renderizar o ícone corretamente
  const renderIcon = (Icon: typeof HouseIcon | typeof GridIcon | typeof BoardIcon | typeof CheckIcon | typeof TreeIcon | typeof ShieldIcon | typeof CalendarIcon | typeof DollarIcon, isActive: boolean, iconOffset: string = "") => {
  // Todos os ícones são customizados agora, passa a prop filled
    return <Icon className={`h-5 w-5 flex-shrink-0 ${isActive ? "text-[var(--text-inverse)]" : "text-white"} ${iconOffset}`} filled={isActive} />
  }

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`
        ${isExpanded ? "w-64" : "w-16"} 
        bg-[var(--surface-sidebar)] text-white 
        border-r border-[var(--border-default)] shadow-[var(--elev-3)]
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
          className="hover:bg-[var(--surface-hover)] rounded-lg p-2 transition-colors flex items-center justify-center flex-shrink-0"
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
        <div className="border-b border-[var(--border-strong)]" />
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
            {menuItems.filter((item) => (!item.permissao || pode(item.permissao)) && (!item.soAdmin || isAdmin)).map((item) => {
              const isActive = pathname === item.url

              return (
                <Link
                  key={item.url}
                  href={item.url}
                  className={`
                    flex items-center gap-3 rounded-lg px-3 py-3 text-[15px] font-medium transition-colors
                    hover:bg-[var(--surface-hover)] relative
                    ${isActive ? "bg-[var(--action-primary)] text-[var(--text-inverse)]" : "text-white/90"}
                    ${!isExpanded ? "justify-center" : ""}
                  `}
                  title={!isExpanded ? item.title : undefined}
                >
                  <span className="relative flex-shrink-0">
                    {renderIcon(item.icon, isActive, item.iconOffset)}
                  </span>

                  {isExpanded && (
                    <span className={`whitespace-nowrap leading-none ${item.textOffset}`}>{item.title}</span>
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
                      hover:bg-[var(--surface-hover)]
                      ${isActive ? "bg-[var(--action-primary)] text-[var(--text-inverse)]" : "text-white/90"}
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