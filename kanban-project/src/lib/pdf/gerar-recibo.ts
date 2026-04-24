// src/lib/pdf/gerar-recibo.ts

import jsPDF from "jspdf"
import "jspdf-autotable"
import { fmt, fmtBRL, fmtDataBR, today, valorPorExtenso } from "@/src/lib/financeiro/helpers"
import { DADOS_EMPRESA, PDF_CORES, fill, textColor } from "./pdf-base"
import type { MoedaV2, ProcessoContext } from "@/src/types/financeiro"

export interface DadosRecibo {
  numero: string
  dataEmissao: string
  valorTotal: number
  pagadorNome: string
  pagadorEndereco?: string
  descricao: string
  origem: string
  etapa?: string | null
  dataPagamento: string
  formaPagamento: string
  moedaOriginal?: MoedaV2
  valorOriginal?: number
  cambio?: number
  comprovante?: string
  temAnexo: boolean
  processoCtx: ProcessoContext
}

export function gerarReciboIndividualPDF(dados: DadosRecibo) {
  const doc = new jsPDF()
  const W = 210, H = 297

  fill(doc, PDF_CORES.primary)
  doc.rect(0, 0, W, 50, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.setFont("helvetica", "bold")
  doc.text("DISCOVERY", 15, 20)
  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.text(DADOS_EMPRESA.nome, 15, 27)
  doc.text(`CNPJ: ${DADOS_EMPRESA.cnpj}`, 15, 32)
  doc.text(DADOS_EMPRESA.endereco, 15, 37)

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(140, 12, 55, 30, 3, 3, "F")
  textColor(doc, PDF_CORES.gray)
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  doc.text("RECIBO Nº", 167.5, 20, { align: "center" })
  textColor(doc, PDF_CORES.primary)
  doc.setFontSize(18)
  doc.text(dados.numero, 167.5, 30, { align: "center" })
  textColor(doc, PDF_CORES.gray)
  doc.setFontSize(7)
  doc.setFont("helvetica", "normal")
  doc.text(`Emitido em ${fmtDataBR(dados.dataEmissao)}`, 167.5, 37, { align: "center" })

  fill(doc, PDF_CORES.green)
  doc.rect(0, 55, W, 35, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont("helvetica", "normal")
  doc.text("VALOR RECEBIDO", 15, 66)
  doc.setFontSize(32)
  doc.setFont("helvetica", "bold")
  doc.text(fmtBRL(dados.valorTotal), 15, 80)
  if (dados.moedaOriginal && dados.moedaOriginal !== "BRL" && dados.valorOriginal) {
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.text(
      `Valor original: ${fmt(dados.valorOriginal, dados.moedaOriginal)} · Câmbio: ${(dados.cambio || 1).toFixed(4)}`,
      15, 87
    )
  }

  let y = 105
  textColor(doc, PDF_CORES.dark)
  doc.setFontSize(11)
  doc.setFont("helvetica", "normal")
  doc.text("Recebemos de:", 15, y); y += 8
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text(dados.pagadorNome, 15, y); y += 8
  if (dados.pagadorEndereco) {
    doc.setFontSize(9)
    doc.setFont("helvetica", "normal")
    textColor(doc, PDF_CORES.gray)
    doc.text(dados.pagadorEndereco, 15, y, { maxWidth: 180 }); y += 6
    textColor(doc, PDF_CORES.dark)
  }

  doc.setFontSize(10)
  doc.setFont("helvetica", "italic")
  doc.text(`a importância de ${valorPorExtenso(dados.valorTotal)},`, 15, y); y += 6
  doc.text("referente aos serviços abaixo discriminados:", 15, y); y += 12

  const autoTable = (doc as any).autoTable
  autoTable({
    startY: y,
    body: [
      ["Descrição", dados.descricao],
      ["Origem", dados.origem],
      ["Processo", `${dados.processoCtx.nome} — ${dados.processoCtx.pais}`],
      ["Etapa", dados.etapa || "—"],
      ["Data do pagamento", fmtDataBR(dados.dataPagamento)],
      ["Forma de pagamento", dados.formaPagamento],
      ["Comprovante", dados.comprovante || "—"],
      ["Anexo digital", dados.temAnexo ? "Sim (arquivado no sistema)" : "Não"]
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: [249, 250, 251], cellWidth: 50 },
      1: { cellWidth: 130 },
    },
  })
  y = (doc as any).lastAutoTable.finalY + 15

  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  const decl =
    "Declaramos, para os devidos fins, que recebemos a importância acima, dando total quitação do valor referente ao serviço prestado. Este recibo é emitido em via única, para controle do pagador."
  const declLinhas = doc.splitTextToSize(decl, 180)
  doc.text(declLinhas, 15, y); y += declLinhas.length * 5 + 15

  doc.text(`${DADOS_EMPRESA.cidade}, ${fmtDataBR(today())}`, 15, y); y += 20
  doc.line(60, y, 150, y); y += 5
  doc.setFontSize(9)
  doc.text(DADOS_EMPRESA.nome.split(" LTDA")[0], 105, y, { align: "center" }); y += 4
  doc.text(`CNPJ: ${DADOS_EMPRESA.cnpj}`, 105, y, { align: "center" })

  fill(doc, PDF_CORES.lightGray)
  doc.rect(0, H - 12, W, 12, "F")
  textColor(doc, PDF_CORES.gray)
  doc.setFontSize(7)
  doc.text(
    `Recibo ${dados.numero} · Emitido em ${fmtDataBR(dados.dataEmissao)} · ${new Date().toLocaleTimeString("pt-BR")}`,
    W / 2, H - 6, { align: "center" }
  )
  doc.text("Documento válido como comprovante de pagamento", W / 2, H - 3, { align: "center" })

  doc.save(`Recibo_${dados.numero}_${dados.pagadorNome.replace(/\s/g, "_")}.pdf`)
}