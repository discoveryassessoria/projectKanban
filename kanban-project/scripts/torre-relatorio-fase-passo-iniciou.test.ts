// scripts/torre-relatorio-fase-passo-iniciou.test.ts
// ============================================================================
// TORRE NOVA (01/10/2026) — RELATÓRIO DE CONTROLE DO DETALHE DO PROCESSO: colunas Fase, Passo e Iniciou (do protótipo) JUNTO das
// que já existiam (Certidão, Pessoa, Geração, Situação, Responsável, Prazo) — na PRÉVIA e nos arquivos CSV / Excel / PDF.
//
//   node scripts/ci/gate-build.mjs --so torre-relatorio-fase-passo-iniciou      (banco de teste descartável)
//
// Dados reais do banco de teste: tarefas materializadas pelo motor (fixture), certidões da categoria REGISTRO_CIVIL, uma tarefa com
// início registrado (`Tarefa.dataInicio`) e outra sem (registro antigo → "—", nunca inventado).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-relatorio-fase-passo-iniciou.test.ts")

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { COLUNAS_DO_RELATORIO_DE_CONTROLE, ROTULOS_DO_RELATORIO_DE_CONTROLE } from "../lib/operacional/torre-relatorio-colunas"
import { DOMINIO_CERTIDOES, CATEGORIA_CERTIDAO } from "../src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "../src/lib/relatorios/motor/executar"
import { POST as postExportar } from "../src/app/api/relatorios/exportar/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "RELCTL"

async function main() {
  secao("as listas do componente e do motor")
  const modal = readFileSync("src/components/torre/ProcessoRelatorio.tsx", "utf8")
  const aba = readFileSync("src/components/torre/RelatorioControle.tsx", "utf8")
  ok("a prévia (Detalhe) e as exportações (Detalhe e aba Processos) pedem a MESMA lista de colunas", /COLUNAS_DO_RELATORIO_DE_CONTROLE/.test(modal) && /colunas: \[\.\.\.COLUNAS_DO_RELATORIO_DE_CONTROLE\]/.test(aba) && /colunas: COLUNAS,/.test(modal) && /\.\.\.spec, formato/.test(modal))
  ok("as colunas mantêm as existentes e acrescentam Fase, Passo e Iniciou", ["tipo", "pessoa", "geracao", "status", "responsavel_tarefa", "prazo"].every((k) => (COLUNAS_DO_RELATORIO_DE_CONTROLE as readonly string[]).includes(k)) && ["fase_certidao", "passo", "iniciou"].every((k) => (COLUNAS_DO_RELATORIO_DE_CONTROLE as readonly string[]).includes(k)))
  ok("todas existem no domínio de Certidões do motor, com os rótulos esperados", COLUNAS_DO_RELATORIO_DE_CONTROLE.map((k) => DOMINIO_CERTIDOES.colunas.find((c) => c.key === k)?.rotulo).join("|") === ROTULOS_DO_RELATORIO_DE_CONTROLE.join("|"), COLUNAS_DO_RELATORIO_DE_CONTROLE.map((k) => DOMINIO_CERTIDOES.colunas.find((c) => c.key === k)?.rotulo).join("|"))

  const c = await montarCenario(MARCA)
  const usuarios: number[] = []
  try {
    const admin = await prisma.usuario.create({ data: { nome: "Marco Rovatti", email: `${MARCA.toLowerCase()}-m@t.com`, senha: "x", tipo: "admin" } })
    const daniela = await prisma.usuario.create({ data: { nome: "Daniela Brait", email: `${MARCA.toLowerCase()}-d@t.com`, senha: "x", tipo: "assistente" } })
    usuarios.push(admin.id, daniela.id)
    const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })

    // Categoria "Registro civil" + item de certidão (o cadastro vem vazio no banco do gate).
    const cat = (await prisma.categoriaDocumental.findUnique({ where: { code: CATEGORIA_CERTIDAO } })) ?? await prisma.categoriaDocumental.create({ data: { code: CATEGORIA_CERTIDAO, name: `${MARCA} Registro civil` } })
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}-ITEM`, name: `${MARCA} Certidão de nascimento`, natureza: "DOCUMENTO" }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}-TIPO`, name: `${MARCA} tipo`, itemCatalogoId: item.id, categoriaDocumentalId: cat.id } })

    // Duas certidões do MESMO processo, cada uma com a tarefa materializada pelo motor.
    const o1 = await c.novaObrigacao({})
    const o2 = await c.novaObrigacao({})
    const proc = o1.processoId
    const arv = (await prisma.processo.findUniqueOrThrow({ where: { id: proc }, select: { arvoreId: true } })).arvoreId!
    await prisma.processo.update({ where: { id: o2.processoId }, data: { arvoreId: arv } }) // as duas na mesma árvore, só para ligar as pessoas
    const ligar = async (o: { tarefaId: number; processoId: number }, nome: string, tag: string, dataInicio: Date | null) => {
      const pes = await prisma.pessoa.create({ data: { arvoreId: arv, nome, sobrenome: MARCA }, select: { id: true } })
      const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${tag}` }, select: { id: true } })
      const doc = await prisma.documento.create({ data: { pessoaId: pes.id, necessidadeId: nec.id, tipo: "CERTIDAO_NASCIMENTO", status: "PENDENTE" }, select: { id: true } })
      await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { documentoId: doc.id, necessidadeId: nec.id, pessoaId: pes.id, processoId: proc, faseMacroKey: "emissao_documental", responsavelId: daniela.id, dataInicio, dataPrazo: new Date(Date.now() + 5 * 86400000) } })
      return doc.id
    }
    await ligar(o1, "Luigi", "a", new Date("2026-09-29T15:00:00-03:00"))
    await ligar(o2, "Rosa", "b", null)

    const spec = { dominio: "certidoes", filtros: [{ key: "processo", valor: { tipo: "entidade" as const, id: proc } }], colunas: [...COLUNAS_DO_RELATORIO_DE_CONTROLE], ordenarPor: "familia_geracao", direcao: "asc" as const, pagina: 1, porPagina: 100 }

    secao("PRÉVIA — o motor devolve as 9 colunas, com Fase/Passo/Iniciou da tarefa da certidão")
    const r = await executar(DOMINIO_CERTIDOES, spec as never)
    ok("9 colunas na ordem pedida", r.colunas.map((x) => x.rotulo).join("|") === ROTULOS_DO_RELATORIO_DE_CONTROLE.join("|"), r.colunas.map((x) => x.rotulo).join("|"))
    ok("2 linhas (as duas certidões)", r.linhas.length === 2, String(r.linhas.length))
    const cel = (l: (typeof r.linhas)[number], k: string) => l.celulas.find((x) => x.key === k)?.valor
    const luigi = r.linhas.find((l) => String(cel(l, "pessoa")).includes("Luigi"))!, rosa = r.linhas.find((l) => String(cel(l, "pessoa")).includes("Rosa"))!
    ok("Fase = nome da fase do cadastro (nunca a chave): 'Emissão Documental'", /Emiss[ãa]o [Dd]ocumental/.test(String(cel(luigi, "fase_certidao"))) && !/_/.test(String(cel(luigi, "fase_certidao"))), String(cel(luigi, "fase_certidao")))
    ok("Passo = o passo corrente da tarefa (rótulo, não a chave)", /Solicitar certid[ãa]o/.test(String(cel(luigi, "passo"))) && !/_/.test(String(cel(luigi, "passo"))), String(cel(luigi, "passo")))
    ok("Iniciou = o dia do início REGISTRADO (29/09/2026, fuso de São Paulo)", cel(luigi, "iniciou") === "29/09/2026", String(cel(luigi, "iniciou")))
    ok("Iniciou sem registro = '—' (nada inventado)", cel(rosa, "iniciou") === "—", String(cel(rosa, "iniciou")))
    ok("as colunas que já existiam continuam (Responsável = Daniela Brait; Prazo preenchido ou vazio sem inventar)", cel(luigi, "responsavel_tarefa") === "Daniela Brait" && cel(luigi, "status") != null)

    secao("EXPORTAÇÕES — o arquivo tem as colunas e os valores")
    const pedir = (formato: string) => postExportar(new NextRequest("http://localhost/api/relatorios/exportar", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...spec, formato }) }))
    // CSV
    const rc = await pedir("csv"); const csv = await rc.text()
    const linhasCsv = csv.replace(/^﻿/, "").split("\n")
    const cabIdx = linhasCsv.findIndex((l) => l.startsWith('"Certidão";'))
    const cab = (linhasCsv[cabIdx] ?? "").split(";").map((x) => x.replace(/^"|"$/g, ""))
    ok("CSV: cabeçalho com as 9 colunas (Certidão · Pessoa · Geração · Fase · Passo · Situação · Responsável · Iniciou · Prazo)", rc.status === 200 && cab.join("|") === ROTULOS_DO_RELATORIO_DE_CONTROLE.join("|"), cab.join("|"))
    const corpoCsv = linhasCsv.slice(cabIdx + 1).filter((l) => l.trim())
    const luigiCsv = (corpoCsv.find((l) => l.includes("Luigi")) ?? "").split(";").map((x) => x.replace(/^"|"$/g, ""))
    ok("CSV: a linha traz Fase, Passo e Iniciou (29/09/2026)", /Emiss[ãa]o/.test(luigiCsv[3] ?? "") && /Solicitar/.test(luigiCsv[4] ?? "") && luigiCsv[7] === "29/09/2026", luigiCsv.join("|"))
    const rosaCsv = (corpoCsv.find((l) => l.includes("Rosa")) ?? "").split(";").map((x) => x.replace(/^"|"$/g, ""))
    ok("CSV: Iniciou sem registro = '—'", rosaCsv[7] === "—", rosaCsv.join("|"))
    // XLSX
    const rx = await pedir("xlsx"); const buf = Buffer.from(await rx.arrayBuffer())
    const mod = await import("exceljs"); const Workbook = (mod as { Workbook?: typeof import("exceljs").Workbook }).Workbook ?? (mod as unknown as { default: { Workbook: typeof import("exceljs").Workbook } }).default.Workbook
    const wb = new Workbook(); await wb.xlsx.load(buf as never)
    const ws = wb.worksheets[0]
    const linhasX: string[][] = []
    ws.eachRow((row) => { linhasX.push((row.values as unknown[]).slice(1).map((v) => String((v as { text?: string } | null)?.text ?? v ?? ""))) })
    const cabX = linhasX.find((l) => l[0] === "Certidão") ?? []
    ok("Excel: cabeçalho com as 9 colunas", rx.status === 200 && cabX.join("|") === ROTULOS_DO_RELATORIO_DE_CONTROLE.join("|"), cabX.join("|"))
    const luigiX = linhasX.find((l) => l.join(" ").includes("Luigi")) ?? []
    ok("Excel: a linha traz Fase, Passo e Iniciou (29/09/2026)", /Emiss[ãa]o/.test(luigiX[3] ?? "") && /Solicitar/.test(luigiX[4] ?? "") && luigiX[7] === "29/09/2026", luigiX.join("|"))
    // PDF
    const rp = await pedir("pdf"); const pdf = Buffer.from(await rp.arrayBuffer())
    ok("PDF: arquivo válido, gerado do MESMO resultado (X-Relatorio-Total = 2)", rp.status === 200 && pdf.subarray(0, 4).toString() === "%PDF" && rp.headers.get("X-Relatorio-Total") === "2")
    const textoPdf = pdf.toString("latin1")
    ok("PDF: o cabeçalho da tabela traz Fase, Passo e Iniciou (e as existentes)", ROTULOS_DO_RELATORIO_DE_CONTROLE.every((rot) => textoPdf.includes(rot.normalize("NFD").replace(/[̀-ͯ]/g, "")) || textoPdf.includes(rot)), "texto do PDF lido do fluxo do arquivo")
    ok("PDF: o valor '29/09/2026' (Iniciou) está no arquivo", textoPdf.includes("29/09/2026"))
  } finally {
    await c.limpar()
    await prisma.documento.deleteMany({ where: { descricao: null, necessidade: { chaveIdempotencia: { startsWith: MARCA } } } }).catch(() => {})
    await prisma.necessidadeDocumental.deleteMany({ where: { chaveIdempotencia: { startsWith: MARCA } } }).catch(() => {})
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } }).catch(() => {})
    await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } }).catch(() => {})
    await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } }).catch(() => {})
  }
}

main().then(async () => {
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) console.log(falhas.join("\n"))
  await prisma.$disconnect()
  process.exit(falhou ? 1 : 0)
}).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
