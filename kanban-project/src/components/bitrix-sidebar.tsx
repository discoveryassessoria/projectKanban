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
import { useIsMobile } from "@/hooks/use-mobile"
import { CalendarIcon } from "@/src/components/icons/calendar-icon"
import { CalendarGridIcon } from "@/src/components/icons/calendar-grid-icon"
import { DistributeIcon } from "@/src/components/icons/distribute-icon"
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
    // DISTRIBUIÇÃO — tela própria de "quem decide de quem é o trabalho"
    // (mandato "ultra fiel ao desenho", 24/09/2026 — confirmado em dois
    // mockups distintos). Mesma permissão da própria tela
    // (`/operacao/distribuicao`): `tarefas.editar`.
    title: "Distribuição",
    url: "/operacao/distribuicao",
    icon: DistributeIcon,
    textOffset: "",
    iconOffset: "",
    permissao: "tarefas.editar",
  },
  {
    // CALENDÁRIO — agendamentos consulares (mandato 24/09/2026). Item PRÓPRIO,
    // ícone distinto de Eventos: são telas diferentes, nunca a mesma rota
    // renomeada — só o desenho por enquanto, sem fonte de dado ligada ainda.
    title: "Calendário",
    url: "/calendario",
    icon: CalendarGridIcon,
    textOffset: "",
    iconOffset: "",
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
  const { isCollapsed, setIsCollapsed, mobileAberto, setMobileAberto } = useSidebarContext()
  const [isHovered, setIsHovered] = useState(false)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pathname = usePathname()
  const isMobile = useIsMobile()

  // FRONTEIRA ABSOLUTA (mandato "modernização visual — sidebar mobile",
  // 19/09/2026): o Kanban NUNCA entra no modo drawer, em NENHUM viewport —
  // continua exatamente como sempre foi (trilho fixo, `isCollapsed`/hover,
  // sem `translate-x`, sem backdrop). Só telas fora do Kanban, abaixo de
  // 768px, usam o drawer novo.
  const isKanban = pathname.startsWith("/kanban")
  const usarDrawerMobile = isMobile && !isKanban

  // No drawer mobile o menu é binário — aberto (rótulos à mostra, como o
  // painel expandido do desktop) ou fechado (fora da tela). Não existe
  // "trilho só-ícone" no mobile: não há hover pra reabrir por engano, e um
  // ícone sem rótulo é pior alvo de toque.
  const isExpanded = usarDrawerMobile ? true : (!isCollapsed || isHovered)

  // Fechar o drawer sozinho ao trocar de rota — abrir o menu, tocar num
  // item e continuar vendo o menu por cima seria o mesmo defeito que
  // motivou este mandato, só que depois de navegar em vez de antes.
  useEffect(() => {
    if (usarDrawerMobile) setMobileAberto(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Esc fecha o drawer — mesma expectativa de teclado de qualquer overlay
  // (modal, sheet, dropdown) já usado no resto do sistema.
  useEffect(() => {
    if (!usarDrawerMobile || !mobileAberto) return
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileAberto(false) }
    document.addEventListener("keydown", aoTeclar)
    return () => document.removeEventListener("keydown", aoTeclar)
  }, [usarDrawerMobile, mobileAberto, setMobileAberto])

  const handleMouseEnter = () => {
    if (usarDrawerMobile) return
    if (isCollapsed) {
      hoverTimeoutRef.current = setTimeout(() => {
        setIsHovered(true)
      }, 200)
    }
  }

  const handleMouseLeave = () => {
    if (usarDrawerMobile) return
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsHovered(false)
  }

  // IDENTIDADE BITRIX (14-15/09/2026): dois estados de verdade, não só
  // largura — trilho colapsado CLARO, painel expandido AZUL-MARINHO com
  // texto claro. `text-white` aqui resolveria pro pigmento do vidro
  // (graphite, --color-white) — errado num fundo escuro — por isso os dois
  // estados usam tokens explícitos (`--sidebar-rail-*`/`--sidebar-expanded-*`),
  // nunca a classe `text-white`.
  const corTextoInativo = isExpanded ? "text-[var(--sidebar-expanded-text)]" : "text-[var(--sidebar-rail-text)]"
  const corHover = isExpanded ? "hover:bg-[var(--sidebar-expanded-item-hover)]" : "hover:bg-[var(--surface-hover)]"

  const getIconClasses = (isActive: boolean) => {
    if (isActive) {
      return `h-5 w-5 flex-shrink-0 ${isExpanded ? "text-[var(--sidebar-expanded-item-active-text)]" : "text-[var(--text-inverse)]"}`
    }
    return `h-5 w-5 flex-shrink-0 ${corTextoInativo}`
  }

  // Função para renderizar o ícone corretamente
  const renderIcon = (Icon: typeof HouseIcon | typeof GridIcon | typeof BoardIcon | typeof CheckIcon | typeof TreeIcon | typeof ShieldIcon | typeof CalendarIcon | typeof DollarIcon, isActive: boolean, iconOffset: string = "") => {
    // Trilho colapsado: ícone ativo ganha uma bolha verde (destaque Bitrix),
    // ícone atrás fica branco pra contrastar. Painel expandido: pill de
    // fundo translúcido claro sobre o azul-marinho (ver `getIconClasses`).
    if (!isExpanded && isActive) {
      return (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--sidebar-rail-icon-active-bg)]">
          <Icon className={`h-5 w-5 flex-shrink-0 text-[var(--text-inverse)] ${iconOffset}`} filled={isActive} />
        </span>
      )
    }
    return <Icon className={`${getIconClasses(isActive)} ${iconOffset}`} filled={isActive} />
  }

  return (
    <>
      {/* BACKDROP — só existe no drawer mobile, só quando aberto. Kanban e
          desktop nunca renderizam isto (usarDrawerMobile é sempre false lá). */}
      {usarDrawerMobile && mobileAberto && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileAberto(false)}
          aria-hidden="true"
        />
      )}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role={usarDrawerMobile ? "dialog" : undefined}
        aria-modal={usarDrawerMobile ? mobileAberto : undefined}
        aria-label={usarDrawerMobile ? "Menu de navegação" : undefined}
        className={`
        ${usarDrawerMobile ? "w-64" : (isExpanded ? "w-64" : "w-16")}
        ${isExpanded ? "bg-[var(--sidebar-expanded-background)]" : "bg-[var(--sidebar-rail-background)]"}
        border-r border-[var(--border-default)] shadow-[var(--elev-3)]
        ${usarDrawerMobile
          ? `transition-transform duration-300 ease-in-out z-50 ${mobileAberto ? "translate-x-0" : "-translate-x-full"}`
          : "transition-[width,background-color] duration-300 ease-in-out z-50"}
        flex flex-col h-screen fixed left-0 top-0
        overflow-hidden
      `}
      >
      {/* Header com botão toggle */}
      <div className="py-4 px-3 flex items-center">
        <button
          onClick={() => {
            if (usarDrawerMobile) {
              setMobileAberto(false)
              return
            }
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current)
              hoverTimeoutRef.current = null
            }
            setIsCollapsed(!isCollapsed)
            setIsHovered(false)
          }}
          className={`${corHover} rounded-lg p-2 transition-colors flex items-center justify-center flex-shrink-0`}
          aria-label={usarDrawerMobile ? "Fechar menu de navegação" : "Recolher ou expandir a barra lateral"}
        >
          <Menu className={`h-6 w-6 ${corTextoInativo}`} aria-hidden="true" />
        </button>

        {isExpanded && (
          <span className={`font-semibold text-base ${corTextoInativo} ml-1 leading-none whitespace-nowrap`}>
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
            <div className={`text-xs uppercase tracking-wide ${corTextoInativo} opacity-70 font-medium px-3 mb-3 whitespace-nowrap`}>
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
                    ${corHover} relative
                    ${isActive
                      ? isExpanded
                        ? "bg-[var(--sidebar-expanded-item-active-bg)] text-[var(--sidebar-expanded-item-active-text)]"
                        : "text-[var(--text-inverse)]"
                      : corTextoInativo}
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
              <div className={`text-xs uppercase tracking-wide ${corTextoInativo} opacity-70 font-medium px-3 mb-3 whitespace-nowrap`}>
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
                      ${corHover}
                      ${isActive
                        ? isExpanded
                          ? "bg-[var(--sidebar-expanded-item-active-bg)] text-[var(--sidebar-expanded-item-active-text)]"
                          : "text-[var(--text-inverse)]"
                        : corTextoInativo}
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

      {/* CTA fixado embaixo — equivalente ao "Atualize seu plano" do Bitrix. */}
      {isExpanded && (
        <div className="p-3">
          <div
            className="rounded-xl px-3 py-2.5 text-center text-[13px] font-semibold text-[var(--text-inverse)] cursor-pointer transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, var(--brand) 0%, var(--stepper-current-bg) 100%)" }}
          >
            Central de Ajuda
          </div>
        </div>
      )}
      </aside>
    </>
  )
}