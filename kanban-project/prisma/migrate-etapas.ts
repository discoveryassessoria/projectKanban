// Script de migração das etapas do Kanban por país
// Execute com: npx ts-node prisma/migrate-etapas.ts
// Ou adicione ao package.json: "migrate:etapas": "ts-node prisma/migrate-etapas.ts"

import { PrismaClient, Pais } from '@prisma/client'

const prisma = new PrismaClient()

// Definição das etapas por país
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

// Mapeamento de etapas antigas para novas (quando removidas)
// Chave: nome antigo (lowercase), Valor: nome novo sugerido
const mapeamentoEtapas: Record<string, string> = {
  'transcrição': 'Protocolado', // Se Transcrição não existir no país, vai para Protocolado
  'tradução juramentada': 'Retificação', // Se não existir, volta para Retificação
  'apostilamento': 'Retificação', // Se não existir, volta para Retificação
}

async function encontrarEtapaDestino(pais: Pais, nomeEtapaAntiga: string): Promise<string> {
  const etapasNoPais = etapasPorPais[pais]
  const nomeNormalizado = nomeEtapaAntiga.toLowerCase()
  
  // 1. Tenta encontrar mapeamento direto
  const mapeado = mapeamentoEtapas[nomeNormalizado]
  if (mapeado && etapasNoPais.some(e => e.toLowerCase() === mapeado.toLowerCase())) {
    return mapeado
  }
  
  // 2. Tenta encontrar etapa com nome similar no país
  const similar = etapasNoPais.find(e => 
    e.toLowerCase().includes(nomeNormalizado) || 
    nomeNormalizado.includes(e.toLowerCase())
  )
  if (similar) return similar
  
  // 3. Retorna primeira etapa (Genealogia)
  return etapasNoPais[0]
}

async function migrarEtapas() {
  console.log('🚀 Iniciando migração das etapas...\n')

  for (const pais of Object.keys(etapasPorPais) as Pais[]) {
    const etapas = etapasPorPais[pais]
    console.log(`\n📍 Processando ${pais}...`)
    console.log(`   Etapas: ${etapas.join(' → ')}`)

    // 1. Buscar etapas existentes deste país
    const etapasExistentes = await prisma.status.findMany({
      where: { pais },
      include: {
        processos: { select: { id: true } },
        tarefas: { select: { id: true } },
      },
    })

    console.log(`   ${etapasExistentes.length} etapas existentes encontradas`)

    // 2. Criar/Atualizar etapas na ordem correta
    for (let i = 0; i < etapas.length; i++) {
      const nomeEtapa = etapas[i]
      const ordem = i

      // Verifica se já existe
      const existente = etapasExistentes.find(
        (e) => e.nome.toLowerCase() === nomeEtapa.toLowerCase()
      )

      if (existente) {
        // Atualiza ordem se necessário
        if (existente.ordem !== ordem) {
          await prisma.status.update({
            where: { id: existente.id },
            data: { ordem },
          })
          console.log(`   ✏️  Atualizado ordem: "${nomeEtapa}" (${existente.ordem} → ${ordem})`)
        } else {
          console.log(`   ✅ Mantido: "${nomeEtapa}" (ordem ${ordem})`)
        }
      } else {
        // Cria nova etapa
        await prisma.status.create({
          data: {
            nome: nomeEtapa,
            pais,
            ordem,
          },
        })
        console.log(`   ➕ Criado: "${nomeEtapa}" (ordem ${ordem})`)
      }
    }

    // 3. Identificar etapas que precisam ser removidas
    const nomesNovos = etapas.map((e) => e.toLowerCase())
    const etapasParaRemover = etapasExistentes.filter(
      (e) => !nomesNovos.includes(e.nome.toLowerCase())
    )

    if (etapasParaRemover.length > 0) {
      console.log(`\n   🔄 Etapas a serem removidas/migradas:`)

      for (const etapaAntiga of etapasParaRemover) {
        const processosVinculados = etapaAntiga.processos.length
        const tarefasVinculadas = etapaAntiga.tarefas.length

        if (processosVinculados > 0 || tarefasVinculadas > 0) {
          // Encontrar etapa destino usando mapeamento inteligente
          const nomeEtapaDestino = await encontrarEtapaDestino(pais, etapaAntiga.nome)
          
          const etapaDestino = await prisma.status.findFirst({
            where: {
              pais,
              nome: nomeEtapaDestino,
            },
          })

          if (etapaDestino) {
            // Mover processos
            if (processosVinculados > 0) {
              await prisma.processo.updateMany({
                where: { statusId: etapaAntiga.id },
                data: { statusId: etapaDestino.id },
              })
              console.log(
                `      📦 Movidos ${processosVinculados} processos de "${etapaAntiga.nome}" → "${etapaDestino.nome}"`
              )
            }

            // Mover tarefas
            if (tarefasVinculadas > 0) {
              await prisma.tarefa.updateMany({
                where: { statusId: etapaAntiga.id },
                data: { statusId: etapaDestino.id },
              })
              console.log(
                `      📋 Movidas ${tarefasVinculadas} tarefas de "${etapaAntiga.nome}" → "${etapaDestino.nome}"`
              )
            }
          }
        }

        // Remover etapa antiga
        await prisma.status.delete({
          where: { id: etapaAntiga.id },
        })
        console.log(`      🗑️  Removida: "${etapaAntiga.nome}"`)
      }
    }
  }

  // Resumo final
  console.log('\n\n📊 RESUMO FINAL:')
  for (const pais of Object.keys(etapasPorPais) as Pais[]) {
    const etapas = await prisma.status.findMany({
      where: { pais },
      orderBy: { ordem: 'asc' },
      include: {
        _count: { select: { processos: true } },
      },
    })

    console.log(`\n${pais}:`)
    etapas.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.nome} (${e._count.processos} processos)`)
    })
  }

  console.log('\n✅ Migração concluída com sucesso!')
}

migrarEtapas()
  .catch((error) => {
    console.error('❌ Erro na migração:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })