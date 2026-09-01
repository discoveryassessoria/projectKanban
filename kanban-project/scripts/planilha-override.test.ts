// scripts/planilha-override.test.ts
// ============================================================================
// O COMBINADO DE UMA CÉLULA — §39 e §40.
//
// A pergunta que este teste responde: editar um valor na planilha de UM
// processo mexe no preço dos outros? Não pode mexer. A Tabela de Preços é a
// fonte canônica do padrão; o override é um fato daquele processo.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL="postgresql://postgres@127.0.0.1:55432/discovery_test" \
//   DIRECT_DATABASE_URL="$PRISMA_DATABASE_URL" npx tsx scripts/planilha-override.test.ts
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { definirOverride, removerOverride, overridesDoProcesso } from "@/lib/financeiro/planilha-celula-override"
import { adicionarColuna } from "@/lib/financeiro/leitura/planilha-colunas"
import { chaveDaCelula } from "@/lib/financeiro/leitura/planilha-matriz"

const MARCA = "OVERRIDE-TEST"

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
  for (const p of procs) {
    if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  }
  await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.planilhaDocumentalColuna.deleteMany({ where: { config: { nome: { startsWith: MARCA } } } })
  await prisma.tabelaValor.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.produtoFinanceiro.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { name: { startsWith: MARCA } } })
}

async function main() {
  exigirBancoDeTeste("prova que o override é do processo e não da Tabela de Preços")
  await limpar()

  // ── Cenário: dois processos, a MESMA coluna, o MESMO preço de tabela ──────
  const cfg = await prisma.produtoFinanceiro.create({
    data: { codigo: `${MARCA}-CFG`, nome: `${MARCA} Apostilamento`, moedaPadrao: "BRL", possuiCusto: true },
    select: { id: true },
  })
  const preco = await prisma.tabelaValor.create({
    data: {
      name: `${MARCA} preço`, configuracaoFinanceiraItemId: cfg.id, natureza: "CUSTO",
      moeda: "BRL", modoCalculo: "fixed", valor: 151.05, prioridade: 10,
    },
    select: { id: true, valor: true },
  })
  // Pelo serviço canônico: até o cenário de teste entra pela mesma porta.
  const coluna = await adicionarColuna({ origem: "SERVICO", itemId: cfg.id })
  const tipoDoc = await prisma.tipoDocumentoCadastro.create({
    data: { code: `${MARCA}-T`, name: `${MARCA} Nascimento`, participaPlanilha: true, ativo: true },
    select: { id: true },
  })

  const monta = async (sufixo: string) => {
    const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id }, select: { id: true },
    })
    const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: sufixo }, select: { id: true } })
    return { processoId: proc.id, pessoaId: pes.id }
  }
  const A = await monta("A")
  const B = await monta("B")

  const alvoA = { ...A, tipoDocumentoId: tipoDoc.id, colunaId: coluna.id }
  const alvoB = { ...B, tipoDocumentoId: tipoDoc.id, colunaId: coluna.id }

  console.log("COMBINADO DA CÉLULA — a Tabela de Preços não se mexe\n")

  // ═════════════════════════════════════════════════════════════════════════
  secao("39) Editar no processo A não altera a Tabela nem o processo B")
  // ═════════════════════════════════════════════════════════════════════════
  await definirOverride(alvoA, { valor: 175, autorId: null, motivo: "cartório cobrou a mais" })

  const tabelaDepois = await prisma.tabelaValor.findUnique({ where: { id: preco.id }, select: { valor: true } })
  ok("a Tabela de Preços continua R$ 151,05", Number(tabelaDepois?.valor) === 151.05, `${Number(tabelaDepois?.valor)}`)

  const doA = await overridesDoProcesso(A.processoId)
  ok("o processo A passa a valer R$ 175,00",
    doA.get(chaveDaCelula(alvoA))?.valor === 175, `${doA.get(chaveDaCelula(alvoA))?.valor}`)

  const doB = await overridesDoProcesso(B.processoId)
  ok("o processo B não tem override nenhum", doB.size === 0, `${doB.size}`)

  // ═════════════════════════════════════════════════════════════════════════
  secao("39) O combinado persiste — reler o banco devolve o mesmo valor")
  // ═════════════════════════════════════════════════════════════════════════
  const relido = await overridesDoProcesso(A.processoId)
  ok("releitura devolve R$ 175,00", relido.get(chaveDaCelula(alvoA))?.valor === 175)

  // ═════════════════════════════════════════════════════════════════════════
  secao("21) A identidade é a interseção inteira — não a pessoa, não a coluna")
  // ═════════════════════════════════════════════════════════════════════════
  await definirOverride(alvoB, { valor: 99, autorId: null })
  const aindaA = await overridesDoProcesso(A.processoId)
  ok("gravar em B não mexe em A", aindaA.get(chaveDaCelula(alvoA))?.valor === 175)
  const agoraB = await overridesDoProcesso(B.processoId)
  ok("B tem o seu próprio valor", agoraB.get(chaveDaCelula(alvoB))?.valor === 99)

  // ═════════════════════════════════════════════════════════════════════════
  secao("20) Sobrescrever atualiza — não cria uma segunda linha")
  // ═════════════════════════════════════════════════════════════════════════
  await definirOverride(alvoA, { valor: 180, autorId: null })
  const quantos = await prisma.planilhaCelulaOverride.count({ where: { processoId: A.processoId } })
  ok("continua havendo UM override para a célula", quantos === 1, `${quantos}`)
  const atualizado = await overridesDoProcesso(A.processoId)
  ok("o valor é o último combinado (R$ 180,00)", atualizado.get(chaveDaCelula(alvoA))?.valor === 180)

  // ═════════════════════════════════════════════════════════════════════════
  secao("24) Restaurar padrão remove o combinado e devolve a Tabela")
  // ═════════════════════════════════════════════════════════════════════════
  const removeu = await removerOverride(alvoA)
  ok("remover devolve true", removeu === true)
  const semOverride = await overridesDoProcesso(A.processoId)
  ok("a célula volta a não ter combinado", !semOverride.has(chaveDaCelula(alvoA)))
  const tabelaFinal = await prisma.tabelaValor.findUnique({ where: { id: preco.id }, select: { valor: true } })
  ok("a Tabela permanece intacta o tempo todo", Number(tabelaFinal?.valor) === 151.05)
  ok("remover de novo não é erro", (await removerOverride(alvoA)) === false)

  // ═════════════════════════════════════════════════════════════════════════
  secao("25) Auditoria — quem, quando, de quanto para quanto")
  // ═════════════════════════════════════════════════════════════════════════
  const logs = await prisma.logAuditoria.findMany({
    where: { entidade: "PlanilhaCelulaOverride" },
    orderBy: { id: "desc" }, take: 10,
    select: { acao: true, descricao: true, detalhes: true },
  })
  ok("o define foi auditado", logs.some((l) => l.acao === "PLANILHA_OVERRIDE_DEFINIDO"))
  ok("a alteração foi auditada", logs.some((l) => l.acao === "PLANILHA_OVERRIDE_ALTERADO"))
  ok("a remoção foi auditada", logs.some((l) => l.acao === "PLANILHA_OVERRIDE_REMOVIDO"))
  const alteracao = logs.find((l) => l.acao === "PLANILHA_OVERRIDE_ALTERADO")
  ok("a alteração registra o valor anterior e o novo",
    !!alteracao && /175/.test(JSON.stringify(alteracao.detalhes)) && /180/.test(JSON.stringify(alteracao.detalhes)))
  ok("a auditoria diz que a Tabela não foi alterada",
    logs.some((l) => /Tabela de Preços NÃO foi alterada/.test(l.descricao ?? "")))

  // ═════════════════════════════════════════════════════════════════════════
  secao("37) Zero é zero — e negativo é recusado")
  // ═════════════════════════════════════════════════════════════════════════
  await definirOverride(alvoA, { valor: 0, autorId: null })
  const zero = await overridesDoProcesso(A.processoId)
  ok("R$ 0,00 é um combinado LEGÍTIMO e persiste", zero.get(chaveDaCelula(alvoA))?.valor === 0)
  let recusou = false
  try { await definirOverride(alvoA, { valor: -5, autorId: null }) } catch { recusou = true }
  ok("valor negativo é recusado", recusou)

  // ═════════════════════════════════════════════════════════════════════════
  secao("41) Override não sobrevive à pessoa — nada de custo fantasma")
  // ═════════════════════════════════════════════════════════════════════════
  await definirOverride(alvoB, { valor: 42, autorId: null })
  await prisma.pessoa.delete({ where: { id: B.pessoaId } })
  const orfaos = await prisma.planilhaCelulaOverride.count({ where: { processoId: B.processoId } })
  ok("pessoa removida leva o override junto (FK Cascade)", orfaos === 0, `${orfaos} restante(s)`)

  await limpar()

  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhou > 0) {
    console.log("\nFalhas:")
    for (const f of falhas) console.log(`  · ${f}`)
    process.exit(1)
  }
  console.log("O combinado é do processo; a Tabela de Preços é de todos.\n")
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
