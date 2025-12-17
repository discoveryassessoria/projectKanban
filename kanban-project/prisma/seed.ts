import { PrismaClient, Pais } from '@prisma/client'
import { hash } from 'bcrypt'

const prisma = new PrismaClient()

// Etapas padrão para todos os países
const etapasPadrao = [
  'Busca Documental',
  'Emissão de Documentos',
  'Análise Documental',
  'Retificação',
  'Tradução Juramentada',
  'Apostilamento',
  'Aguardando Protocolo',
  'Protocolado',
  'Transcrição',
]

const paises: Pais[] = [Pais.ALEMANHA, Pais.ESPANHA, Pais.ITALIA, Pais.PORTUGAL]

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // ===== CRIAR USUÁRIO ADMIN =====
  const adminExistente = await prisma.usuario.findUnique({
    where: { email: 'admin@teste.com' }
  })

  if (adminExistente) {
    console.log('⚠️  Usuário admin já existe no banco de dados')
  } else {
    const senhaHash = await hash('12345678', 10)

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

  // ===== CRIAR ETAPAS DE KANBAN =====
  console.log('\n📋 Criando etapas do Kanban...')

  for (const pais of paises) {
    console.log(`\n🌍 ${pais}:`)

    for (let i = 0; i < etapasPadrao.length; i++) {
      const nome = etapasPadrao[i]

      // Verificar se já existe
      const existente = await prisma.status.findFirst({
        where: {
          nome,
          pais,
        },
      })

      if (existente) {
        console.log(`   ⏭️  "${nome}" já existe`)
        continue
      }

      await prisma.status.create({
        data: {
          nome,
          pais,
          ordem: i,
        },
      })

      console.log(`   ✅ "${nome}"`)
    }
  }

  console.log('\n✨ Seed concluído com sucesso!')
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