"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

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
import type { Projeto } from "@/src/types/kanban"

interface ProjectSelectorProps {
  projetos: Projeto[]
  selectedProject: Projeto | null
  onSelect: (projeto: Projeto) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function ProjectSelector({ 
  projetos, 
  selectedProject, 
  onSelect, 
  placeholder = "Selecione um projeto...",
  className,
  disabled = false 
}: ProjectSelectorProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (projetoId: string) => {
    const projeto = projetos.find(p => p.id.toString() === projetoId)
    if (projeto) {
      onSelect(projeto)
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
          className={cn("justify-between min-h-[40px] bg-white border-gray-300 text-gray-900 hover:bg-gray-50", className)}
          disabled={disabled}
        >
          <span className="truncate text-left">
            {selectedProject ? selectedProject.nome : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput 
            placeholder="Buscar projeto..." 
            className="h-9" 
          />
          <CommandList>
            <CommandEmpty>Nenhum projeto encontrado.</CommandEmpty>
            <CommandGroup>
              {projetos.map((projeto) => (
                <CommandItem
                  key={projeto.id}
                  value={projeto.id.toString()}
                  onSelect={handleSelect}
                  className="flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{projeto.nome}</span>
                    {projeto.descricao && (
                      <span className="text-sm text-muted-foreground truncate">
                        {projeto.descricao}
                      </span>
                    )}
                  </div>
                  <Check
                    className={cn(
                      "ml-2 h-4 w-4",
                      selectedProject?.id === projeto.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}