"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  KanbanIcon,
  Home,
  Settings,
  Inbox,
  Calendar,
  Search,
  Shield,
  Menu,
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
    adminOnly: true,
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { isAdmin } = useIsAdmin()
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

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