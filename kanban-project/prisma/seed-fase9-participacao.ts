// prisma/seed-fase9-participacao.ts
// LOTE C · Fase 9 — marca participaPlanilha=true nos tipos que ANTES eram o TIPOS_CERTIDAO
// hardcoded (as 6 certidões). Idempotente. Rodar após db push: npx tsx prisma/seed-fase9-participacao.ts
import { prisma } from '@/lib/prisma'

// os mesmos valores que estavam hardcoded — agora viram configuração
const PARTICIPAM = [
  'CERTIDAO_NASCIMENTO', 'CERTIDAO_NASCIMENTO_INTEIRO_TEOR',
  'CERTIDAO_CASAMENTO', 'CERTIDAO_CASAMENTO_INTEIRO_TEOR',
  'CERTIDAO_OBITO', 'CERTIDAO_OBITO_INTEIRO_TEOR',
]

async function main() {
  const r = await prisma.tipoDocumentoCadastro.updateMany({
    where: { legacyEnumKey: { in: PARTICIPAM } },
    data: { participaPlanilha: true },
  })
  const total = await prisma.tipoDocumentoCadastro.count({ where: { participaPlanilha: true } })
  console.log(`✅ Fase 9: ${r.count} tipos marcados como participaPlanilha (total agora: ${total}).`)
  console.log('   Agora a Planilha lê da CONFIG, não da lista fixa. Marco pode ligar/desligar novos tipos na tela.')
}
main().catch(console.error).finally(() => prisma.$disconnect())