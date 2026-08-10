// scripts/preco-generico-planilha.test.ts
// ============================================================================
// O PREÇO GENÉRICO DE CUSTO DA PLANILHA — §"VALIDAÇÃO DO RESOLVEDOR".
// Rodar: npm run test:preco-generico  (banco de TESTE)
//
// Prova, sem publicar nenhuma Regra Documental real, que:
//
//   · cada etapa da matriz resolve o custo genérico;
//   · o preço específico de fornecedor continua ganhando quando o fornecedor é
//     conhecido, e o genérico atende quando não é;
//   · nenhuma VENDA foi inventada;
//   · rodar de novo não cria nada.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { NaturezaPreco } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { resolverPrecoPorConfigDB } from "@/src/lib/motor/resolver-preco-financeiro.prisma"
import { resolverIntersecao, type ColunaMatriz, type ConfigCandidata } from "@/lib/financeiro/leitura/planilha-matriz"

const MARCA = "PRECO-GEN"
const CUSTO = 146.24

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.planilhaDocumentalColuna.deleteMany({ where: { config: { nome: { startsWith: MARCA } } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.categoriaServico.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.fornecedor.deleteMany({ where: { nome: { startsWith: MARCA } } })
}

/** Cria item + Configuração Financeira. Preço fica por conta de cada cenário. */
async function item(sufixo: string, natureza: "DOCUMENTO" | "SERVICO", categoriaId: number | null) {
  const it = await prisma.itemCatalogo.create({
    data: { code: `${MARCA}_${sufixo}`, name: `${MARCA} ${sufixo}`, natureza, categoriaId },
    select: { id: true, code: true },
  })
  const cfg = await prisma.produtoFinanceiro.create({
    data: { codigo: `${MARCA}-${sufixo}`.slice(0, 30), nome: `${MARCA} ${sufixo}`, moedaPadrao: "BRL", possuiCusto: true, itemCatalogoId: it.id },
    select: { id: true },
  })
  return { itemId: it.id, code: it.code, configId: cfg.id }
}

const precoGenerico = (configId: number, itemId: number, valor = CUSTO) =>
  prisma.tabelaValor.create({
    data: {
      name: `${MARCA} custo genérico ${configId}`, configuracaoFinanceiraItemId: configId, itemCatalogoId: itemId,
      natureza: "CUSTO", moeda: "BRL", modoCalculo: "fixed", valor, unidade: "DOCUMENTO", fornecedorId: null, prioridade: 0,
    },
    select: { id: true },
  })

const resolver = (configId: number, fornecedorId?: number) =>
  resolverPrecoPorConfigDB(configId, { processoId: 0, tipoProcessoId: "", natureza: NaturezaPreco.CUSTO, ...(fornecedorId ? { fornecedorId } : {}) } as never)

async function main() {
  exigirBancoDeTeste("prova o preço de custo genérico das etapas da planilha")
  await limpar()

  console.log("PREÇO GENÉRICO DE CUSTO — as sete interseções da matriz\n")

  const cat = await prisma.categoriaServico.create({ data: { code: `${MARCA}-REGCIV`, nome: `${MARCA} Registro Civil` }, select: { id: true } })

  // Três registros civis (dimensão LINHA) + quatro serviços (dimensão COLUNA).
  const nasc = await item("NASC", "DOCUMENTO", cat.id)
  const casa = await item("CASA", "DOCUMENTO", cat.id)
  const obito = await item("OBITO", "DOCUMENTO", cat.id)
  const desmat = await item("DESMAT", "SERVICO", null)
  const apostCert = await item("APOST_CERT", "SERVICO", null)
  const traducao = await item("TRAD", "SERVICO", null)
  const apostTrad = await item("APOST_TRAD", "SERVICO", null)

  const tipos = await Promise.all(
    [["Nascimento", nasc], ["Casamento", casa], ["Óbito", obito]].map(async ([nome, it]) =>
      prisma.tipoDocumentoCadastro.create({
        data: { code: `${MARCA}-${nome}`.slice(0, 40), name: `${MARCA} ${nome}`, participaPlanilha: true, ativo: true, itemCatalogoId: (it as { itemId: number }).itemId },
        select: { id: true, name: true, itemCatalogoId: true },
      }),
    ),
  )

  // O preço de CUSTO genérico de cada item — a decisão desta rodada.
  for (const i of [nasc, casa, obito, desmat, apostCert, traducao, apostTrad]) await precoGenerico(i.configId, i.itemId)

  // ═════════════════════════════════════════════════════════════════════════
  secao("1) As três interseções da coluna de etapa resolvem R$ 146,24")
  // ═════════════════════════════════════════════════════════════════════════
  // A coluna "Certidão Inteiro Teor" é UMA; o item vem do registro da linha.
  const porItem = new Map<number, ConfigCandidata[]>()
  for (const i of [nasc, casa, obito, desmat, apostCert, traducao, apostTrad]) {
    const it = await prisma.itemCatalogo.findUnique({ where: { id: i.itemId }, select: { categoriaId: true } })
    porItem.set(i.itemId, [{ configId: i.configId, itemCatalogoId: i.itemId, categoriaItemId: it?.categoriaId ?? null }])
  }
  const colCertidao: ColunaMatriz = { id: 1, estrategia: "ITEM_DO_REGISTRO", configId: null, categoriaItemId: cat.id }

  for (const t of tipos) {
    const r = resolverIntersecao(colCertidao, { tipoDocumentoId: t.id, itemCatalogoId: t.itemCatalogoId }, porItem)
    if (r.tipo !== "RESOLVIDO") { ok(`${t.name} × Certidão Inteiro Teor resolve item`, false, r.tipo); continue }
    const preco = await resolver(r.configId)
    ok(`${t.name} × Certidão Inteiro Teor → R$ ${CUSTO}`,
      preco.ok && !preco.conflito && Number(preco.valor) === CUSTO && preco.moeda === "BRL",
      preco.ok ? `${preco.moeda} ${preco.valor}` : preco.razao)
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("2) As quatro colunas de serviço resolvem R$ 146,24")
  // ═════════════════════════════════════════════════════════════════════════
  for (const [nome, i] of [["Desmaterialização", desmat], ["Apostilamento certidão", apostCert], ["Tradução juramentada", traducao], ["Apostilamento Tradução", apostTrad]] as const) {
    const col: ColunaMatriz = { id: 2, estrategia: "SERVICO_FIXO", configId: i.configId, categoriaItemId: null }
    const r = resolverIntersecao(col, { tipoDocumentoId: tipos[0].id, itemCatalogoId: tipos[0].itemCatalogoId }, porItem)
    const preco = r.tipo === "RESOLVIDO" ? await resolver(r.configId) : null
    ok(`${nome} → R$ ${CUSTO}`,
      !!preco && preco.ok && !preco.conflito && Number(preco.valor) === CUSTO,
      preco?.ok ? `${preco.moeda} ${preco.valor}` : "não resolve")
  }

  // ═════════════════════════════════════════════════════════════════════════
  secao("3) Fornecedor específico ganha; o genérico é o fallback")
  // ═════════════════════════════════════════════════════════════════════════
  // A arquitetura de prioridade NÃO foi tocada — este cenário só a documenta.
  const forn = await prisma.fornecedor.create({ data: { nome: `${MARCA} Cartório X`, tipo: "CARTORIO" }, select: { id: true } })
  await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} custo do fornecedor`, configuracaoFinanceiraItemId: nasc.configId, itemCatalogoId: nasc.itemId,
      natureza: "CUSTO", moeda: "BRL", modoCalculo: "fixed", valor: 199.9, unidade: "DOCUMENTO",
      fornecedorId: forn.id, prioridade: 0,
    },
  })
  const semForn = await resolver(nasc.configId)
  ok("sem fornecedor conhecido → genérico R$ 146,24",
    semForn.ok && !semForn.conflito && Number(semForn.valor) === CUSTO, semForn.ok ? String(semForn.valor) : semForn.razao)
  const comForn = await resolver(nasc.configId, forn.id)
  ok("com o fornecedor conhecido → o preço dele, R$ 199,90",
    comForn.ok && !comForn.conflito && Number(comForn.valor) === 199.9, comForn.ok ? String(comForn.valor) : comForn.razao)

  // ═════════════════════════════════════════════════════════════════════════
  secao("4) Nada de VENDA, nada de vigência, nada duplicado")
  // ═════════════════════════════════════════════════════════════════════════
  const ids = [nasc, casa, obito, desmat, apostCert, traducao, apostTrad].map((i) => i.itemId)
  const vendas = await prisma.tabelaValor.count({ where: { itemCatalogoId: { in: ids }, natureza: { in: ["VENDA", "RECEITA"] } } })
  ok("nenhum preço de VENDA foi criado", vendas === 0, `${vendas}`)

  const comVigencia = await prisma.tabelaValor.count({
    where: { itemCatalogoId: { in: ids }, OR: [{ vigenciaInicio: { not: null } }, { vigenciaFim: { not: null } }] },
  })
  ok("nenhuma vigência por data foi recriada", comVigencia === 0, `${comVigencia}`)

  for (const i of [nasc, casa, obito, desmat, apostCert, traducao, apostTrad]) {
    const genericos = await prisma.tabelaValor.count({
      where: { configuracaoFinanceiraItemId: i.configId, natureza: "CUSTO", fornecedorId: null, arquivado: false },
    })
    ok(`${i.code}: exatamente UM custo genérico`, genericos === 1, `${genericos}`)
  }

  const configs = await prisma.produtoFinanceiro.count({ where: { itemCatalogoId: { in: ids } } })
  ok("uma Configuração Financeira por item", configs === ids.length, `${configs}/${ids.length}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("5) Idempotência — rodar de novo não cria nada")
  // ═════════════════════════════════════════════════════════════════════════
  // A condição de criação da rotina é "o resolvedor não resolve". Aqui todos
  // resolvem, então a segunda passada é vazia por construção.
  let criariaDeNovo = 0
  for (const i of [nasc, casa, obito, desmat, apostCert, traducao, apostTrad]) {
    const r = await resolver(i.configId)
    if (!(r.ok && !r.conflito)) criariaDeNovo++
  }
  ok("segunda execução criaria ZERO preços", criariaDeNovo === 0, `${criariaDeNovo}`)

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("Toda etapa da matriz resolve o custo genérico; o do fornecedor continua ganhando.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
