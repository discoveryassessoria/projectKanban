// scripts/paridade-config-financeira-certidoes.ts
// ============================================================================
// PARIDADE ESTRUTURAL — todo item do Catálogo tem a sua Configuração Financeira.
//
// ─── O QUE O SMOKE ENCONTROU ────────────────────────────────────────────────
// A coluna "Certidão Inteiro Teor" resolvia o item na linha do nascimento e na
// do casamento, e não resolvia na do óbito. A causa não é a matriz: é que
// `CERT_OBITO_IT` nunca ganhou Configuração Financeira, enquanto os seus dois
// irmãos ganharam.
//
// Hoje o cadastro cria essa configuração sozinho para todo item novo
// (`garantirConfigFinanceiraDeItem`, chamado dentro do fluxo de Serviço). Os
// itens de certidão são anteriores a isso, e ficaram desemparelhados.
//
// ─── POR QUE ISTO NÃO É INVENTAR NADA ───────────────────────────────────────
// A Configuração Financeira é o ENDEREÇO onde o preço mora — não é o preço. Um
// item de custo sem ela não pode ser precificado nunca, por ninguém. Este
// script cria só o endereço, pelo MESMO serviço canônico que o cadastro usa, e
// é idempotente: item que já tem a sua não é tocado.
//
// NÃO cria preço. NÃO cria fornecedor. NÃO cria regra de aplicabilidade.
//
//   Dry-run:  npx tsx scripts/paridade-config-financeira-certidoes.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/paridade-config-financeira-certidoes.ts --execute
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
import { garantirConfigFinanceiraDeItem } from "@/src/services/config-financeira-auto"

const EXECUTAR = process.argv.includes("--execute")

async function main() {
  // O recorte é o que a planilha usa como LINHA: os tipos documentais marcados
  // como `participaPlanilha`, pelo item que cada um declara. Nada de lista fixa.
  const tipos = await prisma.tipoDocumentoCadastro.findMany({
    where: { participaPlanilha: true, itemCatalogoId: { not: null } },
    select: { id: true, name: true, itemCatalogoId: true, itemCatalogo: { select: { id: true, code: true, name: true } } },
    orderBy: { id: "asc" },
  })

  const semConfig: Array<{ itemId: number; code: string; nome: string }> = []
  console.log(`\nREGISTROS DA PLANILHA (${tipos.length}):`)
  for (const t of tipos) {
    const cfg = await prisma.produtoFinanceiro.findUnique({
      where: { itemCatalogoId: t.itemCatalogoId! },
      select: { id: true },
    })
    console.log(`  ${t.name.padEnd(40)} item=${t.itemCatalogo?.code} ${cfg ? `config #${cfg.id}` : "SEM CONFIGURAÇÃO FINANCEIRA"}`)
    if (!cfg) semConfig.push({ itemId: t.itemCatalogoId!, code: t.itemCatalogo?.code ?? "", nome: t.itemCatalogo?.name ?? t.name })
  }

  if (semConfig.length === 0) {
    console.log(`\n✅ paridade já existe: todo registro da planilha tem onde o preço morar.\n`)
    return
  }

  console.log(`\nA CRIAR (${semConfig.length}) — só o endereço do preço, sem valor:`)
  for (const s of semConfig) console.log(`  ${s.code} :: ${s.nome}`)

  if (!EXECUTAR) {
    console.log(`\nDRY-RUN: nada foi escrito.`)
    console.log(`Aplicar: EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/paridade-config-financeira-certidoes.ts --execute\n`)
    return
  }

  exigirConfirmacaoDeEscritaEmProducao(
    `cria ${semConfig.length} Configuração(ões) Financeira(s) faltante(s) para itens de registro civil (SEM preço, SEM fornecedor, SEM regra)`,
    "paridade-config-financeira-certidoes",
  )

  const criadas: Array<{ itemId: number; configId: number }> = []
  for (const s of semConfig) {
    const r = await prisma.$transaction((tx) => garantirConfigFinanceiraDeItem(tx, { itemCatalogoId: s.itemId, nome: s.nome }))
    if (r.criado) criadas.push({ itemId: s.itemId, configId: r.id })
    console.log(`  ${s.code} → config #${r.id} ${r.criado ? "(criada)" : "(já existia)"}`)
  }

  await prisma.logAuditoria.create({
    data: {
      acao: "CONFIG_FINANCEIRA_PARIDADE",
      entidade: "ProdutoFinanceiro",
      entidadeId: 0,
      descricao:
        `Criada(s) ${criadas.length} Configuração(ões) Financeira(s) para item(ns) de registro civil que não tinham onde o preço morar. ` +
        `Nenhum preço, fornecedor ou regra de aplicabilidade foi criado.`,
      detalhes: { criadas, itens: semConfig },
    },
  })

  // A prova: nenhuma delas nasce com preço.
  const comPreco = await prisma.tabelaValor.count({
    where: { configuracaoFinanceiraItemId: { in: criadas.map((c) => c.configId) } },
  })
  console.log(`\n✅ ${criadas.length} criada(s). Preços cadastrados nelas: ${comPreco} (tem de ser 0).`)
  if (comPreco !== 0) process.exitCode = 1
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
