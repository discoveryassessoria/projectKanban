// scripts/ordem-certidoes-todas-as-listas.test.ts
// ============================================================================
// GUARDA — REGRA FIXA DE ORDEM DAS CERTIDÕES (06/10/2026), aplicada a CADA lista do sistema (não só uma):
//   Torre: Tarefas (todas as ordens e agrupamentos) · Processos · Minha operação · Radar · Relatório de controle · Histórico;
//   Operação; página do processo; aba Documentos; central da fase; exportações CSV/Excel/PDF.
// Dentro da família: GERAÇÃO calculada (G1…, cônjuge na do parceiro) → linha reta antes de fora da linha → nascimento da pessoa → pessoa →
// Nascimento, Casamento, Óbito, outros. Risco/prazo/status/criação NUNCA reordenam certidões dentro da família — só famílias. Fixture: UMA família
// de 4 gerações, cônjuges, fora da linha e os três tipos, TODAS as certidões com o MESMO risco e prazo, e `numeroLinhagem` embaralhado de propósito.
//   npx tsx scripts/ordem-certidoes-todas-as-listas.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { ordenarCertidoesDaFamilia, ordenarLinhasDeCertidao, compararCertidoesDaFamilia } from "../lib/operacional/ordem-certidoes"
import { aplicarFiltros, filtrosVazios, ORDENS_TORRE, type OrdemTorre } from "../lib/operacional/torre-filtros"
import { agruparParaTela, type Agrupar } from "../lib/operacional/torre-tarefas-tela"
import { filtrarEOrdenar, pessoasDaTabela, type LinhaDaTabela } from "../lib/operacional/torre-processo-puro"
import { ordenarItensDoRelatorio, type ItemDoRelatorio } from "../src/lib/relatorios/motor/dominios/certidoes-ordem"
import { chaveDoAtomo } from "../lib/operacional/historico-processo"
import { ordenarPorEvento, agruparPorFamilia, agruparPorOrgao, agruparDentroDaFamilia, linhasDoRadar } from "../src/components/operacao/operacao-v3-derivacoes"
import { compararPorEventoDeVida } from "../src/lib/documentos/ordem-evento-vida"
import { ordenarDocumentos } from "../src/components/kanban/PainelDaFase"
import type { LinhaOperacaoV3 } from "../src/components/operacao/operacao-v3-tipos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")

// ─── a família ──────────────────────────────────────────────────────────────
type Cat = "NASCIMENTO" | "CASAMENTO" | "OBITO"
const TITULO: Record<Cat | "OUTRO", string> = { NASCIMENTO: "Certidão de nascimento", CASAMENTO: "Certidão de casamento", OBITO: "Certidão de óbito", OUTRO: "Passaporte" }
interface Pessoa { id: number; nome: string; geracao: number; linhaReta: boolean; nasc: string; numeroLinhagem: number; docs: Array<Cat | "OUTRO"> }
// numeroLinhagem EMBARALHADO (irmãos com números muito diferentes, cônjuge com o do parceiro, quem é de fora com número alto): ele NÃO pode mandar.
const PESSOAS: Pessoa[] = [
  { id: 1, nome: "Erminio", geracao: 1, linhaReta: true, nasc: "1900-01-01", numeroLinhagem: 9, docs: ["NASCIMENTO", "CASAMENTO", "OBITO"] },
  { id: 2, nome: "Guilhermina", geracao: 1, linhaReta: false, nasc: "1902-01-01", numeroLinhagem: 1, docs: ["NASCIMENTO", "OBITO"] },
  { id: 3, nome: "Carlota", geracao: 2, linhaReta: true, nasc: "1925-01-01", numeroLinhagem: 2, docs: ["NASCIMENTO", "CASAMENTO", "OBITO"] },
  { id: 4, nome: "Antonio", geracao: 2, linhaReta: false, nasc: "1923-01-01", numeroLinhagem: 7, docs: ["NASCIMENTO", "OBITO"] },
  { id: 5, nome: "Adelia", geracao: 3, linhaReta: true, nasc: "1950-01-01", numeroLinhagem: 3, docs: ["NASCIMENTO", "CASAMENTO", "OUTRO"] },
  { id: 6, nome: "Silvia Helena", geracao: 3, linhaReta: true, nasc: "1955-01-01", numeroLinhagem: 8, docs: ["NASCIMENTO", "CASAMENTO"] },
  { id: 7, nome: "Alberto Luis", geracao: 3, linhaReta: false, nasc: "1948-01-01", numeroLinhagem: 3, docs: ["NASCIMENTO"] },
  { id: 8, nome: "José Roberto Mantoan", geracao: 3, linhaReta: false, nasc: "1952-01-01", numeroLinhagem: 8, docs: ["NASCIMENTO", "OBITO"] },
  { id: 9, nome: "Tia fora da linha", geracao: 3, linhaReta: false, nasc: "1952-01-01", numeroLinhagem: 1, docs: ["NASCIMENTO"] },
  { id: 10, nome: "Mônica", geracao: 4, linhaReta: true, nasc: "1975-01-01", numeroLinhagem: 4, docs: ["NASCIMENTO", "CASAMENTO"] },
  { id: 11, nome: "André", geracao: 4, linhaReta: true, nasc: "1978-01-01", numeroLinhagem: 7, docs: ["NASCIMENTO"] },
]
const ordemDoTipo: Record<string, number> = { NASCIMENTO: 0, CASAMENTO: 1, OBITO: 2, OUTRO: 3 }
// A ORDEM ESPERADA, escrita à mão (não calculada pelo código testado): geração; na geração, linha reta antes; nascimento; tipo.
const ESPERADA: Array<[number, string]> = [
  [1, "NASCIMENTO"], [1, "CASAMENTO"], [1, "OBITO"], [2, "NASCIMENTO"], [2, "OBITO"], // G1: Erminio (linha) depois Guilhermina
  [3, "NASCIMENTO"], [3, "CASAMENTO"], [3, "OBITO"], [4, "NASCIMENTO"], [4, "OBITO"], // G2: Carlota (linha) depois Antonio
  [5, "NASCIMENTO"], [5, "CASAMENTO"], [5, "OUTRO"], [6, "NASCIMENTO"], [6, "CASAMENTO"], // G3 linha: Adelia (1950), Silvia (1955)
  [7, "NASCIMENTO"], [8, "NASCIMENTO"], [8, "OBITO"], [9, "NASCIMENTO"], // G3 fora: Alberto Luis (1948), José Roberto (1952), Tia (1952, id maior)
  [10, "NASCIMENTO"], [10, "CASAMENTO"], [11, "NASCIMENTO"], // G4: Mônica (1975), André (1978)
]
const esperado = ESPERADA.map(([p, c]) => `${p}:${c}`)
// Os docs que a fixture realmente produz têm de ser os da lista esperada (sanidade do gabarito).
const produzidos = PESSOAS.flatMap((p) => p.docs.map((c) => `${p.id}:${c}`))

let tarefa = 100
interface Linha { taskId: number; pessoaId: number; cat: Cat | "OUTRO"; [k: string]: unknown }
const linhasBase = (): Linha[] => PESSOAS.flatMap((p) => p.docs.map((c) => {
  const taskId = tarefa++
  const linha: Linha = {
    taskId, pessoaId: p.id, cat: c,
    titulo: `${TITULO[c]} · ${p.nome}`, pessoaNome: p.nome, familiaNome: "Rosatto", processoNome: "Rosatto Processo", processoId: 676,
    numeroLinhagem: p.numeroLinhagem, geracao: p.geracao, linhaReta: p.linhaReta, pessoaNascimento: `${p.nasc}T00:00:00.000Z`,
    categoriaDoc: c === "OUTRO" ? null : c, documentoId: taskId, casalNomes: null, conjugeNome: null,
    // TODAS com o MESMO risco e o MESMO prazo e status:
    dataPrazo: "2026-10-20T15:00:00.000Z", criadaEm: "2026-09-01T12:00:00.000Z", atribuidaEm: null, iniciouEm: null, atrasada: false, escalada: false, emRisco: false,
    acompanhamentoVencido: false, acompanhamentoPasso: null, prioridade: "MEDIA", statusTarefa: "NAO_INICIADA", estadoOperacao: "FILA", responsavelId: null, responsavelNome: null,
    faseMacroKey: "genealogia", faseAtualDoProcessoLabel: "Genealogia", faseAnteriorAFaseAtual: false, origem: "WORKFLOW", terceiroNome: null, passoCorrente: null, etapaAtual: null,
    aIniciar: false, passoAtual: null, coluna: "A_FAZER",
  }
  return linha
}))
const embaralhar = <T,>(xs: T[], semente: number): T[] => { const r = [...xs]; let s = semente; for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]] } return r }
const idsDe = (ls: Array<{ pessoaId: number | null; categoriaDoc?: string | null; cat?: string }>): string[] => ls.map((l) => `${l.pessoaId}:${(l as any).cat ?? l.categoriaDoc ?? "OUTRO"}`)
const FAM = embaralhar(linhasBase(), 7)
const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

secao("0) o gabarito e o comparador único")
ok("o gabarito escrito à mão cobre exatamente as certidões da fixture", [...produzidos].sort().join() === [...esperado].sort().join())
ok("compararCertidoesDaFamilia sozinho produz o gabarito (4 gerações, cônjuges, fora da linha, 3 tipos + outro)", iguais(
  idsDe(ordenarCertidoesDaFamilia(FAM, (l) => ({ geracao: l.geracao as number, linhaReta: l.linhaReta as boolean, pessoaNascimento: l.pessoaNascimento as string, pessoaId: l.pessoaId, categoria: l.categoriaDoc as string | null, titulo: l.titulo as string, desempate: l.taskId }))), esperado))
ok("o numeroLinhagem embaralhado DISCORDARIA da regra (por isso o teste prova que ele não manda)", !iguais(idsDe([...FAM].sort((a, b) => (a.numeroLinhagem as number) - (b.numeroLinhagem as number) || ordemDoTipo[a.cat] - ordemDoTipo[b.cat])), esperado))
ok("pessoa sem geração / sem nascimento vai DEPOIS de quem tem; mesmo tipo desempata por id", compararCertidoesDaFamilia({ geracao: null }, { geracao: 9 }) > 0 && compararCertidoesDaFamilia({ geracao: 2, pessoaNascimento: null }, { geracao: 2, pessoaNascimento: "1990-01-01" }) > 0 && compararCertidoesDaFamilia({ geracao: 2, desempate: 1 }, { geracao: 2, desempate: 2 }) < 0)

secao("1) Torre — aba Tarefas: TODA ordem do «Ordenar por», TODO agrupamento")
for (const o of [null, ...ORDENS_TORRE] as Array<OrdemTorre | null>) {
  const r = aplicarFiltros(FAM as any, { ...filtrosVazios(), ordenar: o }, { usuarioId: 1, agora: new Date("2026-10-06T15:00:00Z") })
  ok(`ordenar por ${o ?? "ordem padrão"}: dentro da família é a regra fixa`, iguais(idsDe(r.linhas as any), esperado))
}
for (const por of ["fam", "resp", "fase", "org", "none"] as Agrupar[]) {
  const grupos = agruparParaTela(FAM as any, por)
  ok(`agrupar por ${por}: certidões na regra fixa dentro do grupo`, grupos.length === 1 && iguais(idsDe(grupos[0][1] as any), esperado))
}
{
  // Duas famílias: o critério decide só QUAL FAMÍLIA vem primeiro; cada família segue a regra.
  const outra = linhasBase().map((l) => ({ ...l, familiaNome: "Alfa", processoNome: "Alfa", dataPrazo: "2026-10-01T15:00:00.000Z", atrasada: true, taskId: (l.taskId as number) + 1000 }))
  const duas = embaralhar([...FAM, ...outra], 3)
  const porPrazo = aplicarFiltros(duas as any, { ...filtrosVazios(), ordenar: "prazo" }, { usuarioId: 1, agora: new Date("2026-10-06T15:00:00Z") }).linhas as any[]
  ok("duas famílias, ordenar por prazo: a família com prazo mais cedo (Alfa) vem primeiro, as duas na regra", porPrazo[0].familiaNome === "Alfa" && iguais(idsDe(porPrazo.slice(0, esperado.length)), esperado) && iguais(idsDe(porPrazo.slice(esperado.length)), esperado) && porPrazo.slice(esperado.length).every((l) => l.familiaNome === "Rosatto"))
  const porFam = aplicarFiltros(duas as any, { ...filtrosVazios(), ordenar: "familia" }, { usuarioId: 1, agora: new Date() }).linhas as any[]
  ok("ordenar por família: A–Z entre famílias, regra dentro", porFam[0].familiaNome === "Alfa" && porFam.slice(0, esperado.length).every((l) => l.familiaNome === "Alfa"))
}

secao("2) Torre — aba Processos (lista famílias, nunca certidões)")
{
  const f = ler("lib/operacional/torre-fase.ts")
  ok("«Ordenar por» de Processos ordena PROCESSOS/famílias (`ordenarProcessos`) — a aba não tem lista de certidões, só a contagem «a de b»", /export function ordenarProcessos/.test(f) && !/numeroLinhagem|categoriaDoc/.test(f))
}

secao("3) Operação e Torre → Minha operação (o MESMO componente) — todas as abas e agrupamentos")
{
  const v3 = FAM as unknown as LinhaOperacaoV3[]
  ok("ordenarPorEvento (qualquer lista da Operação)", iguais(idsDe(ordenarPorEvento(v3) as any), esperado))
  ok("A fazer / Aguardando / Acompanhamento / Feito: agruparPorFamilia", (() => { const g = agruparPorFamilia(v3); return g.length === 1 && iguais(idsDe(g[0].linhas as any), esperado) })())
  ok("Aguardando agrupado por órgão (cobrar juntos)", (() => { const g = agruparPorOrgao(v3); return g.length === 1 && iguais(idsDe(g[0].linhas as any), esperado) })())
  for (const por of ["pessoa", "orgao", "passo"] as const) {
    ok(`«Por família, depois por ${por}»: grupos e linhas na regra`, iguais(idsDe(agruparDentroDaFamilia(v3, por).flatMap((g) => g.linhas) as any), esperado))
  }
  ok("Operação (/operacao, a tela de quem executa) monta o OperacaoV3 — e a Torre NÃO o monta mais (Minha operação saiu da Torre)", /OperacaoV3/.test(ler("src/app/operacao/page.tsx")) && !/OperacaoV3/.test(ler("src/components/torre/Torre.tsx")))
}

secao("4) Radar (da Operação): a lista que cada cartão abre")
{
  const v3 = FAM as unknown as LinhaOperacaoV3[]
  const semOrgao = linhasDoRadar("noorg", v3, v3.map((l) => ({ ...l, documentoId: l.documentoId, faseMacroKey: "emissao_documental" })) as any)
  const g = agruparPorFamilia(semOrgao as any)
  ok("«Sem órgão» → a lista aberta pelo cartão passa pela regra", g.length === 1 && g[0].linhas.length === semOrgao.length && idsDe(g[0].linhas as any).every((x, i, a) => i === 0 || esperado.indexOf(x) > esperado.indexOf(a[i - 1])))
  ok("o Radar da Torre ordena PROCESSOS (ordenarRadar), não certidões", /export function ordenarRadar/.test(ler("lib/operacional/torre-radar.ts")))
}

secao("5) Relatório de controle (preview e exportações CSV/Excel/PDF compartilham a ordem)")
{
  const itens: ItemDoRelatorio[] = embaralhar(PESSOAS.flatMap((p) => p.docs.map((c, i) => ({
    id: p.id * 10 + i, createdAt: Date.parse("2026-09-01"), status: "PENDENTE", familia: "Rosatto", geracao: p.geracao, linhaReta: p.linhaReta, nascimento: p.nasc, pessoaId: p.id, titulo: TITULO[c],
  }))), 5)
  const esperadoRel = ESPERADA.map(([p, c]) => `${p}:${c}`)
  for (const ord of ["criacao", "status", "familia_geracao"]) for (const dir of ["asc", "desc"] as const) {
    const r = ordenarItensDoRelatorio(itens, ord, dir)
    ok(`ordenar por ${ord} (${dir}): certidões na regra fixa`, iguais(r.map((i) => `${i.pessoaId}:${i.titulo?.includes("nasc") ? "NASCIMENTO" : i.titulo?.includes("casam") ? "CASAMENTO" : i.titulo?.includes("óbito") ? "OBITO" : "OUTRO"}`), esperadoRel))
  }
  const motor = ler("src/lib/relatorios/motor/executar.ts"), dom = ler("src/lib/relatorios/motor/dominios/certidoes.ts"), exp = ler("src/lib/relatorios/motor/exportar.ts")
  ok("o motor pagina os ids da ORDEM FIXA (preview) e o domínio de certidões a define", /dominio\.idsEmOrdemFixa/.test(motor) && /idsEmOrdemFixa: idsDasCertidoesNaOrdemFixa/.test(dom))
  ok("CSV/Excel/PDF saem do MESMO executar (mesma ordem)", /executar\(/.test(exp))
}

secao("6) Histórico — certidões dentro de um fato agrupado")
{
  const ctx: any = { ordemDasPessoas: Object.fromEntries(PESSOAS.map((p) => [p.id, { geracao: p.geracao, linhaReta: p.linhaReta, nascimento: p.nasc }])) }
  const atomos = embaralhar(PESSOAS.flatMap((p) => p.docs.map((c, i) => ({ pessoaId: p.id, certidao: TITULO[c], t: 1_000 + i, cat: c }))), 11)
  const r = ordenarCertidoesDaFamilia(atomos, (x) => chaveDoAtomo(ctx, x))
  ok("fato agrupado: itens na regra fixa", iguais(r.map((x) => `${x.pessoaId}:${x.cat}`), esperado))
  ok("o Histórico usa esta chave ao montar `agrupadoDe`", /ordenarCertidoesDaFamilia\(ordenados, \(x\) => chaveDoAtomo\(ctx, x\)\)/.test(ler("lib/operacional/historico-processo.ts")))
}

secao("7) Página do processo (tabela de certidões da fase) — status/prazo/risco não reordenam")
{
  const tab: LinhaDaTabela[] = embaralhar(PESSOAS.flatMap((p) => p.docs.map((c, i) => ({
    chave: `t${p.id}${i}`, tarefaId: p.id * 100 + i, documentoId: null, tipo: (i % 3 === 0 ? "ABERTA" : i % 3 === 1 ? "CONCLUIDA" : "CANCELADA") as LinhaDaTabela["tipo"], titulo: TITULO[c], pessoaId: p.id, pessoa: p.nome,
    geracao: `G${p.geracao}`, geracaoNum: p.geracao, linhaReta: p.linhaReta, pessoaNascimento: `${p.nasc}T00:00:00Z`,
    passo: null, status: (i % 3 === 0 ? "A_INICIAR" : i % 3 === 1 ? "CONCLUIDA" : "CANCELADA") as LinhaDaTabela["status"], statusRotulo: "x", responsavelId: null, responsavelNome: null, iniciouEm: null, concluidaEm: null,
    dataPrazo: "2026-10-20T15:00:00Z", rotuloDoPrazo: "", risco: "ritmo" as const, atrasada: false, bola: null, encerramentoTexto: null, motivoTexto: null, reabrivel: false, podeAtribuir: false, fase: { key: "emissao_documental", label: "Emissão", ordem: 2 },
  }))), 13)
  const r = filtrarEOrdenar(tab, { pessoaId: null, status: "TODOS" })
  ok("«Ativas + canceladas»: a regra fixa — a cancelada NÃO vai para o fim", iguais(r.map((l) => `${l.pessoaId}:${l.titulo.includes("nasc") ? "NASCIMENTO" : l.titulo.includes("casam") ? "CASAMENTO" : l.titulo.includes("óbito") ? "OBITO" : "OUTRO"}`), esperado))
  ok("o select «Pessoa» também na regra: G1…G4, linha reta antes, nascimento", pessoasDaTabela(tab).map((p) => p.id).join() === "1,2,3,4,5,6,7,8,9,10,11")
  ok("a tela não oferece «Ordenar» (prazo/status) na página do processo", !/OPCOES_DE_ORDEM|aria-label="Ordenar"/.test(ler("src/components/torre/ProcessoEncerradas.tsx")) && !/OPCOES_DE_ORDEM/.test(ler("lib/operacional/torre-processo-puro.ts")))
}

secao("8) Aba Documentos do processo e central da fase")
{
  const rota = ler("src/app/api/processos/[processoId]/documentos/route.ts"), tela = ler("src/components/kanban/ProcessoDocumentos.tsx")
  ok("a API ordena as pessoas na regra (geração calculada → linha reta → nascimento) nos três blocos", /geracoesDasArvores\(\[processo\.arvoreId\]\)/.test(rota) && (rota.match(/ordenarPessoas\(/g) ?? []).length >= 3 && !/numeroLinhagem \?\? 99|\(a\.geracao \?\? 99\)/.test(rota))
  ok("dentro da pessoa: Nascimento, Casamento, Óbito, outros — um sort só, sem «encerrados no fim»", /docsOrdenados = \[\.\.\.aplicaveis\]\.sort\(porEventoDeVida\)/.test(tela))
  ok("o comparador de eventos da pessoa delega à regra única", ["Certidão de óbito", "Passaporte", "Certidão de casamento", "Certidão de nascimento"].sort(compararPorEventoDeVida).join() === "Certidão de nascimento,Certidão de casamento,Certidão de óbito,Passaporte" && /ordemDaCategoria/.test(ler("src/lib/documentos/ordem-evento-vida.ts")))
  const docs = ["óbito", "nascimento", "casamento"].map((t, i) => ({ titulo: `Certidão de ${t}`, chave: `d${i}`, naFase: { estado: i === 1 ? "CANCELADA" : "A_FAZER" } })) as any[]
  ok("central da fase: a cancelada fica NO LUGAR da regra (Nascimento, Casamento, Óbito), não no fim", ordenarDocumentos(docs).map((d) => d.titulo).join() === "Certidão de nascimento,Certidão de casamento,Certidão de óbito")
}

secao("9) Exportações CSV")
{
  ok("exportarFamiliaCsv (Central da família) exporta na regra fixa e inclui a geração", /const linhas = ordenarCertidoesDaTabela\(linhasEntrada\)/.test(ler("src/components/operacao/tabela-familia.tsx")))
  ok("ordenarLinhasDeCertidao é a mesma regra", iguais(idsDe(ordenarLinhasDeCertidao(FAM as any) as any), esperado))
}

secao("10) NENHUMA lista tem ordenação própria de certidão (e ninguém ordena por numeroLinhagem)")
for (const arq of [
  "src/components/operacao/operacao-v3-derivacoes.ts", "src/components/operacao/tabela-familia.tsx", "lib/operacional/torre-processo-puro.ts", "lib/operacional/torre-filtros.ts",
  "lib/operacional/torre-tarefas-tela.ts", "src/lib/relatorios/motor/dominios/certidoes-ordem.ts", "lib/operacional/ordem-certidoes.ts",
]) {
  const s = ler(arq).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  ok(`${arq}: sem numeroLinhagem`, !/numeroLinhagem/.test(s))
}
ok("o «G» exibido na Operação e na Central vem da geração calculada, não do número de sequência", !/G\$\{t\.numeroLinhagem\}|G\{p\.numeroLinhagem\}/.test(ler("src/components/operacao/operacao-v3-abas.tsx") + ler("src/components/operacao/operacao-v3.tsx") + ler("src/components/kanban/PainelDaFase.tsx")))
ok("CLAUDE.md grava a regra como permanente", /REGRA FIXA DE ORDEM DAS CERTIDÕES/.test(ler("CLAUDE.md")))

console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
