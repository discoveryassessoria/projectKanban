"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Plus, User, Pencil } from "lucide-react"

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
  selectedRequerente?: Requerente | null
  selectedRequerentes?: Requerente[]
  onSelect?: (requerente: Requerente | null) => void
  onSelectMultiple?: (requerentes: Requerente[]) => void
  onAdd?: () => void
  onView?: (requerente: Requerente) => void
  onEdit?: (requerente: Requerente) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  mode?: 'single' | 'checkbox'
}

export function RequerenteSelector({ 
  requerentes, 
  selectedRequerente, 
  selectedRequerentes = [],
  onSelect,
  onSelectMultiple,
  onAdd,
  onView,
  onEdit,
  placeholder = "Requerente",
  className,
  disabled = false,
  mode = 'single'
}: RequerenteSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (requerenteId: string) => {
    if (requerenteId === "add-new") {
      onAdd?.()
      setOpen(false)
      return
    }
    
    if (mode === 'single') {
      if (requerenteId === "none") {
        onSelect?.(null)
        setOpen(false)
        return
      }

      const requerente = requerentes.find(r => r.id.toString() === requerenteId)
      if (requerente) {
        onSelect?.(requerente)
      }
      setOpen(false)
    }
  }

  const handleCheckboxToggle = (requerente: Requerente) => {
    console.log('Checkbox toggle - requerente:', requerente.nome, 'mode:', mode)
    if (mode === 'checkbox') {
      const isSelected = selectedRequerentes.some(r => r.id === requerente.id)
      let newSelection: Requerente[]
      
      if (isSelected) {
        newSelection = selectedRequerentes.filter(r => r.id !== requerente.id)
      } else {
        newSelection = [...selectedRequerentes, requerente]
      }
      
      console.log('New selection:', newSelection)
      onSelectMultiple?.(newSelection)
    }
  }

  const handleView = (e: React.MouseEvent, requerente: Requerente) => {
    e.stopPropagation()
    onView?.(requerente)
    setOpen(false)
  }

  const handleEdit = (e: React.MouseEvent, requerente: Requerente) => {
    e.stopPropagation()
    onEdit?.(requerente)
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
            (!selectedRequerente && mode === 'single') && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            {mode === 'checkbox' 
              ? `${selectedRequerentes.length} requerente(s) selecionado(s)`
              : selectedRequerente 
                ? selectedRequerente.nome 
                : placeholder
            }
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Pesquisar requerente..." />
          <CommandList>
            <CommandEmpty>
              {requerentes.length === 0 
                ? "Nenhum requerente cadastrado." 
                : "Nenhum requerente encontrado."
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
                      !selectedRequerente ? "opacity-100" : "opacity-0"
                    )}
                  />
                  Nenhum requerente
                </CommandItem>
              )}
              {requerentes.map((requerente) => (
                <CommandItem
                  key={requerente.id}
                  value={`${requerente.nome} ${requerente.cpf || ''}`}
                  onSelect={mode === 'single' ? () => handleSelect(requerente.id.toString()) : undefined}
                  className="cursor-pointer relative hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={mode === 'checkbox' ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleCheckboxToggle(requerente)
                  } : undefined}
                >
                  {mode === 'checkbox' && (
                    <div className="mr-2 flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedRequerentes.some(r => r.id === requerente.id)}
                        onChange={(e) => {
                          e.stopPropagation()
                          handleCheckboxToggle(requerente)
                        }}
                        className="h-4 w-4 rounded border"
                      />
                    </div>
                  )}
                  {mode === 'single' && (
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 flex-shrink-0",
                        selectedRequerente?.id === requerente.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                  )}
                  <div className="flex flex-col flex-1">
                    <span>{requerente.nome}</span>
                    {requerente.cpf && (
                      <span className="text-xs text-muted-foreground">
                        CPF: {requerente.cpf}
                      </span>
                    )}
                  </div>
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 ml-auto hover:bg-gray-200 dark:hover:bg-gray-700"
                      onClick={(e) => handleEdit(e, requerente)}
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
              + Adicionar requerente
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}