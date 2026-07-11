// ESTE ARQUIVO VAI EM: prisma/seed.ts
// Versão atualizada com etapas específicas por país

import { PrismaClient, Pais } from '@prisma/client'
import { hash } from 'bcrypt'

const prisma = new PrismaClient()

// Etapas específicas por país
const etapasPorPais: Record<Pais, string[]> = {
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

const paises: Pais[] = [Pais.ALEMANHA, Pais.ESPANHA, Pais.ITALIA, Pais.PORTUGAL]

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

  // ===== CRIAR CATEGORIAS FINANCEIRAS PADRÃO =====
  console.log('\n💰 Criando categorias financeiras...')

  const categoriasEntrada = [
    { nome: 'Honorários', cor: '#22c55e', icone: 'banknotes' },
    { nome: 'Reembolsos', cor: '#3b82f6', icone: 'arrow-uturn-left' },
    { nome: 'Outros Recebimentos', cor: '#8b5cf6', icone: 'plus-circle' },
  ]

  const categoriasSaida = [
    { nome: 'Certidões', cor: '#ef4444', icone: 'document-text' },
    { nome: 'Traduções', cor: '#f97316', icone: 'language' },
    { nome: 'Apostilamentos', cor: '#eab308', icone: 'stamp' },
    { nome: 'Taxas Consulares', cor: '#14b8a6', icone: 'building-library' },
    { nome: 'Despesas Operacionais', cor: '#6366f1', icone: 'cog' },
    { nome: 'Impostos', cor: '#ec4899', icone: 'receipt-percent' },
    { nome: 'Outras Despesas', cor: '#78716c', icone: 'minus-circle' },
  ]

  for (const cat of categoriasEntrada) {
    await prisma.categoriaFinanceira.upsert({
      where: { id: -1 }, // Força criar se não existir por nome
      update: {},
      create: {
        nome: cat.nome,
        tipo: 'ENTRADA',
        cor: cat.cor,
        icone: cat.icone,
      },
    }).catch(async () => {
      // Se já existe, ignora
      const existe = await prisma.categoriaFinanceira.findFirst({
        where: { nome: cat.nome, tipo: 'ENTRADA' }
      })
      if (!existe) {
        await prisma.categoriaFinanceira.create({
          data: {
            nome: cat.nome,
            tipo: 'ENTRADA',
            cor: cat.cor,
            icone: cat.icone,
          }
        })
      }
    })
  }

  for (const cat of categoriasSaida) {
    const existe = await prisma.categoriaFinanceira.findFirst({
      where: { nome: cat.nome, tipo: 'SAIDA' }
    })
    if (!existe) {
      await prisma.categoriaFinanceira.create({
        data: {
          nome: cat.nome,
          tipo: 'SAIDA',
          cor: cat.cor,
          icone: cat.icone,
        }
      })
    }
  }

  console.log('   ✅ Categorias financeiras criadas')

  // ===== RESUMO FINAL =====
  console.log('\n\n📊 RESUMO:')
  
  const totalStatus = await prisma.status.count()
  const totalCategorias = await prisma.categoriaFinanceira.count()
  
  console.log(`   - ${totalStatus} etapas criadas`)
  console.log(`   - ${totalCategorias} categorias financeiras`)
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