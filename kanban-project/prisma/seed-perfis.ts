// prisma/seed-perfis.ts
// Executar: npx tsx prisma/seed-perfis.ts
// Cria os perfis padrão do sistema (Administrador, Gerente, Assistente, Estagiário)

import { PrismaClient } from '@prisma/client'
import { PERFIS_PADRAO } from '../src/lib/permissoes'

const prisma = new PrismaClient()

async function main() {
  console.log('🔐 Criando perfis padrão de permissões...\n')

  for (const perfil of PERFIS_PADRAO) {
    const existente = await prisma.perfil.findUnique({
      where: { nome: perfil.nome },
    })

    if (existente) {
      // Atualiza permissões se o perfil já existe
      await prisma.perfil.update({
        where: { nome: perfil.nome },
        data: {
          descricao: perfil.descricao,
          permissoes: perfil.permissoes,
          cor: perfil.cor,
          sistema: perfil.sistema,
        },
      })
      console.log(`  ✅ ${perfil.nome} — atualizado`)
    } else {
      // Cria novo
      await prisma.perfil.create({
        data: {
          nome: perfil.nome,
          descricao: perfil.descricao,
          permissoes: perfil.permissoes,
          cor: perfil.cor,
          sistema: perfil.sistema,
        },
      })
      console.log(`  ✅ ${perfil.nome} — criado`)
    }
  }

  // Atribuir perfil "Administrador" a todos os usuários admin existentes
  const perfilAdmin = await prisma.perfil.findUnique({
    where: { nome: 'Administrador' },
  })

  if (perfilAdmin) {
    const admins = await prisma.usuario.updateMany({
      where: {
        tipo: 'admin',
        perfilId: null,
      },
      data: {
        perfilId: perfilAdmin.id,
      },
    })
    if (admins.count > 0) {
      console.log(`\n  👤 ${admins.count} admin(s) vinculado(s) ao perfil Administrador`)
    }
  }

  console.log('\n✨ Perfis criados com sucesso!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())