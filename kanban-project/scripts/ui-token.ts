// scripts/ui-token.ts
//
// Emite a identidade técnica da suíte de interface e imprime UMA linha JSON.
//
// Vive em processo separado de propósito: o `jose` (usado para assinar) é ESM
// puro e não sobrevive ao transpile CommonJS do Playwright. Aqui, sob `tsx`,
// funciona sem gambiarra de interop.
//
// Não cria usuário, não altera permissão, não escreve nada. Usa um
// administrador que já existe e um token de vida curta.

import { prisma } from '@/lib/prisma'
import { signAuthToken } from '@/lib/auth-jwt'

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET ausente')

  const admin = await prisma.usuario.findFirst({
    where: { tipo: 'admin' },
    select: { id: true, email: true, tipo: true, nome: true },
    orderBy: { id: 'asc' },
  })
  if (!admin) throw new Error('nenhum administrador cadastrado')

  const token = await signAuthToken({
    userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now(),
  })

  // única saída do processo — o chamador lê e guarda em arquivo ignorado
  process.stdout.write(JSON.stringify({ token, nome: admin.nome, tipo: admin.tipo }))
  await prisma.$disconnect()
}

main().catch((e) => { console.error(String(e)); process.exit(1) })
