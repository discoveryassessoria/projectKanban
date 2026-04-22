// src/lib/pdf/pdf-base.ts
// ⚠ INSTALAR depois: npm install jspdf jspdf-autotable

import jsPDF from "jspdf"
import "jspdf-autotable"
import { fmtDataBR, today } from "@/src/lib/financeiro/helpers-v2"
import type { ProcessoContext } from "@/src/types/financeiro-v2"

export type RGB = readonly [number, number, number]

export const PDF_CORES = {
  primary: [139, 92, 246] as RGB,
  green: [34, 197, 94] as RGB,
  red: [239, 68, 68] as RGB,
  orange: [245, 158, 11] as RGB,
  blue: [59, 130, 246] as RGB,
  dark: [31, 41, 55] as RGB,
  gray: [107, 114, 128] as RGB,
  lightGray: [243, 244, 246] as RGB,
  border: [229, 231, 235] as RGB,
}

export const DADOS_EMPRESA = {
  nome: "Discovery Assessoria em Dupla Cidadania e Imigração LTDA",
  cnpj: "36.897.530/0001-21",
  endereco: "Rua José Fontana 120 Sala 01 · Centro · Amparo/SP · CEP 13900-480",
  cidade: "Amparo/SP",
}

export function fill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]) }
export function stroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]) }
export function textColor(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]) }

export function pdfCapa(doc: jsPDF, titulo: string, subtitulo: string, ctx: ProcessoContext) {
  const W = 210
  fill(doc, PDF_CORES.primary)
  doc.rect(0, 0, W, 85, "F")

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(24)
  doc.setFont("helvetica", "bold")
  doc.text("DISCOVERY", 15, 30)
  doc.setFontSize(11)
  doc.setFont("helvetica", "normal")
  doc.text("Assessoria em Dupla Cidadania e Imigração", 15, 38)
  doc.setFontSize(28)
  doc.setFont("helvetica", "bold")
  doc.text(titulo.toUpperCase(), 15, 65)
  if (subtitulo) {
    doc.setFontSize(12)
    doc.setFont("helvetica", "normal")
    doc.text(subtitulo, 15, 75)
  }

  fill(doc, PDF_CORES.lightGray)
  doc.roundedRect(15, 100, 180, 60, 4, 4, "F")
  stroke(doc, PDF_CORES.border)
  doc.roundedRect(15, 100, 180, 60, 4, 4, "S")

  textColor(doc, PDF_CORES.gray)
  doc.setFontSize(9)
  doc.setFont("helvetica", "bold")
  doc.text("PROCESSO", 22, 112)
  doc.text("PAÍS DESTINO", 22, 128)
  doc.text("ETAPA ATUAL", 22, 144)
  doc.text("EMITIDO EM", 110, 112)
  doc.text("REQUERENTES", 110, 128)
  doc.text("CNPJ", 110, 144)

  textColor(doc, PDF_CORES.dark)
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.text(ctx.nome || "—", 22, 120)
  doc.text(ctx.pais || "—", 22, 136)
  doc.text(ctx.etapaAtual || "—", 22, 152)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text(fmtDataBR(today()), 110, 120)
  const req = ctx.requerentes.length > 0
    ? ctx.requerentes.map(r => r.split(" ").slice(0, 2).join(" ")).join(", ")
    : "—"
  doc.text(req, 110, 136, { maxWidth: 85 })
  doc.text(DADOS_EMPRESA.cnpj, 110, 152)

  fill(doc, PDF_CORES.dark)
  doc.rect(0, 270, W, 27, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont("helvetica", "bold")
  doc.text(DADOS_EMPRESA.nome, 15, 280)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.text(DADOS_EMPRESA.endereco, 15, 286)
  doc.text(`CNPJ: ${DADOS_EMPRESA.cnpj}`, 15, 292)
}

export function pdfHeader(doc: jsPDF, titulo: string, ctx: ProcessoContext) {
  const W = 210
  fill(doc, PDF_CORES.primary)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont("helvetica", "bold")
  doc.text("DISCOVERY", 15, 10)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8)
  doc.text(`${ctx.nome} · ${ctx.pais}`, 15, 16)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.text(titulo, W / 2, 13, { align: "center" })
  textColor(doc, PDF_CORES.dark)
}

export function pdfKPI(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  label: string, valor: string, cor: RGB, subLabel?: string
) {
  fill(doc, cor)
  doc.roundedRect(x, y, w, h, 3, 3, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont("helvetica", "bold")
  doc.text(label.toUpperCase(), x + 4, y + 6)
  doc.setFontSize(13)
  doc.text(valor, x + 4, y + 14)
  if (subLabel) {
    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.text(subLabel, x + 4, y + 19)
  }
  textColor(doc, PDF_CORES.dark)
}

export function pdfSecao(doc: jsPDF, y: number, titulo: string, subtitulo?: string): number {
  fill(doc, PDF_CORES.primary)
  doc.rect(15, y, 4, 10, "F")
  textColor(doc, PDF_CORES.dark)
  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text(titulo, 22, y + 7)
  if (subtitulo) {
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    textColor(doc, PDF_CORES.gray)
    doc.text(subtitulo, 22, y + 12)
  }
  textColor(doc, PDF_CORES.dark)
  return y + 16
}

export function pdfObs(
  doc: jsPDF, y: number, texto: string,
  tipo: "info" | "sucesso" | "alerta" | "erro" = "info"
): number {
  const cor: RGB = tipo === "sucesso" ? PDF_CORES.green
    : tipo === "alerta" ? PDF_CORES.orange
    : tipo === "erro" ? PDF_CORES.red
    : PDF_CORES.blue
  const corBG: RGB = tipo === "sucesso" ? [220, 252, 231]
    : tipo === "alerta" ? [254, 243, 199]
    : tipo === "erro" ? [254, 226, 226]
    : [219, 234, 254]
  const linhas = doc.splitTextToSize(texto, 165)
  const h = 8 + linhas.length * 4.5
  fill(doc, corBG)
  doc.roundedRect(15, y, 180, h, 2, 2, "F")
  fill(doc, cor)
  doc.rect(15, y, 2, h, "F")
  textColor(doc, cor)
  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.text(tipo === "sucesso" ? "✓" : tipo === "alerta" ? "!" : tipo === "erro" ? "⚠" : "i", 20, y + 6)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  textColor(doc, PDF_CORES.dark)
  doc.text(linhas, 26, y + 6)
  return y + h + 4
}

export function finalizarPDF(doc: jsPDF, nomeArquivo: string) {
  const total = doc.internal.getNumberOfPages()
  const W = 210, H = 297
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    fill(doc, PDF_CORES.lightGray)
    doc.rect(0, H - 15, W, 15, "F")
    textColor(doc, PDF_CORES.gray)
    doc.setFontSize(7)
    doc.setFont("helvetica", "normal")
    doc.text(
      `${DADOS_EMPRESA.nome} · CNPJ ${DADOS_EMPRESA.cnpj}`,
      W / 2, H - 7, { align: "center" }
    )
    doc.text(
      `Gerado em ${fmtDataBR(today())} · Página ${i} de ${total}`,
      W / 2, H - 3, { align: "center" }
    )
    textColor(doc, PDF_CORES.dark)
  }
  doc.save(nomeArquivo)
}