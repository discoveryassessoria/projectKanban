// Fixtures MÍNIMAS e idempotentes do banco de TESTE do Financeiro.
// Os testes de custo referenciam o usuário 1 (ator das ações auditadas) e o processo 16.
// Este script NUNCA roda contra produção: aborta se a URL não for local.
import { prisma } from '@/lib/prisma'

async function main() {
  const url = process.env.PRISMA_DATABASE_URL ?? ''
  if (!/(127\.0\.0\.1|localhost)/.test(url)) {
    console.error('❌ Recusado: PRISMA_DATABASE_URL não é local. Este seed é EXCLUSIVO do banco de teste.')
    process.exit(1)
  }

  const existente = await prisma.usuario.findUnique({ where: { id: 1 } })
  if (!existente) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Usuario" (id, nome, email, senha, tipo) VALUES (1, 'Ator de Teste', 'ator-teste@local', 'x', 'admin')
       ON CONFLICT (id) DO NOTHING`,
    )
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Usuario"', 'id'), GREATEST((SELECT MAX(id) FROM "Usuario"), 1))`,
    )
  }
  const u = await prisma.usuario.findUnique({ where: { id: 1 }, select: { id: true, email: true } })
  console.log(`✅ usuário de teste pronto: #${u?.id} ${u?.email}`)

  if (!(await prisma.processo.findUnique({ where: { id: 16 } }))) {
    await prisma.processo.create({ data: { id: 16, nome: 'Processo de Teste — Financeiro',} })
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Processo"', 'id'), GREATEST((SELECT MAX(id) FROM "Processo"), 16))`,
    )
  }
  const p = await prisma.processo.findUnique({ where: { id: 16 }, select: { id: true, nome: true } })
  console.log(`✅ processo de teste pronto: #${p?.id} ${p?.nome}`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
