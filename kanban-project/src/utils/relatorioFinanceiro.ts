// src/utils/relatorioFinanceiro.ts
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

// ============================================
// TIPOS
// ============================================

interface FaturaRelatorio {
  id: number
  descricao: string
  moeda: string
  valor: number
  valorPago: number
  valorRestante: number
  valorTotalBRL: number
  valorPagoBRL: number
  valorRestanteBRL: number
  vencidoBRL: number
  pendenteBRL: number
  cambio: number
  status: string
  metodoPagamento: string | null
  parcelas: number
  dataEmissao: string
  dataVencimento: string | null
  processo: {
    id: number
    nome: string
    pais: string
    statusNome: string
  } | null
  destinatarios: { id: number; nome: string }[]
}

interface TotaisGeralBRL {
  total: number
  pago: number
  pendente: number
  vencido: number
}

interface ProcessoResumo {
  id: number
  nome: string
  pais: string
  totalBRL: number
  pagoBRL: number
  pendenteBRL: number
  vencidoBRL: number
  qtdFaturas: number
}

interface DadosFinanceiro {
  faturas: FaturaRelatorio[]
  totaisGeralBRL: TotaisGeralBRL
  totaisPorMoeda: Record<string, { total: number; pago: number; pendente: number; vencido: number }>
  porProcesso: ProcessoResumo[]
}

interface FiltrosFinanceiro {
  pais?: string
  status?: string
  moeda?: string
  dataInicio?: string
  dataFim?: string
}

const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal',
  ESPANHA: 'Espanha',
  ALEMANHA: 'Alemanha',
  ITALIA: 'Itália'
}

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: 'Pendente',
  PAGO: 'Pago',
  VENCIDO: 'Vencido',
  PARCIAL: 'Parcial'
}

const MOEDA_SIMBOLO: Record<string, string> = {
  BRL: 'R$',
  EUR: '€',
  USD: 'US$'
}

// ============================================
// HELPERS
// ============================================

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatCurrency(valor: number, moeda: string = 'BRL'): string {
  const simbolo = MOEDA_SIMBOLO[moeda] || moeda
  return `${simbolo} ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCurrencyBRL(valor: number): string {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ============================================
// GERAÇÃO DE PDF
// ============================================

export function gerarRelatorioFinanceiroPDF(dados: DadosFinanceiro, filtrosAtivos?: FiltrosFinanceiro) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const hoje = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  // ---- HEADER ----
  doc.setFillColor(30, 58, 95) // dark blue
  doc.rect(0, 0, pageWidth, 28, 'F')
  
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Relatório Financeiro', 14, 12)
  
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Grupo Discovery | Gerado em ${hoje}`, 14, 20)
  doc.text(`${dados.faturas.length} fatura(s)`, pageWidth - 14, 20, { align: 'right' })

  // ---- RESUMO CARDS ----
  const t = dados.totaisGeralBRL
  const resumoY = 36
  const boxWidth = 60
  const boxHeight = 22
  const gap = 8
  const startX = (pageWidth - (4 * boxWidth + 3 * gap)) / 2

  const resumoBoxes = [
    { label: 'Total Geral (BRL)', valor: formatCurrencyBRL(t.total), cor: [30, 58, 95] },
    { label: 'Recebido', valor: formatCurrencyBRL(t.pago), cor: [34, 197, 94] },
    { label: 'Pendente', valor: formatCurrencyBRL(t.pendente), cor: [245, 158, 11] },
    { label: 'Vencido', valor: formatCurrencyBRL(t.vencido), cor: [239, 68, 68] },
  ]

  resumoBoxes.forEach((box, i) => {
    const x = startX + i * (boxWidth + gap)
    doc.setFillColor(box.cor[0], box.cor[1], box.cor[2])
    doc.roundedRect(x, resumoY, boxWidth, boxHeight, 2, 2, 'F')
    
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(box.valor, x + boxWidth / 2, resumoY + 10, { align: 'center' })
    
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.text(box.label, x + boxWidth / 2, resumoY + 18, { align: 'center' })
  })

  // ---- TOTAIS POR MOEDA (abaixo dos cards) ----
  let nextY = resumoY + boxHeight + 8
  const moedas = Object.entries(dados.totaisPorMoeda)
  if (moedas.length > 1 || (moedas.length === 1 && moedas[0][0] !== 'BRL')) {
    doc.setTextColor(80, 80, 80)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    const moedaTexts = moedas.map(([m, v]) => 
      `${m}: Total ${formatCurrency(v.total, m)} | Recebido ${formatCurrency(v.pago, m)} | Pendente ${formatCurrency(v.pendente, m)}`
    )
    doc.text(moedaTexts.join('   •   '), 14, nextY)
    nextY += 5
  }

  // ---- FILTROS ----
  const filtrosTexto: string[] = []
  if (filtrosAtivos?.pais && filtrosAtivos.pais !== 'all') filtrosTexto.push(`País: ${PAIS_LABELS[filtrosAtivos.pais] || filtrosAtivos.pais}`)
  if (filtrosAtivos?.status && filtrosAtivos.status !== 'all') filtrosTexto.push(`Status: ${STATUS_LABELS[filtrosAtivos.status] || filtrosAtivos.status}`)
  if (filtrosAtivos?.moeda && filtrosAtivos.moeda !== 'all') filtrosTexto.push(`Moeda: ${filtrosAtivos.moeda}`)
  if (filtrosAtivos?.dataInicio) filtrosTexto.push(`De: ${formatDate(filtrosAtivos.dataInicio)}`)
  if (filtrosAtivos?.dataFim) filtrosTexto.push(`Até: ${formatDate(filtrosAtivos.dataFim)}`)

  if (filtrosTexto.length > 0) {
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    doc.text(`Filtros: ${filtrosTexto.join(' | ')}`, 14, nextY)
    nextY += 5
  }

  // ---- TABELA DE FATURAS ----
  const headers = ['Família/Processo', 'País', 'Descrição', 'Moeda', 'Valor', 'Pago', 'Restante', 'Vencimento', 'Status', 'Destinatários']
  const body = dados.faturas.map(f => [
    f.processo?.nome || '-',
    PAIS_LABELS[f.processo?.pais || ''] || '-',
    f.descricao,
    f.moeda,
    formatCurrency(f.valor, f.moeda),
    formatCurrency(f.valorPago, f.moeda),
    formatCurrency(f.valorRestante, f.moeda),
    formatDate(f.dataVencimento),
    STATUS_LABELS[f.status] || f.status,
    f.destinatarios.map(d => d.nome).join(', ') || '-'
  ])

  autoTable(doc, {
    startY: nextY + 2,
    head: [headers],
    body: body,
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold', halign: 'left' },
    bodyStyles: { fontSize: 7, textColor: [30, 30, 30], cellPadding: 2 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 32 },  // Família
      1: { cellWidth: 18 },  // País
      2: { cellWidth: 35 },  // Descrição
      3: { cellWidth: 14 },  // Moeda
      4: { cellWidth: 24, halign: 'right' },  // Valor
      5: { cellWidth: 24, halign: 'right' },  // Pago
      6: { cellWidth: 24, halign: 'right' },  // Restante
      7: { cellWidth: 22 },  // Vencimento
      8: { cellWidth: 18 },  // Status
      9: { cellWidth: 38 },  // Destinatários
    },
    didParseCell: (data: any) => {
      if (data.column.index === 8 && data.section === 'body') {
        const val = data.cell.raw as string
        if (val === 'Vencido') { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold' }
        else if (val === 'Pago') { data.cell.styles.textColor = [22, 163, 74]; data.cell.styles.fontStyle = 'bold' }
        else if (val === 'Parcial') { data.cell.styles.textColor = [217, 119, 6]; data.cell.styles.fontStyle = 'bold' }
        else if (val === 'Pendente') { data.cell.styles.textColor = [30, 58, 95]; data.cell.styles.fontStyle = 'bold' }
      }
    },
    margin: { left: 14, right: 14 },
  })

  // ---- RODAPÉ ----
  const totalPages = (doc as any).getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.setFont('helvetica', 'normal')
    doc.text('Grupo Discovery - Sistema de Gestão de Projetos', 14, pageHeight - 8)
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' })
  }

  doc.save(`relatorio-financeiro-${new Date().toISOString().split('T')[0]}.pdf`)
}

// ============================================
// GERAÇÃO DE EXCEL (ExcelJS)
// ============================================

const COLORS = {
  headerBg: '1E3A5F',
  headerText: 'FFFFFF',
  titleBg: '0F172A',
  subtitleText: '94A3B8',
  totalBg: '1E3A5F',
  recebidoBg: '22C55E',
  pendenteBg: 'F59E0B',
  vencidoBg: 'EF4444',
  recebidoLight: 'DCFCE7',
  pendenteLight: 'FEF3C7',
  vencidoLight: 'FEE2E2',
  pagoLight: 'DCFCE7',
  parcialLight: 'FEF3C7',
  recebidoText: '16A34A',
  pendenteText: 'D97706',
  vencidoText: 'DC2626',
  pagoText: '16A34A',
  parcialText: 'D97706',
  borderColor: 'E2E8F0',
  altRow: 'F8FAFC',
  white: 'FFFFFF',
  textDark: '1E293B',
  textMuted: '64748B',
}

function applyHeaderStyle(row: ExcelJS.Row, colCount: number) {
  row.height = 28
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i)
    cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 10, name: 'Arial' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } }
  }
}

function applyDataRowStyle(row: ExcelJS.Row, colCount: number, rowIndex: number, statusColIndex?: number) {
  row.height = 22
  const isAlt = rowIndex % 2 === 0
  
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i)
    cell.font = { size: 9.5, name: 'Arial', color: { argb: COLORS.textDark } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? COLORS.altRow : COLORS.white } }
    cell.border = { bottom: { style: 'thin', color: { argb: COLORS.borderColor } } }
  }

  if (statusColIndex) {
    const statusCell = row.getCell(statusColIndex)
    const statusVal = String(statusCell.value || '')
    
    const statusMap: Record<string, { text: string; light: string }> = {
      'Vencido': { text: COLORS.vencidoText, light: COLORS.vencidoLight },
      'Pago': { text: COLORS.pagoText, light: COLORS.pagoLight },
      'Parcial': { text: COLORS.parcialText, light: COLORS.parcialLight },
      'Pendente': { text: COLORS.headerBg, light: 'EFF6FF' },
    }
    
    const style = statusMap[statusVal]
    if (style) {
      statusCell.font = { bold: true, size: 9.5, name: 'Arial', color: { argb: style.text } }
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.light } }
    }
  }
}

function addResumoCard(ws: ExcelJS.Worksheet, cell: string, valor: string, label: string, corBg: string) {
  const c = ws.getCell(cell)
  c.value = valor
  c.font = { bold: true, size: 14, color: { argb: COLORS.white }, name: 'Arial' }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corBg } }
  c.alignment = { horizontal: 'center', vertical: 'middle' }
  c.border = {
    top: { style: 'medium', color: { argb: corBg } },
    bottom: { style: 'thin', color: { argb: corBg } },
    left: { style: 'medium', color: { argb: corBg } },
    right: { style: 'medium', color: { argb: corBg } },
  }

  const row = Number(cell.replace(/[A-Z]/g, ''))
  const col = cell.replace(/[0-9]/g, '')
  const labelCell = ws.getCell(`${col}${row + 1}`)
  labelCell.value = label
  labelCell.font = { size: 9, color: { argb: COLORS.white }, name: 'Arial' }
  labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corBg } }
  labelCell.alignment = { horizontal: 'center', vertical: 'top' }
  labelCell.border = {
    bottom: { style: 'medium', color: { argb: corBg } },
    left: { style: 'medium', color: { argb: corBg } },
    right: { style: 'medium', color: { argb: corBg } },
  }
}

function criarAbaFaturas(wb: ExcelJS.Workbook, nomeAba: string, faturas: FaturaRelatorio[], tabColor?: string) {
  const ws = wb.addWorksheet(nomeAba, {
    properties: { tabColor: tabColor ? { argb: tabColor } : undefined }
  })

  const headers = ['Família', 'País', 'Descrição', 'Moeda', 'Valor', 'Pago', 'Restante', 'Valor BRL', 'Emissão', 'Vencimento', 'Status', 'Destinatários']
  const colWidths = [25, 12, 30, 8, 16, 16, 16, 18, 14, 14, 12, 30]

  ws.columns = headers.map((h, i) => ({ header: h, width: colWidths[i] }))

  const headerRow = ws.getRow(1)
  applyHeaderStyle(headerRow, headers.length)

  // Alinhar colunas de valor à direita no header
  for (const colIdx of [5, 6, 7, 8]) {
    headerRow.getCell(colIdx).alignment = { vertical: 'middle', horizontal: 'right' }
  }

  faturas.forEach((f, idx) => {
    const row = ws.addRow([
      f.processo?.nome || '-',
      PAIS_LABELS[f.processo?.pais || ''] || '-',
      f.descricao,
      f.moeda,
      f.valor,
      f.valorPago,
      f.valorRestante,
      f.valorTotalBRL,
      formatDate(f.dataEmissao),
      formatDate(f.dataVencimento),
      STATUS_LABELS[f.status] || f.status,
      f.destinatarios.map(d => d.nome).join(', ') || '-'
    ])
    applyDataRowStyle(row, headers.length, idx, 11) // coluna 11 = Status

    // Formato moeda para colunas de valor
    const fmt = f.moeda === 'EUR' ? '#,##0.00 "€"' : f.moeda === 'USD' ? '"US$" #,##0.00' : '"R$" #,##0.00'
    for (const colIdx of [5, 6, 7]) {
      row.getCell(colIdx).numFmt = fmt
      row.getCell(colIdx).alignment = { vertical: 'middle', horizontal: 'right' }
    }
    row.getCell(8).numFmt = '"R$" #,##0.00'
    row.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' }
  })

  // Total row
  if (faturas.length > 0) {
    const emptyRow = ws.addRow([])
    emptyRow.height = 8
    
    const totalBRL = faturas.reduce((s, f) => s + f.valorTotalBRL, 0)
    const pagoBRL = faturas.reduce((s, f) => s + f.valorPagoBRL, 0)
    const restanteBRL = faturas.reduce((s, f) => s + f.valorRestanteBRL, 0)
    
    const totalRow = ws.addRow([
      `Total: ${faturas.length} fatura(s)`, '', '', 'BRL',
      '', '', '',
      totalBRL,
      '', '', '', ''
    ])
    totalRow.getCell(1).font = { bold: true, size: 9, name: 'Arial', color: { argb: COLORS.textMuted } }
    totalRow.getCell(8).numFmt = '"R$" #,##0.00'
    totalRow.getCell(8).font = { bold: true, size: 10, name: 'Arial', color: { argb: COLORS.textDark } }
    totalRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'right' }
  }

  ws.autoFilter = { from: 'A1', to: `L${faturas.length + 1}` }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  return ws
}

export async function gerarRelatorioFinanceiroExcel(dados: DadosFinanceiro, filtrosAtivos?: FiltrosFinanceiro) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Grupo Discovery'
  wb.created = new Date()

  const hoje = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  const t = dados.totaisGeralBRL

  // ================================================================
  // ABA RESUMO
  // ================================================================
  const wsResumo = wb.addWorksheet('Resumo', {
    properties: { tabColor: { argb: '8B4513' } }
  })

  wsResumo.columns = [
    { width: 5 },  // A
    { width: 22 }, // B
    { width: 22 }, // C
    { width: 22 }, // D
    { width: 22 }, // E
    { width: 5 },  // F
  ]

  // Header escuro
  for (let row = 1; row <= 3; row++) {
    for (let col = 1; col <= 6; col++) {
      wsResumo.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } }
    }
  }

  wsResumo.mergeCells('B1:E1')
  const titleCell = wsResumo.getCell('B1')
  titleCell.value = 'RELATÓRIO FINANCEIRO'
  titleCell.font = { bold: true, size: 16, color: { argb: COLORS.white }, name: 'Arial' }
  titleCell.alignment = { vertical: 'middle' }
  wsResumo.getRow(1).height = 32

  wsResumo.mergeCells('B2:E2')
  const subtitleCell = wsResumo.getCell('B2')
  subtitleCell.value = `Grupo Discovery | Gerado em ${hoje}`
  subtitleCell.font = { size: 9, color: { argb: COLORS.subtitleText }, name: 'Arial' }
  subtitleCell.alignment = { vertical: 'middle' }

  // Filtros
  if (filtrosAtivos) {
    const filtrosTexto: string[] = []
    if (filtrosAtivos.pais && filtrosAtivos.pais !== 'all') filtrosTexto.push(`País: ${PAIS_LABELS[filtrosAtivos.pais] || filtrosAtivos.pais}`)
    if (filtrosAtivos.status && filtrosAtivos.status !== 'all') filtrosTexto.push(`Status: ${STATUS_LABELS[filtrosAtivos.status] || filtrosAtivos.status}`)
    if (filtrosAtivos.moeda && filtrosAtivos.moeda !== 'all') filtrosTexto.push(`Moeda: ${filtrosAtivos.moeda}`)
    if (filtrosTexto.length > 0) {
      wsResumo.mergeCells('B3:E3')
      wsResumo.getCell('B3').value = `Filtros: ${filtrosTexto.join(' | ')}`
      wsResumo.getCell('B3').font = { italic: true, size: 8, color: { argb: COLORS.subtitleText }, name: 'Arial' }
    }
  }

  // Cards
  wsResumo.getRow(5).height = 38
  wsResumo.getRow(6).height = 22
  addResumoCard(wsResumo, 'B5', formatCurrencyBRL(t.total), 'Total Geral (BRL)', COLORS.totalBg)
  addResumoCard(wsResumo, 'C5', formatCurrencyBRL(t.pago), 'Recebido', COLORS.recebidoBg)
  addResumoCard(wsResumo, 'D5', formatCurrencyBRL(t.pendente), 'Pendente', COLORS.pendenteBg)
  addResumoCard(wsResumo, 'E5', formatCurrencyBRL(t.vencido), 'Vencido', COLORS.vencidoBg)

  // Totais por moeda
  let currentRow = 9
  const moedas = Object.entries(dados.totaisPorMoeda)
  if (moedas.length > 0) {
    wsResumo.mergeCells(`B${currentRow}:E${currentRow}`)
    const moedaTitle = wsResumo.getCell(`B${currentRow}`)
    moedaTitle.value = 'Totais por Moeda'
    moedaTitle.font = { bold: true, size: 11, color: { argb: COLORS.textDark }, name: 'Arial' }
    moedaTitle.border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } }
    currentRow += 2

    // Header da tabela de moedas
    const moedaHeaders = ['Moeda', 'Total', 'Recebido', 'Pendente']
    moedaHeaders.forEach((h, i) => {
      const cell = wsResumo.getCell(currentRow, i + 2)
      cell.value = h
      cell.font = { bold: true, size: 9, name: 'Arial', color: { argb: COLORS.headerText } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
      cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' }
    })
    wsResumo.getRow(currentRow).height = 24
    currentRow++

    moedas.forEach(([moeda, vals]) => {
      const cells = [moeda, formatCurrency(vals.total, moeda), formatCurrency(vals.pago, moeda), formatCurrency(vals.pendente, moeda)]
      cells.forEach((v, i) => {
        const cell = wsResumo.getCell(currentRow, i + 2)
        cell.value = v
        cell.font = { size: 9.5, name: 'Arial', color: { argb: COLORS.textDark } }
        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' }
        cell.border = { bottom: { style: 'thin', color: { argb: COLORS.borderColor } } }
      })
      wsResumo.getRow(currentRow).height = 22
      currentRow++
    })
  }

  // Resumo por processo
  currentRow += 2
  if (dados.porProcesso.length > 0) {
    wsResumo.mergeCells(`B${currentRow}:E${currentRow}`)
    const procTitle = wsResumo.getCell(`B${currentRow}`)
    procTitle.value = 'Resumo por Família/Processo'
    procTitle.font = { bold: true, size: 11, color: { argb: COLORS.textDark }, name: 'Arial' }
    procTitle.border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } }
    currentRow += 2

    // Header
    const procHeaders = ['Família', 'Total BRL', 'Recebido', 'Pendente']
    procHeaders.forEach((h, i) => {
      const cell = wsResumo.getCell(currentRow, i + 2)
      cell.value = h
      cell.font = { bold: true, size: 9, name: 'Arial', color: { argb: COLORS.headerText } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
      cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' }
    })
    wsResumo.getRow(currentRow).height = 24
    currentRow++

    // Sort by total descending
    const processos = [...dados.porProcesso].sort((a, b) => b.totalBRL - a.totalBRL)
    processos.forEach((p, idx) => {
      const isAlt = idx % 2 === 0
      const cells = [
        `${p.nome} (${PAIS_LABELS[p.pais] || p.pais})`,
        formatCurrencyBRL(p.totalBRL),
        formatCurrencyBRL(p.pagoBRL),
        formatCurrencyBRL(p.pendenteBRL)
      ]
      cells.forEach((v, i) => {
        const cell = wsResumo.getCell(currentRow, i + 2)
        cell.value = v
        cell.font = { size: 9.5, name: 'Arial', color: { argb: COLORS.textDark } }
        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'right' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? COLORS.altRow : COLORS.white } }
        cell.border = { bottom: { style: 'thin', color: { argb: COLORS.borderColor } } }
      })

      // Highlight pendente se > 0
      if (p.pendenteBRL > 0) {
        const pendCell = wsResumo.getCell(currentRow, 5)
        pendCell.font = { bold: true, size: 9.5, name: 'Arial', color: { argb: COLORS.pendenteText } }
      }
      if (p.vencidoBRL > 0) {
        const pendCell = wsResumo.getCell(currentRow, 5)
        pendCell.font = { bold: true, size: 9.5, name: 'Arial', color: { argb: COLORS.vencidoText } }
      }

      wsResumo.getRow(currentRow).height = 22
      currentRow++
    })
  }

  // ================================================================
  // ABAS DE DADOS
  // ================================================================
  criarAbaFaturas(wb, 'Todas as Faturas', dados.faturas, '1E3A5F')
  criarAbaFaturas(wb, 'Pendentes', dados.faturas.filter(f => f.status === 'PENDENTE' || f.status === 'PARCIAL'), 'B45309')
  criarAbaFaturas(wb, 'Vencidas', dados.faturas.filter(f => f.status === 'VENCIDO'), 'B91C1C')
  criarAbaFaturas(wb, 'Pagas', dados.faturas.filter(f => f.status === 'PAGO'), '15803D')

  // ================================================================
  // DOWNLOAD
  // ================================================================
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-financeiro-${new Date().toISOString().split('T')[0]}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}