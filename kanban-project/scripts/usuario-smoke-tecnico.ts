// scripts/usuario-smoke-tecnico.ts
// ============================================================================
// IDENTIDADE TÉCNICA DE SMOKE — o único jeito de validar produção sem pedir a
// credencial pessoal de ninguém.
//
// Por que existe: `scripts/ui-token.ts` assina um token com o JWT_SECRET do
// ambiente. Isso funciona local e em homologação, onde o segredo está no `.env`.
// Em PRODUÇÃO o JWT_SECRET é Sensitive na Vercel — não é legível nem por quem
// faz o deploy, e está certo que seja assim. Sem segredo não há assinatura, e a
// única porta legítima que sobra é a MESMA que qualquer pessoa usa: o login
// oficial (`POST /api/auth/login`), que devolve um token assinado pelo próprio
// ambiente.
//
// Este script cria (ou reconcilia) o usuário que atravessa essa porta:
//
//   • NÃO é admin. `tipo` fora de 'admin' começa com TODAS as permissões em
//     false — o acesso é só o que este script conceder, nominalmente.
//   • Recebe UMA permissão: `usuarios.gerenciar` ("Ver usuários"), que é o
//     portão exigido pelas rotas de /api/gerenciamento. Não recebe
//     `usuarios.criar/editar/excluir`, então não mexe em gente; e as permissões
//     EXCLUSIVAS (destrutivas, opt-in) continuam fora do seu alcance por
//     construção — `calcularPermissoes` nunca as liga na base.
//   • A senha NUNCA está no código: vem de SMOKE_USER_PASSWORD, guardada no
//     secret manager da Vercel. O script grava só o hash bcrypt.
//   • O nome do usuário DIZ o que ele é, para que ninguém o confunda com
//     pessoa da equipe numa lista de acessos.
//
// Idempotente: rodar de novo reconcilia senha e permissões, não duplica.
// Escrita em produção passa pelo guard oficial (db-guard --exigir producao).
//
// Uso:
//   SMOKE_USER_PASSWORD='…' npx tsx scripts/usuario-smoke-tecnico.ts            (ensaio)
//   SMOKE_USER_PASSWORD='…' npx tsx scripts/usuario-smoke-tecnico.ts --execute  (grava)
// ============================================================================
import { hash } from 'bcrypt'
import { prisma } from '@/lib/prisma'

const EMAIL = process.env.SMOKE_USER_EMAIL ?? 'smoke.tecnico@discoveryassessoria.com.br'
const NOME = 'SMOKE TÉCNICO — validação automatizada (não usar)'
const TIPO = 'servico'
/** Portão único das rotas de /api/gerenciamento. Nada além disto. */
const PERMISSOES = { 'usuarios.gerenciar': true } as const

const executar = process.argv.includes('--execute')

async function main() {
  const senha = process.env.SMOKE_USER_PASSWORD
  if (!senha || senha.length < 24) throw new Error('SMOKE_USER_PASSWORD ausente ou curta demais (mín. 24).')

  const existente = await prisma.usuario.findUnique({ where: { email: EMAIL }, select: { id: true, nome: true, tipo: true, perfilId: true } })
  console.log(`identidade técnica: ${EMAIL}`)
  console.log(`estado atual: ${existente ? `existe (#${existente.id}, tipo=${existente.tipo})` : 'não existe'}`)
  console.log(`permissão concedida: ${Object.keys(PERMISSOES).join(', ')} (e só)`)
  if (!executar) { console.log('\nENSAIO — nada gravado. Repita com --execute.'); return }

  const senhaHash = await hash(senha, 10)
  const dados = {
    nome: NOME, tipo: TIPO, senha: senhaHash,
    // perfil NULO de propósito: o acesso não herda nada de um perfil que possa
    // crescer depois; é só o override individual, explícito e auditável.
    perfilId: null, permissoesCustom: PERMISSOES as object,
  }
  const u = existente
    ? await prisma.usuario.update({ where: { id: existente.id }, data: dados, select: { id: true } })
    : await prisma.usuario.create({ data: { email: EMAIL, ...dados }, select: { id: true } })

  await prisma.logAuditoria.create({
    data: {
      acao: existente ? 'EDITAR' : 'CRIAR',
      entidade: 'Usuario',
      entidadeId: u.id,
      descricao: `Identidade técnica de smoke ${existente ? 'reconciliada' : 'criada'} (${EMAIL}) — permissão única usuarios.gerenciar, senha no secret manager`,
      usuarioId: u.id,
    },
  })
  console.log(`\n✅ usuário técnico #${u.id} ${existente ? 'reconciliado' : 'criado'} e auditado.`)
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1) }).finally(() => prisma.$disconnect())
