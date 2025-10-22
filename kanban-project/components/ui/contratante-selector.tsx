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
  selectedContratante?: Contratante | null
  selectedContratantes?: Contratante[]
  onSelect?: (contratante: Contratante | null) => void
  onSelectMultiple?: (contratantes: Contratante[]) => void
  onAdd?: () => void
  onView?: (contratante: Contratante) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  mode?: 'single' | 'checkbox'
}

export function ContratanteSelector({ 
  contratantes, 
  selectedContratante, 
  selectedContratantes = [],
  onSelect,
  onSelectMultiple,
  onAdd,
  onView,
  placeholder = "Contratante",
  className,
  disabled = false,
  mode = 'single'
}: ContratanteSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (contratanteId: string) => {
    if (contratanteId === "add-new") {
      onAdd?.()
      setOpen(false)
      return
    }
    
    if (mode === 'single') {
      if (contratanteId === "none") {
        onSelect?.(null)
        setOpen(false)
        return
      }

      const contratante = contratantes.find(c => c.id.toString() === contratanteId)
      if (contratante) {
        onSelect?.(contratante)
      }
      setOpen(false)
    }
  }

  const handleCheckboxToggle = (contratante: Contratante) => {
    console.log('Checkbox toggle - contratante:', contratante.nome, 'mode:', mode)
    if (mode === 'checkbox') {
      const isSelected = selectedContratantes.some(c => c.id === contratante.id)
      let newSelection: Contratante[]
      
      if (isSelected) {
        newSelection = selectedContratantes.filter(c => c.id !== contratante.id)
      } else {
        newSelection = [...selectedContratantes, contratante]
      }
      
      console.log('New selection:', newSelection)
      onSelectMultiple?.(newSelection)
    }
  }

  const handleView = (e: React.MouseEvent, contratante: Contratante) => {
    e.stopPropagation()
    onView?.(contratante)
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
            (!selectedContratante && mode === 'single') || (selectedContratantes.length === 0 && mode === 'checkbox') 
              ? "text-muted-foreground" : "",
            className
          )}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            {mode === 'single' 
              ? (selectedContratante ? selectedContratante.nome : placeholder)
              : (selectedContratantes.length === 0 
                  ? placeholder 
                  : `${selectedContratantes.length} selecionado(s)`
                )
            }
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar contratante..." />
          <CommandList>
            <CommandEmpty>
              {contratantes.length === 0 
                ? "Nenhum contratante cadastrado." 
                : "Nenhum contratante encontrado."
              }
            </CommandEmpty>
            <CommandGroup>
              {mode === 'single' && (
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
              )}
              {contratantes.map((contratante) => (
                <CommandItem
                  key={contratante.id}
                  value={contratante.nome}
                  onSelect={mode === 'single' ? () => handleSelect(contratante.id.toString()) : undefined}
                  className="cursor-pointer relative"
                  onClick={mode === 'checkbox' ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleCheckboxToggle(contratante)
                  } : undefined}
                >
                  {mode === 'checkbox' && (
                    <div className="mr-2 flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedContratantes.some(c => c.id === contratante.id)}
                        onChange={(e) => {
                          e.stopPropagation()
                          handleCheckboxToggle(contratante)
                        }}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </div>
                  )}
                  {mode === 'single' && (
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 flex-shrink-0",
                        selectedContratante?.id === contratante.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  )}
                  <div className="flex flex-col flex-1">
                    <span>{contratante.nome}</span>
                    {(contratante.cpf || contratante.telefone) && (
                      <span className="text-xs text-muted-foreground">
                        {contratante.cpf && `CPF: ${contratante.cpf}`}
                        {contratante.cpf && contratante.telefone && ' • '}
                        {contratante.telefone && `Tel: ${contratante.telefone}`}
                      </span>
                    )}
                  </div>
                  {onView && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                      onClick={(e) => handleView(e, contratante)}
                    >
                      <Building2 className="h-3 w-3" />
                    </Button>
                  )}
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