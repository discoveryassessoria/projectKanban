// scripts/preco-custo-generico-planilha.ts
// ============================================================================
// PREÇO DE CUSTO GENÉRICO PARA AS ETAPAS DA PLANILHA DOCUMENTAL.
//
// Deixa a CAMADA DE PREÇOS pronta: toda etapa da matriz passa a ter onde o
// preço mora e um custo que o resolvedor oficial alcança. Não toca em Regra
// Documental, em PhaseEconomicRule nem em aplicabilidade — enquanto essas não
// forem configuradas, as células continuam "não aplicável", e isso é o correto.
//
// ─── O QUE A AUDITORIA MOSTROU, E QUE MUDA A AÇÃO ───────────────────────────
// Nascimento e casamento JÁ TINHAM custo de R$ 146,24 — preso ao fornecedor 15.
// Existir não é o mesmo que ser aplicável: uma linha com `fornecedorId`
// preenchido só casa quando o contexto traz AQUELE fornecedor, e a planilha lê
// sem fornecedor nenhum. Na prática o preço estava lá e o resolvedor não o
// alcançava.
//
// Por isso o critério deste script não é "tem linha de preço?" e sim "o
// RESOLVEDOR OFICIAL devolve valor?". É a mesma pergunta que a planilha faz.
//
// ─── O QUE ELE PRESERVA ─────────────────────────────────────────────────────
// O preço específico de fornecedor continua intacto e continua ganhando quando
// o fornecedor é conhecido — o desempate por especificidade é do resolvedor e
// não foi tocado. O genérico é o fallback de quando não há fornecedor.
//
// NÃO cria VENDA. NÃO copia custo para venda. NÃO cria vigência (validade é
// estado, não data). NÃO sobrescreve preço algum.
//
// ─── IDEMPOTÊNCIA ───────────────────────────────────────────────────────────
// A condição de criação é "o resolvedor não resolve". Depois de criado, ele
// resolve — então a segunda execução não escreve nada.
//
//   Dry-run:  npx tsx scripts/preco-custo-generico-planilha.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/preco-custo-generico-planilha.ts --execute
// ============================================================================
import { prisma } from "@/lib/prisma"
import { NaturezaPreco } from "@prisma/client"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
import { resolverPrecoPorConfigDB } from "@/src/lib/motor/resolver-preco-financeiro.prisma"
import { listarColunasConfiguradas } from "@/lib/financeiro/leitura/planilha-colunas"
import { garantirConfigFinanceiraDeItem } from "@/src/services/config-financeira-auto"

const EXECUTAR = process.argv.includes("--execute")

/** Decisão de negócio do usuário, em 09/08/2026. Custo genérico, sem fornecedor. */
const CUSTO_GENERICO = 146.24
const MOEDA = "BRL"

interface Alvo {
  etapa: string
  itemId: number
  itemCode: string
  itemNome: string
}

/**
 * Os itens que a matriz precisa — DERIVADOS da configuração, nunca uma lista
 * fixa. Coluna de serviço traz o seu item; coluna de etapa traz os itens dos
 * REGISTROS da planilha, que é de onde ela resolve.
 */
async function alvosDaMatriz(): Promise<Alvo[]> {
  const colunas = await listarColunasConfiguradas({ apenasAtivas: true })
  const vistos = new Set<number>()
  const alvos: Alvo[] = []

  const registrar = (etapa: string, item: { id: number; code: string; name: string } | null) => {
    if (!item || vistos.has(item.id)) return
    vistos.add(item.id)
    alvos.push({ etapa, itemId: item.id, itemCode: item.code, itemNome: item.name })
  }

  for (const c of colunas) {
    if (c.estrategia === "ITEM_DO_REGISTRO") {
      const tipos = await prisma.tipoDocumentoCadastro.findMany({
        where: { participaPlanilha: true, itemCatalogoId: { not: null } },
        select: { name: true, itemCatalogo: { select: { id: true, code: true, name: true } } },
        orderBy: { id: "asc" },
      })
      for (const t of tipos) registrar(`${c.rotulo} × ${t.name}`, t.itemCatalogo)
      continue
    }
    if (c.configId == null) continue
    const cfg = await prisma.produtoFinanceiro.findUnique({
      where: { id: c.configId },
      select: { itemCatalogo: { select: { id: true, code: true, name: true } } },
    })
    registrar(c.rotulo, cfg?.itemCatalogo ?? null)
  }
  return alvos
}

async function main() {
  const alvos = await alvosDaMatriz()
  console.log(`\nETAPAS DA MATRIZ → ITENS NECESSÁRIOS (${alvos.length})\n`)

  const linhas: Array<{
    alvo: Alvo; configId: number | null; existentes: string; resolve: boolean; detalhe: string; acao: string
  }> = []

  for (const a of alvos) {
    const cfg = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: a.itemId }, select: { id: true } })
    const precos = cfg
      ? await prisma.tabelaValor.findMany({
          where: { configuracaoFinanceiraItemId: cfg.id, natureza: "CUSTO", arquivado: false },
          select: { id: true, valor: true, fornecedorId: true },
        })
      : []

    // A PERGUNTA CERTA: o resolvedor oficial devolve valor SEM fornecedor?
    let resolve = false
    let detalhe = "sem Configuração Financeira"
    if (cfg) {
      const r = await resolverPrecoPorConfigDB(cfg.id, { processoId: 0, tipoProcessoId: "", natureza: NaturezaPreco.CUSTO })
      resolve = r.ok && !r.conflito
      detalhe = r.ok && !r.conflito ? `${r.moeda} ${r.valor}` : (r.ok ? (r.conflito?.nota ?? "conflito") : r.razao)
    }

    linhas.push({
      alvo: a,
      configId: cfg?.id ?? null,
      existentes: precos.map((p) => `#${p.id}=${p.valor}${p.fornecedorId ? `·forn${p.fornecedorId}` : "·genérico"}`).join(" ") || "nenhum",
      resolve,
      detalhe,
      acao: resolve ? "PRESERVAR" : cfg ? "criar custo genérico" : "criar config + custo genérico",
    })
  }

  const larg = Math.max(...linhas.map((l) => l.alvo.itemNome.length))
  console.log(`${"ITEM".padEnd(larg)}  ${"CÓDIGO".padEnd(26)} CFG    CUSTOS EXISTENTES         RESOLVEDOR            AÇÃO`)
  console.log("─".repeat(larg + 100))
  for (const l of linhas) {
    console.log(
      `${l.alvo.itemNome.padEnd(larg)}  ${l.alvo.itemCode.padEnd(26)} ${String(l.configId ?? "—").padEnd(6)} ` +
      `${l.existentes.padEnd(25)} ${(l.resolve ? `OK ${l.detalhe}` : "não resolve").padEnd(21)} ${l.acao}`,
    )
  }

  const aCriar = linhas.filter((l) => !l.resolve)
  console.log(`\nA CRIAR: ${aCriar.length} preço(s) de CUSTO genérico de ${MOEDA} ${CUSTO_GENERICO.toFixed(2)}`)
  console.log(`A PRESERVAR: ${linhas.length - aCriar.length} item(ns) que o resolvedor já alcança`)
  const comFornecedor = linhas.filter((l) => l.existentes.includes("forn"))
  if (comFornecedor.length) {
    console.log(`\nPREÇOS DE FORNECEDOR PRESERVADOS (continuam ganhando quando o fornecedor é conhecido):`)
    for (const l of comFornecedor) console.log(`  ${l.alvo.itemCode}: ${l.existentes}`)
  }

  if (aCriar.length === 0) {
    console.log(`\n✅ nada a fazer: toda etapa da matriz já resolve custo.\n`)
    return
  }
  if (!EXECUTAR) {
    console.log(`\nDRY-RUN: nada foi escrito.`)
    console.log(`Aplicar: EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/preco-custo-generico-planilha.ts --execute\n`)
    return
  }

  exigirConfirmacaoDeEscritaEmProducao(
    `cria ${aCriar.length} preço(s) de CUSTO genérico de ${MOEDA} ${CUSTO_GENERICO.toFixed(2)} para as etapas da Planilha Documental ` +
      `(sem fornecedor, sem vigência, sem VENDA; nenhum preço existente é tocado)`,
    "preco-custo-generico-planilha",
  )

  const criados: Array<{ item: string; configId: number; precoId: number }> = []
  for (const l of aCriar) {
    const configId = l.configId ?? (await prisma.$transaction((tx) =>
      garantirConfigFinanceiraDeItem(tx, { itemCatalogoId: l.alvo.itemId, nome: l.alvo.itemNome }),
    )).id

    // Guarda de duplicidade no ato: se já houver um genérico ativo, não cria
    // outro. O critério de cima já basta, mas dois processos concorrentes não
    // podem produzir duas linhas genéricas para o mesmo item.
    const jaGenerico = await prisma.tabelaValor.findFirst({
      where: { configuracaoFinanceiraItemId: configId, natureza: "CUSTO", fornecedorId: null, arquivado: false },
      select: { id: true },
    })
    if (jaGenerico) {
      console.log(`  ${l.alvo.itemCode.padEnd(26)} já tinha genérico #${jaGenerico.id} — nada criado`)
      continue
    }

    const p = await prisma.tabelaValor.create({
      data: {
        name: `${l.alvo.itemNome} · CUSTO · genérico`,
        configuracaoFinanceiraItemId: configId,
        itemCatalogoId: l.alvo.itemId,
        natureza: "CUSTO",
        moeda: MOEDA,
        modoCalculo: "fixed",
        valor: CUSTO_GENERICO,
        unidade: "DOCUMENTO",
        // SEM fornecedor: é o que faz dele o fallback. SEM vigência: validade é
        // estado (arquivado), nunca data.
        fornecedorId: null,
        prioridade: 0,
      },
      select: { id: true },
    })
    criados.push({ item: l.alvo.itemCode, configId, precoId: p.id })
    console.log(`  ${l.alvo.itemCode.padEnd(26)} config #${configId} → preço #${p.id}`)
  }

  await prisma.logAuditoria.create({
    data: {
      acao: "PRECO_CUSTO_GENERICO_PLANILHA",
      entidade: "TabelaValor",
      entidadeId: 0,
      descricao:
        `Cadastrado(s) ${criados.length} preço(s) de CUSTO genérico de ${MOEDA} ${CUSTO_GENERICO.toFixed(2)} para as etapas da ` +
        `Planilha Documental, por decisão de negócio. Sem fornecedor e sem vigência. Nenhum preço existente foi alterado; ` +
        `nenhum preço de VENDA foi criado; nenhuma Regra Documental foi tocada.`,
      detalhes: { criados, valor: CUSTO_GENERICO, moeda: MOEDA },
    },
  })

  // ── PROVA IMEDIATA: o resolvedor passa a alcançar todos ───────────────────
  console.log(`\nCONFERÊNCIA — o resolvedor oficial, item a item:`)
  let falhou = 0
  for (const a of alvos) {
    const cfg = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: a.itemId }, select: { id: true } })
    if (!cfg) { console.log(`  ❌ ${a.itemCode}: sem configuração`); falhou++; continue }
    const r = await resolverPrecoPorConfigDB(cfg.id, { processoId: 0, tipoProcessoId: "", natureza: NaturezaPreco.CUSTO })
    const ok = r.ok && !r.conflito && Number(r.valor) === CUSTO_GENERICO
    console.log(`  ${ok ? "✅" : "❌"} ${a.itemCode.padEnd(26)} ${r.ok && !r.conflito ? `${r.moeda} ${r.valor}` : "não resolve"}`)
    if (!ok) falhou++
  }

  const vendas = await prisma.tabelaValor.count({
    where: { itemCatalogoId: { in: alvos.map((a) => a.itemId) }, natureza: { in: ["VENDA", "RECEITA"] }, name: { contains: "genérico" } },
  })
  console.log(`\nPreços de VENDA criados por este script: ${vendas} (tem de ser 0).`)
  if (falhou > 0 || vendas !== 0) process.exitCode = 1
  else console.log(`\n✅ toda etapa da matriz resolve ${MOEDA} ${CUSTO_GENERICO.toFixed(2)} de custo.\n`)
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
