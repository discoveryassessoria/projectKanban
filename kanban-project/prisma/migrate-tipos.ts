import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Migrar gestor → gerente
  const gestores = await prisma.usuario.updateMany({
    where: { tipo: 'gestor' },
    data: { tipo: 'gerente' }
  })
  console.log(`✅ ${gestores.count} gestores → gerente`)

  // Migrar usuario → assistente
  const usuarios = await prisma.usuario.updateMany({
    where: { tipo: 'usuario' },
    data: { tipo: 'assistente' }
  })
  console.log(`✅ ${usuarios.count} usuários → assistente`)

  // Mostrar resultado final
  const todos = await prisma.usuario.findMany({
    select: { nome: true, tipo: true }
  })
  console.log('\nResultado:')
  todos.forEach(u => console.log(`  ${u.nome}: ${u.tipo}`))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())