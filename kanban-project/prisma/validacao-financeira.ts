// prisma/validacao-financeira.ts
// ============================================================================
// GATE DE VALIDAÇÃO FINANCEIRA — SOMENTE LEITURA. Sai com código != 0 se
// QUALQUER invariante de gate estiver violada (Fase 15/16 — prova de cutover):
//   • nenhum vínculo por texto quebrado;
//   • nenhum preço zero/invisível ao motor;
//   • nenhum produto órfão de mestre;
//   • nenhum código de produto duplicado.
//
// NÃO escreve NADA. Usável em CI/pré-cutover:
//   npx tsx prisma/validacao-financeira.ts        (após o freeze)
//   npx tsx prisma/validacao-financeira.ts --json
// ============================================================================

import { PrismaClient } from '@prisma/client'
import { coletarDadosFinanceiros } from './_financeiro-coleta'
import { analisarFinanceiro, violacoesDeGate } from './_financeiro-checks'

const prisma = new PrismaClient()
const JSON_OUT = process.argv.includes('--json')

async function main() {
  const dados = await coletarDadosFinanceiros(prisma)
  const achados = analisarFinanceiro(dados)
  const violacoes = violacoesDeGate(achados)

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: violacoes.length === 0, violacoes }, null, 2))
  } else {
    console.log('\n=== VALIDAÇÃO FINANCEIRA (gate de cutover) ===\n')
    if (violacoes.length === 0) {
      console.log('✅ Nenhuma violação de gate. Elegível para avançar o cutover.')
    } else {
      console.log(`⛔ ${violacoes.length} invariante(s) de gate violada(s):\n`)
      for (const v of violacoes) {
        console.log(`  ⛔ [${v.total}] ${v.titulo}  (${v.chave})`)
        for (const r of v.amostra.slice(0, 10)) console.log('        ·', JSON.stringify(r))
      }
    }
  }

  if (violacoes.length > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error('ERRO na validação (somente leitura):', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
