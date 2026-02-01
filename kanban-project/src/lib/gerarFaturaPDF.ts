// src/lib/gerarFaturaPDF.ts
// Gerador de PDF - COMPROVANTE/RELATÓRIO de pagamentos
// Logo carregada de /public/logo-discovery.png

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ========================================
// CORES DISCOVERY
// ========================================
const CORES = {
  azulEscuro: [13, 44, 88] as [number, number, number],
  azulMedio: [19, 73, 114] as [number, number, number],
  dourado: [185, 140, 72] as [number, number, number],
  amareloClaro: [248, 200, 116] as [number, number, number],
  branco: [255, 255, 255] as [number, number, number],
  texto: [51, 51, 51] as [number, number, number],
  cinzaClaro: [245, 247, 250] as [number, number, number],
  verde: [34, 139, 34] as [number, number, number],
  verdeClaro: [220, 252, 231] as [number, number, number],
  vermelho: [220, 53, 69] as [number, number, number],
}

// ========================================
// LOGO - Carrega da pasta /public
// ========================================
const LOGO_URL = '/logo-discovery.png'
let logoBase64Cache: string | null = null

async function carregarLogo(): Promise<string | null> {
  if (logoBase64Cache) return logoBase64Cache
  
  try {
    const response = await fetch(LOGO_URL)
    if (!response.ok) return null
    
    const blob = await response.blob()
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        logoBase64Cache = reader.result as string
        resolve(logoBase64Cache)
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// ========================================
// TIPOS
// ========================================
interface Destinatario {
  nome: string
  cpf?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
}

interface Pagamento {
  id: number
  valor: number
  data: string
  formaPagamento: string | null
  observacao?: string | null
  cambio?: number | null  // Valor do câmbio (campo do Prisma)
}

interface DadosFatura {
  id: number
  numero?: string
  dataEmissao: string
  dataVencimento?: string | null
  descricao: string
  moeda: 'BRL' | 'EUR' | 'USD'
  cambio?: number | null  // Câmbio da fatura (para moedas estrangeiras)
  valor: number
  observacoes?: string | null
  destinatario: Destinatario
  pagamentos?: Pagamento[]
}

interface DadosFaturaConsolidada {
  faturas: DadosFatura[]
  destinatario: Destinatario
  dataEmissao: string
}

// ========================================
// DADOS DA EMPRESA
// ========================================
const DADOS_DISCOVERY = {
  nome: 'Discovery Assessoria em Dupla Cidadania e Imigração',
  cnpj: '36.897.530/0001-21',
  endereco: 'Rua Jose Fontana, 120/1',
  cidade: 'Amparo',
  estado: 'SP',
}

// ========================================
// HELPERS
// ========================================
const formatarMoeda = (valor: number, moeda: string = 'BRL'): string => {
  const simbolos: Record<string, string> = { BRL: 'R$', EUR: '€', USD: 'US$' }
  const simbolo = simbolos[moeda] || moeda
  return `${simbolo} ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const formatarData = (data: string): string => {
  return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

const formatarCPF = (cpf: string | null | undefined): string => {
  if (!cpf) return '-'
  const nums = cpf.replace(/\D/g, '')
  if (nums.length !== 11) return cpf
  return nums.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

const formatarCambio = (cambio: number | null | undefined): string => {
  if (!cambio) return '-'
  return cambio.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

const montarEnderecoCompleto = (dest: Destinatario): string => {
  const partes: string[] = []
  if (dest.endereco) {
    let linha = dest.endereco
    if (dest.numero) linha += `, ${dest.numero}`
    if (dest.complemento) linha += ` - ${dest.complemento}`
    partes.push(linha)
  }
  if (dest.bairro) partes.push(dest.bairro)
  const cidadeEstado: string[] = []
  if (dest.cidade) cidadeEstado.push(dest.cidade)
  if (dest.estado) cidadeEstado.push(dest.estado)
  if (cidadeEstado.length > 0) {
    let linha = cidadeEstado.join(' - ')
    if (dest.cep) linha += ` - CEP: ${dest.cep}`
    partes.push(linha)
  }
  return partes.join('\n')
}

// ========================================
// GERADOR DE PDF - FATURA ÚNICA
// ========================================
export async function gerarFaturaPDF(dados: DadosFatura): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginLeft = 15
  const marginRight = 15
  const contentWidth = pageWidth - marginLeft - marginRight

  let currentY = 15

  const logoBase64 = await carregarLogo()

  // Calcular totais de pagamento
  const totalPago = dados.pagamentos?.reduce((sum, p) => sum + p.valor, 0) || 0
  const isPago = totalPago >= dados.valor

  // ========================================
  // LOGO CENTRALIZADA NO TOPO (proporção original ~5:1)
  // ========================================
  if (logoBase64) {
    const logoWidth = 55
    const logoHeight = 12
    const logoX = (pageWidth - logoWidth) / 2  // Centralizado
    doc.addImage(logoBase64, 'PNG', logoX, currentY, logoWidth, logoHeight)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...CORES.azulEscuro)
    doc.text('GRUPO DISCOVERY', pageWidth / 2, currentY + 8, { align: 'center' })
  }
  currentY += 18

  // ========================================
  // TÍTULO - Fundo amarelo claro, texto escuro
  // ========================================
  const numeroFatura = dados.numero || `${String(dados.id).padStart(3, '0')}/${new Date(dados.dataEmissao).getFullYear()}`
  
  doc.setFillColor(...CORES.amareloClaro)
  doc.rect(marginLeft, currentY, contentWidth, 10, 'F')
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...CORES.azulEscuro)  // Texto escuro no fundo claro
  doc.text(`Comprovante - Fatura ${numeroFatura}`, marginLeft + 5, currentY + 7)
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(formatarData(dados.dataEmissao), marginLeft + contentWidth - 5, currentY + 7, { align: 'right' })
  
  currentY += 16

  // ========================================
  // EMITENTE E DESTINATÁRIO (textos centralizados)
  // ========================================
  const boxWidth = (contentWidth - 8) / 2
  const headerHeight = 8
  const bodyHeight = 32
  const boxHeight = headerHeight + bodyHeight
  
  // EMITENTE - Header
  doc.setFillColor(...CORES.azulMedio)
  doc.rect(marginLeft, currentY, boxWidth, headerHeight, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...CORES.branco)
  doc.text('EMITENTE', marginLeft + boxWidth / 2, currentY + 5.5, { align: 'center' })
  
  // EMITENTE - Body
  doc.setDrawColor(...CORES.azulMedio)
  doc.setLineWidth(0.3)
  doc.rect(marginLeft, currentY + headerHeight, boxWidth, bodyHeight)
  
  const emitenteBodyY = currentY + headerHeight
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...CORES.texto)
  doc.text(DADOS_DISCOVERY.nome, marginLeft + 4, emitenteBodyY + 7, { maxWidth: boxWidth - 8 })
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`CNPJ: ${DADOS_DISCOVERY.cnpj}`, marginLeft + 4, emitenteBodyY + 15)
  doc.text(DADOS_DISCOVERY.endereco, marginLeft + 4, emitenteBodyY + 20)
  doc.text(`${DADOS_DISCOVERY.cidade} - ${DADOS_DISCOVERY.estado}`, marginLeft + 4, emitenteBodyY + 25)

  // DESTINATÁRIO - Header
  const destX = marginLeft + boxWidth + 8
  doc.setFillColor(...CORES.azulMedio)
  doc.rect(destX, currentY, boxWidth, headerHeight, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...CORES.branco)
  doc.text('DESTINATÁRIO', destX + boxWidth / 2, currentY + 5.5, { align: 'center' })
  
  // DESTINATÁRIO - Body
  doc.setDrawColor(...CORES.azulMedio)
  doc.rect(destX, currentY + headerHeight, boxWidth, bodyHeight)
  
  const destBodyY = currentY + headerHeight
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...CORES.texto)
  doc.text(dados.destinatario.nome, destX + 4, destBodyY + 7, { maxWidth: boxWidth - 8 })
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`CPF: ${formatarCPF(dados.destinatario.cpf)}`, destX + 4, destBodyY + 15)
  const enderecoCompleto = montarEnderecoCompleto(dados.destinatario)
  if (enderecoCompleto) {
    const linhas = enderecoCompleto.split('\n')
    linhas.forEach((linha, idx) => {
      if (idx < 2) doc.text(linha, destX + 4, destBodyY + 20 + (idx * 5), { maxWidth: boxWidth - 8 })
    })
  }

  currentY += boxHeight + 10

  // ========================================
  // SERVIÇO
  // ========================================
  autoTable(doc, {
    startY: currentY,
    head: [['Descrição do Serviço', 'Valor']],
    body: [[dados.descricao, formatarMoeda(dados.valor, dados.moeda)]],
    theme: 'grid',
    headStyles: { fillColor: CORES.azulMedio, textColor: CORES.branco, fontSize: 9, fontStyle: 'bold', cellPadding: 3 },
    bodyStyles: { fontSize: 9, textColor: CORES.texto, cellPadding: 3 },
    columnStyles: { 
      0: { cellWidth: 'auto', halign: 'left' }, 
      1: { cellWidth: 40, halign: 'right', fontStyle: 'bold' } 
    },
    margin: { left: marginLeft, right: marginRight },
  })

  currentY = (doc as any).lastAutoTable.finalY + 10

  // ========================================
  // STATUS DO PAGAMENTO
  // ========================================
  doc.setFillColor(...CORES.azulMedio)
  doc.rect(marginLeft, currentY, contentWidth, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...CORES.branco)
  doc.text('STATUS DO PAGAMENTO', marginLeft + contentWidth / 2, currentY + 5.5, { align: 'center' })
  
  currentY += 8

  if (dados.pagamentos && dados.pagamentos.length > 0) {
    // Verificar se tem câmbio para mostrar coluna
    const temCambio = dados.pagamentos.some(p => p.cambio)
    
    // Tabela de pagamentos - usar strings simples
    const headRow = temCambio 
      ? ['Data', 'Forma de Pagamento', 'Câmbio', 'Valor']
      : ['Data', 'Forma de Pagamento', 'Valor']

    const bodyRows = dados.pagamentos.map(pag => {
      if (temCambio) {
        return [
          formatarData(pag.data),
          pag.formaPagamento || 'Não informado',
          formatarCambio(pag.cambio),
          formatarMoeda(pag.valor, dados.moeda)
        ]
      } else {
        return [
          formatarData(pag.data),
          pag.formaPagamento || 'Não informado',
          formatarMoeda(pag.valor, dados.moeda)
        ]
      }
    })

    autoTable(doc, {
      startY: currentY,
      head: [headRow],
      body: bodyRows,
      theme: 'grid',
      headStyles: { fillColor: CORES.cinzaClaro, textColor: CORES.texto, fontSize: 8, fontStyle: 'bold', cellPadding: 2.5 },
      bodyStyles: { fontSize: 8, textColor: CORES.texto, cellPadding: 2.5 },
      columnStyles: temCambio 
        ? { 
            0: { cellWidth: 25, halign: 'center' }, 
            1: { cellWidth: 'auto', halign: 'left' }, 
            2: { cellWidth: 25, halign: 'center' }, 
            3: { cellWidth: 35, halign: 'right' } 
          }
        : { 
            0: { cellWidth: 30, halign: 'center' }, 
            1: { cellWidth: 'auto', halign: 'left' }, 
            2: { cellWidth: 35, halign: 'right' } 
          },
      margin: { left: marginLeft, right: marginRight },
    })

    currentY = (doc as any).lastAutoTable.finalY + 5

    // Resumo - Box colorido
    const resumoHeight = 12
    if (isPago) {
      doc.setFillColor(...CORES.verdeClaro)
    } else {
      doc.setFillColor(254, 243, 199)
    }
    doc.rect(marginLeft, currentY, contentWidth, resumoHeight, 'F')
    doc.setDrawColor(...CORES.dourado)
    doc.setLineWidth(0.3)
    doc.rect(marginLeft, currentY, contentWidth, resumoHeight)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    
    if (isPago) {
      doc.setTextColor(...CORES.verde)
      doc.text('✓ PAGO INTEGRALMENTE', marginLeft + 5, currentY + 8)
    } else {
      doc.setTextColor(...CORES.dourado)
      const restante = dados.valor - totalPago
      doc.text(`PARCIALMENTE PAGO - Restante: ${formatarMoeda(restante, dados.moeda)}`, marginLeft + 5, currentY + 8)
    }
    
    doc.setTextColor(...CORES.texto)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Total pago: ${formatarMoeda(totalPago, dados.moeda)}`, marginLeft + contentWidth - 5, currentY + 8, { align: 'right' })

    currentY += resumoHeight + 8

  } else {
    // Sem pagamentos
    const boxH = 18
    doc.setFillColor(254, 226, 226)
    doc.rect(marginLeft, currentY, contentWidth, boxH, 'F')
    doc.setDrawColor(...CORES.vermelho)
    doc.setLineWidth(0.3)
    doc.rect(marginLeft, currentY, contentWidth, boxH)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...CORES.vermelho)
    doc.text('PENDENTE', marginLeft + 5, currentY + 7)
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...CORES.texto)
    doc.text('Nenhum pagamento registrado.', marginLeft + 5, currentY + 13)

    currentY += boxH + 8
  }

  // ========================================
  // OBSERVAÇÕES (se existir)
  // ========================================
  if (dados.observacoes && dados.observacoes.trim()) {
    doc.setFillColor(...CORES.cinzaClaro)
    doc.rect(marginLeft, currentY, contentWidth, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...CORES.azulEscuro)
    doc.text('OBSERVAÇÕES', marginLeft + 3, currentY + 5)
    
    currentY += 7
    doc.setDrawColor(...CORES.dourado)
    doc.setLineWidth(0.3)
    doc.rect(marginLeft, currentY, contentWidth, 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...CORES.texto)
    doc.text(dados.observacoes, marginLeft + 3, currentY + 5, { maxWidth: contentWidth - 6 })
  }

  // ========================================
  // RODAPÉ
  // ========================================
  const rodapeY = pageHeight - 10
  doc.setDrawColor(...CORES.azulEscuro)
  doc.setLineWidth(0.5)
  doc.line(marginLeft, rodapeY - 3, marginLeft + contentWidth, rodapeY - 3)
  
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7)
  doc.setTextColor(128, 128, 128)
  doc.text('Documento gerado pelo Sistema Discovery', pageWidth / 2, rodapeY, { align: 'center' })

  return doc
}

// ========================================
// GERADOR DE PDF - CONSOLIDADA
// ========================================
export async function gerarFaturaConsolidadaPDF(dados: DadosFaturaConsolidada): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginLeft = 15
  const marginRight = 15
  const contentWidth = pageWidth - marginLeft - marginRight

  let currentY = 15

  const logoBase64 = await carregarLogo()

  // Calcular totais
  const totaisPorMoeda: Record<string, number> = {}
  const pagamentosPorMoeda: Record<string, number> = {}
  let totalGeralBRL = 0
  let totalPagoBRL = 0
  
  dados.faturas.forEach(f => {
    totaisPorMoeda[f.moeda] = (totaisPorMoeda[f.moeda] || 0) + f.valor
    const pagos = f.pagamentos?.reduce((sum, p) => sum + p.valor, 0) || 0
    pagamentosPorMoeda[f.moeda] = (pagamentosPorMoeda[f.moeda] || 0) + pagos
    
    // Calcular total em BRL
    if (f.moeda === 'BRL') {
      totalGeralBRL += f.valor
      totalPagoBRL += pagos
    } else if (f.cambio && f.cambio > 0) {
      totalGeralBRL += f.valor * f.cambio
      totalPagoBRL += pagos * f.cambio
    }
  })

  // ========================================
  // LOGO CENTRALIZADA (proporção original ~5:1)
  // ========================================
  if (logoBase64) {
    const logoWidth = 55
    const logoHeight = 12
    const logoX = (pageWidth - logoWidth) / 2  // Centralizado
    doc.addImage(logoBase64, 'PNG', logoX, currentY, logoWidth, logoHeight)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...CORES.azulEscuro)
    doc.text('GRUPO DISCOVERY', pageWidth / 2, currentY + 8, { align: 'center' })
  }
  currentY += 18

  // ========================================
  // TÍTULO - Fundo amarelo claro, texto escuro
  // ========================================
  doc.setFillColor(...CORES.amareloClaro)
  doc.rect(marginLeft, currentY, contentWidth, 10, 'F')
  
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...CORES.azulEscuro)  // Texto escuro no fundo claro
  doc.text('Relatório Consolidado de Pagamentos', marginLeft + 5, currentY + 7)
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(formatarData(dados.dataEmissao), marginLeft + contentWidth - 5, currentY + 7, { align: 'right' })
  
  currentY += 16

  // ========================================
  // EMITENTE E DESTINATÁRIO (textos centralizados)
  // ========================================
  const boxWidth = (contentWidth - 8) / 2
  const headerHeight = 8
  const bodyHeight = 32
  const boxHeight = headerHeight + bodyHeight
  
  // EMITENTE - Header
  doc.setFillColor(...CORES.azulMedio)
  doc.rect(marginLeft, currentY, boxWidth, headerHeight, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...CORES.branco)
  doc.text('EMITENTE', marginLeft + boxWidth / 2, currentY + 5.5, { align: 'center' })
  
  // EMITENTE - Body
  doc.setDrawColor(...CORES.azulMedio)
  doc.setLineWidth(0.3)
  doc.rect(marginLeft, currentY + headerHeight, boxWidth, bodyHeight)
  
  const emitenteBodyY = currentY + headerHeight
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...CORES.texto)
  doc.text(DADOS_DISCOVERY.nome, marginLeft + 4, emitenteBodyY + 7, { maxWidth: boxWidth - 8 })
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`CNPJ: ${DADOS_DISCOVERY.cnpj}`, marginLeft + 4, emitenteBodyY + 15)
  doc.text(DADOS_DISCOVERY.endereco, marginLeft + 4, emitenteBodyY + 20)
  doc.text(`${DADOS_DISCOVERY.cidade} - ${DADOS_DISCOVERY.estado}`, marginLeft + 4, emitenteBodyY + 25)

  // DESTINATÁRIO - Header
  const destX = marginLeft + boxWidth + 8
  doc.setFillColor(...CORES.azulMedio)
  doc.rect(destX, currentY, boxWidth, headerHeight, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...CORES.branco)
  doc.text('DESTINATÁRIO', destX + boxWidth / 2, currentY + 5.5, { align: 'center' })
  
  // DESTINATÁRIO - Body
  doc.setDrawColor(...CORES.azulMedio)
  doc.rect(destX, currentY + headerHeight, boxWidth, bodyHeight)
  
  const destBodyY = currentY + headerHeight
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...CORES.texto)
  doc.text(dados.destinatario.nome, destX + 4, destBodyY + 7, { maxWidth: boxWidth - 8 })
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(`CPF: ${formatarCPF(dados.destinatario.cpf)}`, destX + 4, destBodyY + 15)
  const enderecoCompleto = montarEnderecoCompleto(dados.destinatario)
  if (enderecoCompleto) {
    const linhas = enderecoCompleto.split('\n')
    linhas.forEach((linha, idx) => {
      if (idx < 2) doc.text(linha, destX + 4, destBodyY + 20 + (idx * 5), { maxWidth: boxWidth - 8 })
    })
  }

  currentY += boxHeight + 10

  // ========================================
  // TABELA DE FATURAS
  // ========================================
  const faturasComStatus = dados.faturas.map((f, idx) => {
    const pago = f.pagamentos?.reduce((sum, p) => sum + p.valor, 0) || 0
    const status = pago >= f.valor ? 'Pago' : pago > 0 ? 'Parcial' : 'Pendente'
    const cambioStr = f.moeda !== 'BRL' && f.cambio ? formatarCambio(f.cambio) : '-'
    return {
      idx: idx + 1,
      descricao: f.descricao,
      valor: formatarMoeda(f.valor, f.moeda),
      cambio: cambioStr,
      pago: formatarMoeda(pago, f.moeda),
      status
    }
  })

  autoTable(doc, {
    startY: currentY,
    head: [['#', 'Descrição', 'Valor', 'Câmbio', 'Pago', 'Status']],
    body: faturasComStatus.map(f => [String(f.idx), f.descricao, f.valor, f.cambio, f.pago, f.status]),
    theme: 'grid',
    headStyles: { fillColor: CORES.azulMedio, textColor: CORES.branco, fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
    bodyStyles: { fontSize: 8, textColor: CORES.texto, cellPadding: 3 },
    columnStyles: { 
      0: { cellWidth: 8, halign: 'center' }, 
      1: { cellWidth: 'auto', halign: 'left' }, 
      2: { cellWidth: 26, halign: 'right' }, 
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 26, halign: 'right' }, 
      5: { cellWidth: 18, halign: 'center', fontStyle: 'bold' } 
    },
    margin: { left: marginLeft, right: marginRight },
    didParseCell: (data) => {
      // Aplicar cor no status (coluna 5)
      if (data.section === 'body' && data.column.index === 5) {
        const status = data.cell.raw as string
        if (status === 'Pago') {
          data.cell.styles.textColor = CORES.verde
        } else if (status === 'Parcial') {
          data.cell.styles.textColor = CORES.dourado
        } else {
          data.cell.styles.textColor = CORES.vermelho
        }
      }
    }
  })

  currentY = (doc as any).lastAutoTable.finalY + 8

  // ========================================
  // RESUMO FINANCEIRO
  // ========================================
  const moedas = Object.keys(totaisPorMoeda)
  const temMoedaEstrangeira = moedas.some(m => m !== 'BRL')
  const resumoWidth = 95
  const resumoX = marginLeft + contentWidth - resumoWidth
  const linhaAltura = 14
  // Adiciona espaço extra para total em BRL se tiver moeda estrangeira
  const linhasTotalBRL = temMoedaEstrangeira ? 2 : 0
  const resumoHeight = 6 + (moedas.length * linhaAltura) + (linhasTotalBRL * 7)
  
  doc.setFillColor(...CORES.amareloClaro)
  doc.rect(resumoX, currentY, resumoWidth, resumoHeight, 'F')
  doc.setDrawColor(...CORES.dourado)
  doc.setLineWidth(0.5)
  doc.rect(resumoX, currentY, resumoWidth, resumoHeight)
  
  let resumoY = currentY + 6
  moedas.forEach((moeda) => {
    const total = totaisPorMoeda[moeda]
    const pago = pagamentosPorMoeda[moeda] || 0
    
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...CORES.texto)
    doc.text(`Total (${moeda}):`, resumoX + 4, resumoY)
    doc.text(formatarMoeda(total, moeda), resumoX + resumoWidth - 4, resumoY, { align: 'right' })
    
    doc.setTextColor(...CORES.verde)
    doc.text(`Pago (${moeda}):`, resumoX + 4, resumoY + 5)
    doc.text(formatarMoeda(pago, moeda), resumoX + resumoWidth - 4, resumoY + 5, { align: 'right' })
    
    resumoY += linhaAltura
  })
  
  // Total em BRL (se tiver moeda estrangeira)
  if (temMoedaEstrangeira) {
    // Linha separadora
    doc.setDrawColor(...CORES.dourado)
    doc.setLineWidth(0.3)
    doc.line(resumoX + 4, resumoY - 4, resumoX + resumoWidth - 4, resumoY - 4)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...CORES.azulEscuro)
    doc.text('Total Geral (BRL):', resumoX + 4, resumoY + 2)
    doc.text(formatarMoeda(totalGeralBRL, 'BRL'), resumoX + resumoWidth - 4, resumoY + 2, { align: 'right' })
    
    doc.setTextColor(...CORES.verde)
    doc.text('Pago (BRL):', resumoX + 4, resumoY + 8)
    doc.text(formatarMoeda(totalPagoBRL, 'BRL'), resumoX + resumoWidth - 4, resumoY + 8, { align: 'right' })
  }

  // ========================================
  // RODAPÉ
  // ========================================
  const rodapeY = pageHeight - 10
  doc.setDrawColor(...CORES.azulEscuro)
  doc.setLineWidth(0.5)
  doc.line(marginLeft, rodapeY - 3, marginLeft + contentWidth, rodapeY - 3)
  
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7)
  doc.setTextColor(128, 128, 128)
  doc.text('Documento gerado pelo Sistema Discovery', pageWidth / 2, rodapeY, { align: 'center' })

  return doc
}

// ========================================
// FUNÇÕES DE DOWNLOAD/ABRIR
// ========================================
export async function downloadFaturaPDF(dados: DadosFatura): Promise<void> {
  const doc = await gerarFaturaPDF(dados)
  const numeroFatura = dados.numero || `${String(dados.id).padStart(3, '0')}-${new Date(dados.dataEmissao).getFullYear()}`
  const nomeArquivo = `Comprovante_${numeroFatura}_${dados.destinatario.nome.replace(/\s+/g, '_')}.pdf`
  doc.save(nomeArquivo)
}

export async function abrirFaturaPDF(dados: DadosFatura): Promise<void> {
  const doc = await gerarFaturaPDF(dados)
  const blobUrl = doc.output('bloburl')
  window.open(blobUrl as string, '_blank')
}

export async function downloadFaturaConsolidadaPDF(dados: DadosFaturaConsolidada): Promise<void> {
  const doc = await gerarFaturaConsolidadaPDF(dados)
  const dataHoje = new Date().toISOString().split('T')[0]
  const nomeArquivo = `Relatorio_${dados.destinatario.nome.replace(/\s+/g, '_')}_${dataHoje}.pdf`
  doc.save(nomeArquivo)
}

export async function abrirFaturaConsolidadaPDF(dados: DadosFaturaConsolidada): Promise<void> {
  const doc = await gerarFaturaConsolidadaPDF(dados)
  const blobUrl = doc.output('bloburl')
  window.open(blobUrl as string, '_blank')
}