// scripts/planilha-documental-sem-valores.test.ts
// ============================================================================
// PLANILHA DOCUMENTAL NA ABA DOCUMENTOS (07/10/2026) — a MESMA planilha de Financeiro → Custos, SEM nenhum valor.
//   npx tsx scripts/planilha-documental-sem-valores.test.ts   (banco de teste)
//
//   (a) mesmas pessoas, mesma ordem, mesmos registros que a de Custos;
//   (b) a resposta de Documentos não contém NENHUM campo de valor — e a permissão é `processos.ver` (a da aba Documentos), não financeiro.ver;
//   (c) Custos continua com os valores e o botão «+ Novo Custo» (a mudança não o tocou).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("planilha-documental-sem-valores.test.ts")

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarEstruturaDocumental, montarPlanilhaDocumental } from "../lib/financeiro/leitura/planilha-documental"
import { GET as getSemValores } from "../src/app/api/processos/[processoId]/planilha-documental/route"
import { GET as getCustos } from "../src/app/api/processos/[processoId]/custos/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "PLSV"

async function main() {
  let tipoCriado: number | null = null
  const marcaArvore = `${MARCA} arvore`
  try {
    // O cadastro do que é «registro da planilha» (nascimento/casamento/óbito). No banco de teste pode não existir: cria um, e remove no fim.
    let tipos = await prisma.tipoDocumentoCadastro.findMany({ where: { participaPlanilha: true }, select: { id: true } })
    if (tipos.length === 0) {
      const t = await prisma.tipoDocumentoCadastro.create({ data: { name: `${MARCA} Certidão de nascimento`, code: `${MARCA}_NASC`, participaPlanilha: true } as never, select: { id: true } })
      tipoCriado = t.id; tipos = [t]
    }
    const arv = await prisma.arvore.create({ data: { nome: marcaArvore }, select: { id: true } })
    const proc = await prisma.processo.create({ data: { nome: `${MARCA} Família`, arvoreId: arv.id }, select: { id: true } })
    const avo = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${MARCA} Avô`, sobrenome: "Rossi", numeroLinhagem: 1, linhaReta: true, requerente: "nao" }, select: { id: true } })
    const pai = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${MARCA} Pai`, sobrenome: "Rossi", numeroLinhagem: 2, linhaReta: true, requerente: "nao", paiId: avo.id }, select: { id: true } })
    const req = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${MARCA} Requerente`, sobrenome: "Rossi", numeroLinhagem: 3, linhaReta: true, requerente: "sim", paiId: pai.id }, select: { id: true } })
    await prisma.documento.create({ data: { pessoaId: pai.id, documentTypeId: tipos[0].id, descricao: `${MARCA} doc`, cartorio: "Comacchio", livro: "1", folha: "2", termo: "3", cidade_registro: "Comacchio", data_registro: new Date("1950-03-04T00:00:00Z") } as never })

    secao("(a) Mesmas pessoas e registros que Custos")
    const estrutura = await montarEstruturaDocumental(proc.id)
    const custos = await montarPlanilhaDocumental(proc.id)
    ok("a planilha tem as 3 pessoas da árvore", estrutura.length === 3, estrutura.map((b) => b.nome).join(", "))
    ok("mesma ordem de pessoas (por geração) nas duas", JSON.stringify(estrutura.map((b) => b.pessoaId)) === JSON.stringify(custos.pessoas.map((b) => b.pessoaId)))
    const camposDoRegistro = (l: { documentoId: number; tipoDocumentoId: number | null; tipoRegistro: string | null; dataRegistro: string | null; local: string | null; cartorio: string | null; livro: string | null; folha: string | null; termo: string | null; conjuge: string | null; paiNome: string | null; maeNome: string | null; localizado: boolean }) => JSON.stringify([l.documentoId, l.tipoDocumentoId, l.tipoRegistro, l.dataRegistro, l.local, l.cartorio, l.livro, l.folha, l.termo, l.conjuge, l.paiNome, l.maeNome, l.localizado])
    const registrosA = estrutura.flatMap((b) => b.linhas.map((l) => `${b.pessoaId}|${camposDoRegistro(l)}`))
    const registrosB = custos.pessoas.flatMap((b) => b.linhas.map((l) => `${b.pessoaId}|${camposDoRegistro(l)}`))
    ok("os mesmos registros (data, local, livro/folha/termo, cônjuge, genitores) nas duas", registrosA.length > 0 && JSON.stringify(registrosA) === JSON.stringify(registrosB), `${registrosA.length} linhas`)
    ok("mesma geração e mesma linhagem principal em cada pessoa", JSON.stringify(estrutura.map((b) => [b.geracao, b.linhagemPrincipal, b.posicao])) === JSON.stringify(custos.pessoas.map((b) => [b.geracao, b.linhagemPrincipal, b.posicao])))
    const doPai = estrutura.find((b) => b.pessoaId === pai.id)!.linhas.find((l) => l.documentoId > 0)
    ok("o registro do pai traz cartório, livro/folha/termo e data", doPai?.cartorio === "Comacchio" && doPai?.livro === "1" && doPai?.folha === "2" && doPai?.termo === "3" && !!doPai?.dataRegistro)

    secao("(b) A resposta de Documentos não tem valor nenhum — e a permissão é a da aba Documentos")
    const mk = (n: string, perms: Record<string, boolean>) => prisma.usuario.create({ data: { nome: `${MARCA} ${n}`, email: `${MARCA.toLowerCase()}-${n}@t.com`, senha: "x", tipo: "assistente", permissoesCustom: perms } })
    const operador = await mk("operador", { "processos.ver": true, "financeiro.ver": false })
    const semNada = await mk("semnada", { "processos.ver": false, "financeiro.ver": false })
    const financeiro = await mk("financeiro", { "processos.ver": true, "financeiro.ver": true })
    const tok = async (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
    const chama = async (h: typeof getSemValores, u: { id: number; email: string; tipo: string }) =>
      h(new NextRequest(`http://localhost/api/processos/${proc.id}/x`, { headers: { Authorization: `Bearer ${await tok(u)}` } }), { params: Promise.resolve({ processoId: String(proc.id) }) })

    const rOp = await chama(getSemValores, operador)
    ok("o OPERADOR (processos.ver, SEM financeiro.ver) abre a planilha de Documentos", rOp.status === 200, String(rOp.status))
    const corpo = await rOp.json()
    const texto = JSON.stringify(corpo)
    ok("a resposta não tem NENHUM campo de valor (valor, total, preço, custo, moeda, célula, coluna de serviço)", !/"(valor\w*|total\w*|preco\w*|custo\w*|moeda|celulas?|colunas|servicos|naoConvertido|automatico|estado)"/i.test(texto), (texto.match(/"(valor\w*|total\w*|preco\w*|custo\w*|moeda|celulas?|colunas|servicos|naoConvertido)"/i) ?? [""])[0])
    ok("nem números com cara de dinheiro (R$)", !/R\$/.test(texto))
    ok("e as pessoas vêm (a mesma estrutura)", (corpo.planilha?.pessoas ?? []).length === 3)
    const rNada = await chama(getSemValores, semNada)
    ok("quem não vê processos NÃO abre (403)", rNada.status === 403, String(rNada.status))

    const rCustosOp = await chama(getCustos, operador)
    ok("o operador SEM financeiro.ver continua sem acesso a Custos (403)", rCustosOp.status === 403, String(rCustosOp.status))

    secao("(c) Custos continua com valores e «+ Novo Custo»")
    const rFin = await chama(getCustos, financeiro)
    const corpoFin = await rFin.json()
    ok("a rota de Custos devolve valores (colunas, totais, células) a quem tem financeiro.ver", rFin.status === 200 && Array.isArray(corpoFin.planilha?.colunas) && "totalGeralBrl" in corpoFin.planilha && Array.isArray(corpoFin.servicos) && "totalGeral" in corpoFin)
    ok("a planilha de Custos tem células e totais por linha", custos.pessoas.every((b) => b.linhas.every((l) => Array.isArray(l.celulas) && typeof l.totalBrl === "number")) && typeof custos.totalGeralBrl === "number")
    const shell = readFileSync("src/components/financeiro/v3/ProcessoFinanceiroShell.tsx", "utf8")
    ok("a tela de Custos mantém o botão «Novo Custo» e a planilha COM valores", /Novo Custo/.test(shell) && /<PlanilhaDocumentalView processoId=\{processoId\} \/>/.test(shell) && !/semValores/.test(shell))
    const view = readFileSync("src/components/financeiro/v3/PlanilhaDocumentalView.tsx", "utf8")
    ok("o padrão do componente é COM valores (semValores só liga quando pedido)", /semValores = false/.test(view))
    ok("sem valores: sem coluna «Total», sem total geral e sem edição de preço", /!semValores && <th/.test(view) && /!semValores && p\.totalGeralBrl != null/.test(view) && /semValores \? \[\]/.test(view))

    secao("Aba Documentos (estático)")
    const bib = readFileSync("src/components/kanban/ProcessoDocumentosBiblioteca.tsx", "utf8")
    ok("o seletor Lista · Painel · Planilha documental existe", /\["lista", "Lista"\], \["painel", "Painel"\], \["planilha", "Planilha documental"\]/.test(bib))
    ok("a planilha de Documentos é a MESMA, ligada em semValores e com os filtros da lista", /<PlanilhaDocumentalView processoId=\{processoId\} semValores filtrarLinha=\{filtrarLinhaDaPlanilha\}/.test(bib))
    ok("os 8 cartões, os filtros e a legenda não dependem da visão (ficam fora dos ramos)", /kpiCards\.map/.test(bib) && /<Legenda \/>/.test(bib))
    const docs = readFileSync("src/components/kanban/ProcessoDocumentos.tsx", "utf8")
    ok("a aba passa o processo para a biblioteca", /processoId=\{processo\.id\}/.test(docs))
    const rota = readFileSync("src/app/api/processos/[processoId]/planilha-documental/route.ts", "utf8")
    ok("a rota de Documentos usa processos.ver e NÃO importa nada financeiro", /verificarPermissao\(request, 'processos\.ver'\)/.test(rota) && !/financeiro\.ver/.test(rota.replace(/\/\/.*$/gm, "")) && !/montarPlanilhaDocumental/.test(rota.replace(/\/\/.*$/gm, "")))
    const estr = readFileSync("lib/financeiro/leitura/planilha-documental.ts", "utf8")
    const corpoEstrutura = estr.slice(estr.indexOf("export async function montarEstruturaDocumental"), estr.indexOf("export async function montarPlanilhaDocumental"))
    ok("a estrutura não consulta preço, lançamento, regra econômica nem combinado", !/resolverPrecoPorConfigDB|listarObrigacoes|overridesDoProcesso|resolverElegibilidadeDocumental|produtoFinanceiro/.test(corpoEstrutura))
  } finally {
    await prisma.documento.deleteMany({ where: { descricao: { startsWith: MARCA } } })
    await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.pessoa.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
    if (tipoCriado != null) await prisma.tipoDocumentoCadastro.deleteMany({ where: { id: tipoCriado } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
