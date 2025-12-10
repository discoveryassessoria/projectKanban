"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Bell, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

interface SearchResult {
  id: number | string
  type: string
  icon: React.ReactNode
  title: string
  subtitle?: string
  onClick?: () => void
}

interface HeaderProps {
  title: string
  subtitle: string
  user: {
    nome: string
    tipo?: string
  } | null
  searchPlaceholder?: string
  searchResults?: SearchResult[]
  onSearch?: (query: string) => void
  onLogout?: () => void
}

export function Header({
  title,
  subtitle,
  user,
  searchPlaceholder = "Pesquisar no sistema...",
  searchResults = [],
  onSearch,
  onLogout
}: HeaderProps) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)

  const getInitials = (nome: string) => {
    if (!nome) return "US"
    return nome
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleLogout = () => {
    if (onLogout) {
      onLogout()
    } else {
      localStorage.removeItem("authToken")
      localStorage.removeItem("user")
      router.push("/login")
    }
  }

  const handleSearchChange = (query: string) => {
    setSearchQuery(query)
    if (onSearch) {
      onSearch(query)
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md shadow-lg">
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold leading-tight text-white">
            {title}
          </h1>
          <p className="text-xs text-white/70">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Barra de pesquisa */}
          <div className="relative hidden md:block">
            <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/30">
              <Search className="h-4 w-4 text-white/70" />
              <input
                className="bg-transparent text-xs outline-none placeholder:text-white/60 w-40 text-white"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => setShowSearchResults(true)}
                onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              />
            </div>

            {/* Dropdown de resultados */}
            {showSearchResults && (
              <div className="absolute top-full mt-2 left-0 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400">
                    <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-gray-600">Nenhum resultado encontrado</p>
                    <p className="text-xs mt-1 text-gray-400">Tente buscar por outro termo</p>
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.type}-${result.id}`}
                        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-100 transition text-left"
                        onClick={() => {
                          if (result.onClick) {
                            result.onClick()
                          }
                          setShowSearchResults(false)
                          setSearchQuery("")
                        }}
                      >
                        <div className="flex-shrink-0">
                          {result.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{result.title}</p>
                          <p className="text-[10px] text-gray-400 truncate">{result.subtitle || "Sem descrição"}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Botão de notificações */}
          <div className="relative hidden md:block">
            <button 
              className="relative inline-flex items-center justify-center rounded-full p-2 border border-white/30 hover:bg-white/10 transition"
              onClick={() => setShowNotifications(!showNotifications)}
              onBlur={() => setTimeout(() => setShowNotifications(false), 200)}
            >
              <Bell className="h-4 w-4 text-white" />
            </button>

            {/* Dropdown de notificações */}
            {showNotifications && (
              <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="font-semibold text-gray-800 text-sm">Notificações</h3>
                  <p className="text-xs text-gray-500">0 pendentes</p>
                </div>

                <div className="px-4 py-8 text-center">
                  <Bell className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm text-gray-500">Nenhuma notificação</p>
                  <p className="text-xs text-gray-400 mt-1">Você está em dia!</p>
                </div>
              </div>
            )}
          </div>

          {/* Avatar e informações do usuário */}
          {user && (
            <div className="flex items-center gap-2">
              <Avatar className="h-9 w-9 border border-white/30">
                <AvatarFallback className="bg-transparent text-xs font-medium text-white">
                  {getInitials(user.nome)}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:block">
                <p className="text-xs font-medium leading-tight text-white">
                  {user.nome}
                </p>
                <p className="text-[11px] text-white/70 leading-tight">
                  {user.tipo === 'admin' ? 'Administrador' : user.tipo || 'Usuário'}
                </p>
              </div>
            </div>
          )}

          {/* Botão de sair */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="border-white/30 text-xs bg-transparent hover:bg-red-500/20 hover:border-red-400/50 text-white hover:text-red-400 flex items-center justify-center gap-1.5"
          >
            <LogOut className="h-3 w-3" />
            Sair
          </Button>
        </div>
      </div>
    </header>
  )
}