// prisma/limpa-teste-motor.ts
// Remove SÓ os artefatos criados pela v1 do motor (ruleSource "matriz").
// NÃO toca nas 93 receitas reais (essas têm ruleSource automation/trigger).
// Roda:  npx tsx prisma/limpa-teste-motor.ts
import { prisma } from '@/lib/prisma'

async function main() {
  const arts = await prisma.motorArtefato.findMany({
    where: { ruleSource: 'matriz' },
    select: { targetTable: true, targetId: true },
  })
  const ids = (tabela: string) =>
    arts.filter((a) => a.targetTable === tabela && a.targetId).map((a) => a.targetId as number)

  // parcelas e eventos caem por cascade ao deletar Custo/Receita
  const c = await prisma.custo.deleteMany({ where: { id: { in: ids('Custo') } } })
  const r = await prisma.receita.deleteMany({ where: { id: { in: ids('Receita') } } })
  const t = await prisma.tarefa.deleteMany({ where: { id: { in: ids('Tarefa') } } })
  const a = await prisma.motorArtefato.deleteMany({ where: { ruleSource: 'matriz' } })

  console.log('🧹 Limpeza do teste v1:')
  console.log(`  Custo removidos:   ${c.count}`)
  console.log(`  Receita removidas: ${r.count}`)
  console.log(`  Tarefa removidas:  ${t.count}`)
  console.log(`  MotorArtefato:     ${a.count}`)
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect())