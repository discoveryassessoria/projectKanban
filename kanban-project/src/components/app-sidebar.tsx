// SUBSTITUI: src/components/app-sidebar.tsx

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  Settings,
  CheckSquare,
  Search,
  Shield,
  Menu,
  DollarSign,
  Receipt,
  CreditCard,
  TrendingUp,
  Users,
  FileText,
  Kanban,
  TreeDeciduous,
  Bot,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { useIsAdmin } from "@/src/hooks/use-is-admin"

const menuItems = [
  {
    title: "Página Inicial",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Processos",
    url: "/kanban",
    icon: Kanban,
  },
  {
    title: "Tarefas e Projetos",
    url: "/activities",
    icon: CheckSquare,
  },
  {
    title: "Árvore Genealógica",
    url: "/genealogy",
    icon: TreeDeciduous,
  },
  {
    title: "Automação",
    url: "/automation",
    icon: Bot,
  },
  {
    title: "Configurações",
    url: "/settings",
    icon: Settings,
  },
]

// Novo grupo: Finanças
const financeItems = [
  {
    title: "Dashboard",
    url: "/financas",
    icon: TrendingUp,
  },
  {
    title: "Contas a Receber",
    url: "/financas/contas-receber",
    icon: Receipt,
  },
  {
    title: "Contas a Pagar",
    url: "/financas/contas-pagar",
    icon: CreditCard,
  },
  {
    title: "Fluxo de Caixa",
    url: "/financas/fluxo-caixa",
    icon: DollarSign,
  },
  {
    title: "Fornecedores",
    url: "/financas/fornecedores",
    icon: Users,
  },
  {
    title: "Relatórios",
    url: "/financas/relatorios",
    icon: FileText,
  },
]

const adminMenuItems = [
  {
    title: "Gerenciar Usuários",
    url: "/administrator",
    icon: Shield,
    adminOnly: true,
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { isAdmin } = useIsAdmin()
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  // Verifica se está em alguma rota de finanças
  const isFinanceActive = pathname.startsWith("/financas")

  return (
    <Sidebar
      collapsible="icon"
      className="bg-[#050B2A]/80 backdrop-blur-xl text-white border-r border-white/10 shadow-xl"
    >
      <SidebarHeader className="border-b border-white/10 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <SidebarTrigger className="hover:bg-white/10 rounded-lg p-2 transition-colors">
            <Menu className="h-5 w-5 text-white" />
          </SidebarTrigger>
          
          {!isCollapsed && (
            <div className="flex items-center gap-2 flex-1 overflow-hidden">
              <div className="flex flex-col leading-tight whitespace-nowrap">
                <span className="font-semibold text-sm">Grupo Discovery</span>
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3 space-y-4">
        {/* Navegação Principal */}
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wide text-white/60 px-2">
              Navegação
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {menuItems.map((item) => {
                const isActive = pathname === item.url

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition
                      hover:bg-white/10 hover:text-white
                      ${isActive ? "bg-white/12 text-white shadow-inner border border-white/10" : "text-white/75"}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Finanças */}
        <SidebarGroup>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-[11px] uppercase tracking-wide text-white/60 px-2">
              Finanças
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {financeItems.map((item) => {
                const isActive = pathname === item.url

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition
                      hover:bg-white/10 hover:text-white
                      ${isActive ? "bg-white/12 text-white shadow-inner border border-white/10" : "text-white/75"}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Administração */}
        {isAdmin && (
          <SidebarGroup>
            {!isCollapsed && (
              <SidebarGroupLabel className="text-[11px] uppercase tracking-wide text-white/60 px-2">
                Administração
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {adminMenuItems.map((item) => {
                  const isActive = pathname === item.url

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition
                        hover:bg-white/10 hover:text-white
                        ${isActive ? "bg-white/12 text-white shadow-inner border border-white/10" : "text-white/75"}`}
                      >
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!isCollapsed && <span className="whitespace-nowrap overflow-hidden">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}