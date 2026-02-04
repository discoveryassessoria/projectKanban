// src/utils/relatorioTarefas.ts
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'

// ============================================
// TIPOS
// ============================================

interface Atividade {
  id: number
  nome: string
  descricao: string | null
  data_termino: string | null
  data_criacao: string
  pais: string
  status?: { nome: string } | null
  concluida?: boolean
  processo?: { id: number; nome: string } | null
  tarefaPai?: { id: number; titulo: string } | null
  responsavel?: { nome: string } | null
  usuarios?: { usuario: { nome: string } }[]
}

interface ReportFilters {
  pais?: string
  status?: string
  responsavel?: string
  dataInicio?: string
  dataFim?: string
}

const PAIS_LABELS: Record<string, string> = {
  PORTUGAL: 'Portugal',
  ESPANHA: 'Espanha',
  ALEMANHA: 'Alemanha',
  ITALIA: 'Itália'
}

// ============================================
// CLASSIFICAÇÃO DE TAREFAS
// ============================================

function classificarTarefa(atividade: Atividade): 'atrasada' | 'pendente' | 'concluida' {
  const statusNome = atividade.status?.nome?.toLowerCase() || ''
  
  if (statusNome === 'concluída' || statusNome === 'concluida' || atividade.concluida) {
    return 'concluida'
  }
  
  if (atividade.data_termino) {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const prazo = new Date(atividade.data_termino)
    prazo.setHours(0, 0, 0, 0)
    
    if (prazo < hoje) {
      return 'atrasada'
    }
  }
  
  return 'pendente'
}

function getResponsavel(atividade: Atividade): string {
  if (atividade.responsavel?.nome) return atividade.responsavel.nome
  if (atividade.usuarios && atividade.usuarios.length > 0) {
    return atividade.usuarios.map(u => u.usuario?.nome || '').filter(Boolean).join(', ')
  }
  return '-'
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function getStatusLabel(atividade: Atividade): string {
  const classificacao = classificarTarefa(atividade)
  if (classificacao === 'atrasada') return 'Atrasada'
  if (classificacao === 'concluida') return 'Concluída'
  return 'Pendente'
}

// ============================================
// DADOS DO RELATÓRIO
// ============================================

function prepararDados(atividades: Atividade[]) {
  const atrasadas = atividades.filter(a => classificarTarefa(a) === 'atrasada')
  const pendentes = atividades.filter(a => classificarTarefa(a) === 'pendente')
  const concluidas = atividades.filter(a => classificarTarefa(a) === 'concluida')

  const linhas = atividades.map(a => ({
    nome: a.nome,
    descricao: a.descricao || '',
    processo: a.processo?.nome || '-',
    vinculado: a.tarefaPai?.titulo || '-',
    dataCriacao: formatDate(a.data_criacao),
    prazoFinal: formatDate(a.data_termino),
    status: getStatusLabel(a),
    responsavel: getResponsavel(a),
    pais: PAIS_LABELS[a.pais] || a.pais || '-',
  }))

  return {
    total: atividades.length,
    atrasadas: atrasadas.length,
    pendentes: pendentes.length,
    concluidas: concluidas.length,
    linhas,
  }
}

// ============================================
// GERAÇÃO DE PDF
// ============================================

export function gerarRelatorioPDF(atividades: Atividade[], filtrosAtivos?: ReportFilters) {
  const dados = prepararDados(atividades)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const hoje = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  doc.setFillColor(30, 41, 59)
  doc.rect(0, 0, pageWidth, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Relatório de Tarefas', 14, 12)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Grupo Discovery | Gerado em ${hoje}`, 14, 20)

  const resumoY = 36
  const boxWidth = 60
  const boxHeight = 18
  const gap = 8
  const startX = (pageWidth - (4 * boxWidth + 3 * gap)) / 2

  const resumoBoxes = [
    { label: 'Total', valor: dados.total, cor: [59, 130, 246] },
    { label: 'Atrasadas', valor: dados.atrasadas, cor: [239, 68, 68] },
    { label: 'Pendentes', valor: dados.pendentes, cor: [245, 158, 11] },
    { label: 'Concluídas', valor: dados.concluidas, cor: [34, 197, 94] },
  ]

  resumoBoxes.forEach((box, i) => {
    const x = startX + i * (boxWidth + gap)
    doc.setFillColor(box.cor[0], box.cor[1], box.cor[2])
    doc.roundedRect(x, resumoY, boxWidth, boxHeight, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(String(box.valor), x + boxWidth / 2, resumoY + 9, { align: 'center' })
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(box.label, x + boxWidth / 2, resumoY + 15, { align: 'center' })
  })

  let filtroY = resumoY + boxHeight + 6
  const filtrosTexto: string[] = []
  if (filtrosAtivos?.pais && filtrosAtivos.pais !== 'all') filtrosTexto.push(`País: ${PAIS_LABELS[filtrosAtivos.pais] || filtrosAtivos.pais}`)
  if (filtrosAtivos?.status && filtrosAtivos.status !== 'all') filtrosTexto.push(`Status: ${filtrosAtivos.status}`)
  if (filtrosAtivos?.responsavel && filtrosAtivos.responsavel !== 'all') filtrosTexto.push(`Responsável: ${filtrosAtivos.responsavel}`)
  if (filtrosAtivos?.dataInicio) filtrosTexto.push(`De: ${formatDate(filtrosAtivos.dataInicio)}`)
  if (filtrosAtivos?.dataFim) filtrosTexto.push(`Até: ${formatDate(filtrosAtivos.dataFim)}`)

  if (filtrosTexto.length > 0) {
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    doc.text(`Filtros: ${filtrosTexto.join(' | ')}`, 14, filtroY)
    filtroY += 6
  }

  const headers = ['Nome', 'Processo', 'Vinculado a', 'Criação', 'Prazo', 'Status', 'Responsável', 'País']
  const body = dados.linhas.map(l => [
    l.nome, l.processo, l.vinculado, l.dataCriacao, l.prazoFinal, l.status, l.responsavel, l.pais
  ])

  autoTable(doc, {
    startY: filtroY + 2,
    head: [headers],
    body: body,
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold', halign: 'left' },
    bodyStyles: { fontSize: 7.5, textColor: [30, 30, 30], cellPadding: 2.5 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      0: { cellWidth: 65 }, 1: { cellWidth: 30 }, 2: { cellWidth: 35 },
      3: { cellWidth: 22 }, 4: { cellWidth: 22 }, 5: { cellWidth: 22 },
      6: { cellWidth: 30 }, 7: { cellWidth: 22 },
    },
    didParseCell: (data: any) => {
      if (data.column.index === 5 && data.section === 'body') {
        const val = data.cell.raw as string
        if (val === 'Atrasada') { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold' }
        else if (val === 'Concluída') { data.cell.styles.textColor = [22, 163, 74]; data.cell.styles.fontStyle = 'bold' }
        else if (val === 'Pendente') { data.cell.styles.textColor = [217, 119, 6]; data.cell.styles.fontStyle = 'bold' }
      }
    },
    margin: { left: 14, right: 14 },
  })

  const totalPages = (doc as any).getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.setFont('helvetica', 'normal')
    doc.text(`Grupo Discovery - Sistema de Gestão de Projetos`, 14, pageHeight - 8)
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 8, { align: 'right' })
  }

  doc.save(`relatorio-tarefas-${new Date().toISOString().split('T')[0]}.pdf`)
}

// ============================================
// GERAÇÃO DE EXCEL (ExcelJS - com estilos)
// ============================================

const COLORS = {
  headerBg: '1E293B',
  headerText: 'FFFFFF',
  titleBg: '0F172A',
  subtitleText: '94A3B8',
  totalBg: '3B82F6',
  atrasadaBg: 'EF4444',
  pendenteBg: 'F59E0B',
  concluidaBg: '22C55E',
  atrasadaLight: 'FEE2E2',
  pendenteLight: 'FEF3C7',
  concluidaLight: 'DCFCE7',
  atrasadaText: 'DC2626',
  pendenteText: 'D97706',
  concluidaText: '16A34A',
  borderColor: 'E2E8F0',
  altRow: 'F8FAFC',
  white: 'FFFFFF',
  textDark: '1E293B',
  textMuted: '64748B',
}

function applyHeaderStyle(row: any, colCount: number) {
  row.height = 28
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i)
    cell.font = { bold: true, color: { argb: COLORS.headerText }, size: 10, name: 'Arial' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } }
  }
}

function applyDataRowStyle(row: any, colCount: number, rowIndex: number, statusColIndex?: number) {
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
    
    if (statusVal === 'Atrasada') {
      statusCell.font = { bold: true, size: 9.5, name: 'Arial', color: { argb: COLORS.atrasadaText } }
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.atrasadaLight } }
    } else if (statusVal === 'Pendente') {
      statusCell.font = { bold: true, size: 9.5, name: 'Arial', color: { argb: COLORS.pendenteText } }
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pendenteLight } }
    } else if (statusVal === 'Concluída') {
      statusCell.font = { bold: true, size: 9.5, name: 'Arial', color: { argb: COLORS.concluidaText } }
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.concluidaLight } }
    }
  }
}

function addResumoCard(ws: any, cell: string, valor: number, label: string, corBg: string) {
  const c = ws.getCell(cell)
  c.value = valor
  c.font = { bold: true, size: 22, color: { argb: COLORS.white }, name: 'Arial' }
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

function criarAbaTarefas(wb: any, nomeAba: string, linhas: any[], tabColor?: string) {
  const ws = wb.addWorksheet(nomeAba, {
    properties: { tabColor: tabColor ? { argb: tabColor } : undefined }
  })

  const headers = ['Nome', 'Descrição', 'Processo', 'Vinculado a', 'Criação', 'Prazo Final', 'Status', 'Responsável', 'País']
  const colWidths = [45, 35, 18, 22, 14, 14, 13, 18, 12]

  ws.columns = headers.map((h, i) => ({ header: h, width: colWidths[i] }))

  const headerRow = ws.getRow(1)
  applyHeaderStyle(headerRow, headers.length)

  linhas.forEach((l: any, idx: number) => {
    const row = ws.addRow([l.nome, l.descricao || '', l.processo, l.vinculado, l.dataCriacao, l.prazoFinal, l.status, l.responsavel, l.pais])
    applyDataRowStyle(row, headers.length, idx, 7)
  })

  if (linhas.length > 0) {
    const emptyRow = ws.addRow([])
    emptyRow.height = 8
    const totalRow = ws.addRow([`Total: ${linhas.length} tarefa(s)`])
    totalRow.getCell(1).font = { bold: true, size: 9, name: 'Arial', color: { argb: COLORS.textMuted } }
  }

  ws.autoFilter = { from: 'A1', to: `I${linhas.length + 1}` }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  return ws
}

export async function gerarRelatorioExcel(atividades: Atividade[], filtrosAtivos?: ReportFilters) {
  const dados = prepararDados(atividades)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Grupo Discovery'
  wb.created = new Date()

  const hoje = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  // ================================================================
  // ABA RESUMO
  // ================================================================
  const wsResumo = wb.addWorksheet('Resumo', {
    properties: { tabColor: { argb: '8B4513' } }
  })

  wsResumo.columns = [
    { width: 5 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 5 },
  ]

  for (let row = 1; row <= 3; row++) {
    for (let col = 1; col <= 6; col++) {
      const cell = wsResumo.getCell(row, col)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.titleBg } }
    }
  }

  wsResumo.mergeCells('B1:E1')
  const titleCell = wsResumo.getCell('B1')
  titleCell.value = 'RELATÓRIO DE TAREFAS'
  titleCell.font = { bold: true, size: 16, color: { argb: COLORS.white }, name: 'Arial' }
  titleCell.alignment = { vertical: 'middle' }
  wsResumo.getRow(1).height = 32

  wsResumo.mergeCells('B2:E2')
  const subtitleCell = wsResumo.getCell('B2')
  subtitleCell.value = `Grupo Discovery | Gerado em ${hoje}`
  subtitleCell.font = { size: 9, color: { argb: COLORS.subtitleText }, name: 'Arial' }
  subtitleCell.alignment = { vertical: 'middle' }

  if (filtrosAtivos) {
    const filtrosTexto: string[] = []
    if (filtrosAtivos.pais && filtrosAtivos.pais !== 'all') filtrosTexto.push(`País: ${PAIS_LABELS[filtrosAtivos.pais] || filtrosAtivos.pais}`)
    if (filtrosAtivos.status && filtrosAtivos.status !== 'all') filtrosTexto.push(`Status: ${filtrosAtivos.status}`)
    if (filtrosAtivos.responsavel && filtrosAtivos.responsavel !== 'all') filtrosTexto.push(`Responsável: ${filtrosAtivos.responsavel}`)
    
    if (filtrosTexto.length > 0) {
      wsResumo.mergeCells('B3:E3')
      const filtroCell = wsResumo.getCell('B3')
      filtroCell.value = `Filtros: ${filtrosTexto.join(' | ')}`
      filtroCell.font = { italic: true, size: 8, color: { argb: COLORS.subtitleText }, name: 'Arial' }
    }
  }

  wsResumo.getRow(5).height = 38
  wsResumo.getRow(6).height = 22

  addResumoCard(wsResumo, 'B5', dados.total, 'Total', COLORS.totalBg)
  addResumoCard(wsResumo, 'C5', dados.atrasadas, 'Atrasadas', COLORS.atrasadaBg)
  addResumoCard(wsResumo, 'D5', dados.pendentes, 'Pendentes', COLORS.pendenteBg)
  addResumoCard(wsResumo, 'E5', dados.concluidas, 'Concluídas', COLORS.concluidaBg)

  const detailStartRow = 9
  wsResumo.mergeCells(`B${detailStartRow}:E${detailStartRow}`)
  const detailTitle = wsResumo.getCell(`B${detailStartRow}`)
  detailTitle.value = 'Distribuição por Status'
  detailTitle.font = { bold: true, size: 11, color: { argb: COLORS.textDark }, name: 'Arial' }
  detailTitle.border = { bottom: { style: 'medium', color: { argb: COLORS.headerBg } } }

  const barRow = detailStartRow + 2
  const statusItems = [
    { label: 'Atrasadas', valor: dados.atrasadas, cor: COLORS.atrasadaBg, corLight: COLORS.atrasadaLight, corText: COLORS.atrasadaText },
    { label: 'Pendentes', valor: dados.pendentes, cor: COLORS.pendenteBg, corLight: COLORS.pendenteLight, corText: COLORS.pendenteText },
    { label: 'Concluídas', valor: dados.concluidas, cor: COLORS.concluidaBg, corLight: COLORS.concluidaLight, corText: COLORS.concluidaText },
  ]

  statusItems.forEach((item, i) => {
    const row = barRow + i
    const pct = dados.total > 0 ? ((item.valor / dados.total) * 100).toFixed(1) : '0.0'

    const indicatorCell = wsResumo.getCell(`B${row}`)
    indicatorCell.value = `  ${item.label}`
    indicatorCell.font = { bold: true, size: 10, color: { argb: item.corText }, name: 'Arial' }
    indicatorCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: item.corLight } }
    indicatorCell.alignment = { vertical: 'middle' }
    indicatorCell.border = { left: { style: 'thick', color: { argb: item.cor } } }

    const qtyCell = wsResumo.getCell(`C${row}`)
    qtyCell.value = item.valor
    qtyCell.font = { bold: true, size: 10, color: { argb: item.corText }, name: 'Arial' }
    qtyCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: item.corLight } }
    qtyCell.alignment = { vertical: 'middle', horizontal: 'center' }

    const pctCell = wsResumo.getCell(`D${row}`)
    pctCell.value = `${pct}%`
    pctCell.font = { size: 10, color: { argb: COLORS.textMuted }, name: 'Arial' }
    pctCell.alignment = { vertical: 'middle', horizontal: 'center' }

    wsResumo.getRow(row).height = 24
  })

  // ================================================================
  // ABAS DE DADOS
  // ================================================================
  criarAbaTarefas(wb, 'Todas as Tarefas', dados.linhas, '1E3A5F')
  criarAbaTarefas(wb, 'Atrasadas', dados.linhas.filter(l => l.status === 'Atrasada'), 'B91C1C')
  criarAbaTarefas(wb, 'Pendentes', dados.linhas.filter(l => l.status === 'Pendente'), 'B45309')
  criarAbaTarefas(wb, 'Concluídas', dados.linhas.filter(l => l.status === 'Concluída'), '15803D')

  // ================================================================
  // DOWNLOAD
  // ================================================================
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `relatorio-tarefas-${new Date().toISOString().split('T')[0]}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}