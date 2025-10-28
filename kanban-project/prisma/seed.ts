import { PrismaClient } from '@prisma/client'
import { hash } from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // Verificar se o usuário admin já existe
  const adminExistente = await prisma.usuario.findUnique({
    where: { email: 'admin@teste.com' }
  })

  if (adminExistente) {
    console.log('⚠️  Usuário admin já existe no banco de dados')
    return
  }

  // Criar hash da senha
  const senhaHash = await hash('12345678', 10)

  // Criar usuário admin
  const admin = await prisma.usuario.create({
    data: {
      nome: 'Administrador',
      email: 'admin@teste.com',
      senha: senhaHash,
      tipo: 'admin'
    }
  })

  console.log('✅ Usuário admin criado com sucesso!')
  console.log('📧 Email: admin@teste.com')
  console.log('🔑 Senha: 12345678')
  console.log(`👤 ID: ${admin.id}`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Erro ao executar seed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
