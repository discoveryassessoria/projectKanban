"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react"

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

interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
}

interface ContratanteSelectorProps {
  contratantes: Contratante[]
  selectedContratante: Contratante | null
  onSelect: (contratante: Contratante | null) => void
  onAdd: () => void
  onView: (contratante: Contratante) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function ContratanteSelector({ 
  contratantes, 
  selectedContratante, 
  onSelect,
  onAdd,
  onView,
  placeholder = "Selecione um contratante...",
  className,
  disabled = false 
}: ContratanteSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (contratanteId: string) => {
    if (contratanteId === "add-new") {
      onAdd()
      setOpen(false)
      return
    }
    
    if (contratanteId === "none") {
      onSelect(null)
      setOpen(false)
      return
    }

    const contratante = contratantes.find(c => c.id.toString() === contratanteId)
    if (contratante) {
      onView(contratante)
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
            !selectedContratante && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {selectedContratante ? selectedContratante.nome : placeholder}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar contratante..." />
          <CommandList>
            <CommandEmpty>Nenhum contratante encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="none"
                onSelect={handleSelect}
                className="text-muted-foreground"
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !selectedContratante ? "opacity-100" : "opacity-0"
                  )}
                />
                Nenhum contratante
              </CommandItem>
              {contratantes.map((contratante) => (
                <CommandItem
                  key={contratante.id}
                  value={contratante.id.toString()}
                  onSelect={handleSelect}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedContratante?.id === contratante.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span>{contratante.nome}</span>
                    {(contratante.cpf || contratante.telefone) && (
                      <span className="text-xs text-muted-foreground">
                        {contratante.cpf && `CPF: ${contratante.cpf}`}
                        {contratante.cpf && contratante.telefone && ' • '}
                        {contratante.telefone && `Tel: ${contratante.telefone}`}
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
                + Adicionar contratante
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}