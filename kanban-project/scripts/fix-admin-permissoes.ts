// scripts/fix-admin-permissoes.ts
//
// Liga TODAS as permissões atuais no perfil Administrador.
// Use quando o Administrador aparecer com menos permissões que o total
// (isso acontece quando novas permissões são adicionadas ao sistema depois).
// SEGURO: só mexe no perfil Administrador. Pode rodar quantas vezes quiser.
//
// RODAR: npx tsx scripts/fix-admin-permissoes.ts

import { PrismaClient, Prisma } from '@prisma/client'
import { PERMISSOES } from '../src/lib/permissoes'

const prisma = new PrismaClient()

async function main() {
  // pega TODAS as chaves de permissão que o sistema conhece hoje
  const chaves = Object.keys(PERMISSOES)
  const todas: Record<string, boolean> = {}
  chaves.forEach((k) => (todas[k] = true))

  const perfis = await prisma.perfil.findMany()
  const admin = perfis.find((p) => (p.nome || '').trim().toLowerCase() === 'administrador')

  if (!admin) {
    console.log('Perfil "Administrador" não encontrado — nada a fazer.')
    return
  }

  await prisma.perfil.update({
    where: { id: admin.id },
    data: { permissoes: todas as Prisma.InputJsonValue },
  })

  console.log(`Administrador atualizado: ${chaves.length} permissões, todas ligadas.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })