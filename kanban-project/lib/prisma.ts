import { PrismaClient } from "../src/generated/prisma"

const globalForPrisma = globalThis as { prisma?: PrismaClient }

const prismaClientSingleton = () => {
  return new PrismaClient()
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
})

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma