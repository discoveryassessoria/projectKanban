// src/lib/relatorios/motor/exportar.ts
//
// EXPORTAÇÃO — CSV, Excel e PDF.
//
// ─── UMA COLETA SÓ ──────────────────────────────────────────────────────────
// Os três formatos saem de `coletar`, que por sua vez chama `executar` — o
// MESMO caminho da tela. Se cada formato tivesse a própria consulta, o Excel
// acabaria trazendo linha que o CSV não trouxe, e ninguém descobriria até
// alguém conferir à mão. É o defeito clássico de relatório.
//
// ─── O ARQUIVO DIZ O QUE ELE É ──────────────────────────────────────────────
// Planilha que circula por e-mail perde o contexto da tela em que nasceu. Por
// isso o Excel e o PDF carregam, no próprio arquivo, o domínio, a data da
// extração, a nacionalidade e os filtros aplicados. Sem isso, dois arquivos com
// o mesmo nome e números diferentes são indistinguíveis — e o errado ganha a
// discussão porque ninguém sabe qual é qual.
//
// ─── O TETO É DECLARADO, NUNCA SILENCIOSO ───────────────────────────────────
// Acima do teto a extração PARA e diz que parou, no arquivo e na resposta.
// Cortar em silêncio produz um total que não bate com o detalhe — exatamente o
// que a regra de consistência do motor existe para impedir.

import { executar, type LinhaResultado, type Resultado } from "./executar"
import type { PermissaoChave } from "@/src/lib/permissoes"
import type { DominioDef, QuerySpec } from "./tipos"

export type FormatoExportacao = "csv" | "xlsx" | "pdf"

export const TETO_PADRAO = 20000

export interface DadosExportacao {
  dominio: string
  titulo: string
  grain: string
  colunas: { key: string; rotulo: string; alinhamento?: string }[]
  linhas: LinhaResultado[]
  /** COUNT global — o que existe, mesmo que a extração tenha parado antes. */
  total: number
  /** Quantas linhas o arquivo realmente carrega. */
  extraidas: number
  truncado: boolean
  aplicados: Resultado["aplicados"]
  extraidoEm: Date
}

/**
 * A coleta única. Pagina pelo mesmo `executar` que serve a tela — e recebe o
 * MESMO `pode`: se o export não conferisse a permissão de coluna, o vazamento
 * apenas mudaria de porta, do relatório para o botão Exportar.
 */
export async function coletar(
  dominio: DominioDef, spec: QuerySpec, teto = TETO_PADRAO,
  pode?: (chave: PermissaoChave) => boolean,
): Promise<DadosExportacao> {
  const cabeca = await executar(dominio, { ...spec, pagina: 1, porPagina: 1 }, pode)
  const alvo = Math.min(cabeca.total, teto)

  const linhas: LinhaResultado[] = []
  const lote = 200
  for (let p = 1; (p - 1) * lote < alvo; p++) {
    const parte = await executar(dominio, { ...spec, pagina: p, porPagina: lote }, pode)
    linhas.push(...parte.linhas)
    if (parte.linhas.length === 0) break
  }
  const extraidas = Math.min(linhas.length, alvo)

  return {
    dominio: dominio.key,
    titulo: dominio.rotulo,
    grain: cabeca.grain,
    colunas: cabeca.colunas,
    linhas: linhas.slice(0, alvo),
    total: cabeca.total,
    extraidas,
    truncado: cabeca.total > alvo,
    aplicados: cabeca.aplicados,
    extraidoEm: new Date(),
  }
}

const dataHora = (d: Date) =>
  d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })

/** As linhas de contexto que abrem o Excel e o PDF. */
function contexto(d: DadosExportacao): string[] {
  const linhas = [
    `${d.titulo} — ${d.grain}`,
    `Extraído em ${dataHora(d.extraidoEm)}`,
  ]
  if (d.aplicados.length) {
    linhas.push(`Filtros: ${d.aplicados.map((a) => `${a.rotulo}: ${a.descricao}`).join(" · ")}`)
  } else {
    linhas.push("Filtros: nenhum — a base inteira do domínio")
  }
  linhas.push(
    d.truncado
      ? `ATENÇÃO: ${d.total} registro(s) atendem à consulta; este arquivo traz os ${d.extraidas} primeiros.`
      : `${d.total} registro(s) — o arquivo traz todos.`,
  )
  return linhas
}

// ════════════════════════════════════════════════════════════════════════════
// CSV
// ════════════════════════════════════════════════════════════════════════════

export function paraCsv(d: DadosExportacao): string {
  const escapar = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`
  const cab = d.colunas.map((c) => c.rotulo)
  const corpo = d.linhas.map((l) => l.celulas.map((c) => c.valor ?? ""))
  // BOM para o Excel abrir a acentuação corretamente.
  return "﻿" + [cab, ...corpo].map((l) => l.map(escapar).join(";")).join("\n")
}

// ════════════════════════════════════════════════════════════════════════════
// EXCEL
// ════════════════════════════════════════════════════════════════════════════

export async function paraXlsx(d: DadosExportacao): Promise<Buffer> {
  // `exceljs` é CommonJS: sob ESM o namespace vem com o módulo em `default`, e
  // desestruturar `Workbook` direto devolve `undefined`. Aceita os dois formatos.
  const mod = await import("exceljs")
  const Workbook = (mod as { Workbook?: typeof import("exceljs").Workbook }).Workbook
    ?? (mod as unknown as { default: { Workbook: typeof import("exceljs").Workbook } }).default.Workbook
  const wb = new Workbook()
  wb.creator = "Discovery"
  wb.created = d.extraidoEm

  const ws = wb.addWorksheet(d.titulo.slice(0, 28) || "Relatório", {
    views: [{ state: "frozen", ySplit: contexto(d).length + 2 }],
  })

  for (const linha of contexto(d)) {
    const r = ws.addRow([linha])
    r.font = { size: 10, color: { argb: "FF555555" } }
  }
  ws.addRow([])

  const cabecalho = ws.addRow(d.colunas.map((c) => c.rotulo))
  cabecalho.font = { bold: true, color: { argb: "FFFFFFFF" } }
  cabecalho.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2875B7" } }
    c.alignment = { vertical: "middle" }
  })

  for (const l of d.linhas) {
    // Número continua número na planilha: exportar tudo como texto quebra
    // soma, média e ordenação — que é para o que a pessoa abre o Excel.
    ws.addRow(l.celulas.map((c) => (typeof c.valor === "number" ? c.valor : (c.valor ?? ""))))
  }

  ws.columns.forEach((col, i) => {
    const rotulo = d.colunas[i]?.rotulo ?? ""
    let maior = rotulo.length
    for (const l of d.linhas) {
      const v = l.celulas[i]?.valor
      if (v != null) maior = Math.max(maior, String(v).length)
    }
    col.width = Math.min(Math.max(maior + 2, 10), 60)
  })

  ws.autoFilter = {
    from: { row: contexto(d).length + 2, column: 1 },
    to: { row: contexto(d).length + 2, column: Math.max(d.colunas.length, 1) },
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ════════════════════════════════════════════════════════════════════════════
// PDF
// ════════════════════════════════════════════════════════════════════════════

export async function paraPdf(d: DadosExportacao): Promise<Buffer> {
  const jsPDF = (await import("jspdf")).default
  const autoTable = (await import("jspdf-autotable")).default

  // Paisagem: relatório com muitas colunas em retrato vira coluna ilegível.
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
  const largura = doc.internal.pageSize.getWidth()

  doc.setFont("helvetica", "bold"); doc.setFontSize(14)
  doc.text(d.titulo, 32, 40)

  doc.setFont("helvetica", "normal"); doc.setFontSize(9)
  doc.setTextColor(90)
  let y = 56
  for (const linha of contexto(d).slice(1)) {
    for (const pedaco of doc.splitTextToSize(linha, largura - 64) as string[]) {
      doc.text(pedaco, 32, y); y += 12
    }
  }
  doc.setTextColor(0)

  autoTable(doc, {
    startY: y + 8,
    head: [d.colunas.map((c) => c.rotulo)],
    body: d.linhas.map((l) => l.celulas.map((c) => (c.valor == null ? "" : String(c.valor)))),
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [40, 117, 183], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 249, 252] },
    margin: { left: 32, right: 32, bottom: 34 },
    didDrawPage: () => {
      // `doc.internal.pages` é o array de páginas do jsPDF, com a posição 0
      // vazia — daí o −1. Usado no lugar de `getNumberOfPages()`, que não existe
      // na tipagem e só quebraria na verificação de tipos do build.
      const pagina = doc.internal.pages.length - 1
      const altura = doc.internal.pageSize.getHeight()
      doc.setFontSize(8); doc.setTextColor(120)
      doc.text(`${d.titulo} · ${dataHora(d.extraidoEm)}`, 32, altura - 16)
      doc.text(`página ${pagina}`, largura - 32, altura - 16, { align: "right" })
      doc.setTextColor(0)
    },
  })

  return Buffer.from(doc.output("arraybuffer"))
}

// ════════════════════════════════════════════════════════════════════════════

export const TIPO_MIME: Record<FormatoExportacao, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
}

export async function exportar(
  dominio: DominioDef, spec: QuerySpec, formato: FormatoExportacao, teto = TETO_PADRAO,
  pode?: (chave: PermissaoChave) => boolean,
): Promise<{ corpo: Buffer; nome: string; dados: DadosExportacao }> {
  const dados = await coletar(dominio, spec, teto, pode)
  const corpo =
    formato === "xlsx" ? await paraXlsx(dados)
    : formato === "pdf" ? await paraPdf(dados)
    : Buffer.from(paraCsv(dados), "utf8")
  const nome = `${dominio.key}-${dados.extraidoEm.toISOString().slice(0, 10)}.${formato}`
  return { corpo, nome, dados }
}
