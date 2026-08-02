// CRIAR EM: prisma/seed-financas.ts
// EXECUTAR COM: npx ts-node prisma/seed-financas.ts

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  // As Categorias Financeiras foram ELIMINADAS (02/08/2026): o comportamento
  // financeiro vive na Configuração Financeira do próprio cadastro mestre.

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