"use client"

import { useState, useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface Arvore {
  id: number
  nome: string
}

interface TreeSelectorProps {
  value?: string | null
  onChange: (value: number | null) => void
  placeholder?: string
  className?: string
}

export function TreeSelector({ value, onChange, placeholder, className }: TreeSelectorProps) {
  const [arvores, setArvores] = useState<Arvore[]>([])

  useEffect(() => {
    const fetchArvores = async () => {
      try {
        // Busca as árvores da sua API
        const response = await fetch("/api/arvore")
        if (response.ok) {
          const data = await response.json()
          setArvores(data)
        }
      } catch (error) {
        console.error("Erro ao buscar árvores genealógicas:", error)
      }
    }
    fetchArvores()
  }, [])

  const handleValueChange = (selectedValue: string) => {
    onChange(selectedValue === "null" ? null : Number(selectedValue));
  }

  return (
    <Select value={value ?? "null"} onValueChange={handleValueChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="null">Nenhuma</SelectItem>
        {arvores.map((arvore) => (
          <SelectItem key={arvore.id} value={arvore.id.toString()}>
            {arvore.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}