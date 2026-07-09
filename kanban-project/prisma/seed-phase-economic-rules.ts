// prisma/seed-phase-economic-rules.ts
// Semeia a regra econômica que ANTES estava hardcoded no resolverComponente().
// Preserva 1:1 o comportamento provado no processo 238 (Fatia 1 — Emissão).
// Rodar DEPOIS do `npx prisma db push`:  npx tsx prisma/seed-phase-economic-rules.ts
import { prisma } from '@/lib/prisma'

async function main() {
  const existente = await prisma.phaseEconomicRule.findFirst({
    where: { phaseKey: 'emissao_documental', componentKey: 'CERTIDAO_INTEIRO_TEOR' },
  })
  if (existente) { console.log('já existe — nada a fazer (id', existente.id, ')'); return }

  const r = await prisma.phaseEconomicRule.create({
    data: {
      tipoProcessoId: null,               // qualquer tipo (igual ao switch antigo, que só olhava a fase)
      phaseKey: 'emissao_documental',
      documentTypeCode: null,             // qualquer doc elegível da fase (o kw/keyword ainda filtra nascimento)
      appliesTo: 'any',
      componentKey: 'CERTIDAO_INTEIRO_TEOR',
      componentName: 'Certidão Inteiro Teor',   // = nome da COLUNA (TipoServico) — casa com a planilha
      custoProdutoCode: 'CIT_CUSTO',      // mesmos produtos do teste
      receitaProdutoCode: 'CIT_RECEITA',
      participaPlanilha: true,
      ordem: 0,
      ativo: true,
    },
  })
  console.log('✅ PhaseEconomicRule criada (id', r.id, '): emissao_documental → Certidão Inteiro Teor')
  console.log('   Agora o motor resolve o componente pela CONFIG, não pelo código.')
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect())