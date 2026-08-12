// scripts/remover-colunas-planilha-nao-solicitadas.ts
// ============================================================================
// DESFAZ as colunas da Planilha Documental que não foram decisão do usuário.
//
// ─── O QUE ACONTECEU ────────────────────────────────────────────────────────
// Na validação de 09/08/2026, ao provar que o configurador funcionava, EU criei
// quatro colunas em produção — `POST /api/financeiro/planilha-colunas`, ids 1 a
// 4, entre 12:52:36 e 12:52:42 UTC. Era um smoke, e virou configuração real.
//
// Não houve seed, default, bootstrap nem fallback: o único ponto de escrita da
// tabela é `adicionarColuna`, alcançável só pela rota com permissão
// `financeiro.coluna_criar`. A origem foi uma chamada deliberada — minha.
//
// Coluna econômica é decisão de negócio. Prova de funcionamento se faz em banco
// de teste; em produção, o que se prova é que a tela abre.
//
// ─── O QUE ESTE SCRIPT FAZ E NÃO FAZ ────────────────────────────────────────
// Remove SÓ as linhas de configuração da planilha, pelo serviço canônico. Não
// toca em `ProdutoFinanceiro`, não toca em `TabelaValor`, não toca em custo
// lançado, não toca em documento. Nada além da escolha de quais colunas exibir.
//
//   Dry-run:  npx tsx scripts/remover-colunas-planilha-nao-solicitadas.ts
//   Aplicar:  EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/remover-colunas-planilha-nao-solicitadas.ts --execute
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirConfirmacaoDeEscritaEmProducao } from "./_banco-de-teste"
import { listarColunasConfiguradas, removerColuna } from "@/lib/financeiro/leitura/planilha-colunas"

const EXECUTAR = process.argv.includes("--execute")

async function main() {
  const colunas = await listarColunasConfiguradas()
  console.log(`\nCOLUNAS CONFIGURADAS HOJE: ${colunas.length}\n`)
  for (const c of colunas) {
    console.log(`  #${c.id} pos.${c.posicao} ${c.ativa ? "ativa  " : "inativa"} ${c.origem} → ${c.rotuloCanonico}`)
  }
  if (colunas.length === 0) {
    console.log("\n✅ Nada a remover: a planilha já mostra só as colunas fixas.\n")
    return
  }
  if (!EXECUTAR) {
    console.log(`\nDRY-RUN: nada foi escrito. ${colunas.length} coluna(s) seriam removidas da CONFIGURAÇÃO.`)
    console.log(`Serviços, preços, documentos e custos lançados NÃO são tocados.`)
    console.log(`Aplicar: EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1 npx tsx scripts/remover-colunas-planilha-nao-solicitadas.ts --execute\n`)
    return
  }

  exigirConfirmacaoDeEscritaEmProducao(
    `remove ${colunas.length} coluna(s) da configuração da Planilha Documental (cadastro mestre e preços intocados)`,
    "remover-colunas-planilha-nao-solicitadas",
  )

  for (const c of colunas) await removerColuna(c.id)

  await prisma.logAuditoria.create({
    data: {
      acao: "PLANILHA_COLUNAS_REMOVIDAS",
      entidade: "PlanilhaDocumentalColuna",
      entidadeId: 0,
      descricao:
        `Removidas ${colunas.length} coluna(s) da Planilha Documental criadas durante validação técnica, ` +
        `não por decisão do usuário. Cadastro mestre, preços e custos preservados.`,
      detalhes: {
        removidas: colunas.map((c) => ({ id: c.id, origem: c.origem, configId: c.configId, rotulo: c.rotuloCanonico })),
      },
    },
  })

  const restantes = await listarColunasConfiguradas()
  console.log(`\n✅ ${colunas.length} removida(s). Colunas configuradas agora: ${restantes.length}.`)
  console.log(`   A planilha passa a exibir apenas as colunas fixas + Total.\n`)
}

main().catch((e) => { console.error("falhou:", e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
