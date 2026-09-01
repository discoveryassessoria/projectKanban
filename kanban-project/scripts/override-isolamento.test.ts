// scripts/override-isolamento.test.ts
// ============================================================================
// O OVERRIDE PERTENCE A UM PROCESSO — e a mais ninguém.
// Rodar: npm run test:override-isolamento   (banco de TESTE)
//
// A regra que este teste trava:
//
//   effectiveValue = overrideValue ?? baseValue
//
// e o efetivo manda em TODA conta da planilha daquele processo — célula, linha,
// pessoa, total geral. Enquanto isso, o Cadastro Mestre e a Tabela de Preços
// ficam intactos, e a planilha de qualquer outro processo continua no valor
// canônico.
//
// ─── POR QUE ISOLAMENTO PRECISA DE TESTE PRÓPRIO ────────────────────────────
// Um override é um preço escrito à mão. A tentação de "corrigir o preço de uma
// vez" é enorme, e o dia em que alguém trocar o `PlanilhaCelulaOverride` por um
// UPDATE em `TabelaValor` o sistema vai continuar passando em todos os outros
// testes — o processo A mostraria R$ 175,00 certinho. Só o processo B, de outro
// cliente, é que passaria a cobrar errado. É esse cenário que este arquivo
// monta: dois processos sobre o MESMO cadastro.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/override-isolamento.test.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { montarPlanilhaDocumental } from "@/lib/financeiro/leitura/planilha-documental"
import { definirOverride, removerOverride } from "@/lib/financeiro/planilha-celula-override"
import { adicionarColuna, listarColunasConfiguradas, removerColuna } from "@/lib/financeiro/leitura/planilha-colunas"

const MARCA = "ISOLAMENTO"
const BASE = 146.24
const COMBINADO = 175

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  await prisma.planilhaCelulaOverride.deleteMany({ where: { processoId: { in: procs.map((p) => p.id) } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  for (const c of await listarColunasConfiguradas()) await removerColuna(c.id)
  await prisma.matrizDocumental.deleteMany({ where: { documentTypeCode: { startsWith: MARCA } } })
  await prisma.phaseEconomicRule.deleteMany({ where: { componentKey: { startsWith: MARCA } } })
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: MARCA } } })
}

/** Uma célula da planilha, achada por pessoa × registro × coluna. */
function celula(pl: Awaited<ReturnType<typeof montarPlanilhaDocumental>>, tipoDocumentoId: number, colunaId: number) {
  const linha = pl.pessoas[0]?.linhas.find((l) => l.tipoDocumentoId === tipoDocumentoId)
  return { linha, celula: linha?.celulas.find((c) => c.colunaId === colunaId) }
}

async function main() {
  exigirBancoDeTeste("prova que o override é do processo e não vaza para os outros")
  await limpar()

  // ── UM cadastro, UM preço, DOIS processos ────────────────────────────────
  const item = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_CERT`, name: `${MARCA} Certidão`, natureza: "DOCUMENTO" },
    select: { id: true },
  })
  const cfg = await prisma.produtoFinanceiro.create({
    data: { codigo: `${MARCA}-CFG`, nome: `${MARCA} Certidão`, moedaPadrao: "BRL", possuiCusto: true, itemCatalogoId: item.id },
    select: { id: true },
  })
  const preco = await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} preço canônico`, configuracaoFinanceiraItemId: cfg.id, itemCatalogoId: item.id,
      natureza: "CUSTO", moeda: "BRL", modoCalculo: "fixed", valor: BASE, unidade: "DOCUMENTO", prioridade: 0,
    },
    select: { id: true, valor: true },
  })
  const tipoDoc = await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}-T`, name: `${MARCA} Nascimento`, participaPlanilha: true, ativo: true, itemCatalogoId: item.id },
    select: { id: true },
  })
  const coluna = await adicionarColuna({ origem: "SERVICO", itemId: cfg.id, rotuloOverride: "Certidão Inteiro Teor" })

  const montar = async (sufixo: string) => {
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id }, select: { id: true },
    })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: `${sufixo}` }, select: { id: true } })
    return { processoId: proc.id, pessoaId: pes.id }
  }
  const A = await montar("A")
  const B = await montar("B")
  const alvoA = { ...A, tipoDocumentoId: tipoDoc.id, colunaId: coluna.id }

  console.log(`ISOLAMENTO DO OVERRIDE — base ${BASE}, combinado ${COMBINADO}\n`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Estado inicial — os dois processos leem o mesmo preço canônico")
  // ═════════════════════════════════════════════════════════════════════════
  let plA = await montarPlanilhaDocumental(A.processoId)
  let plB = await montarPlanilhaDocumental(B.processoId)
  const cA0 = celula(plA, tipoDoc.id, coluna.id)
  ok("A mostra o preço da Tabela", cA0.celula?.valorEfetivo === BASE, String(cA0.celula?.valorEfetivo))
  ok("B mostra o preço da Tabela", celula(plB, tipoDoc.id, coluna.id).celula?.valorEfetivo === BASE)
  ok("o total de A é o preço base", plA.totalGeralBrl === BASE, String(plA.totalGeralBrl))
  ok("o total de B é o preço base", plB.totalGeralBrl === BASE, String(plB.totalGeralBrl))

  // ═════════════════════════════════════════════════════════════════════════
  secao("Override em A — todo cálculo de A passa a usar o combinado")
  // ═════════════════════════════════════════════════════════════════════════
  await definirOverride(alvoA, { valor: COMBINADO, autorId: null, motivo: "combinado do processo" })
  plA = await montarPlanilhaDocumental(A.processoId)
  const cA1 = celula(plA, tipoDoc.id, coluna.id)

  ok("a célula de A vale o combinado", cA1.celula?.valorEfetivo === COMBINADO, String(cA1.celula?.valorEfetivo))
  ok("e o estado é SOBRESCRITO", cA1.celula?.estado === "SOBRESCRITO", cA1.celula?.estado)
  // O base NÃO some: é ele que a explicação mostra como "preço padrão", e é
  // para ele que a célula volta quando o combinado é removido.
  ok("o preço da Tabela continua visível na célula", cA1.celula?.valorBase === BASE, String(cA1.celula?.valorBase))
  ok("o TOTAL DA LINHA de A usa o combinado", cA1.linha?.totalBrl === COMBINADO, String(cA1.linha?.totalBrl))
  ok("o TOTAL DA PESSOA de A usa o combinado", plA.pessoas[0].totalBrl === COMBINADO, String(plA.pessoas[0].totalBrl))
  ok("o TOTAL GERAL de A usa o combinado", plA.totalGeralBrl === COMBINADO, String(plA.totalGeralBrl))
  ok("o total por serviço de A usa o combinado",
    Object.values(plA.totaisPorServico)[0] === COMBINADO, JSON.stringify(plA.totaisPorServico))
  ok("a explicação diz que a origem é o combinado do processo",
    cA1.celula?.explicacao.origem === "Combinado deste processo", String(cA1.celula?.explicacao.origem))

  // ═════════════════════════════════════════════════════════════════════════
  secao("O cadastro canônico NÃO foi tocado")
  // ═════════════════════════════════════════════════════════════════════════
  const precoDepois = await prisma.tabelaValor.findUnique({ where: { id: preco.id }, select: { valor: true, atualizadoEm: true } })
  ok("a Tabela de Preços continua R$ 146,24", Number(precoDepois?.valor) === BASE, String(precoDepois?.valor))
  const cfgDepois = await prisma.produtoFinanceiro.findUnique({ where: { id: cfg.id }, select: { itemCatalogoId: true, ativo: true } })
  ok("a Configuração Financeira continua a mesma", cfgDepois?.itemCatalogoId === item.id && cfgDepois?.ativo === true)
  const linhasDePreco = await prisma.tabelaValor.count({ where: { configuracaoFinanceiraItemId: cfg.id } })
  ok("nenhuma linha de preço foi criada por causa do override", linhasDePreco === 1, `${linhasDePreco}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("O outro processo NÃO enxerga o combinado")
  // ═════════════════════════════════════════════════════════════════════════
  plB = await montarPlanilhaDocumental(B.processoId)
  const cB = celula(plB, tipoDoc.id, coluna.id)
  ok("B continua no preço canônico", cB.celula?.valorEfetivo === BASE, String(cB.celula?.valorEfetivo))
  ok("B não tem override nenhum", cB.celula?.valorOverride === null, String(cB.celula?.valorOverride))
  ok("o estado de B não é SOBRESCRITO", cB.celula?.estado !== "SOBRESCRITO", cB.celula?.estado)
  ok("o total de B continua R$ 146,24", plB.totalGeralBrl === BASE, String(plB.totalGeralBrl))
  const overridesDeB = await prisma.planilhaCelulaOverride.count({ where: { processoId: B.processoId } })
  ok("nenhum override vazou para B no banco", overridesDeB === 0, `${overridesDeB}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("Restaurar padrão — A volta ao valor ATUAL do cadastro")
  // ═════════════════════════════════════════════════════════════════════════
  await removerOverride(alvoA)
  plA = await montarPlanilhaDocumental(A.processoId)
  const cA2 = celula(plA, tipoDoc.id, coluna.id)
  ok("a célula de A volta ao preço da Tabela", cA2.celula?.valorEfetivo === BASE, String(cA2.celula?.valorEfetivo))
  ok("o total da linha de A volta", cA2.linha?.totalBrl === BASE, String(cA2.linha?.totalBrl))
  ok("o total geral de A volta", plA.totalGeralBrl === BASE, String(plA.totalGeralBrl))
  ok("não sobra override em A", (await prisma.planilhaCelulaOverride.count({ where: { processoId: A.processoId } })) === 0)

  // "Volta ao valor ATUAL" não é "volta ao valor de antes": se a Tabela mudou
  // enquanto o combinado vigorava, é o preço NOVO que passa a valer — o
  // override nunca guardou uma cópia do preço para restaurar depois.
  await prisma.tabelaValor.update({ where: { id: preco.id }, data: { valor: 160 } })
  plA = await montarPlanilhaDocumental(A.processoId)
  ok("removido o combinado, A acompanha o preço ATUAL do cadastro (160,00)",
    celula(plA, tipoDoc.id, coluna.id).celula?.valorEfetivo === 160,
    String(celula(plA, tipoDoc.id, coluna.id).celula?.valorEfetivo))
  await prisma.tabelaValor.update({ where: { id: preco.id }, data: { valor: BASE } })

  // ═════════════════════════════════════════════════════════════════════════
  secao("Nenhum caminho de escrita do override alcança o cadastro")
  // ═════════════════════════════════════════════════════════════════════════
  // Estático, e de propósito: o teste acima prova o comportamento de hoje; este
  // impede que a implementação de amanhã passe a "corrigir o preço de uma vez".
  const { readFileSync } = await import("node:fs")
  const servico = readFileSync(new URL("../lib/financeiro/planilha-celula-override.ts", import.meta.url), "utf8")
  const rota = readFileSync(new URL("../src/app/api/processos/[processoId]/planilha-override/route.ts", import.meta.url), "utf8")
  for (const [rotulo, src] of [["o serviço", servico], ["a rota", rota]] as const) {
    ok(`${rotulo} não escreve em TabelaValor`, !/tabelaValor\.(create|update|updateMany|upsert|delete|deleteMany)/.test(src))
    ok(`${rotulo} não escreve em ProdutoFinanceiro`, !/produtoFinanceiro\.(create|update|upsert|delete)/.test(src))
    ok(`${rotulo} não escreve em ItemCatalogo`, !/itemCatalogo\.(create|update|upsert|delete)/.test(src))
  }
  ok("o override é gravado com o processo na chave",
    /processoId_pessoaId_tipoDocumentoId_colunaId/.test(servico),
    "sem o processo na chave, o valor valeria para todo mundo")

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("O combinado é de um processo; o preço é de todos.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
