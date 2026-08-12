// scripts/migrar-planilha-para-matriz.ts
// ============================================================================
// TROCA A CONFIGURAÇÃO ERRADA DA PLANILHA PELA MATRIZ CORRETA.
//
// ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
// As colunas apontavam para itens do Cadastro Mestre que pertencem à dimensão
// de LINHA:
//
//   coluna #5 → CFG_ITEM_1 "Certidão de Nascimento - Inteiro Teor"
//   coluna #6 → CFG_ITEM_2 "Certidão de Casamento - Inteiro Teor"
//
// Isso produzia uma matriz diagonal — a linha do nascimento só tinha valor na
// coluna do nascimento — porque a mesma informação estava sendo dita duas
// vezes. São a mesma ETAPA sobre registros diferentes: uma coluna, três linhas.
//
// ─── O QUE ESTE SCRIPT FAZ ──────────────────────────────────────────────────
// Substitui essas colunas por UMA coluna de etapa ancorada na CATEGORIA do
// catálogo a que os três itens pertencem, e acrescenta as colunas de serviço
// que a referência tem, quando o serviço já existir no cadastro.
//
// ─── O QUE ELE NÃO FAZ, EM NENHUMA HIPÓTESE ─────────────────────────────────
// Não apaga Cadastro Mestre. Não apaga Tabela de Preços. Não apaga documento
// operacional, obrigação ou custo lançado. Não cria serviço nem preço: o que
// faltar no cadastro é REPORTADO como pendência, não inventado.
//
//   Dry-run:  npx tsx scripts/migrar-planilha-para-matriz.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/migrar-planilha-para-matriz.ts --execute
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
import {
  listarColunasConfiguradas, adicionarColuna, adicionarColunaDeEtapa, removerColuna, reordenarColunas,
} from "@/lib/financeiro/leitura/planilha-colunas"

const EXECUTAR = process.argv.includes("--execute")

/**
 * A ordem das colunas da referência. Cada uma é uma ETAPA.
 *
 * `categoriaCode` → coluna que resolve o item pela LINHA (a certidão em si).
 * `itemCode`      → coluna de serviço: o mesmo item em todas as linhas.
 *
 * Os códigos são os do catálogo canônico, lidos por `code` (identidade `@unique`
 * do ItemCatalogo), não por nome de exibição.
 */
const COLUNAS_ALVO: Array<{ rotulo: string; categoriaCode?: string; itemCode?: string }> = [
  { rotulo: "Certidão Inteiro Teor", categoriaCode: "REGCIV" },
  { rotulo: "Desmaterialização", itemCode: "SRV_DESMATERIALIZACAO" },
  { rotulo: "Apostilamento certidão", itemCode: "SRV_APOSTILAMENTO_CERTIDAO" },
  { rotulo: "Tradução juramentada", itemCode: "SRV_TRADUCAO_JURAMENTADA" },
  { rotulo: "Apostilamento Tradução", itemCode: "SRV_APOSTILAMENTO_TRADUCAO" },
]

async function main() {
  const antes = await listarColunasConfiguradas()
  console.log(`\nCONFIGURAÇÃO ATUAL (${antes.length} coluna(s)):`)
  for (const c of antes) {
    console.log(`  #${c.id} pos.${c.posicao} ${c.estrategia.padEnd(16)} cfg=${c.configId ?? "-"} cat=${c.categoriaItemId ?? "-"} :: ${c.rotulo}`)
  }

  // Quais colunas são o erro: as de item fixo cujo item está na categoria dos
  // registros civis — ou seja, uma CERTIDÃO virada coluna.
  const catRegistros = await prisma.categoriaServico.findUnique({ where: { code: "REGCIV" }, select: { id: true, nome: true } })
  if (!catRegistros) {
    console.log(`\n⛔ categoria REGCIV não existe no catálogo — sem ela a coluna de certidão não tem âncora canônica.`)
    process.exitCode = 1
    return
  }

  const configs = await prisma.produtoFinanceiro.findMany({
    where: { id: { in: antes.map((c) => c.configId).filter((v): v is number => v != null) } },
    select: { id: true, nome: true, itemCatalogo: { select: { categoriaId: true, natureza: true } } },
  })
  const ehCertidao = new Set(
    configs.filter((c) => c.itemCatalogo?.categoriaId === catRegistros.id).map((c) => c.id),
  )
  const aRemover = antes.filter((c) => c.estrategia === "SERVICO_FIXO" && c.configId != null && ehCertidao.has(c.configId))

  console.log(`\nA REMOVER (documento da dimensão de LINHA usado como coluna): ${aRemover.length}`)
  for (const c of aRemover) console.log(`  #${c.id} :: ${c.rotulo}`)

  // O que existe no cadastro para virar as colunas corretas.
  const plano: Array<{ rotulo: string; acao: string; categoriaItemId?: number; configId?: number }> = []
  const pendencias: string[] = []

  for (const alvo of COLUNAS_ALVO) {
    if (alvo.categoriaCode) {
      const cat = await prisma.categoriaServico.findUnique({ where: { code: alvo.categoriaCode }, select: { id: true } })
      if (!cat) { pendencias.push(`categoria ${alvo.categoriaCode} não cadastrada — coluna "${alvo.rotulo}" não pode ser criada`); continue }
      plano.push({ rotulo: alvo.rotulo, acao: "coluna de etapa (resolve o item pela linha)", categoriaItemId: cat.id })
      continue
    }
    const item = await prisma.itemCatalogo.findUnique({ where: { code: alvo.itemCode! }, select: { id: true } })
    if (!item) { pendencias.push(`item ${alvo.itemCode} não existe no Catálogo — coluna "${alvo.rotulo}" fica pendente de cadastro`); continue }
    const cfg = await prisma.produtoFinanceiro.findFirst({
      where: { itemCatalogoId: item.id, ativo: true },
      select: { id: true },
    })
    if (!cfg) { pendencias.push(`item ${alvo.itemCode} existe mas não tem Configuração Financeira ativa — coluna "${alvo.rotulo}" fica pendente`); continue }
    plano.push({ rotulo: alvo.rotulo, acao: "coluna de serviço (item fixo em todas as linhas)", configId: cfg.id })
  }

  console.log(`\nA CRIAR/MANTER (${plano.length}):`)
  for (const p of plano) console.log(`  ${p.rotulo.padEnd(26)} ${p.acao}`)

  if (pendencias.length) {
    console.log(`\nPENDÊNCIAS DE CADASTRO (nada é inventado — a coluna simplesmente não nasce):`)
    for (const p of pendencias) console.log(`  · ${p}`)
  }

  if (!EXECUTAR) {
    console.log(`\nDRY-RUN: nada foi escrito.`)
    console.log(`Aplicar: EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/migrar-planilha-para-matriz.ts --execute\n`)
    return
  }

  exigirConfirmacaoDeEscritaEmProducao(
    `substitui ${aRemover.length} coluna(s) de documento por ${plano.length} coluna(s) de etapa na Planilha Documental ` +
      `(Cadastro Mestre, Tabela de Preços e custos lançados INTOCADOS)`,
    "migrar-planilha-para-matriz",
  )

  for (const c of aRemover) await removerColuna(c.id)

  const criadas: number[] = []
  for (const p of plano) {
    const col = p.categoriaItemId != null
      ? await adicionarColunaDeEtapa({ categoriaItemId: p.categoriaItemId, rotuloOverride: p.rotulo })
      : await adicionarColuna({ origem: "SERVICO", itemId: p.configId!, rotuloOverride: p.rotulo })
    criadas.push(col.id)
  }
  // A ordem é a da referência — e ordem é POSIÇÃO, nunca nome.
  await reordenarColunas(criadas)

  await prisma.logAuditoria.create({
    data: {
      acao: "PLANILHA_MIGRADA_PARA_MATRIZ",
      entidade: "PlanilhaDocumentalColuna",
      entidadeId: 0,
      descricao:
        `Planilha Documental migrada para matriz: ${aRemover.length} coluna(s) de documento removida(s) da configuração ` +
        `e ${criadas.length} coluna(s) de etapa configurada(s). Registro civil passa a ser LINHA; etapa/serviço, COLUNA. ` +
        `Cadastro Mestre, Tabela de Preços e custos lançados preservados.`,
      detalhes: {
        removidas: aRemover.map((c) => ({ id: c.id, rotulo: c.rotulo, configId: c.configId })),
        criadas, pendencias,
      },
    },
  })

  const depois = await listarColunasConfiguradas()
  console.log(`\n✅ configuração final (${depois.length}):`)
  for (const c of depois) console.log(`  #${c.id} pos.${c.posicao} ${c.estrategia.padEnd(16)} :: ${c.rotulo}`)
  if (pendencias.length) console.log(`\n⚠ ${pendencias.length} pendência(s) de cadastro acima — nenhuma coluna foi inventada.`)
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
