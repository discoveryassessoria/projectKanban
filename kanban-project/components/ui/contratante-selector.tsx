"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus, Building2, Pencil } from "lucide-react"

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
  onEdit?: (contratante: Contratante) => void
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
  onEdit,
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
        // Se já está selecionado, remove
        newSelection = selectedContratantes.filter(c => c.id !== contratante.id)
      } else {
        // Se não está selecionado, substitui a seleção anterior (apenas 1 contratante)
        newSelection = [contratante]
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

  const handleEdit = (e: React.MouseEvent, contratante: Contratante) => {
    e.stopPropagation()
    onEdit?.(contratante)
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
                  value={`${contratante.nome} ${contratante.cpf || ''}`}
                  onSelect={mode === 'single' ? () => handleSelect(contratante.id.toString()) : undefined}
                  className="cursor-pointer relative hover:bg-gray-100 dark:hover:bg-gray-800"
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
                        className="h-4 w-4 rounded border"
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
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 ml-auto hover:bg-gray-200 dark:hover:bg-gray-700"
                      onClick={(e) => handleEdit(e, contratante)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {/* Botão Adicionar fixo na parte inferior */}
          <div className="border-t p-2">
            <Button
              variant="ghost"
              className="w-full justify-start text-primary font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => {
                onAdd?.()
                setOpen(false)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              + Adicionar contratante
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}