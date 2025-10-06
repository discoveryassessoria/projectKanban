"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus, User } from "lucide-react"

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

interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
}

interface RequerenteSelectorProps {
  requerentes: Requerente[]
  selectedRequerente: Requerente | null
  onSelect: (requerente: Requerente | null) => void
  onAdd: () => void
  onView: (requerente: Requerente) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function RequerenteSelector({ 
  requerentes, 
  selectedRequerente, 
  onSelect,
  onAdd,
  onView,
  placeholder = "Selecione um requerente...",
  className,
  disabled = false 
}: RequerenteSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (requerenteId: string) => {
    if (requerenteId === "add-new") {
      onAdd()
      setOpen(false)
      return
    }
    
    if (requerenteId === "none") {
      onSelect(null)
      setOpen(false)
      return
    }

    const requerente = requerentes.find(r => r.id.toString() === requerenteId)
    if (requerente) {
      onView(requerente)
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "justify-between text-left font-normal",
            !selectedRequerente && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            {selectedRequerente ? selectedRequerente.nome : placeholder}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar requerente..." />
          <CommandList>
            <CommandEmpty>Nenhum requerente encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none"
                onSelect={handleSelect}
                className="text-muted-foreground"
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !selectedRequerente ? "opacity-100" : "opacity-0"
                  )}
                />
                Nenhum requerente
              </CommandItem>
              {requerentes.map((requerente) => (
                <CommandItem
                  key={requerente.id}
                  value={requerente.id.toString()}
                  onSelect={handleSelect}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedRequerente?.id === requerente.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{requerente.nome}</span>
                    {requerente.cpf && (
                      <span className="text-xs text-muted-foreground">
                        CPF: {requerente.cpf}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
              <CommandItem
                value="add-new"
                onSelect={handleSelect}
                className="text-blue-600 font-medium"
              >
                <Plus className="mr-2 h-4 w-4" />
                + Adicionar requerente
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}