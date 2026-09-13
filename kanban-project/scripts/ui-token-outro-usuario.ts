// scripts/ui-token-outro-usuario.ts
//
// Emite um token de vida curta para um usuário QUALQUER (não o admin de
// tests/ui/global-setup.ts), só para o teste de RBAC de
// tests/ui/etapa4-sino-notificacoes.spec.ts provar que o destinatário ERRADO
// não marca a notificação de outra pessoa como lida.
//
// Mesma razão de scripts/ui-token.ts para viver em processo separado: `jose`
// é ESM puro e não sobrevive ao transform do Playwright dentro do arquivo de
// teste. Não cria usuário, não altera nada — só lê e assina.
import { prisma } from '@/lib/prisma'
import { signAuthToken } from '@/lib/auth-jwt'

async function main() {
  const userId = Number(process.argv[2])
  if (!userId) throw new Error('uso: ui-token-outro-usuario.ts <userId>')
  const u = await prisma.usuario.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, tipo: true } })
  const token = await signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
  process.stdout.write(token)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(String(e)); process.exit(1) })
