"use client"

import * as React from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface Usuario {
  id: number
  nome: string
  email: string
}

interface UserSelectorProps {
  value?: string
  onChange?: (userId: number | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function UserSelector({ 
  value, 
  onChange, 
  placeholder = "Selecione um usuário...",
  className,
  disabled = false 
}: UserSelectorProps) {
  const [open, setOpen] = React.useState(false)
  const [usuarios, setUsuarios] = React.useState<Usuario[]>([])
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState("")

  // Buscar usuários quando o componente monta ou quando o search muda
  React.useEffect(() => {
    const fetchUsuarios = async () => {
      setLoading(true)
      try {
        const searchParam = search ? `?search=${encodeURIComponent(search)}` : ""
        const response = await fetch(`/api/usuarios${searchParam}`)
        
        if (response.ok) {
          const data = await response.json()
          setUsuarios(data.usuarios || [])
        }
      } catch (error) {
        console.error("Erro ao buscar usuários:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchUsuarios()
  }, [search])

  // Buscar o usuário selecionado atual
  const selectedUser = React.useMemo(() => {
    if (!value) return null
    return usuarios.find((user) => user.id.toString() === value) || null
  }, [value, usuarios])

  const handleSelect = (userId: string) => {
    const user = usuarios.find(u => u.id.toString() === userId)
    if (user) {
      onChange?.(user.id)
    }
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange?.(null)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
          disabled={disabled}
        >
          <span className="truncate">
            {selectedUser
              ? `${selectedUser.nome} (${selectedUser.email})`
              : placeholder}
          </span>
          <div className="flex items-center gap-1">
            {selectedUser && (
              <X 
                className="h-4 w-4 opacity-50 hover:opacity-100" 
                onClick={handleClear}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command>
          <CommandInput 
            placeholder="Buscar usuário..." 
            className="h-9" 
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="p-2 text-sm text-muted-foreground">Carregando...</div>
            ) : (
              <>
                <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                <CommandGroup>
                  {usuarios.map((usuario) => (
                    <CommandItem
                      key={usuario.id}
                      value={usuario.id.toString()}
                      onSelect={handleSelect}
                      className="flex items-center justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{usuario.nome}</span>
                        <span className="text-sm text-muted-foreground">{usuario.email}</span>
                      </div>
                      <Check
                        className={cn(
                          "ml-2 h-4 w-4",
                          value === usuario.id.toString() ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}