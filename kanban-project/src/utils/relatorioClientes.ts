// ESTE ARQUIVO VAI EM: src/utils/relatorioClientes.ts

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import ExcelJS from "exceljs"

// ==============================
// TIPOS
// ==============================
export interface ClienteAniversario {
  id: number
  nome: string
  dataNascimento: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  estado: string | null
  tipo: "Contratante" | "Requerente"
  processos: Array<{
    id: number
    nome: string
    pais: string
  }>
}

export interface ClienteDocumento {
  id: number
  tipo: "Contratante" | "Requerente"
  nome: string
  cpf: string | null
  telefone: string | null
  email: string | null
  temRG: boolean
  temCNH: boolean
  temComprovante: boolean
  documentosFaltantes: string[]
  totalFaltantes: number
  processos: Array<{
    id: number
    nome: string
    pais: string
  }>
}

interface FiltrosRelatorio {
  mes?: number | null
  proximosDias?: number | null
}

interface TotaisDocumentos {
  totalClientes: number
  totalComFalta: number
  totalCompletos: number
  faltaRG: number
  faltaCNH: number
  faltaComprovante: number
}

// ==============================
// HELPERS
// ==============================
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
]

function formatarData(dateStr: string | null): string {
  if (!dateStr) return "—"
  const d = new Date(dateStr)
  const dia = String(d.getUTCDate()).padStart(2, "0")
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0")
  const ano = d.getUTCFullYear()
  return `${dia}/${mes}/${ano}`
}

function calcularIdade(dateStr: string | null): number | null {
  if (!dateStr) return null
  const nascimento = new Date(dateStr)
  const hoje = new Date()
  let idade = hoje.getFullYear() - nascimento.getUTCFullYear()
  const mesAtual = hoje.getMonth()
  const mesNasc = nascimento.getUTCMonth()
  if (mesAtual < mesNasc || (mesAtual === mesNasc && hoje.getDate() < nascimento.getUTCDate())) {
    idade--
  }
  return idade
}

function diasParaAniversario(dateStr: string | null): number | null {
  if (!dateStr) return null
  const nascimento = new Date(dateStr)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const proximoAniversario = new Date(
    hoje.getFullYear(),
    nascimento.getUTCMonth(),
    nascimento.getUTCDate()
  )
  if (proximoAniversario < hoje) {
    proximoAniversario.setFullYear(hoje.getFullYear() + 1)
  }
  const diffTime = proximoAniversario.getTime() - hoje.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

function getDescricaoFiltro(filtros?: FiltrosRelatorio): string {
  if (!filtros) return "Todos os clientes com data de nascimento"
  if (filtros.mes) return `Aniversariantes de ${MESES[filtros.mes - 1]}`
  if (filtros.proximosDias) return `Aniversariantes nos próximos ${filtros.proximosDias} dias`
  return "Todos os clientes com data de nascimento"
}

function getDataGeracao(): string {
  return new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getDescricaoFiltroDocumento(filtro: string): string {
  switch (filtro) {
    case "RG": return "Clientes sem RG cadastrado"
    case "CNH": return "Clientes sem CNH cadastrada"
    case "COMPROVANTE_ENDERECO": return "Clientes sem Comprovante de Endereço"
    default: return "Clientes com documentos faltantes"
  }
}

function downloadBlob(buffer: ArrayBuffer | ExcelJS.Buffer, filename: string, mimeType: string) {
  const blob = new Blob([buffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ============================
// PDF - ANIVERSARIANTES
// ============================
export function gerarRelatorioClientesPDF(
  clientes: ClienteAniversario[],
  filtros?: FiltrosRelatorio
) {
  const doc = new jsPDF({ orientation: "landscape" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const dataGeracao = getDataGeracao()

  // Título
  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text("Relatório de Clientes — Aniversariantes", 14, 20)

  // Subtítulo
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100)
  doc.text(getDescricaoFiltro(filtros), 14, 28)
  doc.text(`Gerado em: ${dataGeracao}`, pageWidth - 14, 28, { align: "right" })

  // Resumo
  const totalContratantes = clientes.filter((c) => c.tipo === "Contratante").length
  const totalRequerentes = clientes.filter((c) => c.tipo === "Requerente").length
  const aniversariantesHoje = clientes.filter((c) => diasParaAniversario(c.dataNascimento) === 0).length

  doc.setFontSize(9)
  doc.setTextColor(0)
  doc.setFont("helvetica", "bold")

  const resumoY = 35
  const resumoTextos = [
    `Total: ${clientes.length}`,
    `Contratantes: ${totalContratantes}`,
    `Requerentes: ${totalRequerentes}`,
    `Aniversariantes hoje: ${aniversariantesHoje}`,
  ]

  let xPos = 14
  resumoTextos.forEach((texto) => {
    const textWidth = doc.getTextWidth(texto) + 8
    doc.setFillColor(240, 240, 250)
    doc.roundedRect(xPos - 2, resumoY - 4, textWidth, 7, 1, 1, "F")
    doc.text(texto, xPos + 2, resumoY)
    xPos += textWidth + 4
  })

  // Tabela
  const dadosTabela = clientes.map((c) => {
    const dias = diasParaAniversario(c.dataNascimento)
    const idade = calcularIdade(c.dataNascimento)
    return [
      c.nome,
      c.tipo,
      formatarData(c.dataNascimento),
      idade !== null ? `${idade} anos` : "—",
      dias === 0 ? "HOJE!" : dias !== null ? `${dias} dias` : "—",
      c.telefone || "—",
      c.email || "—",
      c.processos.map((p) => p.nome).join(", ") || "—",
    ]
  })

  autoTable(doc, {
    startY: resumoY + 8,
    head: [["Nome", "Tipo", "Nascimento", "Idade", "Próx. Aniv.", "Telefone", "E-mail", "Processos"]],
    body: dadosTabela,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [245, 245, 255] },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 25 },
      2: { cellWidth: 25 },
      3: { cellWidth: 18 },
      4: { cellWidth: 22 },
      5: { cellWidth: 30 },
      6: { cellWidth: 45 },
      7: { cellWidth: "auto" },
    },
    didParseCell: (data: any) => {
      if (data.section === "body" && data.column.index === 4) {
        const cellText = data.cell.text.join("")
        if (cellText.includes("HOJE")) {
          data.cell.styles.textColor = [22, 163, 74]
          data.cell.styles.fontStyle = "bold"
        }
      }
    },
  })

  // Rodapé
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: "center" }
    )
  }

  const nomeArquivo = filtros?.mes
    ? `relatorio-aniversariantes-${MESES[filtros.mes - 1].toLowerCase()}.pdf`
    : "relatorio-clientes-aniversariantes.pdf"
  doc.save(nomeArquivo)
}

// ============================
// PDF - SEM DATA DE NASCIMENTO
// ============================
export function gerarRelatorioSemAniversarioPDF(clientes: ClienteAniversario[]) {
  const doc = new jsPDF({ orientation: "landscape" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const dataGeracao = getDataGeracao()

  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text("Clientes Sem Data de Nascimento", 14, 20)

  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100)
  doc.text("Clientes que precisam ter a data de nascimento cadastrada", 14, 28)
  doc.text(`Gerado em: ${dataGeracao}`, pageWidth - 14, 28, { align: "right" })

  const totalContratantes = clientes.filter((c) => c.tipo === "Contratante").length
  const totalRequerentes = clientes.filter((c) => c.tipo === "Requerente").length

  doc.setFontSize(9)
  doc.setTextColor(0)
  doc.setFont("helvetica", "bold")

  const resumoY = 35
  const resumoTextos = [
    `Total sem data: ${clientes.length}`,
    `Contratantes: ${totalContratantes}`,
    `Requerentes: ${totalRequerentes}`,
  ]

  let xPos = 14
  resumoTextos.forEach((texto) => {
    const textWidth = doc.getTextWidth(texto) + 8
    doc.setFillColor(255, 243, 224)
    doc.roundedRect(xPos - 2, resumoY - 4, textWidth, 7, 1, 1, "F")
    doc.text(texto, xPos + 2, resumoY)
    xPos += textWidth + 4
  })

  const dadosTabela = clientes.map((c) => [
    c.nome,
    c.tipo,
    c.telefone || "—",
    c.email || "—",
    c.cidade && c.estado ? `${c.cidade}/${c.estado}` : c.cidade || c.estado || "—",
    c.processos.map((p) => p.nome).join(", ") || "—",
  ])

  autoTable(doc, {
    startY: resumoY + 8,
    head: [["Nome", "Tipo", "Telefone", "E-mail", "Cidade/UF", "Processos"]],
    body: dadosTabela,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: {
      fillColor: [217, 119, 6],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 25 },
      2: { cellWidth: 30 },
      3: { cellWidth: 50 },
      4: { cellWidth: 35 },
      5: { cellWidth: "auto" },
    },
  })

  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: "center" }
    )
  }

  doc.save("relatorio-clientes-sem-data-nascimento.pdf")
}

// ============================
// PDF - DOCUMENTOS PENDENTES
// ============================
export function gerarRelatorioDocumentosPDF(
  clientes: ClienteDocumento[],
  totais: TotaisDocumentos,
  filtro: string
) {
  const doc = new jsPDF({ orientation: "landscape" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const dataGeracao = getDataGeracao()

  // Título
  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text("Relatório de Documentos Pendentes", 14, 20)

  // Subtítulo
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100)
  doc.text(getDescricaoFiltroDocumento(filtro), 14, 28)
  doc.text(`Gerado em: ${dataGeracao}`, pageWidth - 14, 28, { align: "right" })

  // Resumo com badges
  doc.setFontSize(9)
  doc.setTextColor(0)
  doc.setFont("helvetica", "bold")

  const resumoY = 35
  const resumoTextos = [
    `Total clientes: ${totais.totalClientes}`,
    `Com pendência: ${totais.totalComFalta}`,
    `Completos: ${totais.totalCompletos}`,
    `Sem RG: ${totais.faltaRG}`,
    `Sem CNH: ${totais.faltaCNH}`,
    `Sem Comprov.: ${totais.faltaComprovante}`,
  ]

  let xPos = 14
  resumoTextos.forEach((texto, idx) => {
    const textWidth = doc.getTextWidth(texto) + 8
    // Vermelho para pendências, verde para completos
    if (idx === 2) {
      doc.setFillColor(220, 252, 231) // green-100
    } else if (idx >= 3) {
      doc.setFillColor(254, 226, 226) // red-100
    } else {
      doc.setFillColor(240, 240, 250) // indigo-50
    }
    doc.roundedRect(xPos - 2, resumoY - 4, textWidth, 7, 1, 1, "F")
    doc.text(texto, xPos + 2, resumoY)
    xPos += textWidth + 4
  })

  // Tabela
  const dadosTabela = clientes.map((c) => [
    c.nome,
    c.tipo,
    c.temRG ? "Sim" : "Nao",
    c.temCNH ? "Sim" : "Nao",
    c.temComprovante ? "Sim" : "Nao",
    c.documentosFaltantes.join(", "),
    c.telefone || "-",
    c.processos.map((p) => p.nome).join(", ") || "-",
  ])

  autoTable(doc, {
    startY: resumoY + 8,
    head: [["Nome", "Tipo", "RG", "CNH", "Comprov.", "Docs Faltantes", "Telefone", "Processos"]],
    body: dadosTabela,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: {
      fillColor: [185, 28, 28], // red-700
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [254, 242, 242] }, // red-50
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 22 },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 50 },
      6: { cellWidth: 30 },
      7: { cellWidth: "auto" },
    },
    didParseCell: (data: any) => {
      if (data.section === "body") {
        // Colunas RG, CNH, Comprovante (2, 3, 4)
        if ([2, 3, 4].includes(data.column.index)) {
          const cellText = data.cell.text.join("")
          if (cellText === "Sim") {
            data.cell.styles.textColor = [22, 163, 74] // green
            data.cell.styles.fontStyle = "bold"
          } else if (cellText === "Nao") {
            data.cell.styles.textColor = [220, 38, 38] // red
            data.cell.styles.fontStyle = "bold"
          }
        }
      }
    },
  })

  // Rodapé
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: "center" }
    )
  }

  const nomeArquivo = filtro !== "todos"
    ? `relatorio-documentos-sem-${filtro.toLowerCase().replace("_", "-")}.pdf`
    : "relatorio-documentos-pendentes.pdf"
  doc.save(nomeArquivo)
}

// ============================
// EXCEL - ANIVERSARIANTES
// ============================
export async function gerarRelatorioClientesExcel(
  clientes: ClienteAniversario[],
  filtros?: FiltrosRelatorio
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Sistema de Cidadania"
  workbook.created = new Date()

  // ABA 1: ANIVERSARIANTES
  const ws = workbook.addWorksheet("Aniversariantes")

  ws.mergeCells("A1:H1")
  const titleCell = ws.getCell("A1")
  titleCell.value = "Relatório de Clientes — Aniversariantes"
  titleCell.font = { size: 16, bold: true, color: { argb: "FF4F46E5" } }
  titleCell.alignment = { horizontal: "left", vertical: "middle" }
  ws.getRow(1).height = 30

  ws.mergeCells("A2:H2")
  ws.getCell("A2").value = `${getDescricaoFiltro(filtros)} — Gerado em: ${new Date().toLocaleDateString("pt-BR")}`
  ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } }

  const totalContratantes = clientes.filter((c) => c.tipo === "Contratante").length
  const totalRequerentes = clientes.filter((c) => c.tipo === "Requerente").length
  ws.mergeCells("A3:H3")
  ws.getCell("A3").value = `Total: ${clientes.length} | Contratantes: ${totalContratantes} | Requerentes: ${totalRequerentes}`
  ws.getCell("A3").font = { size: 10, bold: true }

  const headerRow = ws.addRow(["Nome", "Tipo", "Data de Nascimento", "Idade", "Próx. Aniversário (dias)", "Telefone", "E-mail", "Processos"])
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } }
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }
    cell.alignment = { horizontal: "center", vertical: "middle" }
    cell.border = { bottom: { style: "thin", color: { argb: "FF3730A3" } } }
  })

  clientes.forEach((c) => {
    const dias = diasParaAniversario(c.dataNascimento)
    const idade = calcularIdade(c.dataNascimento)
    const row = ws.addRow([
      c.nome,
      c.tipo,
      c.dataNascimento ? formatarData(c.dataNascimento) : "",
      idade,
      dias,
      c.telefone || "",
      c.email || "",
      c.processos.map((p) => p.nome).join(", ") || "",
    ])
    if (dias === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } }
      })
      row.getCell(5).font = { bold: true, color: { argb: "FF16A34A" } }
    } else if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5FF" } }
      })
    }
  })

  ws.getColumn(1).width = 35
  ws.getColumn(2).width = 15
  ws.getColumn(3).width = 18
  ws.getColumn(4).width = 10
  ws.getColumn(5).width = 22
  ws.getColumn(6).width = 18
  ws.getColumn(7).width = 30
  ws.getColumn(8).width = 40

  // ABA 2: POR MÊS
  const wsMes = workbook.addWorksheet("Por Mês")
  wsMes.mergeCells("A1:C1")
  wsMes.getCell("A1").value = "Aniversariantes por Mês"
  wsMes.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF4F46E5" } }

  const headerMes = wsMes.addRow(["Mês", "Quantidade", "Nomes"])
  headerMes.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } }
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
  })

  MESES.forEach((nomeMes, index) => {
    const clientesDoMes = clientes.filter((c) => {
      if (!c.dataNascimento) return false
      return new Date(c.dataNascimento).getUTCMonth() === index
    })
    wsMes.addRow([nomeMes, clientesDoMes.length, clientesDoMes.map((c) => c.nome).join(", ")])
  })

  wsMes.getColumn(1).width = 15
  wsMes.getColumn(2).width = 12
  wsMes.getColumn(3).width = 80

  const buffer = await workbook.xlsx.writeBuffer()
  const nomeArquivo = filtros?.mes
    ? `relatorio-aniversariantes-${MESES[(filtros.mes || 1) - 1].toLowerCase()}.xlsx`
    : "relatorio-clientes-aniversariantes.xlsx"
  downloadBlob(buffer, nomeArquivo, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
}

// ============================
// EXCEL - SEM DATA DE NASCIMENTO
// ============================
export async function gerarRelatorioSemAniversarioExcel(clientes: ClienteAniversario[]) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Sistema de Cidadania"
  workbook.created = new Date()

  const ws = workbook.addWorksheet("Sem Data de Nascimento")

  ws.mergeCells("A1:F1")
  const titleCell = ws.getCell("A1")
  titleCell.value = "Clientes Sem Data de Nascimento"
  titleCell.font = { size: 16, bold: true, color: { argb: "FFD97706" } }
  titleCell.alignment = { horizontal: "left", vertical: "middle" }
  ws.getRow(1).height = 30

  ws.mergeCells("A2:F2")
  ws.getCell("A2").value = `Clientes que precisam ter a data de nascimento cadastrada — Gerado em: ${new Date().toLocaleDateString("pt-BR")}`
  ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } }

  const totalContratantes = clientes.filter((c) => c.tipo === "Contratante").length
  const totalRequerentes = clientes.filter((c) => c.tipo === "Requerente").length
  ws.mergeCells("A3:F3")
  ws.getCell("A3").value = `Total sem data: ${clientes.length} | Contratantes: ${totalContratantes} | Requerentes: ${totalRequerentes}`
  ws.getCell("A3").font = { size: 10, bold: true }

  const headerRow = ws.addRow(["Nome", "Tipo", "Telefone", "E-mail", "Cidade/UF", "Processos"])
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD97706" } }
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }
    cell.alignment = { horizontal: "center", vertical: "middle" }
    cell.border = { bottom: { style: "thin", color: { argb: "FFB45309" } } }
  })

  clientes.forEach((c) => {
    const row = ws.addRow([
      c.nome,
      c.tipo,
      c.telefone || "",
      c.email || "",
      c.cidade && c.estado ? `${c.cidade}/${c.estado}` : c.cidade || c.estado || "",
      c.processos.map((p) => p.nome).join(", ") || "",
    ])
    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } }
      })
    }
  })

  ws.getColumn(1).width = 40
  ws.getColumn(2).width = 15
  ws.getColumn(3).width = 20
  ws.getColumn(4).width = 35
  ws.getColumn(5).width = 25
  ws.getColumn(6).width = 45

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(buffer, "relatorio-clientes-sem-data-nascimento.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
}

// ============================
// EXCEL - DOCUMENTOS PENDENTES
// ============================
export async function gerarRelatorioDocumentosExcel(
  clientes: ClienteDocumento[],
  totais: TotaisDocumentos,
  filtro: string
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Sistema de Cidadania"
  workbook.created = new Date()

  // ABA 1: CLIENTES COM DOCUMENTOS FALTANTES
  const ws = workbook.addWorksheet("Documentos Pendentes")

  ws.mergeCells("A1:H1")
  const titleCell = ws.getCell("A1")
  titleCell.value = "Relatório de Documentos Pendentes"
  titleCell.font = { size: 16, bold: true, color: { argb: "FFB91C1C" } } // red-700
  titleCell.alignment = { horizontal: "left", vertical: "middle" }
  ws.getRow(1).height = 30

  ws.mergeCells("A2:H2")
  ws.getCell("A2").value = `${getDescricaoFiltroDocumento(filtro)} — Gerado em: ${new Date().toLocaleDateString("pt-BR")}`
  ws.getCell("A2").font = { size: 10, color: { argb: "FF666666" } }

  ws.mergeCells("A3:H3")
  ws.getCell("A3").value = `Total clientes: ${totais.totalClientes} | Com pendência: ${totais.totalComFalta} | Completos: ${totais.totalCompletos} | Sem RG: ${totais.faltaRG} | Sem CNH: ${totais.faltaCNH} | Sem Comprov.: ${totais.faltaComprovante}`
  ws.getCell("A3").font = { size: 10, bold: true }

  const headerRow = ws.addRow(["Nome", "Tipo", "RG", "CNH", "Comprov. Endereço", "Docs Faltantes", "Telefone", "Processos"])
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } }
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }
    cell.alignment = { horizontal: "center", vertical: "middle" }
    cell.border = { bottom: { style: "thin", color: { argb: "FF991B1B" } } }
  })

  clientes.forEach((c) => {
    const row = ws.addRow([
      c.nome,
      c.tipo,
      c.temRG ? "✓ Enviado" : "✗ Faltando",
      c.temCNH ? "✓ Enviado" : "✗ Faltando",
      c.temComprovante ? "✓ Enviado" : "✗ Faltando",
      c.documentosFaltantes.join(", "),
      c.telefone || "",
      c.processos.map((p) => p.nome).join(", ") || "",
    ])

    // Colorir células de status
    const applyStatusStyle = (cellNum: number, ok: boolean) => {
      const cell = row.getCell(cellNum)
      if (ok) {
        cell.font = { bold: true, color: { argb: "FF16A34A" } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } }
      } else {
        cell.font = { bold: true, color: { argb: "FFDC2626" } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } }
      }
      cell.alignment = { horizontal: "center" }
    }

    applyStatusStyle(3, c.temRG)
    applyStatusStyle(4, c.temCNH)
    applyStatusStyle(5, c.temComprovante)

    // Linhas alternadas para colunas sem status
    if (row.number % 2 === 0) {
      ;[1, 2, 6, 7, 8].forEach((colNum) => {
        row.getCell(colNum).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFEF2F2" },
        }
      })
    }
  })

  ws.getColumn(1).width = 40
  ws.getColumn(2).width = 15
  ws.getColumn(3).width = 15
  ws.getColumn(4).width = 15
  ws.getColumn(5).width = 20
  ws.getColumn(6).width = 35
  ws.getColumn(7).width = 18
  ws.getColumn(8).width = 40

  // ABA 2: RESUMO POR DOCUMENTO
  const wsResumo = workbook.addWorksheet("Resumo")
  wsResumo.mergeCells("A1:C1")
  wsResumo.getCell("A1").value = "Resumo de Documentos por Status"
  wsResumo.getCell("A1").font = { size: 14, bold: true, color: { argb: "FFB91C1C" } }

  const headerResumo = wsResumo.addRow(["Documento", "Enviados", "Faltantes"])
  headerResumo.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB91C1C" } }
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
    cell.alignment = { horizontal: "center" }
  })

  const dadosResumo = [
    ["RG", totais.totalClientes - totais.faltaRG, totais.faltaRG],
    ["CNH", totais.totalClientes - totais.faltaCNH, totais.faltaCNH],
    ["Comprovante de Endereço", totais.totalClientes - totais.faltaComprovante, totais.faltaComprovante],
  ]

  dadosResumo.forEach(([doc, enviados, faltantes]) => {
    const row = wsResumo.addRow([doc, enviados, faltantes])
    // Verde para enviados, vermelho para faltantes
    row.getCell(2).font = { bold: true, color: { argb: "FF16A34A" } }
    row.getCell(2).alignment = { horizontal: "center" }
    row.getCell(3).font = { bold: true, color: { argb: "FFDC2626" } }
    row.getCell(3).alignment = { horizontal: "center" }
  })

  wsResumo.addRow([])
  const totalRow = wsResumo.addRow(["TOTAL", "", ""])
  wsResumo.mergeCells(`A${totalRow.number}:C${totalRow.number}`)
  totalRow.getCell(1).value = `Total de clientes: ${totais.totalClientes} | Completos: ${totais.totalCompletos} | Com pendência: ${totais.totalComFalta}`
  totalRow.getCell(1).font = { size: 11, bold: true }

  wsResumo.getColumn(1).width = 30
  wsResumo.getColumn(2).width = 15
  wsResumo.getColumn(3).width = 15

  const buffer = await workbook.xlsx.writeBuffer()
  const nomeArquivo = filtro !== "todos"
    ? `relatorio-documentos-sem-${filtro.toLowerCase().replace("_", "-")}.xlsx`
    : "relatorio-documentos-pendentes.xlsx"
  downloadBlob(buffer, nomeArquivo, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
}