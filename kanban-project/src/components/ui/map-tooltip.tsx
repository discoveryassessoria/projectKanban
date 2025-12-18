"use client"

import { useState, useRef } from "react"
import { MapPin, X } from "lucide-react"

interface MapTooltipProps {
  endereco?: string | null
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  children: React.ReactNode
}

export function MapTooltip(props: MapTooltipProps) {
  const { endereco, numero, bairro, cidade, estado, cep, children } = props
  const [showMap, setShowMap] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const partes = [
    endereco && numero ? endereco + ", " + numero : endereco,
    bairro,
    cidade,
    estado,
    cep,
    "Brasil"
  ].filter(Boolean)
  
  const enderecoCompleto = partes.join(", ")
  const embedUrl = "https://maps.google.com/maps?q=" + encodeURIComponent(enderecoCompleto) + "&t=&z=18&ie=UTF8&iwloc=&output=embed"
  const enderecoLabel = endereco ? (numero ? endereco + ", " + numero : endereco) : ""

  const handleMouseEnter = () => {
    if (!endereco && !cidade) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(function() { setShowMap(true) }, 300)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(function() { setShowMap(false) }, 300)
  }

  const handleClose = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShowMap(false)
  }

  if (!endereco && !cidade) {
    return children
  }

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="cursor-pointer">
        {children}
      </div>

      {showMap ? (
        <div 
          className="absolute left-full top-0 ml-3 z-[10000] bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden"
          style={{ width: 450 }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="bg-gray-100 px-3 py-2 border-b flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <MapPin className="h-4 w-4 text-red-500 flex-shrink-0" />
              <span className="text-sm font-medium text-gray-700 truncate">
                {enderecoLabel}
              </span>
            </div>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          <iframe
            src={embedUrl}
            width="100%"
            height="350"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      ) : null}
    </div>
  )
}