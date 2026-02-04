// ESTE ARQUIVO VAI EM: src/components/contratantesComponents/RelatorioClientesButton.tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  FileText,
  FileSpreadsheet,
  Loader2,
  Cake,
  Calendar,
  Download,
  ChevronLeft,
  AlertCircle,
  FileBarChart,
  Shield,
  CreditCard,
  Car,
  Home,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  gerarRelatorioClientesPDF,
  gerarRelatorioClientesExcel,
  gerarRelatorioSemAniversarioPDF,
  gerarRelatorioSemAniversarioExcel,
  gerarRelatorioDocumentosPDF,
  gerarRelatorioDocumentosExcel,
  type ClienteAniversario,
  type ClienteDocumento,
} from "@/src/utils/relatorioClientes"

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

type MenuView = "main" | "escolherMes" | "formatoExport" | "documentos" | "formatoDocumentos"

interface ExportConfig {
  label: string
  mes?: number | null
  proximosDias?: number | null
  semAniversario?: boolean
}

type DocumentoFiltro = "todos" | "RG" | "CNH" | "COMPROVANTE_ENDERECO"

interface DocumentoExportConfig {
  label: string
  filtro: DocumentoFiltro
}

export default function RelatorioClientesButton() {
  const [isGenerating, setIsGenerating] = useState(false)
  const [menuView, setMenuView] = useState<MenuView>("main")
  const [exportConfig, setExportConfig] = useState<ExportConfig | null>(null)
  const [docExportConfig, setDocExportConfig] = useState<DocumentoExportConfig | null>(null)

  const mesAtual = new Date().getMonth() + 1

  // ========== ANIVERSARIANTES ==========
  const buscarAniversariantes = async (
    mes?: number | null,
    proximosDias?: number | null,
    semAniversario?: boolean
  ): Promise<ClienteAniversario[]> => {
    const params = new URLSearchParams()
    if (mes) params.set("mes", mes.toString())
    if (proximosDias) params.set("proximosDias", proximosDias.toString())
    if (semAniversario) params.set("semAniversario", "true")

    const response = await fetch(`/api/clientes/aniversariantes?${params}`)
    if (!response.ok) throw new Error("Erro ao buscar dados")
    const data = await response.json()
    return data.clientes || []
  }

  const handleExport = async (formato: "pdf" | "excel", config: ExportConfig) => {
    setIsGenerating(true)
    try {
      const clientes = await buscarAniversariantes(
        config.mes,
        config.proximosDias,
        config.semAniversario
      )
      if (clientes.length === 0) {
        alert(
          config.semAniversario
            ? "Todos os clientes possuem data de nascimento cadastrada!"
            : "Nenhum aniversariante encontrado para o filtro selecionado."
        )
        return
      }

      if (config.semAniversario) {
        if (formato === "pdf") {
          gerarRelatorioSemAniversarioPDF(clientes)
        } else {
          await gerarRelatorioSemAniversarioExcel(clientes)
        }
      } else {
        if (formato === "pdf") {
          gerarRelatorioClientesPDF(clientes, { mes: config.mes, proximosDias: config.proximosDias })
        } else {
          await gerarRelatorioClientesExcel(clientes, { mes: config.mes, proximosDias: config.proximosDias })
        }
      }
    } catch (error) {
      console.error(`Erro ao gerar ${formato}:`, error)
      alert(`Erro ao gerar o relatório. Tente novamente.`)
    } finally {
      setIsGenerating(false)
    }
  }

  // ========== DOCUMENTOS PENDENTES ==========
  const buscarDocumentosPendentes = async (filtro: DocumentoFiltro): Promise<{
    clientes: ClienteDocumento[]
    totais: {
      totalClientes: number
      totalComFalta: number
      totalCompletos: number
      faltaRG: number
      faltaCNH: number
      faltaComprovante: number
    }
  }> => {
    const params = new URLSearchParams()
    if (filtro !== "todos") params.set("filtro", filtro)

    const response = await fetch(`/api/clientes/documentos-pendentes?${params}`)
    if (!response.ok) throw new Error("Erro ao buscar dados de documentos")
    return await response.json()
  }

  const handleDocumentoExport = async (formato: "pdf" | "excel", config: DocumentoExportConfig) => {
    setIsGenerating(true)
    try {
      const data = await buscarDocumentosPendentes(config.filtro)
      if (data.clientes.length === 0) {
        alert("Todos os clientes possuem a documentação completa!")
        return
      }

      if (formato === "pdf") {
        gerarRelatorioDocumentosPDF(data.clientes, data.totais, config.filtro)
      } else {
        await gerarRelatorioDocumentosExcel(data.clientes, data.totais, config.filtro)
      }
    } catch (error) {
      console.error(`Erro ao gerar ${formato}:`, error)
      alert(`Erro ao gerar o relatório. Tente novamente.`)
    } finally {
      setIsGenerating(false)
    }
  }

  // ========== NAVIGATION ==========
  const handleSelectFilter = (config: ExportConfig) => {
    setExportConfig(config)
    setMenuView("formatoExport")
  }

  const handleSelectMes = (mesIndex: number) => {
    handleSelectFilter({
      label: MESES[mesIndex],
      mes: mesIndex + 1,
    })
  }

  const handleSelectDocFiltro = (config: DocumentoExportConfig) => {
    setDocExportConfig(config)
    setMenuView("formatoDocumentos")
  }

  const resetMenu = () => {
    setMenuView("main")
    setExportConfig(null)
    setDocExportConfig(null)
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) resetMenu() }}>
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
            <FileBarChart className="mr-1 h-4 w-4" />
          )}
          Relatórios
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="bg-white border-gray-200 text-gray-900 w-64"
      >
        {/* ===== TELA PRINCIPAL ===== */}
        {menuView === "main" && (
          <>
            {/* --- Seção: Aniversariantes --- */}
            <DropdownMenuLabel className="text-gray-500 text-xs">
              🎂 Aniversariantes
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-gray-200" />

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectFilter({ label: "Próximos 30 dias", proximosDias: 30 })
              }}
            >
              <Calendar className="mr-2 h-4 w-4 text-indigo-500" />
              <span className="font-medium text-sm">Próximos 30 dias</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectFilter({ label: `${MESES[mesAtual - 1]} (mês atual)`, mes: mesAtual })
              }}
            >
              <Cake className="mr-2 h-4 w-4 text-pink-500" />
              <span className="font-medium text-sm">{MESES[mesAtual - 1]} (mês atual)</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                setMenuView("escolherMes")
              }}
            >
              <Calendar className="mr-2 h-4 w-4 text-blue-500" />
              <span className="font-medium text-sm">Escolher mês...</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectFilter({ label: "Todos os clientes" })
              }}
            >
              <Download className="mr-2 h-4 w-4 text-gray-500" />
              <span className="font-medium text-sm">Todos os clientes</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectFilter({ label: "Sem data de nascimento", semAniversario: true })
              }}
            >
              <AlertCircle className="mr-2 h-4 w-4 text-amber-500" />
              <span className="font-medium text-sm">Sem data de nascimento</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-gray-200" />

            {/* --- Seção: Documentos Pendentes --- */}
            <DropdownMenuLabel className="text-gray-500 text-xs">
              📄 Documentos Pendentes
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-gray-200" />

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                setMenuView("documentos")
              }}
            >
              <Shield className="mr-2 h-4 w-4 text-red-500" />
              <span className="font-medium text-sm">Documentos faltantes...</span>
            </DropdownMenuItem>
          </>
        )}

        {/* ===== TELA: ESCOLHER MÊS ===== */}
        {menuView === "escolherMes" && (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-indigo-600"
              onSelect={(e) => {
                e.preventDefault()
                setMenuView("main")
              }}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span className="font-medium text-sm">Voltar</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-200" />
            <DropdownMenuLabel className="text-gray-500 text-xs">
              Selecione o mês
            </DropdownMenuLabel>
            {MESES.map((nomeMes, index) => (
              <DropdownMenuItem
                key={index}
                className="cursor-pointer"
                onSelect={(e) => {
                  e.preventDefault()
                  handleSelectMes(index)
                }}
              >
                <span className={`text-sm ${index + 1 === mesAtual ? 'font-bold text-indigo-600' : ''}`}>
                  {nomeMes}
                  {index + 1 === mesAtual && ' ●'}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* ===== TELA: DOCUMENTOS - FILTROS ===== */}
        {menuView === "documentos" && (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-indigo-600"
              onSelect={(e) => {
                e.preventDefault()
                setMenuView("main")
              }}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span className="font-medium text-sm">Voltar</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-200" />
            <DropdownMenuLabel className="text-gray-500 text-xs">
              Filtrar por documento
            </DropdownMenuLabel>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectDocFiltro({ label: "Todos os documentos faltantes", filtro: "todos" })
              }}
            >
              <Shield className="mr-2 h-4 w-4 text-red-500" />
              <span className="font-medium text-sm">Todos os faltantes</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-gray-200" />

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectDocFiltro({ label: "Clientes sem RG", filtro: "RG" })
              }}
            >
              <CreditCard className="mr-2 h-4 w-4 text-blue-500" />
              <span className="font-medium text-sm">Sem RG</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectDocFiltro({ label: "Clientes sem CNH", filtro: "CNH" })
              }}
            >
              <Car className="mr-2 h-4 w-4 text-purple-500" />
              <span className="font-medium text-sm">Sem CNH</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault()
                handleSelectDocFiltro({ label: "Clientes sem Comprovante", filtro: "COMPROVANTE_ENDERECO" })
              }}
            >
              <Home className="mr-2 h-4 w-4 text-teal-500" />
              <span className="font-medium text-sm">Sem Comprovante de Endereço</span>
            </DropdownMenuItem>
          </>
        )}

        {/* ===== TELA: FORMATO EXPORT (ANIVERSARIANTES) ===== */}
        {menuView === "formatoExport" && exportConfig && (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-indigo-600"
              onSelect={(e) => {
                e.preventDefault()
                setMenuView("main")
              }}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span className="font-medium text-sm">Voltar</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-200" />
            <DropdownMenuLabel className="text-gray-500 text-xs">
              {exportConfig.label}
            </DropdownMenuLabel>

            <DropdownMenuItem
              className="cursor-pointer"
              disabled={isGenerating}
              onSelect={(e) => {
                e.preventDefault()
                handleExport("pdf", exportConfig)
              }}
            >
              <FileText className="mr-2 h-4 w-4 text-red-500" />
              <span className="font-medium text-sm">Exportar PDF</span>
              {isGenerating && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              disabled={isGenerating}
              onSelect={(e) => {
                e.preventDefault()
                handleExport("excel", exportConfig)
              }}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
              <span className="font-medium text-sm">Exportar Excel</span>
              {isGenerating && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
            </DropdownMenuItem>
          </>
        )}

        {/* ===== TELA: FORMATO EXPORT (DOCUMENTOS) ===== */}
        {menuView === "formatoDocumentos" && docExportConfig && (
          <>
            <DropdownMenuItem
              className="cursor-pointer text-indigo-600"
              onSelect={(e) => {
                e.preventDefault()
                setMenuView("documentos")
              }}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span className="font-medium text-sm">Voltar</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-200" />
            <DropdownMenuLabel className="text-gray-500 text-xs">
              {docExportConfig.label}
            </DropdownMenuLabel>

            <DropdownMenuItem
              className="cursor-pointer"
              disabled={isGenerating}
              onSelect={(e) => {
                e.preventDefault()
                handleDocumentoExport("pdf", docExportConfig)
              }}
            >
              <FileText className="mr-2 h-4 w-4 text-red-500" />
              <span className="font-medium text-sm">Exportar PDF</span>
              {isGenerating && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
            </DropdownMenuItem>

            <DropdownMenuItem
              className="cursor-pointer"
              disabled={isGenerating}
              onSelect={(e) => {
                e.preventDefault()
                handleDocumentoExport("excel", docExportConfig)
              }}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
              <span className="font-medium text-sm">Exportar Excel</span>
              {isGenerating && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}