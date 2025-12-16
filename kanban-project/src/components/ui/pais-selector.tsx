"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Pais, PAISES_CONFIG, PAISES_LISTA } from "@/src/types/kanban"

interface PaisSelectorProps {
  selectedPais: Pais
  onSelect: (pais: Pais) => void
  className?: string
}

export function PaisSelector({ selectedPais, onSelect, className }: PaisSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const config = PAISES_CONFIG[selectedPais]

  const paisesOrdenados = [...PAISES_LISTA].sort((a, b) => 
    PAISES_CONFIG[a].label.localeCompare(PAISES_CONFIG[b].label)
  )

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between gap-2 w-full px-3 py-2 rounded-lg",
          "bg-white/10 border border-white/20 text-white",
          "hover:bg-white/15 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-indigo-500"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">{config.bandeira}</span>
          <span className="font-medium">{config.label}</span>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 transition-transform",
          isOpen && "rotate-180"
        )} />
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)} 
          />
          
          <div className={cn(
            "absolute top-full left-0 right-0 mt-1 z-20",
            "bg-white/95 backdrop-blur-xl rounded-lg shadow-xl",
            "border border-gray-200 overflow-hidden"
          )}>
            {paisesOrdenados.map((pais) => {
              const paisConfig = PAISES_CONFIG[pais]
              const isSelected = pais === selectedPais
              
              return (
                <button
                  key={pais}
                  type="button"
                  onClick={() => {
                    onSelect(pais)
                    setIsOpen(false)
                  }}
                  className={cn(
                    "flex items-center justify-between w-full px-3 py-2.5",
                    "hover:bg-gray-100 transition-colors text-left",
                    isSelected && "bg-indigo-50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{paisConfig.bandeira}</span>
                    <span className={cn(
                      "font-medium text-gray-900",
                      isSelected && "text-indigo-600"
                    )}>
                      {paisConfig.label}
                    </span>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 text-indigo-600" />
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

interface PaisTabsProps {
  selectedPais: Pais
  onSelect: (pais: Pais) => void
  className?: string
}

export function PaisTabs({ selectedPais, onSelect, className }: PaisTabsProps) {
  const paisesOrdenados = [...PAISES_LISTA].sort((a, b) => 
    PAISES_CONFIG[a].label.localeCompare(PAISES_CONFIG[b].label)
  )

  return (
    <div className={cn("flex gap-1 p-1 bg-white/10 rounded-lg", className)}>
      {paisesOrdenados.map((pais) => {
        const config = PAISES_CONFIG[pais]
        const isSelected = pais === selectedPais
        
        return (
          <button
            key={pais}
            type="button"
            onClick={() => onSelect(pais)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all",
              "text-sm font-medium",
              isSelected 
                ? "bg-white text-gray-900 shadow-sm" 
                : "text-white/70 hover:text-white hover:bg-white/10"
            )}
          >
            <span>{config.bandeira}</span>
            <span>{config.label}</span>
          </button>
        )
      })}
    </div>
  )
}