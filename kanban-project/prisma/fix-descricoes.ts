import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const perfis = await prisma.perfil.findMany()
  for (const p of perfis) {
    if (p.descricao && !p.descricao.endsWith('.')) {
      await prisma.perfil.update({
        where: { id: p.id },
        data: { descricao: p.descricao + '.' }
      })
      console.log(`✅ ${p.nome}: ${p.descricao}.`)
    }
  }
}

main().finally(() => prisma.$disconnect())