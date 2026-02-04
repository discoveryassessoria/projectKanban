// src/components/activitiesComponents/RelatorioButton.tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FileText, FileSpreadsheet, Download, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { gerarRelatorioPDF, gerarRelatorioExcel } from "@/src/utils/relatorioTarefas"
import type { Atividade } from "@/src/hooks/useActivitiesData"

interface RelatorioButtonProps {
  atividades: Atividade[]
  filtros?: {
    pais?: string
    status?: string
    responsavel?: string
    dataInicio?: string
    dataFim?: string
  }
}

export default function RelatorioButton({ atividades, filtros }: RelatorioButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [formatoGerando, setFormatoGerando] = useState<string | null>(null)

  const handleGerarPDF = async () => {
    setIsGenerating(true)
    setFormatoGerando('pdf')
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      gerarRelatorioPDF(atividades, filtros)
    } catch (error) {
      console.error('Erro ao gerar PDF:', error)
      alert('Erro ao gerar o relatório PDF. Tente novamente.')
    } finally {
      setIsGenerating(false)
      setFormatoGerando(null)
    }
  }

  const handleGerarExcel = async () => {
    setIsGenerating(true)
    setFormatoGerando('excel')
    try {
      await gerarRelatorioExcel(atividades, filtros)
    } catch (error) {
      console.error('Erro ao gerar Excel:', error)
      alert('Erro ao gerar o relatório Excel. Tente novamente.')
    } finally {
      setIsGenerating(false)
      setFormatoGerando(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          disabled={isGenerating}
          className="bg-transparent border-white/30 text-white hover:bg-white/10 hover:text-white"
        >
          {isGenerating ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          Relatório
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white border-gray-200 text-gray-900 w-52">
        <DropdownMenuLabel className="text-gray-500 text-xs">
          Exportar {atividades.length} tarefa(s)
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-200" />
        <DropdownMenuItem 
          onClick={handleGerarPDF}
          disabled={isGenerating}
          className="cursor-pointer hover:bg-gray-100"
        >
          <FileText className="mr-2 h-4 w-4 text-red-500" />
          <div>
            <div className="font-medium">Exportar PDF</div>
            <div className="text-xs text-gray-500">Relatório formatado</div>
          </div>
          {formatoGerando === 'pdf' && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={handleGerarExcel}
          disabled={isGenerating}
          className="cursor-pointer hover:bg-gray-100"
        >
          <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
          <div>
            <div className="font-medium">Exportar Excel</div>
            <div className="text-xs text-gray-500">Planilha com abas por status</div>
          </div>
          {formatoGerando === 'excel' && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}