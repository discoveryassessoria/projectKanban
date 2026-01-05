// CRIAR EM: prisma/seed-financas.ts
// EXECUTAR COM: npx ts-node prisma/seed-financas.ts

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Criando categorias financeiras...")

  // Categorias de SAÍDA (despesas)
  const categoriasSaida = [
    { nome: "Aluguel", cor: "#EF4444" },
    { nome: "Água e Luz", cor: "#F59E0B" },
    { nome: "Telecomunicações", cor: "#3B82F6" },
    { nome: "Material de Escritório", cor: "#8B5CF6" },
    { nome: "Serviços Profissionais", cor: "#EC4899" },
    { nome: "Honorários Advocatícios", cor: "#6366F1" },
    { nome: "Impostos e Taxas", cor: "#DC2626" },
    { nome: "Salários", cor: "#059669" },
    { nome: "Marketing", cor: "#F97316" },
    { nome: "Viagens", cor: "#0EA5E9" },
    { nome: "Alimentação", cor: "#84CC16" },
    { nome: "Manutenção", cor: "#A855F7" },
    { nome: "Software e Assinaturas", cor: "#14B8A6" },
    { nome: "Despesas Bancárias", cor: "#64748B" },
    { nome: "Outras Despesas", cor: "#78716C" },
  ]

  for (const cat of categoriasSaida) {
    await prisma.categoriaFinanceira.upsert({
      where: { 
        id: -1 // Forçar create se não existir
      },
      update: {},
      create: {
        nome: cat.nome,
        tipo: "SAIDA",
        cor: cat.cor,
        ativo: true,
      },
    }).catch(async () => {
      // Se falhar o upsert, tentar criar
      const existe = await prisma.categoriaFinanceira.findFirst({
        where: { nome: cat.nome, tipo: "SAIDA" }
      })
      if (!existe) {
        await prisma.categoriaFinanceira.create({
          data: {
            nome: cat.nome,
            tipo: "SAIDA",
            cor: cat.cor,
            ativo: true,
          }
        })
      }
    })
  }

  // Categorias de ENTRADA (receitas)
  const categoriasEntrada = [
    { nome: "Serviços de Cidadania", cor: "#10B981" },
    { nome: "Consultoria", cor: "#22C55E" },
    { nome: "Tradução Juramentada", cor: "#059669" },
    { nome: "Honorários", cor: "#14B8A6" },
    { nome: "Reembolsos", cor: "#6EE7B7" },
    { nome: "Outras Receitas", cor: "#34D399" },
  ]

  for (const cat of categoriasEntrada) {
    const existe = await prisma.categoriaFinanceira.findFirst({
      where: { nome: cat.nome, tipo: "ENTRADA" }
    })
    if (!existe) {
      await prisma.categoriaFinanceira.create({
        data: {
          nome: cat.nome,
          tipo: "ENTRADA",
          cor: cat.cor,
          ativo: true,
        }
      })
    }
  }

  console.log("✅ Categorias criadas!")

  // Criar conta bancária padrão se não existir
  const contaExiste = await prisma.contaBancaria.findFirst()
  if (!contaExiste) {
    console.log("🏦 Criando conta bancária padrão...")
    await prisma.contaBancaria.create({
      data: {
        nome: "Conta Principal",
        banco: "A definir",
        saldoInicial: 0,
        saldoAtual: 0,
        cor: "#3B82F6",
        ativo: true,
        principal: true,
      }
    })
    console.log("✅ Conta bancária criada!")
  }

  console.log("🎉 Seed financeiro concluído!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })