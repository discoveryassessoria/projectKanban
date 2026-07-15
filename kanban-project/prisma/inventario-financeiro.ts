// prisma/inventario-financeiro.ts
// ============================================================================
// INVENTÁRIO FINANCEIRO — SOMENTE LEITURA (Fase 1 / Fase 14 saneamento).
// Relatório de duplicidades, marcadores de teste, zeros, órfãos e vínculos-texto.
// NÃO escreve NADA. NÃO decide exclusões (ver Fase 14/15).
//
// Lógica de checagem: prisma/_financeiro-checks.ts (pura, testada).
// Coleta (leitura): prisma/_financeiro-coleta.ts.
//
// Rodar (após o fim da migração Legacy→V2 concorrente):
//   npx tsx prisma/inventario-financeiro.ts
//   npx tsx prisma/inventario-financeiro.ts --json
// ============================================================================

import { PrismaClient } from '@prisma/client'
import { coletarDadosFinanceiros } from './_financeiro-coleta'
import { analisarFinanceiro } from './_financeiro-checks'

const prisma = new PrismaClient()
const JSON_OUT = process.argv.includes('--json')

async function main() {
  const dados = await coletarDadosFinanceiros(prisma)
  const achados = analisarFinanceiro(dados)

  const contagens = {
    produtoFinanceiro: dados.produtos.length, itemCatalogo: dados.itens.length, tabelaValor: dados.precos.length,
    honorario: dados.honorarios.length, phaseEconomicRule: dados.econRules.length, phaseTriggerRule: dados.triggerRules.length,
    tipoDocumentoCadastro: dados.tiposDoc.length, servicoProduto: dados.servicos.length, tipoServico: dados.tiposServico.length,
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ contagens, achados }, null, 2))
    return
  }

  console.log('\n=== INVENTÁRIO FINANCEIRO (somente leitura) ===\n')
  console.log('Contagens:', JSON.stringify(contagens))
  console.log('\n--- Achados (⛔ = gate de cutover; ⚠️ = limpeza) ---')
  for (const a of achados) {
    const icon = a.total === 0 ? '✅' : a.gate ? '⛔' : '⚠️ '
    console.log(`${icon} [${a.total}] ${a.titulo}  (chave: ${a.chave}${a.gate ? ', GATE' : ''})`)
    if (a.total > 0) for (const r of a.amostra) console.log('      ·', JSON.stringify(r))
  }
  console.log('\nNADA foi escrito. Este relatório NÃO decide exclusões — ver Fase 14/15.')
}

main()
  .catch((e) => { console.error('ERRO no inventário (somente leitura):', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
