// scripts/planilha-dados-do-registro-ilaine.test.ts
// ============================================================================
// PLANILHA DOCUMENTAL — DADOS DO REGISTRO (07/10/2026, caso Ilaine Fogli, processo 683). Data, Cônjuge, Local e Dados do registro vinham vazios:
//   • Data lia só `Documento.data_registro` (a certidão traz `data_evento`; sem documento, a árvore tem a data) — hoje são DUAS colunas, evento e registro, sem uma no lugar da outra;
//   • Cônjuge lia só `Documento.conjuge_registrado` (vazio) — a árvore sabe quem é o cônjuge;
//   • a CERTIDÃO DE CASAMENTO é da UNIÃO e fica num dos cônjuges (a `pessoa1`): a OUTRA pessoa via a linha de casamento vazia;
//   • livro/folha/termo «0» (valor padrão) apareciam como «Livro 0 / Folhas 0 / Termo 0».
// PROVA: (1) o caso da Ilaine; (2) o fallback pela árvore/união; (3) «0» = sem dado; (4) Documentos e Custos mostram as MESMAS pessoas e registros.
//   npx tsx scripts/planilha-dados-do-registro-ilaine.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("planilha-dados-do-registro-ilaine.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { montarEstruturaDocumental, montarPlanilhaDocumental, dadoDoRegistro, categoriaDoRegistro } from "../lib/financeiro/leitura/planilha-documental"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "ILA"
const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null)

async function main() {
  const antigos = await prisma.tipoDocumentoCadastro.findMany({ where: { participaPlanilha: true }, select: { id: true } })
  const criados: number[] = []
  try {
    await prisma.tipoDocumentoCadastro.updateMany({ where: { id: { in: antigos.map((t) => t.id) } }, data: { participaPlanilha: false } })
    const mk = async (name: string, code: string) => { const t = await prisma.tipoDocumentoCadastro.create({ data: { name, code: `${MARCA}_${code}`, participaPlanilha: true } as never, select: { id: true } }); criados.push(t.id); return t.id }
    const tNasc = await mk(`${MARCA} Certidão de nascimento`, "NASC"), tCas = await mk(`${MARCA} Certidão de casamento`, "CAS"), tObito = await mk(`${MARCA} Certidão de óbito`, "OBITO")

    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore` }, select: { id: true } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} Fogli`, arvoreId: arv.id }, select: { id: true } })
    const pessoa = (nome: string, extra: Record<string, unknown>) => prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${MARCA} ${nome}`, sobrenome: "Fogli", linhaReta: true, requerente: "nao", ...extra } as never, select: { id: true } })
    const sebastiao = await pessoa("Sebastião", { numeroLinhagem: 2, data_nasc: new Date("1938-01-04T00:00:00Z"), casado: true })
    const ilaine = await pessoa("Ilaine", { numeroLinhagem: 3, data_nasc: new Date("1937-10-03T00:00:00Z"), vivo: true, casado: true })
    const rodolfo = await pessoa("Rodolfo", { numeroLinhagem: 4, data_nasc: new Date("1960-05-05T00:00:00Z") })
    const solteira = await pessoa("Solteira", { numeroLinhagem: 5, data_nasc: new Date("1970-02-02T00:00:00Z"), local_nasc: "Santos", estado_nasc: "SP" })
    const uniao = await prisma.uniao.create({ data: { pessoa1Id: sebastiao.id, pessoa2Id: ilaine.id, data_inicio: new Date("1961-07-20T00:00:00Z"), local: "Santo André", estado: "SP" } as never, select: { id: true } })
    // O documento do CASAMENTO fica na pessoa1 da união (Sebastião) — como em produção (documento 2338).
    const docCas = await prisma.documento.create({ data: { pessoaId: sebastiao.id, documentTypeId: tCas, descricao: `${MARCA} cas`, cartorio: "Santo André 1 Subdistrito", livro: "B 62", folha: "141", termo: "17356", data_evento: new Date("2019-07-16T00:00:00Z"), cidade_registro: "Santo André", estado_registro: "São Paulo" } as never, select: { id: true } })
    // Nascimento da Ilaine: só `data_evento` (sem data de registro), livro/termo «0».
    const docNasc = await prisma.documento.create({ data: { pessoaId: ilaine.id, documentTypeId: tNasc, descricao: `${MARCA} nasc`, cartorio: "Santo André 1 Subdistrito", livro: "19", folha: "003", termo: "0", data_evento: new Date("1937-10-13T00:00:00Z"), cidade_registro: "Santo André", estado_registro: "São Paulo" } as never, select: { id: true } })
    // O nascimento do Rodolfo: tudo «0» (o valor padrão do cadastro).
    await prisma.documento.create({ data: { pessoaId: rodolfo.id, documentTypeId: tNasc, descricao: `${MARCA} nasc rodolfo`, cartorio: "Cartório X", livro: "0", folha: "0", termo: "0", data_registro: new Date("1960-05-06T00:00:00Z") } as never })

    const estrutura = await montarEstruturaDocumental(proc.id)
    const linha = (pessoaId: number, tipoId: number) => estrutura.find((b) => b.pessoaId === pessoaId)!.linhas.find((l) => l.tipoDocumentoId === tipoId)!

    secao("1) Caso Ilaine Fogli")
    const cas = linha(ilaine.id, tCas)
    ok("o CASAMENTO da Ilaine mostra o registro da união (o documento está no Sebastião)", cas.documentoId === docCas.id && cas.cartorio === "Santo André 1 Subdistrito" && cas.livro === "B 62" && cas.folha === "141" && cas.termo === "17356", JSON.stringify([cas.documentoId, cas.livro, cas.folha, cas.termo]))
    ok("com o LOCAL do registro", cas.local === "Santo André - São Paulo", String(cas.local))
    ok("DATA DO EVENTO sem deslocamento de fuso: 16/07/2019 — e a DATA DO REGISTRO fica vazia (nunca o evento no lugar)", dia(cas.dataEvento) === "2019-07-16" && cas.dataRegistro === null, JSON.stringify([cas.dataEvento, cas.dataRegistro]))
    ok("e o CÔNJUGE vem da árvore: Sebastião", /Sebastião/.test(cas.conjuge ?? ""), String(cas.conjuge))
    ok("o Sebastião (dono do documento) mostra o MESMO registro, com a Ilaine de cônjuge", linha(sebastiao.id, tCas).documentoId === docCas.id && /Ilaine/.test(linha(sebastiao.id, tCas).conjuge ?? "") && dia(linha(sebastiao.id, tCas).dataEvento) === "2019-07-16")
    const nasc = linha(ilaine.id, tNasc)
    ok("NASCIMENTO da Ilaine: data do EVENTO 13/10/1937 e data do REGISTRO vazia", dia(nasc.dataEvento) === "1937-10-13" && nasc.dataRegistro === null, JSON.stringify([nasc.dataEvento, nasc.dataRegistro]))
    ok("local e dados do nascimento seguem aparecendo", nasc.local === "Santo André - São Paulo" && nasc.livro === "19" && nasc.folha === "003")
    ok("«0» no termo não vira dado (sem «Termo 0»)", nasc.termo === null)
    const obito = linha(ilaine.id, tObito)
    ok("ÓBITO da Ilaine (viva): nada inventado — data, local e dados vazios", obito.dataEvento === null && obito.dataRegistro === null && obito.local === null && obito.livro === null && obito.conjuge === null)

    secao("2) Sem documento: vale o que a ÁRVORE já sabe")
    ok("nascimento sem documento: data = Pessoa.data_nasc e local = Pessoa.local_nasc/estado_nasc", dia(linha(solteira.id, tNasc).dataEvento) === "1970-02-02" && linha(solteira.id, tNasc).dataRegistro === null && linha(solteira.id, tNasc).local === "Santos - SP", JSON.stringify([linha(solteira.id, tNasc).dataEvento, linha(solteira.id, tNasc).local]))
    await prisma.documento.delete({ where: { id: docCas.id } })
    const semDoc = (await montarEstruturaDocumental(proc.id)).find((b) => b.pessoaId === ilaine.id)!.linhas.find((l) => l.tipoDocumentoId === tCas)!
    ok("casamento sem documento: data = União.data_inicio (20/07/1961) e local = União.local/estado", dia(semDoc.dataEvento) === "1961-07-20" && semDoc.dataRegistro === null && semDoc.local === "Santo André - SP", JSON.stringify([semDoc.dataEvento, semDoc.local]))
    ok("e o cônjuge continua vindo da união", /Sebastião/.test(semDoc.conjuge ?? ""))
    ok("sem documento, a linha diz documentoId = 0 (nada de registro inventado)", semDoc.documentoId === 0)

    secao("3) «0» não é dado")
    const rod = linha(rodolfo.id, tNasc)
    ok("Rodolfo: livro/folha/termo «0» viram vazio (a tela mostra «—», nunca «Livro 0 / Folhas 0 / Termo 0»)", rod.livro === null && rod.folha === null && rod.termo === null && rod.cartorio === "Cartório X")
    ok("dadoDoRegistro: «0», «00», vazio e espaços = sem dado; «B 62» e «003» valem", dadoDoRegistro("0") === null && dadoDoRegistro("00") === null && dadoDoRegistro("  ") === null && dadoDoRegistro(null) === null && dadoDoRegistro("B 62") === "B 62" && dadoDoRegistro("003") === "003")
    const view = readFileSync("src/components/financeiro/v3/PlanilhaDocumentalView.tsx", "utf8")
    ok("a tela também protege: «0» vira «—» (semZero)", /const semZero/.test(view) && /dadosDoRegistro = \(l: Linha\)/.test(view) && /semZero\(l\.livro\)/.test(view))
    ok("a data da tela é de calendário: UTC, sem deslocamento de fuso", /formatarDataPura/.test(view))
    ok("categoriaDoRegistro reconhece nascimento, casamento e óbito", categoriaDoRegistro("Certidão de nascimento") === "NASCIMENTO" && categoriaDoRegistro("Certidão de casamento") === "CASAMENTO" && categoriaDoRegistro("Certidão de óbito") === "OBITO")

    secao("4) Documentos e Custos mostram as MESMAS pessoas e registros")
    // Restaura o casamento para comparar com um documento de união presente.
    await prisma.documento.create({ data: { pessoaId: sebastiao.id, documentTypeId: tCas, descricao: `${MARCA} cas2`, cartorio: "Santo André 1 Subdistrito", livro: "B 62", folha: "141", termo: "17356", data_evento: new Date("2019-07-16T00:00:00Z"), cidade_registro: "Santo André", estado_registro: "São Paulo" } as never })
    const a = await montarEstruturaDocumental(proc.id)
    const b = (await montarPlanilhaDocumental(proc.id)).pessoas
    const norm = (blocos: Array<{ pessoaId: number | null; nome: string; geracao: number | null; linhagemPrincipal: boolean; linhas: Array<Record<string, unknown>> }>) =>
      JSON.stringify(blocos.map((x) => [x.pessoaId, x.nome, x.geracao, x.linhagemPrincipal, x.linhas.map((l) => [l.documentoId, l.documentoProprioId, l.tipoDocumentoId, l.tipoRegistro, l.dataEvento, l.dataRegistro, l.local, l.cartorio, l.livro, l.folha, l.termo, l.conjuge, l.paiNome, l.maeNome, l.localizado])]))
    ok("as duas planilhas têm exatamente as mesmas pessoas, registros, datas, locais, dados e cônjuges", norm(a as never) === norm(b as never) && a.length === 4, `${a.length} pessoas`)
    ok("a única diferença são os valores: Custos tem células e totais; a estrutura não tem nada financeiro", b.every((x) => x.linhas.every((l) => Array.isArray(l.celulas))) && a.every((x) => x.linhas.every((l) => !("celulas" in l) && !("totalBrl" in l))))
    const fonte = readFileSync("lib/financeiro/leitura/planilha-documental.ts", "utf8")
    ok("o financeiro casa lançamentos pelo documento PRÓPRIO (o custo do casamento não conta nas duas linhas)", /const chave = `\$\{le\.documentoProprioId\}::/.test(fonte))
    const ilaineCustos = b.find((x) => x.pessoaId === ilaine.id)!.linhas.find((l) => l.tipoDocumentoId === tCas)!
    ok("e a linha de casamento da Ilaine em Custos tem documentoProprioId = 0 (não herda o custo do Sebastião)", ilaineCustos.documentoProprioId === 0)

    secao("5) Layout: em Documentos as colunas essenciais cabem na largura")
    ok("sem valores: tabela de largura fixa com colgroup proporcional e texto que quebra (sem min-width de 860px)", /semValores \? "table-fixed" : "min-w-\[860px\]"/.test(view) && /<colgroup>/.test(view))
    ok("com valores (Custos) o layout continua o de antes (min-w-[860px] e rolagem)", /min-w-\[860px\]/.test(view))
  } finally {
    await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
    await prisma.uniao.deleteMany({ where: { pessoa1: { nome: { startsWith: MARCA } } } })
    await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.pessoa.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { id: { in: criados } } })
    await prisma.tipoDocumentoCadastro.updateMany({ where: { id: { in: antigos.map((t) => t.id) } }, data: { participaPlanilha: true } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
