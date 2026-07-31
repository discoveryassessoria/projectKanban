import { PrismaClient } from '@prisma/client'
import { identificador, retratar } from '../../lib/db/identidade-banco.mjs'
const url = process.env.PRISMA_DATABASE_URL
const prisma = new PrismaClient({ datasources: { db: { url } } })
const r = await retratar(prisma)
console.log('id:', identificador(url), 'tabelas=', r.tabelas, 'migrations=', r.migrations, JSON.stringify(r))
await prisma.$disconnect()
