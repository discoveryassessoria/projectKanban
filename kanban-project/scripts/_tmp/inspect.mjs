import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const procs = await prisma.processo.findMany({
  where: { OR: [{ nome: { contains: 'Teste', mode: 'insensitive' } }, { codigo: { contains: 'Teste', mode: 'insensitive' } }] },
  select: { id: true, nome: true, codigo: true, publicCode: true, pais: true, faseAtualKey: true, createdAt: true },
  orderBy: { id: 'desc' }, take: 20,
})
console.log('PROCESSOS Teste:', JSON.stringify(procs, null, 2))
const total = await prisma.processo.count()
console.log('total processos:', total)
const ultimos = await prisma.processo.findMany({ select: { id: true, nome: true, faseAtualKey: true, createdAt: true }, orderBy: { id: 'desc' }, take: 10 })
console.log('ultimos:', JSON.stringify(ultimos, null, 2))
const admins = await prisma.usuario.findMany({ where: { tipo: 'admin' }, select: { id: true, nome: true, email: true, tipo: true }, take: 5 })
console.log('admins:', JSON.stringify(admins, null, 2))
await prisma.$disconnect()
