// src/lib/pdf/gerar-relatorios.ts

import jsPDF from "jspdf"
import "jspdf-autotable"
import { fmt, fmtBRL, fmtDataBR, nomeDoPagador, pagamentosAtivos } from "@/src/lib/financeiro/helpers-v2"
import { PDF_CORES, pdfCapa, pdfHeader, pdfKPI, pdfSecao, pdfObs, finalizarPDF } from "./pdf-base"
import type {
  FaturaEnriquecida, ResumoFinanceiro, ProcessoContext, MoedaV2
} from "@/src/types/financeiro-v2"

export interface DadosRelatorio {
  faturas: FaturaEnriquecida[]
  pastaTotal: number
  pastaPago: number
  pastaDetalhes: Array<{ pessoa: string; servico: string; registro: string; valor: number }>
  contasPagar: Array<{
    id: number
    descricao: string
    fornecedor?: string
    valor: number
    valorPago: number | null
    dataVencimento: string
    status: string
  }>
  resumo: ResumoFinanceiro
  ctx: ProcessoContext
}

export function gerarResumoExecutivoPDF(d: DadosRelatorio) {
  const doc = new jsPDF()
  pdfCapa(doc, "Resumo Executivo", "Indicadores financeiros consolidados do processo", d.ctx)

  doc.addPage()
  pdfHeader(doc, "Resumo Executivo", d.ctx)
  let y = 32
  y = pdfSecao(doc, y, "Indicadores Principais", "Visão geral do financeiro")

  const kpiW = 42, kpiH = 24, gap = 4
  pdfKPI(doc, 15, y, kpiW, kpiH, "Receita", fmtBRL(d.resumo.totalCobrado), PDF_CORES.green, `${d.resumo.numFaturas} faturas`)
  pdfKPI(doc, 15 + kpiW + gap, y, kpiW, kpiH, "Custo", fmtBRL(d.resumo.custo), PDF_CORES.red, `${d.resumo.pctPago.toFixed(0)}% pago`)
  pdfKPI(doc, 15 + (kpiW + gap) * 2, y, kpiW, kpiH, "Lucro", fmtBRL(d.resumo.lucro), PDF_CORES.blue, "Líquido")
  pdfKPI(doc, 15 + (kpiW + gap) * 3, y, kpiW, kpiH, "Margem", d.resumo.margem.toFixed(1) + "%", PDF_CORES.primary,
    d.resumo.margem > 70 ? "Excelente" : d.resumo.margem > 50 ? "Boa" : "Atenção")
  y += kpiH + 8

  y = pdfSecao(doc, y, "Fluxo Financeiro", "Status de recebimentos e pagamentos")
  const autoTable = (doc as any).autoTable
  autoTable({
    startY: y,
    head: [["DESCRIÇÃO", "VALOR", "% DO TOTAL"]],
    body: [
      ["Total cobrado ao cliente", fmtBRL(d.resumo.totalCobrado), "100%"],
      ["Já recebido", fmtBRL(d.resumo.recebido), d.resumo.pctRecebido.toFixed(1) + "%"],
      ["A receber", fmtBRL(d.resumo.aReceber), d.resumo.totalCobrado > 0 ? (d.resumo.aReceber / d.resumo.totalCobrado * 100).toFixed(1) + "%" : "0%"],
      ["Vencido não pago", fmtBRL(d.resumo.vencido), d.resumo.totalCobrado > 0 ? (d.resumo.vencido / d.resumo.totalCobrado * 100).toFixed(1) + "%" : "0%"],
      ["Total pago a terceiros", fmtBRL(d.resumo.custoPago), d.resumo.pctPago.toFixed(1) + "%"],
      ["A pagar a terceiros", fmtBRL(d.resumo.custoPendente), d.resumo.custo > 0 ? (d.resumo.custoPendente / d.resumo.custo * 100).toFixed(1) + "%" : "0%"]
    ],
    theme: "grid",
    headStyles: { fillColor: [139, 92, 246], fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    alternateRowStyles: { fillColor: [249, 250, 251] }
  })
  y = (doc as any).lastAutoTable.finalY + 6

  if (d.resumo.vencidasCount > 0) {
    y = pdfObs(doc, y, `Atenção: ${d.resumo.vencidasCount} fatura(s) vencida(s) totalizando ${fmtBRL(d.resumo.vencido)}. Recomenda-se cobrança imediata.`, "alerta")
  }
  if (d.resumo.margem > 70) pdfObs(doc, y, `Margem saudável (${d.resumo.margem.toFixed(1)}%).`, "sucesso")
  else if (d.resumo.margem > 0) pdfObs(doc, y, `Margem de ${d.resumo.margem.toFixed(1)}%.`, "info")

  finalizarPDF(doc, `Resumo_Executivo_${d.ctx.nome.replace(/\s/g, "_")}.pdf`)
}

export function gerarExtratoReceitasPDF(d: DadosRelatorio) {
  const doc = new jsPDF()
  pdfCapa(doc, "Extrato de Receitas", "Valores cobrados e recebidos do cliente", d.ctx)

  doc.addPage()
  pdfHeader(doc, "Extrato de Receitas", d.ctx)
  let y = 32
  y = pdfSecao(doc, y, "Faturas", `${d.faturas.length} fatura(s)`)

  const rows = d.faturas.map(f => [
    f.descricao,
    fmtDataBR(f.dataVencimento),
    `${f.moeda} ${fmt(f.valor, f.moeda as MoedaV2).replace(/^[A-Z€$R\s]+/, "")}${f.moeda !== "BRL" ? `\n(${fmtBRL(f.valorTotalBRL)})` : ""}`,
    fmtBRL(f.valorPagoBRL),
    fmtBRL(f.valorRestanteBRL),
    f.status
  ])
  if (d.pastaTotal > 0) {
    const st = d.pastaPago >= d.pastaTotal - 0.005 ? "PAGO" : d.pastaPago > 0 ? "PARCIAL" : "PENDENTE"
    rows.push([
      "Pasta Documental (consolidado)", "—",
      `BRL ${fmt(d.pastaTotal, "BRL").replace(/^R\$\s/, "")}`,
      fmtBRL(d.pastaPago),
      fmtBRL(d.pastaTotal - d.pastaPago),
      st
    ])
  }

  const autoTable = (doc as any).autoTable
  autoTable({
    startY: y,
    head: [["DESCRIÇÃO", "VENCIMENTO", "VALOR", "RECEBIDO", "RESTANTE", "STATUS"]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: [34, 197, 94], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "center" } },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    didParseCell: (data: any) => {
      if (data.column.index === 5 && data.section === "body") {
        const st = data.cell.text[0]
        if (st === "PAGO") { data.cell.styles.textColor = [34, 197, 94]; data.cell.styles.fontStyle = "bold" }
        else if (st === "PARCIAL") { data.cell.styles.textColor = [59, 130, 246]; data.cell.styles.fontStyle = "bold" }
        else if (st === "VENCIDO") { data.cell.styles.textColor = [239, 68, 68]; data.cell.styles.fontStyle = "bold" }
      }
    }
  })
  let y2 = (doc as any).lastAutoTable.finalY + 8

  const pagsEnriq: any[] = []
  d.faturas.forEach(f => {
    pagamentosAtivos(f).forEach(p => {
      const cam = f.moeda === "BRL" ? 1 : Number(p.cambio || f.cambio || 1)
      pagsEnriq.push({
        data: p.data, fatura: f.descricao, pagador: nomeDoPagador(p),
        forma: p.formaPagamento || "—", moeda: f.moeda,
        valorOrig: p.valor, valorBRL: p.valor * cam, anexo: p.comprovanteUrl ? "Sim" : "Não"
      })
    })
  })
  if (pagsEnriq.length > 0) {
    if (y2 > 230) { doc.addPage(); pdfHeader(doc, "Extrato de Receitas", d.ctx); y2 = 32 }
    y2 = pdfSecao(doc, y2, "Histórico de Pagamentos Recebidos", `${pagsEnriq.length} pagamento(s)`)
    autoTable({
      startY: y2,
      head: [["DATA", "FATURA", "PAGADOR", "FORMA", "VALOR", "ANEXO"]],
      body: pagsEnriq.map(p => [
        fmtDataBR(p.data), p.fatura, p.pagador, p.forma,
        p.moeda === "BRL" ? fmtBRL(p.valorBRL) : `${fmt(p.valorOrig, p.moeda)}\n(${fmtBRL(p.valorBRL)})`,
        p.anexo
      ]),
      theme: "grid",
      headStyles: { fillColor: [34, 197, 94], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 4: { halign: "right" }, 5: { halign: "center" } },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    })
  }

  finalizarPDF(doc, `Extrato_Receitas_${d.ctx.nome.replace(/\s/g, "_")}.pdf`)
}

export function gerarExtratoCustosPDF(d: DadosRelatorio) {
  const doc = new jsPDF()
  pdfCapa(doc, "Extrato de Custos", "Pagamentos a fornecedores e terceiros", d.ctx)

  doc.addPage()
  pdfHeader(doc, "Extrato de Custos", d.ctx)
  let y = 32

  if (d.pastaDetalhes.length > 0) {
    y = pdfSecao(doc, y, "Pasta Documental", `${d.pastaDetalhes.length} item(ns)`)
    const autoTable = (doc as any).autoTable
    autoTable({
      startY: y,
      head: [["PESSOA", "SERVIÇO", "REGISTRO", "VALOR"]],
      body: d.pastaDetalhes.map(p => [p.pessoa, p.servico, p.registro, fmtBRL(p.valor)]),
      foot: [["", "", "TOTAL", fmtBRL(d.pastaTotal)]],
      theme: "grid",
      headStyles: { fillColor: [239, 68, 68], fontSize: 9 },
      footStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 3: { halign: "right" } },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    })
    y = (doc as any).lastAutoTable.finalY + 8
  }

  if (d.contasPagar.length > 0) {
    if (y > 240) { doc.addPage(); pdfHeader(doc, "Extrato de Custos", d.ctx); y = 32 }
    y = pdfSecao(doc, y, "Contas a Pagar", `${d.contasPagar.length} lançamento(s)`)
    const autoTable = (doc as any).autoTable
    autoTable({
      startY: y,
      head: [["DESCRIÇÃO", "FORNECEDOR", "VENCIMENTO", "VALOR", "PAGO", "STATUS"]],
      body: d.contasPagar.map(c => [
        c.descricao, c.fornecedor || "—",
        fmtDataBR(c.dataVencimento),
        fmtBRL(c.valor), fmtBRL(c.valorPago || 0), c.status
      ]),
      theme: "grid",
      headStyles: { fillColor: [239, 68, 68], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "center" } },
      alternateRowStyles: { fillColor: [249, 250, 251] }
    })
  }

  finalizarPDF(doc, `Extrato_Custos_${d.ctx.nome.replace(/\s/g, "_")}.pdf`)
}

export function gerarPrestacaoContasPDF(d: DadosRelatorio) {
  const doc = new jsPDF()
  pdfCapa(doc, "Prestação de Contas", "Documento formal completo do processo", d.ctx)

  doc.addPage()
  pdfHeader(doc, "Prestação de Contas", d.ctx)
  let y = 32
  y = pdfSecao(doc, y, "Resumo Executivo", "Fechamento financeiro")

  pdfKPI(doc, 15, y, 42, 24, "RECEITA", fmtBRL(d.resumo.totalCobrado), PDF_CORES.green)
  pdfKPI(doc, 61, y, 42, 24, "CUSTO", fmtBRL(d.resumo.custo), PDF_CORES.red)
  pdfKPI(doc, 107, y, 42, 24, "LUCRO", fmtBRL(d.resumo.lucro), PDF_CORES.blue)
  pdfKPI(doc, 153, y, 42, 24, "MARGEM", d.resumo.margem.toFixed(1) + "%", PDF_CORES.primary)
  y += 30

  y = pdfSecao(doc, y, "Balanço Geral", "")
  const autoTable = (doc as any).autoTable
  autoTable({
    startY: y,
    body: [
      ["(+) Total recebido", fmtBRL(d.resumo.recebido)],
      ["(+) A receber", fmtBRL(d.resumo.aReceber)],
      ["(-) Total pago", "-" + fmtBRL(d.resumo.custoPago)],
      ["(-) A pagar", "-" + fmtBRL(d.resumo.custoPendente)],
      [
        { content: "= SALDO ATUAL", styles: { fontStyle: "bold", fillColor: [31, 41, 55], textColor: 255 } },
        { content: fmtBRL(d.resumo.recebido - d.resumo.custoPago), styles: { fontStyle: "bold", fillColor: [31, 41, 55], textColor: 255, halign: "right" } }
      ]
    ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 1: { halign: "right" } }
  })

  doc.addPage()
  pdfHeader(doc, "Prestação de Contas", d.ctx)
  y = 40
  y = pdfSecao(doc, y, "Declaração Formal", "")
  y += 4
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  const texto = `A Discovery Assessoria em Dupla Cidadania e Imigração LTDA, CNPJ 36.897.530/0001-21, declara que o processo "${d.ctx.nome}" apresenta os valores constantes neste documento, referentes a recebimentos de clientes e pagamentos efetuados a terceiros.\n\nTodos os valores encontram-se devidamente registrados em nosso sistema interno de gestão, com comprovantes arquivados. Esta prestação de contas foi gerada automaticamente em ${fmtDataBR(new Date())} e reflete a situação financeira até a data de emissão.`
  const linhas = doc.splitTextToSize(texto, 180)
  doc.text(linhas, 15, y)
  y += linhas.length * 5 + 20

  doc.line(60, y, 150, y); y += 5
  doc.setFontSize(9)
  doc.text("Discovery Assessoria D.C.I. LTDA", 105, y, { align: "center" })

  finalizarPDF(doc, `Prestacao_de_Contas_${d.ctx.nome.replace(/\s/g, "_")}.pdf`)
}

export function gerarDREPDF(d: DadosRelatorio) {
  const doc = new jsPDF()
  pdfCapa(doc, "DRE do Processo", "Demonstrativo de Resultado do Exercício", d.ctx)

  doc.addPage()
  pdfHeader(doc, "DRE", d.ctx)
  let y = 32
  y = pdfSecao(doc, y, "Demonstrativo de Resultado", "Estrutura formal")

  const autoTable = (doc as any).autoTable
  autoTable({
    startY: y,
    body: [
      [{ content: "RECEITA BRUTA", colSpan: 2, styles: { fillColor: [220, 252, 231], fontStyle: "bold" } }],
      ["  Faturas", fmtBRL(d.resumo.totalCobrado - d.pastaTotal)],
      ["  Pasta Documental", fmtBRL(d.pastaTotal)],
      [{ content: "(=) RECEITA OPERACIONAL", styles: { fontStyle: "bold" } }, { content: fmtBRL(d.resumo.totalCobrado), styles: { fontStyle: "bold", halign: "right" } }],
      [""],
      [{ content: "CUSTOS", colSpan: 2, styles: { fillColor: [254, 226, 226], fontStyle: "bold" } }],
      ["  (-) Pasta Documental", "-" + fmtBRL(d.pastaTotal)],
      ["  (-) Contas a Pagar", "-" + fmtBRL(Math.max(0, d.resumo.custo - d.pastaTotal))],
      [{ content: "(=) TOTAL CUSTOS", styles: { fontStyle: "bold" } }, { content: "-" + fmtBRL(d.resumo.custo), styles: { fontStyle: "bold", halign: "right" } }],
      [""],
      [
        { content: "(=) LUCRO BRUTO", styles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold" } },
        { content: fmtBRL(d.resumo.lucro), styles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold", halign: "right" } }
      ],
      [
        { content: "MARGEM BRUTA", styles: { fillColor: [139, 92, 246], textColor: 255, fontStyle: "bold" } },
        { content: d.resumo.margem.toFixed(2) + "%", styles: { fillColor: [139, 92, 246], textColor: 255, fontStyle: "bold", halign: "right" } }
      ]
    ],
    theme: "plain",
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: { 1: { halign: "right" } }
  })

  finalizarPDF(doc, `DRE_${d.ctx.nome.replace(/\s/g, "_")}.pdf`)
}