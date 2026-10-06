// scripts/torre-relatorio-filtros.test.ts
// ============================================================================
// RELATÓRIO DE CONTROLE (Torre) — OS QUATRO FILTROS: Fase · Linhagem · Status · Pessoa. Cada um sozinho, dois combinados, o resumo do
// título, a URL, e a EXPORTAÇÃO (CSV, Excel, PDF) levando exatamente as linhas filtradas, com os filtros escritos no arquivo.
//
//   node scripts/ci/gate-build.mjs --so torre-relatorio-filtros      (banco de teste descartável)
//
// Dados reais do banco de teste: cinco certidões do mesmo processo — fases, linhagem, status e pessoas diferentes (ver a matriz abaixo).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-relatorio-filtros.test.ts")

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { COLUNAS_DO_RELATORIO_DE_CONTROLE } from "../lib/operacional/torre-relatorio-colunas"
import { DOMINIO_CERTIDOES, CATEGORIA_CERTIDAO } from "../src/lib/relatorios/motor/dominios/certidoes"
import { executar } from "../src/lib/relatorios/motor/executar"
import { POST as postExportar } from "../src/app/api/relatorios/exportar/route"
import {
  FILTROS_PADRAO, filtrosParaOMotor, resumoDoRelatorio, lerRelatorioDaUrl, escreverRelatorioNaUrl, fasesDoFiltro, NENHUMA_FASE,
  type FiltrosDoRelatorio, type OpcoesDoRelatorio,
} from "../lib/operacional/torre-relatorio-filtros"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "RELFLT"

async function main() {
  secao("A URL e o resumo (puros)")
  ok("sem filtros na URL: os padrões (Fase atual · todas as linhagens · só ativas · todas as pessoas), janela fechada", (() => { const r = lerRelatorioDaUrl(new URLSearchParams("")); return !r.aberto && JSON.stringify(r.filtros) === JSON.stringify(FILTROS_PADRAO) })())
  ok("link copiado abre a janela já filtrada", (() => { const r = lerRelatorioDaUrl(new URLSearchParams("relatorio=1&rel_fase=genealogia&rel_linhagem=reta&rel_status=concluidas&rel_pessoa=7")); return r.aberto && r.filtros.fase === "genealogia" && r.filtros.linhagem === "reta" && r.filtros.status === "concluidas" && r.filtros.pessoa === 7 })())
  ok("valor inválido na URL cai no padrão (nunca em erro)", (() => { const r = lerRelatorioDaUrl(new URLSearchParams("relatorio=1&rel_linhagem=xx&rel_status=yy&rel_pessoa=abc")); return r.filtros.linhagem === "todas" && r.filtros.status === "ativas" && r.filtros.pessoa === null })())
  ok("escrever na URL: só o que foge do padrão; fechar remove tudo; os demais parâmetros da página ficam", (() => {
    const aberto = escreverRelatorioNaUrl(new URLSearchParams("x=1"), { aberto: true, filtros: { ...FILTROS_PADRAO, linhagem: "fora", pessoa: 3 } })
    const fechado = escreverRelatorioNaUrl(aberto, { aberto: false, filtros: FILTROS_PADRAO })
    return aberto.get("relatorio") === "1" && aberto.get("rel_linhagem") === "fora" && aberto.get("rel_pessoa") === "3" && !aberto.has("rel_fase") && !aberto.has("rel_status") && aberto.get("x") === "1" && fechado.toString() === "x=1"
  })())

  const opcoes: OpcoesDoRelatorio = {
    faseAtualKey: "emissao_documental",
    fases: [{ key: "genealogia", label: "Genealogia", estado: "concluida" }, { key: "emissao_documental", label: "Emissão Documental", estado: "atual" }],
    pessoas: [],
  }
  ok("fase atual / anteriores / todas / uma fase", JSON.stringify(fasesDoFiltro("atual", opcoes)?.valores) === '["emissao_documental"]' && JSON.stringify(fasesDoFiltro("anteriores", opcoes)?.valores) === '["genealogia"]' && fasesDoFiltro("todas", opcoes) === null && JSON.stringify(fasesDoFiltro("genealogia", opcoes)?.valores) === '["genealogia"]')
  ok("fase sem correspondência vira a chave 'nenhuma' (o motor não pode ignorar o filtro e trazer tudo)", fasesDoFiltro("anteriores", { faseAtualKey: "x", fases: [{ key: "x", label: "X", estado: "atual" }] })?.valores[0] === NENHUMA_FASE && fasesDoFiltro("inexistente", opcoes)?.valores[0] === NENHUMA_FASE)
  ok("resumo do título: família · fase · linhagem · status · linhas", resumoDoRelatorio({ familiaNome: "Salvarani", filtros: { fase: "genealogia", linhagem: "reta", status: "ativas", pessoa: null }, opcoes, linhas: 9 }) === "família Salvarani · Genealogia · linha reta · só ativas · 9 linhas")
  ok("resumo: padrão e singular", resumoDoRelatorio({ familiaNome: "Salvarani", filtros: FILTROS_PADRAO, opcoes, linhas: 1 }) === "família Salvarani · Emissão Documental · todas as linhagens · só ativas · 1 linha")

  const c = await montarCenario(MARCA)
  const usuarios: number[] = []
  try {
    const admin = await prisma.usuario.create({ data: { nome: "Marco Rovatti", email: `${MARCA.toLowerCase()}-m@t.com`, senha: "x", tipo: "admin" } })
    usuarios.push(admin.id)
    const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
    const cat = (await prisma.categoriaDocumental.findUnique({ where: { code: CATEGORIA_CERTIDAO } })) ?? await prisma.categoriaDocumental.create({ data: { code: CATEGORIA_CERTIDAO, name: `${MARCA} Registro civil` } })
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}-ITEM`, name: `${MARCA} Certidão de nascimento`, natureza: "DOCUMENTO" }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}-TIPO`, name: `${MARCA} tipo`, itemCatalogoId: item.id, categoriaDocumentalId: cat.id } })

    // ── a matriz: nome · linha reta · documento · fase da tarefa · tarefa concluída ──
    const matriz = [
      { nome: "Luigi", reta: true, doc: "PENDENTE", fase: "genealogia", concluida: false },
      { nome: "Rosa", reta: true, doc: "PENDENTE", fase: "emissao_documental", concluida: true },
      { nome: "Carlo", reta: false, doc: "PENDENTE", fase: "emissao_documental", concluida: false },
      { nome: "Maria", reta: true, doc: "CANCELADO", fase: "genealogia", concluida: false },
      { nome: "Aldo", reta: false, doc: "NAO_EXIGIDO", fase: "emissao_documental", concluida: false },
    ]
    const obrs = []
    for (let i = 0; i < matriz.length; i++) obrs.push(await c.novaObrigacao({}))
    const proc = obrs[0].processoId
    const arv = (await prisma.processo.findUniqueOrThrow({ where: { id: proc }, select: { arvoreId: true } })).arvoreId!
    const pessoaIds: Record<string, number> = {}
    for (let i = 0; i < matriz.length; i++) {
      const m = matriz[i]
      const pes = await prisma.pessoa.create({ data: { arvoreId: arv, nome: m.nome, sobrenome: MARCA, linhaReta: m.reta }, select: { id: true } })
      pessoaIds[m.nome] = pes.id
      const nec = await prisma.necessidadeDocumental.create({ data: { processoId: proc, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${i}` }, select: { id: true } })
      const doc = await prisma.documento.create({ data: { pessoaId: pes.id, necessidadeId: nec.id, tipo: "CERTIDAO_NASCIMENTO", status: m.doc as never }, select: { id: true } })
      await prisma.tarefa.update({ where: { id: obrs[i].tarefaId }, data: { documentoId: doc.id, necessidadeId: nec.id, pessoaId: pes.id, processoId: proc, faseMacroKey: m.fase, ...(m.concluida ? { statusTarefa: "CONCLUIDO_RECEBIDO" as never, dataConclusao: new Date() } : {}) } })
    }
    const opc: OpcoesDoRelatorio = { ...opcoes, pessoas: Object.entries(pessoaIds).map(([nome, id]) => ({ id, nome })) }

    const montarSpec = (f: FiltrosDoRelatorio, extra: Record<string, unknown> = {}) => ({
      dominio: "certidoes",
      filtros: [{ key: "processo", valor: { tipo: "entidade" as const, id: proc } }, ...filtrosParaOMotor(f, opc)],
      colunas: [...COLUNAS_DO_RELATORIO_DE_CONTROLE], ordenarPor: "familia_geracao", direcao: "asc" as const, pagina: 1, porPagina: 100, ...extra,
    })
    const nomes = async (f: FiltrosDoRelatorio) => {
      const r = await executar(DOMINIO_CERTIDOES, montarSpec(f) as never)
      const ns = r.linhas.map((l) => String(l.celulas.find((x) => x.key === "pessoa")?.valor ?? "").split(" ")[0]).sort()
      return { ns: ns.join(","), total: r.total, n: r.linhas.length }
    }
    const todas: FiltrosDoRelatorio = { fase: "todas", linhagem: "todas", status: "todas", pessoa: null }

    secao("Sem filtro (Todas as fases · todas as linhagens · Todas · todas as pessoas): as 5 certidões")
    ok("5 linhas", (await nomes(todas)).ns === "Aldo,Carlo,Luigi,Maria,Rosa")

    secao("CADA FILTRO SOZINHO")
    ok("PADRÃO ao abrir (Fase atual · só ativas): Rosa e Carlo", (await nomes(FILTROS_PADRAO)).ns === "Carlo,Rosa")
    ok("Fase atual (status Todas): Aldo, Carlo, Rosa", (await nomes({ ...todas, fase: "atual" })).ns === "Aldo,Carlo,Rosa")
    ok("Fases anteriores: Luigi, Maria", (await nomes({ ...todas, fase: "anteriores" })).ns === "Luigi,Maria")
    ok("Uma fase (Genealogia): Luigi, Maria", (await nomes({ ...todas, fase: "genealogia" })).ns === "Luigi,Maria")
    ok("Todas as fases: as 5", (await nomes({ ...todas, fase: "todas" })).total === 5)
    ok("Só linha reta: Luigi, Maria, Rosa", (await nomes({ ...todas, linhagem: "reta" })).ns === "Luigi,Maria,Rosa")
    ok("Só fora da linha: Aldo, Carlo", (await nomes({ ...todas, linhagem: "fora" })).ns === "Aldo,Carlo")
    ok("Status Só ativas (inclui a concluída): Carlo, Luigi, Rosa", (await nomes({ ...todas, status: "ativas" })).ns === "Carlo,Luigi,Rosa")
    ok("Status Concluídas: Rosa", (await nomes({ ...todas, status: "concluidas" })).ns === "Rosa")
    ok("Status Canceladas / não exigidas: Aldo, Maria", (await nomes({ ...todas, status: "encerradas" })).ns === "Aldo,Maria")
    ok("Status Todas: as 5", (await nomes({ ...todas, status: "todas" })).total === 5)
    ok("Pessoa (Luigi): só Luigi", (await nomes({ ...todas, pessoa: pessoaIds.Luigi })).ns === "Luigi")

    secao("DOIS (E MAIS) COMBINADOS")
    ok("Fase atual + fora da linha (status Todas): Aldo, Carlo", (await nomes({ ...todas, fase: "atual", linhagem: "fora" })).ns === "Aldo,Carlo")
    ok("Todas as fases + linha reta + só ativas: Luigi, Rosa", (await nomes({ ...todas, linhagem: "reta", status: "ativas" })).ns === "Luigi,Rosa")
    ok("Fases anteriores + linha reta + canceladas / não exigidas: Maria", (await nomes({ ...todas, fase: "anteriores", linhagem: "reta", status: "encerradas" })).ns === "Maria")
    ok("Fase atual + concluídas + pessoa Rosa: Rosa; com pessoa Carlo: nenhuma", (await nomes({ ...todas, fase: "atual", status: "concluidas", pessoa: pessoaIds.Rosa })).ns === "Rosa" && (await nomes({ ...todas, fase: "atual", status: "concluidas", pessoa: pessoaIds.Carlo })).total === 0)
    ok("combinação sem resultado devolve ZERO linhas (nunca 'tudo')", (await nomes({ ...todas, fase: "anteriores", linhagem: "fora" })).total === 0)
    ok("total do motor = linhas mostradas (o resumo do título e 'Mostrando N de N' batem)", await (async () => { const r = await nomes({ ...todas, linhagem: "reta" }); return r.total === r.n })())

    secao("EXPORTAÇÃO — exatamente as linhas filtradas, com os filtros escritos no arquivo")
    const filtrado: FiltrosDoRelatorio = { fase: "atual", linhagem: "todas", status: "ativas", pessoa: null }
    const pedir = (formato: string, extra: Record<string, unknown> = {}) => postExportar(new NextRequest("http://localhost/api/relatorios/exportar", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...montarSpec(filtrado), formato, ...extra }) }))
    const rc = await pedir("csv", { contextoNoCsv: true }); const csv = (await rc.text()).replace(/^﻿/, "").split("\n")
    ok("CSV: a PRIMEIRA linha escreve os filtros usados", csv[0].startsWith('"Filtros: ') && /Fase: Emiss/.test(csv[0]) && /Status: só ativas/.test(csv[0]) && /Processo: /.test(csv[0]), csv[0])
    ok("CSV: o cabeçalho vem logo depois e só as linhas filtradas (Rosa e Carlo)", csv[1].startsWith('"Certidão";') && csv.slice(2).filter((l) => l.trim()).length === 2 && csv.join("\n").includes("Rosa") && csv.join("\n").includes("Carlo") && !/Luigi|Maria|Aldo/.test(csv.join("\n")), `${csv.length - 2} linhas`)
    ok("CSV: X-Relatorio-Total = linhas filtradas (2)", rc.headers.get("X-Relatorio-Total") === "2")
    const rsem = await pedir("csv"); const csvSem = (await rsem.text()).replace(/^﻿/, "").split("\n")
    ok("CSV sem o pedido de contexto continua como sempre foi (cabeçalho na 1ª linha)", csvSem[0].startsWith('"Certidão";'))
    const rx = await pedir("xlsx"); const mod = await import("exceljs")
    const Workbook = (mod as { Workbook?: typeof import("exceljs").Workbook }).Workbook ?? (mod as unknown as { default: { Workbook: typeof import("exceljs").Workbook } }).default.Workbook
    const wb = new Workbook(); await wb.xlsx.load(Buffer.from(await rx.arrayBuffer()) as never)
    const linhasX: string[] = []; wb.worksheets[0].eachRow((row) => { linhasX.push((row.values as unknown[]).slice(1).map((v) => String((v as { text?: string } | null)?.text ?? v ?? "")).join("|")) })
    ok("Excel: o contexto no topo diz os filtros", linhasX.slice(0, 4).some((l) => /^Filtros: .*Fase: Emiss.*Status: só ativas/.test(l)), linhasX[2])
    ok("Excel: só as linhas filtradas (Rosa e Carlo)", linhasX.some((l) => l.includes("Rosa")) && linhasX.some((l) => l.includes("Carlo")) && !linhasX.some((l) => /Luigi|Maria|Aldo/.test(l)) && rx.headers.get("X-Relatorio-Total") === "2")
    const rp = await pedir("pdf"); const pdf = Buffer.from(await rp.arrayBuffer())
    ok("PDF: válido, do MESMO resultado filtrado (X-Relatorio-Total = 2)", rp.status === 200 && pdf.subarray(0, 4).toString() === "%PDF" && rp.headers.get("X-Relatorio-Total") === "2")
    ok("PDF: o cabeçalho escreve os filtros", pdf.toString("latin1").includes("Filtros:"))
    const rtodos = await postExportar(new NextRequest("http://localhost/api/relatorios/exportar", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...montarSpec(todas), formato: "csv" }) }))
    ok("exportação com 'Todas' leva as 5 (o filtro é que reduz)", rtodos.headers.get("X-Relatorio-Total") === "5")

    secao("A TELA — a barra, o título e a janela única")
    const modal = readFileSync("src/components/torre/ProcessoRelatorio.tsx", "utf8")
    ok("barra com os 4 filtros (Fase, Linhagem, Status, Pessoa)", ["Fase", "Linhagem", "Status", "Pessoa"].every((r) => new RegExp(`aria-label="${r}"`).test(modal)))
    ok("Fase: Fase atual · Fases anteriores · Todas as fases · separador · uma por fase", /Fase atual<\/option>[\s\S]*Fases anteriores<\/option>[\s\S]*Todas as fases<\/option>[\s\S]*──────────[\s\S]*opcoes\.fases\.map/.test(modal))
    ok("o título usa o resumo dos filtros e o nº de linhas", /resumoDoRelatorio\(/.test(modal) && /data-resumo-dos-filtros/.test(modal))
    ok("a exportação leva o MESMO spec da prévia e pede a linha de filtros no CSV", /\.\.\.spec, formato, contextoNoCsv: true/.test(modal))
    const pagina = readFileSync("src/components/torre/TorreProcessoPagina.tsx", "utf8")
    ok("a página grava os filtros na URL (lerRelatorioDaUrl / escreverRelatorioNaUrl) e abre a janela pela URL", /lerRelatorioDaUrl\(/.test(pagina) && /escreverRelatorioNaUrl\(/.test(pagina) && /relatorioDaUrl\.aberto/.test(pagina))
    const torre = readFileSync("src/components/torre/Torre.tsx", "utf8")
    ok("a aba Processos abre a MESMA janela (e o modal antigo foi removido)", /<ProcessoRelatorioDaTorre/.test(torre) && !/RelatorioControle/.test(torre))
  } finally {
    await c.limpar()
    await prisma.documento.deleteMany({ where: { necessidade: { chaveIdempotencia: { startsWith: MARCA } } } }).catch(() => {})
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
