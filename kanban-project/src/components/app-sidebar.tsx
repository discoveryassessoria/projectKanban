"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { KanbanIcon, Home, Settings, Users, Inbox, Calendar, Search, Shield } from "lucide-react"
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
} from "@/components/ui/sidebar"
import { useIsAdmin } from "@/src/hooks/use-is-admin"

const menuItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Kanban",
    url: "/kanban",
    icon: Inbox,
  },
  {
    title: "Activities and projects",
    url: "/activities",
    icon: Calendar,
  },
  {
    title: "Genealogical Tree",
    url: "/genealogy",
    icon: Search,
  },
  {
    title: "Settings",
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

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-zinc-800">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
            <KanbanIcon className="h-5 w-5 text-white" />
          </div>
          <span className="font-semibold text-lg">Kanban App</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.url}>
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Menu administrativo - apenas para admins */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminMenuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={pathname === item.url}>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}

