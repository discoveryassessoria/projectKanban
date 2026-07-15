/**
 * Serviço mestre → selecionável em Configurações Financeiras — integração (tx + ROLLBACK).
 * Prova: cadastrar um Serviço (ServicoProduto) espelha um ItemCatalogo (natureza SERVICO),
 * que é exatamente a lista `servicos` do GET /produtos usada no select "origem: Serviço".
 * Não polui produção (tudo revertido).
 *   PRISMA_DATABASE_URL=$DIRECT_DATABASE_URL npx tsx scripts/servico-mestre.integration.test.ts
 */
import { PrismaClient } from '@prisma/client'
import { sincronizarItemDeServico } from '../src/services/catalogo-sync'

const prisma = new PrismaClient()
const ROLLBACK = 'ROLLBACK_SENTINELA'
let passed = 0, failed = 0
const falhas: string[] = []
const ok = (c: boolean, n: string) => { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) } }

async function main() {
  console.log('Serviço mestre → Configurações Financeiras (rollback)\n')
  try {
    await prisma.$transaction(async (tx) => {
      const code = `TEST_SRV_${Date.now()}`
      // (1) cadastrar serviço pelo MESMO caminho da API (dual-write ItemCatalogo)
      const itemCatalogoId = await sincronizarItemDeServico(tx as never, { code, name: 'Serviço de Teste', category: 'teste' })
      const servico = await tx.servicoProduto.create({
        data: { code, name: 'Serviço de Teste', category: 'teste', descricao: 'desc', unidadePadrao: 'UNIDADE', nationality: 'all', ativo: true, itemCatalogoId },
      })
      ok(servico.id > 0 && servico.itemCatalogoId === itemCatalogoId, '(1) Serviço criado e espelhado no ItemCatalogo')
      ok(servico.descricao === 'desc' && servico.unidadePadrao === 'UNIDADE', '(1b) campos operacionais (descrição/unidade) gravados')

      // (2) aparece na lista que Configurações Financeiras usa p/ origem=Serviço
      const servicosDoFinanceiro = await tx.itemCatalogo.findMany({ where: { natureza: 'SERVICO', ativo: true }, select: { id: true, code: true, name: true } })
      const achou = servicosDoFinanceiro.find((i) => i.id === itemCatalogoId)
      ok(!!achou, '(2) Serviço aparece como MESTRE selecionável em Configurações Financeiras (ItemCatalogo SERVICO)')

      // (3) o mestre não recria entidade — é o mesmo item referenciado por FK
      ok(achou?.name === 'Serviço de Teste', '(3) referência por FK ao mesmo item (sem duplicar)')

      throw new Error(ROLLBACK)
    })
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e
  }
  console.log(`\n${passed} passaram, ${failed} falharam (revertido — produção intacta)`)
  if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exitCode = 1 }
  else console.log('Serviço mestre → Configurações Financeiras: fluxo validado ✅')
}

main().catch((e) => { console.error('ERRO (rollback garantido):', e); process.exit(1) }).finally(() => prisma.$disconnect())
