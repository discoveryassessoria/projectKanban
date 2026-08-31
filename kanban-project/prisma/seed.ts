// ESTE ARQUIVO VAI EM: prisma/seed.ts
// Versão atualizada com etapas específicas por país

import { PrismaClient } from '@prisma/client'
import { hash } from 'bcrypt'

const prisma = new PrismaClient()

// Etapas específicas por país
// CHAVE DO CADASTRO, não enum: o enum `Pais` foi removido: era peso morto —
// nenhuma coluna o usava e a fonte real sempre foi CatalogoPais.
const etapasPorPais: Record<string, string[]> = {
  ITALIA: [
    'Genealogia',
    'Busca Documental',
    'Emissão de Documentos',
    'Análise Documental',
    'Retificação',
    'Tradução Juramentada',
    'Apostilamento',
    'Aguardando Protocolo',
    'Protocolado',
    'Transcrição',
    'Finalizado',
  ],
  ESPANHA: [
    'Genealogia',
    'Busca Documental',
    'Emissão de Documentos',
    'Análise Documental',
    'Retificação',
    'Apostilamento',
    'Aguardando Protocolo',
    'Protocolado',
    'Fase 2',
    'Análise Consular',
    'Finalizado',
  ],
  ALEMANHA: [
    'Genealogia',
    'Busca Documental',
    'Emissão de Documentos',
    'Análise Documental',
    'Retificação',
    'Tradução Juramentada',
    'Aguardando Protocolo',
    'Protocolado',
    'Análise Consular',
    'Finalizado',
  ],
  PORTUGAL: [
    'Genealogia',
    'Busca Documental',
    'Emissão de Documentos',
    'Análise Documental',
    'Retificação',
    'Apostilamento',
    'Aguardando Protocolo',
    'Protocolado',
    'Análise Conservatória',
    'Finalizado',
  ],
}

const paises: string[] = ['ALEMANHA', 'ESPANHA', 'ITALIA', 'PORTUGAL']

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...')

  // ===== CRIAR USUÁRIO ADMIN =====
  // CP-SEC — sem senha fixa no código. A senha do admin vem de env
  // (ADMIN_SEED_PASSWORD, >=8 chars) e NÃO sobrescreve a senha de um admin
  // já existente (o update não toca no campo `senha`).
  const adminEmail = (process.env.ADMIN_SEED_EMAIL || 'admin@teste.com').toLowerCase()
  const existenteAdmin = await prisma.usuario.findUnique({ where: { email: adminEmail } })

  if (existenteAdmin) {
    console.log(`ℹ️  Admin já existe (${adminEmail}); senha preservada.`)
  } else {
    const senhaAdmin = process.env.ADMIN_SEED_PASSWORD
    if (!senhaAdmin || senhaAdmin.length < 8) {
      throw new Error(
        'ADMIN_SEED_PASSWORD ausente ou curto (>=8). Defina no ambiente antes de semear o admin.'
      )
    }
    const senhaHash = await hash(senhaAdmin, 10)
    const admin = await prisma.usuario.create({
      data: {
        nome: 'Administrador',
        email: adminEmail,
        senha: senhaHash,
        tipo: 'admin',
      },
    })
    console.log(`✅ Usuário admin criado: ${admin.email}`)
  }

  // ===== CRIAR ETAPAS POR PAÍS =====
  console.log('\n📋 Criando etapas por país...')

  for (const pais of paises) {
    const etapas = etapasPorPais[pais]
    console.log(`\n   ${pais}:`)

    for (let i = 0; i < etapas.length; i++) {
      const nomeEtapa = etapas[i]

      await prisma.status.upsert({
        where: {
          nome_pais: {
            nome: nomeEtapa,
            pais: pais,
          },
        },
        update: {
          ordem: i,
        },
        create: {
          nome: nomeEtapa,
          pais: pais,
          ordem: i,
        },
      })

      console.log(`      ${i + 1}. ${nomeEtapa}`)
    }
  }

  // As Categorias Financeiras foram ELIMINADAS (02/08/2026): não existe mais
  // classificação intermediária — o comportamento financeiro pertence à
  // Configuração Financeira de cada cadastro mestre.

  // ===== RESUMO FINAL =====
  console.log('\n\n📊 RESUMO:')
  
  const totalStatus = await prisma.status.count()
  
  console.log(`   - ${totalStatus} etapas criadas`)
  console.log(`   - 1 usuário admin`)

  console.log('\n✅ Seed concluído com sucesso!')
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })